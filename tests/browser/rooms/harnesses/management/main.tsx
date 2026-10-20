import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import "@fontsource-variable/inter";
import "../../../../../src/styles/shadcn.css";
import "../../../../../src/styles/index.css";
import { RoomSettingsDialog } from "../../../../../src/features/rooms/components/RoomSettingsDialog";
import { RoomModerationDialog } from "../../../../../src/features/rooms/components/RoomModerationDialog";
import { ThemeProvider } from "../../../../../src/components/theme-provider";
import { Button } from "../../../../../src/components/ui/button";
import type { RoomSnapshot } from "../../../../../src/types";

const isAdmin = new URLSearchParams(location.search).has("admin");
const alice = { isAppAdmin: isAdmin, id: "00000000-0000-4000-8000-000000000001", name: "Alice", avatarSeed: "alice" };
const bob = { id: "00000000-0000-4000-8000-000000000002", name: "Bob", avatarSeed: "bob" };
const offline = { id: "00000000-0000-4000-8000-000000000003", name: "Offline DJ", avatarSeed: "offline" };
const state = { requests: [] as Array<{ path: string; body: Record<string, unknown> }>, failSave: false, role: "dj", reportStatus: "open" };
Object.assign(window, { roomManagementFixture: state });
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const path = String(input); const body = options?.body ? JSON.parse(String(options.body)) as Record<string, unknown> : {};
  if (path.startsWith("/api/")) state.requests.push({ path, body });
  if (path === "/api/rooms/lounge" && options?.method === "PATCH") return Response.json(state.failSave ? { error: "Could not save. Try again." } : { ok: true }, { status: state.failSave ? 500 : 200 });
  if (path === "/api/admin/rooms/lounge/spotify" && options?.method === "PUT") {
    if (!isAdmin) return Response.json({ error: "Administrator required." }, { status: 403 });
    if (state.failSave) return Response.json({ error: "Could not update Spotify. Try again." }, { status: 503 });
    window.dispatchEvent(new CustomEvent("fixture:spotify", { detail: body.enabled === true }));
    return Response.json({ enabled: body.enabled === true });
  }
  if (path.includes("/members?")) return Response.json({ members: [{ user: alice, role: "owner", online: true, restrictions: [] }, { user: offline, role: state.role, online: false, restrictions: [] }], cursor: null });
  if (path.endsWith("/moderation/actions")) { if (body.action === "role") state.role = String(body.role); if (body.action === "report-resolve") state.reportStatus = "resolved"; return Response.json({ ok: true }); }
  if (path.includes("/moderation?")) return Response.json({ items: path.includes("tab=reports") ? [{ id: "00000000-0000-4000-8000-000000000004", targetUserId: bob.id, reporterId: alice.id, reason: "Repeated spam", category: "other", status: state.reportStatus, createdAt: Date.now() }] : [], cursor: null });
  if (path.endsWith("/invitations")) return Response.json({ invitations: [], links: [] });
  if (path === "/api/library") return Response.json({ library: { picks: [], sets: [] } });
  return originalFetch(input, options);
};
const snapshot: RoomSnapshot = { room: { id: "lounge", name: "Lounge", ownerUserId: isAdmin ? bob.id : alice.id, moderatorUserIds: [], djRoleUserIds: [offline.id], isPublic: true, passwordProtected: false, settings: {}, djUserId: null, djQueueUserIds: [], queue: [], history: [], playback: { track: null, playing: false, position: 0, updatedAt: 1 }, vibe: null, createdAt: 1, policyRevision: 0 }, users: [alice, bob], djUsers: [], serverTime: Date.now() };
function Harness() { const [roomSnapshot, setRoomSnapshot] = useState(snapshot);
  useEffect(() => { const update = (event: Event) => setRoomSnapshot(current => ({ ...current, room: { ...current.room, policyRevision: (current.room.policyRevision ?? 0) + 1, settings: { ...current.room.settings, spotifyEnabled: (event as CustomEvent<boolean>).detail } } })); window.addEventListener("fixture:spotify", update); return () => window.removeEventListener("fixture:spotify", update); }, []);
  const [surface, setSurface] = useState<string | null>(null); const [notice, setNotice] = useState(""); return <ThemeProvider><main><Button onClick={() => setSurface("settings")}>Open room settings</Button><Button onClick={() => setSurface("moderation")}>Open moderation</Button><p role="status">{notice}</p>{surface === "settings" && <RoomSettingsDialog snapshot={roomSnapshot} currentUserId={alice.id} isAppAdmin={isAdmin} accessToken="fixture-token" connected onClose={() => setSurface(null)} onNotice={setNotice} />}{surface === "moderation" && <RoomModerationDialog snapshot={snapshot} currentUserId={alice.id} accessToken="fixture-token" connected onClose={() => setSurface(null)} onNotice={setNotice} />}</main></ThemeProvider>; }
createRoot(document.getElementById("root")!).render(<Harness />);
