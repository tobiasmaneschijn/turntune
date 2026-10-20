// Test-only transport. The real JWT verifier uses an ephemeral public JWKS and
// every operation remains local: provider/real-project traffic is prohibited.
import { defaultResourcePolicy } from "../../../shared/resource-policy.ts";
import { runtimeMetrics } from "../../../server/lib/runtime-metrics.ts";
const origin = "https://soundspin-socket-auth.invalid";
const userId = "11111111-1111-4111-8111-111111111111";
let state = { id: "auth-room", name: "Auth room", ownerUserId: userId, moderatorUserIds: [], djRoleUserIds: [],
  // Explicit fixture grant allows the real HTTP gate to exercise live admission.
  isPublic: true, passwordProtected: false, settings: { spotifyEnabled: true }, djUserId: null, djQueueUserIds: [], djQueues: {}, history: [],
  playback: { track: null, playing: false, position: 0, updatedAt: 1 }, vibe: null, createdAt: 1 };
const profile = { user_id: userId, display_name: "Verified listener", is_app_admin: false, avatar_key: "default", avatar_url: null };
const metadata = () => ({ slug: state.id, state, name: state.name, owner_id: userId, is_public: true, access_mode: "public", password_hash: null, settings: state.settings });
let accountSuspended = false, roomDisabled = false;
const messages = new Map();
process.on("message", message => {
  if (message?.fixture === 'metrics') { process.send?.({ metrics: runtimeMetrics.snapshot() }); return; }
  if (message?.fixture === "account") accountSuspended = message.disabled === true;
  else if (message?.fixture === "room") roomDisabled = message.disabled === true;
  else return;
  process.send?.({ fixtureUpdated: message.fixture });
});
// The HTTP listener owns fixture lifetime; IPC must not keep a stopped server alive.
process.channel?.unref();
const emptyTables = new Set(["soundspin_account_restrictions", "soundspin_room_restrictions", "soundspin_room_moderation", "soundspin_storage_deletion_outbox", "soundspin_profile_options"]);
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
    if (table === "soundspin_resource_policy") {
      if (body.p_actor !== null && body.p_actor !== userId) throw new Error("Invalid test resource-policy actor.");
      return json(defaultResourcePolicy());
    }
    if (maintenance.has(table)) {
      if (table === 'soundspin_release_ready' && body.p_contract !== 'database-access-v1') throw new Error('Missing database access contract.');
      return json(maintenance.get(table));
    }
    if (table === 'soundspin_load_room') return json(body.p_room_slug === state.id ? {
      ...metadata(), room_roles: [{ user_id: userId, role: 'owner' }], moderation: {}
    } : null);
    if (table === 'soundspin_access_status') return json({
      accounts: accountSuspended ? [] : body.p_accounts.filter(id => id === userId),
      rooms: roomDisabled || accountSuspended ? [] : body.p_rooms.filter(slug => slug === state.id)
    });
    if (table === 'soundspin_room_access') {
      const exists = body.p_room_slug === state.id;
      return json({ exists, isPublic: true, passwordHash: null, accessMode: 'public', settings: state.settings,
        role: body.p_actor === userId ? 'owner' : null, banned: false,
        accountActive: body.p_actor === userId && !accountSuspended,
        roomActive: exists && !roomDisabled && !accountSuspended,
        readers: exists && !roomDisabled && !accountSuspended ? body.p_readers.filter(id => id === userId) : [] });
    }
    if (table === 'soundspin_chat_message_state') return json({ row: messages.get(body.p_id) || null, removal: null });
    if (table === 'soundspin_chat_command' && body.p_kind === 'message') {
      const payload = body.p_payload;
      if (body.p_room !== state.id || body.p_user !== userId) throw new Error('Invalid fixture chat actor.');
      const previous = messages.get(payload.id);
      const row = previous || { id: payload.id, room_slug: state.id, user_id: userId, user_name: payload.user.name,
        avatar_seed: payload.user.avatarSeed, content: payload.content, message_type: payload.type,
        created_at: payload.createdAt, media_url: null, storage_path: null, mentions: [], reply_to_id: null,
        poll_options: null, removed_at: null, immutable_fingerprint: body.p_fingerprint,
        soundspin_message_reactions: [], soundspin_poll_votes: [] };
      messages.set(payload.id, row);
      return json({ fresh: !previous, result: { id: payload.id }, row });
    }
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
