import { useState } from "react";
import { createRoot } from "react-dom/client";
import { RoomLobby } from "../../src/components/RoomLobby";
import { ThemeProvider } from "../../src/components/theme-provider";
import { TooltipProvider } from "../../src/components/ui/tooltip";
import type { RoomDirectoryEntry } from "../../src/types";
import "@fontsource-variable/geist";
import "../../src/shadcn.css";
import "../../src/styles.css";

const user = { id: "directory-review-user", name: "Directory Listener", avatarSeed: "directory" };
const room = (slug: string, name: string, extra: Partial<RoomDirectoryEntry> = {}): RoomDirectoryEntry => ({
  slug, name, ownerId: "host", isPublic: true, passwordProtected: false, isFavorite: false, role: null,
  listenerCount: 2, createdAt: "2026-01-01", updatedAt: "2026-01-01", ...extra
});
const rooms = [
  room("sunset", "Sunset Radio", { isFavorite: true, role: "owner" }),
  room("private", "Private Studio", { isPublic: false, isFavorite: true, role: "member", listenerCount: 0 }),
  room("favorite", "Favorite Radio", { isFavorite: true }),
  room("public", "Public Radio"),
  room("protected", "Protected Radio", { passwordProtected: true })
];
const state = {
  requests: [] as { path: string; method: string; body: unknown }[],
  favoriteFailure: false, delayFavorite: false, delayCreation: false,
  navigations: [] as { slug: string; password?: string }[],
  finishFavorite: (_ok: boolean) => {}, finishCreation: (_ok: boolean) => {},
  hideLobby: () => {}, showLobby: () => {}
};
Object.assign(window, { directoryReviewFixture: state });
globalThis.fetch = async (input, init) => {
  const path = String(input);
  const method = init?.method || "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  state.requests.push({ path, method, body });
  if (path === "/api/rooms" && method === "GET") return Response.json({ rooms });
  if (path === "/api/social") return Response.json({ people: [], invitations: [], shareActivity: false });
  if (path.endsWith("/favorite") && method === "PUT") {
    const ok = state.delayFavorite ? await new Promise<boolean>(resolve => { state.finishFavorite = resolve; }) : !state.favoriteFailure;
    if (!ok) return Response.json({ error: "The favorite could not be saved." }, { status: 503 });
    const selected = rooms.find(item => path === `/api/rooms/${item.slug}/favorite`);
    if (selected) selected.isFavorite = body.favorite;
    return Response.json({ ok: true });
  }
  if (path === "/api/rooms" && method === "POST") {
    const ok = state.delayCreation ? await new Promise<boolean>(resolve => { state.finishCreation = resolve; }) : true;
    if (!ok) return Response.json({ error: "Room creation failed. Try again." }, { status: 503 });
    return Response.json({ room: { slug: "created-room" } });
  }
  return Response.json({ ok: true });
};
function Harness() {
  const [visible, setVisible] = useState(true);
  state.hideLobby = () => setVisible(false);
  state.showLobby = () => setVisible(true);
  return visible ? <RoomLobby accessToken="fixture-token" currentUser={user} onOpenRoom={(slug, password) => {
    state.navigations.push({ slug, password }); setVisible(false);
  }} onOpenProfile={() => {}} onSignOut={() => setVisible(false)} feedbackButton={null} /> : <main><h1>Outside directory</h1></main>;
}
createRoot(document.getElementById("root")!).render(<ThemeProvider><TooltipProvider><Harness /></TooltipProvider></ThemeProvider>);
