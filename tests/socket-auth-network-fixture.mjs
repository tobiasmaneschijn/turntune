// Test-only transport. The real JWT verifier uses an ephemeral public JWKS and
// every operation remains local: provider/real-project traffic is prohibited.
const origin = "https://soundspin-socket-auth.invalid";
const userId = "11111111-1111-4111-8111-111111111111";
let state = { id: "auth-room", name: "Auth room", ownerUserId: userId, moderatorUserIds: [], djRoleUserIds: [],
  isPublic: true, passwordProtected: false, settings: {}, djUserId: null, djQueueUserIds: [], djQueues: {}, history: [],
  playback: { track: null, playing: false, position: 0, updatedAt: 1 }, vibe: null, createdAt: 1 };
const profile = { user_id: userId, display_name: "Verified listener", is_app_admin: false, avatar_key: "default", avatar_url: null };
const metadata = () => ({ slug: state.id, state, name: state.name, owner_id: userId, is_public: true, access_mode: "public", password_hash: null, settings: state.settings });
let accountSuspended = false, roomDisabled = false;
process.on("message", message => {
  if (message?.fixture === "account") accountSuspended = message.disabled === true;
  else if (message?.fixture === "room") roomDisabled = message.disabled === true;
  else return;
  process.send?.({ fixtureUpdated: message.fixture });
});
// The HTTP listener owns fixture lifetime; IPC must not keep a stopped server alive.
process.channel?.unref();
const emptyTables = new Set(["soundspin_account_restrictions", "soundspin_room_restrictions", "soundspin_room_moderation", "soundspin_storage_deletion_outbox"]);
const maintenance = new Map([["soundspin_release_ready", true], ["soundspin_collect_expired_uploads", 0], ["soundspin_prune_security_retention", {}], ["soundspin_purge_security_archives", {}], ["soundspin_claim_account_deletion", null]]);
const json = value => Response.json(value);

globalThis.fetch = async (input, init) => {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : String(input));
  const method = init?.method || request?.method || "GET";
  const headers = new Headers(init?.headers || request?.headers);
  if (url.origin !== origin) throw new Error("Socket auth test blocked an unexpected outbound request.");
  if (url.pathname === `/auth/v1/admin/users/${userId}` && method === "GET") return json({ user: { id: userId, email: "verified@example.invalid", email_confirmed_at: "2026-01-01T00:00:00Z", app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-01-01T00:00:00Z" } });
  const table = url.pathname.split("/").at(-1);
  if (url.pathname.startsWith("/rest/v1/rpc/") && method === "POST") {
    const body = JSON.parse(init?.body || await request?.text() || "{}");
    if (maintenance.has(table)) return json(maintenance.get(table));
    if (table === "soundspin_room_enabled") return json(body.p_room_slug === "auth-room" && !roomDisabled && !accountSuspended);
    if (table === "soundspin_admit_room") {
      if (body.p_slug !== "auth-room" || body.p_user_id !== userId || body.p_password_hash !== null) throw new Error("Invalid test admission request.");
      return json({ role: "owner" });
    }
    if (["soundspin_commit_room", "soundspin_commit_room_v2"].includes(table)) {
      if (body.p_slug !== "auth-room" || !body.p_state) throw new Error("Invalid test room commit.");
      state = body.p_state;
      return json(true);
    }
  }
  if (method === "GET" && table === "soundspin_account_restrictions" && accountSuspended) return json(headers.get("accept")?.includes("vnd.pgrst.object") ? { user_id: userId, state: "suspended" } : [{ user_id: userId, state: "suspended" }]);
  if (method === "GET" && table === "soundspin_room_restrictions" && roomDisabled) return json(headers.get("accept")?.includes("vnd.pgrst.object") ? { room_slug: "auth-room", disabled: true, owner_suspended: false } : [{ room_slug: "auth-room", disabled: true, owner_suspended: false }]);
  if (["GET", "HEAD"].includes(method) && emptyTables.has(table)) return new Response(method === "HEAD" ? null : headers.get("accept")?.includes("vnd.pgrst.object") ? "null" : "[]", { status: 200, headers: { "Content-Type": "application/json", "Content-Range": "*/0" } });
  if (method === "GET" && ["soundspin_rooms", "soundspin_profiles", "soundspin_room_members"].includes(table)) {
    if (table === "soundspin_rooms" && url.searchParams.has("session_active")) return json([]);
    const value = table === "soundspin_rooms" ? metadata() : table === "soundspin_profiles" ? profile : { user_id: userId, role: "owner" };
    if (table === "soundspin_room_members" && url.searchParams.get("role")?.startsWith("in.")) return json([]);
    return json(headers.get("accept")?.includes("vnd.pgrst.object") ? value : [value]);
  }
  if (table === "soundspin_rooms" && method === "PATCH") {
    const payload = JSON.parse(init?.body || await request?.text() || "{}");
    if (payload.state) state = payload.state;
    return json([metadata()]);
  }
  if (table === "soundspin_managed_uploads" && method === "DELETE" && url.searchParams.get("state") === "eq.deleted") return json([]);
  throw new Error(`Socket auth test blocked an unexpected database operation: ${method} ${url.pathname}.`);
};
