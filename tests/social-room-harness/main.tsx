import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "../../src/shadcn.css";
import "../../src/styles.css";
import { App } from "../../src/App";
import { ThemeProvider } from "../../src/components/theme-provider";
import { socket } from "../../src/socket";
import type { RoomSnapshot } from "../../src/types";

const user = { id: "00000000-0000-4000-8000-000000000001", name: "Alice", avatarSeed: "alice", avatarKey: "pulse" };
const bob = { ...user, id: "00000000-0000-4000-8000-000000000002", name: "Bob" };
const fixture = { creates: 0, destroys: 0, joins: 0, themes: [] as Array<string | null>, connected: false };
Object.assign(window, { socialRoomTest: fixture });
const profile = { user_id: user.id, display_name: "Alice", bio: "", avatar_key: "pulse", avatar_url: null, avatar_path: null,
  theme_key: "afterglow", is_app_admin: false, handle: "alice", status_text: "", favorite_tracks: [],
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
const now = Date.now();
const guest = new URLSearchParams(location.search).has("guest");
const invite = new URLSearchParams(location.search).has("invite");
const jwt = [btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })), btoa(JSON.stringify({ sub: user.id, exp: Math.floor(now / 1000) + 3600 })), "fixture"].join(".");
const authSession = { access_token: jwt, refresh_token: "fixture", token_type: "bearer", expires_in: 3600,
  expires_at: Math.floor(now / 1000) + 3600, user: { id: user.id, email: "alice@example.com", email_confirmed_at: profile.created_at,
    user_metadata: { display_name: "Alice" }, app_metadata: {}, aud: "authenticated", created_at: profile.created_at } };
if (guest) localStorage.removeItem("soundspin-auth");
else localStorage.setItem("soundspin-auth", JSON.stringify(authSession));
history.replaceState({}, "", invite ? "/update-password#type=invite" : "/room/lounge");
const snapshot: RoomSnapshot = { room: { id: "lounge", name: "Lounge", ownerUserId: user.id, moderatorUserIds: [], djRoleUserIds: [], isPublic: true,
  passwordProtected: false, settings: {}, djUserId: bob.id, djQueueUserIds: [bob.id], queue: [], history: [],
  playback: { track: { id: "track-one", provider: "youtube", providerId: "aaaaaaaaaaa", title: "Night song", addedBy: bob, addedAt: now, durationMs: 180000 }, playing: true, position: 12, updatedAt: now }, vibe: null, createdAt: now },
  users: [user, bob], djUsers: [bob], serverTime: now };
const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
const emitEvent = (event: string, ...args: unknown[]) => listeners.get(event)?.forEach(listener => listener(...args));
Object.defineProperty(socket, "connected", { get: () => fixture.connected });
Object.defineProperty(socket, "active", { get: () => true });
Object.assign(socket, {
  on(event: string, listener: (...args: unknown[]) => void) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(listener); return socket; },
  off(event: string, listener: (...args: unknown[]) => void) { listeners.get(event)?.delete(listener); return socket; },
  connect() { fixture.connected = true; emitEvent("connect"); return socket; },
  disconnect() { fixture.connected = false; emitEvent("disconnect"); return socket; },
  timeout() { return { emit(event: string, _payload: unknown, reply: (error: null, result: { ok: boolean }) => void) {
    if (event === "room:join") { fixture.joins++; emitEvent("room:snapshot", snapshot); }
    reply(null, { ok: true });
  } }; },
  emit() { return socket; }
});
window.fetch = async (input, init) => {
  const path = input instanceof Request ? input.url : String(input);
  if (path === "/api/config") return Response.json({ supabase: { url: "https://social-room-fixture.supabase.co", anonKey: "sb_publishable_fixture" } });
  if (path.includes("/auth/v1/user")) return Response.json(authSession.user);
  if (path.includes("/auth/v1/token")) return Response.json(authSession);
  if (path === "/api/signup") return Response.json({ ok: true }, { status: 202 });
  if (path.includes("/api/profiles/")) {
    const other = path.endsWith(bob.id);
    return Response.json({ profile: { ...profile, user_id: other ? bob.id : user.id, display_name: other ? "Bob" : "Alice", handle: other ? "bob" : "alice" }, options: [] });
  }
  if (path === "/api/social") return Response.json({ people: [{ user: bob, state: "friends" }], invitations: [], shareActivity: false, blockedPeople: [], receiveRequests: true });
  if (path === "/api/rooms/lounge" && init?.method === "PATCH") {
    const { themePrompt } = JSON.parse(String(init.body)); fixture.themes.push(themePrompt);
    snapshot.room.settings = themePrompt ? { themePrompt } : {};
    emitEvent("room:snapshot", { ...snapshot, room: { ...snapshot.room }, serverTime: Date.now() });
    return Response.json({ ok: true });
  }
  if (path.includes("/api/library")) return Response.json({ library: { picks: [], sets: [] } });
  if (path.includes("/api/rooms/lounge/chat/")) return Response.json({ rows: [], replies: [], profiles: [], hasMore: false });
  if (path.includes("/api/youtube/live")) return Response.json({ isLive: false });
  if (path.includes("/api/chat")) return Response.json({ messages: [], hasMore: false });
  if (path.includes("/api/spotify")) return Response.json({ connected: false });
  if (path.includes("/api/rooms")) return Response.json({ rooms: [] });
  return Response.json({});
};
class FakeYouTubePlayer {
  videoId = ""; position = 12; playing = true;
  constructor(element: HTMLElement, private options: { events?: Record<string, (event: { data: number }) => void> }) {
    fixture.creates++; const frame = document.createElement("iframe"); frame.title = "Test YouTube player"; element.replaceWith(frame);
    queueMicrotask(() => options.events?.onReady?.({ data: 0 }));
  }
  loadVideoById({ videoId, startSeconds }: { videoId: string; startSeconds: number }) { this.videoId = videoId; this.position = startSeconds; queueMicrotask(() => this.options.events?.onStateChange?.({ data: 1 })); }
  cueVideoById(value: { videoId: string; startSeconds: number }) { this.loadVideoById(value); }
  playVideo() { this.playing = true; }
  pauseVideo() { this.playing = false; }
  seekTo(value: number) { this.position = value; }
  setVolume() {}
  getVideoUrl() { return `https://www.youtube.com/watch?v=${this.videoId}`; }
  getCurrentTime() { return this.position; }
  getDuration() { return 180; }
  getPlayerState() { return this.playing ? 1 : 2; }
  destroy() { fixture.destroys++; }
}
window.YT = { Player: FakeYouTubePlayer, PlayerState: { ENDED: 0, BUFFERING: 3 } };
createRoot(document.getElementById("root")!).render(<ThemeProvider><App /></ThemeProvider>);
