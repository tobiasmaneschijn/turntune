// Test-only database transport. JWT signatures are still verified by the real
// @supabase/server verifier against the ephemeral public JWKS in the test env.
const userId = "11111111-1111-4111-8111-111111111111";
let state = { id: "auth-room", name: "Auth room", ownerUserId: userId, moderatorUserIds: [], djRoleUserIds: [],
  isPublic: true, passwordProtected: false, settings: {}, djUserId: null, djQueueUserIds: [], djQueues: {}, history: [],
  playback: { track: null, playing: false, position: 0, updatedAt: 1 }, vibe: null, createdAt: 1 };
const profile = { user_id: userId, display_name: "Verified listener", is_app_admin: false, avatar_key: "default", avatar_url: null };
const metadata = () => ({ slug: state.id, state, name: state.name, owner_id: userId, is_public: true, password_hash: null, settings: state.settings });

globalThis.fetch = async (input, init) => {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : String(input));
  const method = init?.method || request?.method || "GET";
  const headers = new Headers(init?.headers || request?.headers);
  if (url.origin !== "https://soundspin-socket-auth.invalid") throw new Error("Socket auth test blocked an unexpected outbound request.");
  const table = url.pathname.split("/").at(-1);
  const json = value => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
  if (method === "GET" && ["soundspin_rooms", "soundspin_profiles", "soundspin_room_members"].includes(table)) {
    const value = table === "soundspin_rooms" ? metadata() : table === "soundspin_profiles" ? profile : { user_id: userId, role: "member" };
    if (table === "soundspin_room_members" && url.searchParams.get("role")?.startsWith("in.")) return json([]);
    return json(headers.get("accept")?.includes("vnd.pgrst.object") ? value : [value]);
  }
  if (table === "soundspin_rooms" && method === "PATCH") {
    const payload = JSON.parse(init?.body || await request?.text() || "{}");
    if (payload.state) state = payload.state;
    return json([metadata()]);
  }
  if (table === "soundspin_room_members" && method === "POST") return new Response(null, { status: 201 });
  throw new Error("Socket auth test blocked an unexpected database operation.");
};
