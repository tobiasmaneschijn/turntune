import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { GroupImperativeHandle } from "react-resizable-panels";
import { RoomHeader } from "../../src/components/RoomHeader";
import { RoomWorkspace } from "../../src/components/RoomWorkspace";
import { RoomMiniPlayer } from "../../src/components/RoomMiniPlayer";
import { RoomAnnouncementBanner } from "../../src/components/RoomAnnouncementBanner";
import { ListeningChecklist, type ListeningAudioState, type ListeningProviderState } from "../../src/components/ListeningChecklist";
import { RoomLobby } from "../../src/components/RoomLobby";
import { RoomSettingsDialog } from "../../src/components/RoomSettingsDialog";
import { useRoomLayoutPresets } from "../../src/hooks/use-room-layout-presets";
import { rememberNavigationFocus, useRouteFocus } from "../../src/hooks/use-route-focus";
import { recordRoomVisit } from "../../src/lib/room-visits";
import { ThemeProvider } from "../../src/components/theme-provider";
import { TooltipProvider } from "../../src/components/ui/tooltip";
import { Dialog, DialogContent, DialogTitle } from "../../src/components/ui/dialog";
import { Button } from "../../src/components/ui/button";
import { Input } from "../../src/components/ui/input";
import { Slider } from "../../src/components/ui/slider";
import { Switch } from "../../src/components/ui/switch";
import type { RoomDirectoryEntry, RoomSnapshot, Track, User } from "../../src/types";
import "@fontsource-variable/geist";
import "../../src/shadcn.css";
import "../../src/styles.css";
import "./style.css";

const params = new URLSearchParams(location.search);
const scenario = params.get("scenario") || "room";
const user: User = { id: params.get("user") || "layout-user", name: "Layout Listener", avatarSeed: "layout" };
const users = [user, ...Array.from({ length: 9 }, (_, index) => ({ id: `listener-${index}`, name: `Listener ${index}`, avatarSeed: `seed${index}` }))];
const track: Track = { id: "current", provider: "soundcloud", providerId: "current", title: "A long current track title for listening together", artist: "Current Artist", addedBy: user, addedAt: 1 };
const snapshot: RoomSnapshot = { users, djUsers: [user], serverTime: Date.now(), room: { id: "layout-room", name: "Layout Listening Room", ownerUserId: user.id, moderatorUserIds: [], djRoleUserIds: [], isPublic: true, passwordProtected: false, settings: { djAccess: "everyone", description: "A calm place for listening." }, djUserId: user.id, djQueueUserIds: [user.id], queue: [], history: [], playback: { track, playing: true, position: 10, updatedAt: 1 }, vibe: null, createdAt: 1 } };
const rooms: RoomDirectoryEntry[] = [
  { slug: "zulu", name: "Zulu Radio", ownerId: "host", isPublic: true, passwordProtected: false, isFavorite: false, role: null, listenerCount: 8, description: "A room for evening electronic music.", preview: { title: "Evening Signal", artist: "Mira", playing: true, observedAt: Date.now() }, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  { slug: "alpha", name: "Alpha Radio", ownerId: "host", isPublic: true, passwordProtected: false, isFavorite: false, role: null, listenerCount: 2, preview: { title: "Old Signal", playing: true, observedAt: Date.now() - 120_000 }, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  { slug: "protected", name: "Protected Radio", ownerId: "host", isPublic: true, passwordProtected: true, isFavorite: false, role: null, listenerCount: 1, preview: { title: "SECRET PROTECTED TRACK", playing: true, observedAt: Date.now() }, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  { slug: "private", name: "Private Studio", ownerId: "host", isPublic: false, passwordProtected: false, isFavorite: false, role: "member", listenerCount: 0, preview: { title: "SECRET PRIVATE TRACK", playing: true, observedAt: Date.now() }, createdAt: "2026-01-01", updatedAt: "2026-01-01" }
];
const state = { mounts: 0, unmounts: 0, directoryRequests: 0, requests: [] as string[], failDirectory: scenario === "lobby-error", delayDirectory: false, releaseDirectory: () => {}, excluded: [] as string[], favorite: false, patch: null as unknown, roomEntry: null as { slug: string; password?: string } | null, recordRoomVisit };
Object.assign(window, { layoutFixture: state });
globalThis.fetch = async (input, init) => {
  const url = String(input); state.requests.push(url);
  if (url.endsWith("/api/rooms")) {
    state.directoryRequests += 1;
    if (state.delayDirectory) await new Promise<void>(resolve => { state.releaseDirectory = resolve; });
    return state.failDirectory ? Response.json({ error: "Directory is temporarily unavailable" }, { status: 503 }) : Response.json({ rooms: scenario === "empty-lobby" ? [] : rooms.filter(room => !state.excluded.includes(room.slug)).map(room => room.slug === "private" ? { ...room, isFavorite: state.favorite } : room) });
  }
  if (init?.method === "PATCH") { state.patch = JSON.parse(String(init.body)); return Response.json({ ok: true }); }
  return Response.json({ ok: true });
};

function MountedProviderSentinel() {
  useEffect(() => { state.mounts += 1; return () => { state.unmounts += 1; }; }, []);
  return <div data-testid="provider-lifetime">Existing provider instance</div>;
}

function RoomHarness() {
  const [pane, setPane] = useState<"radio" | "player" | "chat">("player");
  const [muted, setMuted] = useState(false);
  const [settings, setSettings] = useState(false);
  const [roomSettings, setRoomSettings] = useState(scenario === "room-settings");
  const [notice, setNotice] = useState("");
  const [route, setRoute] = useState("room");
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [compact, setCompact] = useState(false);
  const [providerState, setProviderState] = useState<ListeningProviderState>(params.get("provider") === "unconfigured" ? "unconfigured" : params.get("provider") === "idle" ? "idle" : params.get("provider") === "error" ? "error" : "ready");
  const [audioState, setAudioState] = useState<ListeningAudioState>(params.get("audio") === "activation" ? "needs-activation" : params.get("provider") === "idle" ? "quiet" : "playing");
  const search = useRef<HTMLInputElement>(null);
  const composer = useRef<HTMLInputElement>(null);
  const group = useRef<GroupImperativeHandle>(null);
  const layout = useRoomLayoutPresets(group);
  useRouteFocus(route, route === "room" ? "room:layout-room" : undefined);
  const profile = () => { rememberNavigationFocus("room:layout-room"); setRoute("profile"); setProfileLoaded(false); setTimeout(() => setProfileLoaded(true), 60); };
  const focusSearch = () => { setPane("radio"); requestAnimationFrame(() => search.current?.focus()); };
  const focusChat = () => { setPane("chat"); requestAnimationFrame(() => composer.current?.focus()); };
  if (route === "profile") return <main className="fixture-profile">{profileLoaded ? <><h1>Listener profile</h1><Button onClick={() => setRoute("room")}>Return to room</Button></> : <p>Loading profile…</p>}</main>;
  return <main className="app-shell">
    <RoomHeader roomName="Layout Listening Room" roomSlug="layout-room" listenerCount={users.length} currentUser={user} participants={users} ownerUserId={user.id} djUserId="listener-0" moderatorUserIds={["listener-1"]} onOpenProfile={profile} onHome={() => setNotice("Room directory opened")} onProfile={profile} onSettings={() => setSettings(true)} onRoomSettings={() => setRoomSettings(true)} onResetLayout={layout.resetLayout} onNotice={setNotice} onFocusSearch={focusSearch} onFocusChat={focusChat} onOpenQueue={() => { setPane("radio"); setNotice("My private queue opened"); }} onOpenPlayer={() => setPane("player")} onToggleMute={() => setMuted(value => !value)} muted={muted} layoutPreset={layout.layoutPreset} onLayoutPresetChange={layout.onLayoutPresetChange} />
    <RoomWorkspace value={pane} onValueChange={setPane} compact={compact} groupRef={group} defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged}
      roomNotice={<RoomAnnouncementBanner roomId="layout-room" userId={user.id} announcement={{ id: "layout-note", text: "Take turns, and enjoy listening together.", authorId: "host", updatedAt: 1, expiresAt: null }} serverTime={snapshot.serverTime} canEdit={false} connected />}
      listeningChecklist={scenario === "checklist" && <ListeningChecklist userId={user.id} providerName="SoundCloud" providerState={providerState} audioState={audioState} onEnableAudio={() => setAudioState("playing")} onOpenSettings={() => { setProviderState("ready"); setSettings(true); }} />}
      miniPlayer={<RoomMiniPlayer track={track} statusText={audioState === "playing" ? "Playing on this device" : "Enable my audio to listen"} statusTone="playing" muted={muted} onToggleMute={() => setMuted(value => !value)} onOpenPlayer={() => setPane("player")} />}
      radio={<aside className="panel fixture-pane"><h2>Radio</h2><Input ref={search} aria-label="Music search" /><Button onClick={() => setNotice("My private queue opened")}>My private queue</Button></aside>}
      player={<div className="player-column"><section className="panel fixture-pane fixture-player"><div className="now-playing"><div className="now-playing-main"><h2>Now playing</h2><MountedProviderSentinel /><div className="fixture-tall-art">Decorative artwork</div><h3>{track.title}</h3></div><div className="fixture-playback-controls"><Button onClick={() => setMuted(value => !value)} aria-label={muted ? "Unmute my audio" : "Mute my audio"}>Local audio</Button><Slider aria-label="Volume" value={[72]} min={0} max={100} /><label>Compact artwork<Switch checked={compact} onCheckedChange={setCompact} aria-label="Compact artwork" /></label><Button onClick={() => setNotice("Player bottom reached")}>Bottom player control</Button></div></div></section></div>}
      chat={<aside className="panel fixture-pane fixture-chat"><h2>Room chat</h2><div className="fixture-chat-history">Messages are independently scrollable.</div><div className="fixture-chat-composer"><Input ref={composer} aria-label="Message room" /><Button aria-label="Send message">Send</Button></div></aside>}
    />
    <output className="sr-only" aria-label="Fixture notice">{notice}</output>
    {settings && <Dialog open onOpenChange={setSettings}><DialogContent><DialogTitle>Settings</DialogTitle><Button onClick={() => setSettings(false)}>Done</Button></DialogContent></Dialog>}
    {roomSettings && <RoomSettingsDialog snapshot={snapshot} currentUserId={user.id} accessToken="fixture-token" connected onClose={() => setRoomSettings(false)} onNotice={setNotice} />}
  </main>;
}
function LobbyHarness() {
  const [open, setOpen] = useState(true);
  return open ? <RoomLobby accessToken="fixture-token" currentUser={user} onOpenRoom={(slug, password) => { state.roomEntry = { slug, password }; setOpen(false); }} onOpenProfile={() => {}} onSignOut={() => {}} feedbackButton={null} /> : <main><h1>Entered room</h1><Button onClick={() => setOpen(true)}>Return to directory</Button></main>;
}
createRoot(document.getElementById("root")!).render(<ThemeProvider><TooltipProvider>{scenario.includes("lobby") ? <LobbyHarness /> : <RoomHarness />}</TooltipProvider></ThemeProvider>);
