import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import "@fontsource-variable/geist";
import "../../src/shadcn.css";
import "../../src/styles.css";
import { NowPlaying } from "../../src/components/NowPlaying";
import { RoomSettingsDialog } from "../../src/components/RoomSettingsDialog";
import { MusicRail } from "../../src/components/MusicRail";
import { RealtimeChat } from "../../src/components/realtime-chat";
import { RoomHeader } from "../../src/components/RoomHeader";
import { RoomAnnouncementBanner } from "../../src/components/RoomAnnouncementBanner";
import { RoomThemeBanner } from "../../src/components/RoomThemeBanner";
import type { ChatHistorySource } from "../../src/chat/history-reader";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RoomWorkspace } from "../../src/components/RoomWorkspace";
import { DeferredDialog } from "../../src/components/DeferredDialog";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "../../src/components/ui/dialog";
import { ThemeProvider } from "../../src/components/theme-provider";
import { TooltipProvider } from "../../src/components/ui/tooltip";
import { Button } from "../../src/components/ui/button";
import { readUserSettings } from "../../src/playback-settings";
import type { YouTubePlayer, PlayerStatus } from "../../src/components/YouTubePlayer";
import type { Provider, RoomSnapshot, Track } from "../../src/types";
import type { SocketReply } from "../../src/socket-request";
const polished = new URLSearchParams(location.search).has("workspace");
const reactingListener = new URLSearchParams(location.search).has("listener");

const user = { id: "player-user", name: "Mira", avatarSeed: "mira" };
const track: Track = { id: "t1", provider: "youtube", providerId: "fixture0001", title: "A very long recording title that remains readable in its full track details", artist: "The Evening Ensemble", permalinkUrl: "https://www.youtube.com/watch?v=fixture0001", durationMs: 180000, addedBy: user, addedAt: 1 };
const snapshot: RoomSnapshot = { room: { id: "player-room", name: "Evening radio", ownerUserId: user.id, moderatorUserIds: [], djRoleUserIds: [], isPublic: true, passwordProtected: false, settings: { spotifyEnabled: true }, djUserId: user.id, djQueueUserIds: [], queue: [], history: [], playback: { track, playing: true, position: 30, updatedAt: Date.now() }, vibe: null, createdAt: 1 }, users: [user, { ...user, id: "listener", name: "Jonas" }], djUsers: [user], serverTime: Date.now() };
if (polished) {
  snapshot.room.name = "Evening Radio";
  snapshot.room.djQueueUserIds = [user.id, "listener"];
  snapshot.djUsers = snapshot.users;
  snapshot.room.playback.track = { ...track, title: "Midnight City", artist: "M83" };
  snapshot.room.queue = ["Sunset Lover", "A Walk", "Tadow"].map((title, index) => ({ ...track, id: `queue-${index}`, providerId: `fixture00${index + 2}`, title, artist: ["Petit Biscuit", "Tycho", "Masego"][index] }));
}
const chatClient = { channel() { return { on() { return this; }, subscribe(callback: (status: string) => void) { queueMicrotask(() => callback("SUBSCRIBED")); return this; }, async send() { return "ok"; } }; }, async removeChannel() { return "ok"; } } as unknown as SupabaseClient;
const chatMessages = [{ id: "hello-1", content: "This is the perfect soundtrack for the evening.", type: "text" as const, user: snapshot.users[1], createdAt: "2026-10-06T18:30:00Z" }, { id: "hello-2", content: "Queued a few favorites for my next turn.", type: "text" as const, user, createdAt: "2026-10-06T18:31:00Z" }];
const chatHistorySource: ChatHistorySource = {
  loadPage: async () => ({ messages: chatMessages, hasMore: false }),
  search: async query => ({ messages: chatMessages.filter(message => message.content.toLowerCase().includes(query.toLowerCase())), hasMore: false }),
  loadContext: async () => null,
  loadMessage: async id => chatMessages.find(message => message.id === id) || null,
  saveMessage: async () => {},
  saveReaction: async () => {},
  loadMediaUrl: async () => "",
};
type TestState = { spotifyActive: boolean; setSpotifyEnabled: (enabled: boolean) => void; useSpotify: () => void; mounts: number; calls: string[]; pending?: (reply: SocketReply) => void; ready: boolean; actualPlaying?: boolean; buffering: boolean; failConnections: boolean; status?: (value: PlayerStatus) => void; error?: (text: string) => void; update: () => void; setVotes: (votes: Record<string, -1 | 1>) => void; setAllowedProviders: (providers: Provider[]) => void; useMixcloud: () => void; savedRoomSettings?: { allowedProviders: Provider[] } };
const qa: TestState = { spotifyActive: false, setSpotifyEnabled: () => {}, useSpotify: () => {}, mounts: 0, calls: [], ready: true, actualPlaying: undefined, buffering: false, failConnections: false, update: () => {}, setVotes: () => {}, setAllowedProviders: () => {}, useMixcloud: () => {} };
declare global { interface Window { playerQolTest: TestState } }
window.playerQolTest = qa;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("/api/spotify/connect?")) return originalFetch(url, init);
  if (String(url).includes("/api/music/connections")) return qa.failConnections ? Response.json({}, { status: 503 }) : Response.json({ spotify: { configured: true, connected: true }, apple: { configured: false } });
  if (String(url).includes("/api/rooms/") && init?.method === "PATCH") qa.savedRoomSettings = JSON.parse(String(init.body));
  return Response.json({});
};
function FixturePlayer({ playback, onStatus, onError, syncRevision, volume }: React.ComponentProps<typeof YouTubePlayer>) {
  const mounted = useRef(false);
  useEffect(() => { if (!mounted.current) { qa.mounts += 1; mounted.current = true; } }, []);
  qa.status = onStatus; qa.error = onError;
  useEffect(() => {
    onStatus({ ready: qa.ready, buffering: qa.buffering, playing: qa.actualPlaying, currentTime: playback.position + (playback.playing ? Math.max(0, Date.now() - playback.updatedAt) / 1000 : 0), duration: 180, trackId: playback.track?.id });
  }, [playback.track?.id, playback.playing, playback.updatedAt, syncRevision, onStatus]);
  return playback.track?.provider === "mixcloud"
    ? <div className="mixcloud-shell"><iframe title="Fixture Mixcloud player" style={{ width: "100%", height: 120, border: 0 }} /><button type="button">Play Mixcloud</button></div>
    : <div className="provider-player-shell"><span>Fixture provider · volume {volume}</span></div>;
}
function SpotifyFixture({ playback, onStatus }: React.ComponentProps<typeof FixturePlayer>) {
  useEffect(() => { qa.spotifyActive = true; return () => { qa.spotifyActive = false; }; }, []);
  useEffect(() => { onStatus({ ready: true, buffering: false, currentTime: playback.position, duration: 180, trackId: playback.track?.id }); }, [playback, onStatus]);
  return null;
}
const adapters = { youtube: FixturePlayer, mixcloud: FixturePlayer, spotify: SpotifyFixture };
const requestAction = (event: string, _payload: unknown, reply: (result: SocketReply) => void) => { qa.calls.push(event); qa.pending = reply; };
function ReadyDialog({ onClose }: { onClose: () => void }) { return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent><DialogTitle>Deferred panel</DialogTitle><DialogDescription>Ready</DialogDescription></DialogContent></Dialog>; }
let releaseModule: () => void;
const loadDelayed = () => new Promise<{ default: typeof ReadyDialog }>((resolve) => { releaseModule = () => resolve({ default: ReadyDialog }); });
let rejectOnce = true;
const loadFlaky = () => rejectOnce ? (rejectOnce = false, Promise.reject(new Error("Module unavailable"))) : Promise.resolve({ default: ReadyDialog });
function Harness() {
  const [settings, setSettings] = useState(readUserSettings);
  const [pane, setPane] = useState<"radio" | "player" | "chat">("player");
  const [chatHeaderActions, setChatHeaderActions] = useState<HTMLDivElement | null>(null);
  const [room, setRoom] = useState(snapshot);
  const [connected, setConnected] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [roomSettingsOpen, setRoomSettingsOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [delayedOpen, setDelayedOpen] = useState(false);
  const [flakyOpen, setFlakyOpen] = useState(false);
  qa.setSpotifyEnabled = spotifyEnabled => setRoom(value => ({ ...value, room: { ...value.room, settings: { ...value.room.settings, spotifyEnabled } } }));
  qa.useSpotify = () => { setSettings(value => ({ ...value, playback: { ...value.playback, preference: "spotify-web" } })); setRoom(value => ({ ...value, room: { ...value.room, playback: { ...value.room.playback, track: { ...track, mappings: { spotify: { providerId: "fixture-spotify", matchMethod: "isrc" } } } } } })); };
  qa.update = () => setRevision(value => value + 1);
  qa.setAllowedProviders = allowedProviders => setRoom(value => ({ ...value, room: { ...value.room, settings: { ...value.room.settings, allowedProviders } } }));
  qa.useMixcloud = () => { setSettings(value => ({ ...value, playback: { ...value.playback, preference: "source", defaultVolume: 0 } })); setRoom(value => ({ ...value, room: { ...value.room, playback: { ...value.room.playback, track: { ...track, provider: "mixcloud", providerId: "/artist/show/", permalinkUrl: "https://www.mixcloud.com/artist/show/" }, updatedAt: Date.now() } } })); };
  qa.setVotes = votes => setRoom(value => ({ ...value, users: [user, ...Object.keys(votes).map(id => ({ id, name: id, avatarSeed: id }))], room: { ...value.room, vibe: { trackId: value.room.playback.track!.id, votes } } }));
  return <main className="app-shell">
    {polished ? <RoomHeader roomName={room.room.name} roomSlug={room.room.id} listenerCount={room.users.length} currentUser={user} onHome={() => {}} onSettings={() => setSettingsOpen(true)} onProfile={() => {}} onResetLayout={() => {}} onNotice={() => {}} connected={connected} participants={room.users} ownerUserId={user.id} djUserId={user.id} onOpenProfile={() => {}} /> : <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: 8 }}>
      <Button onClick={() => setConnected(value => !value)}>Toggle room connection</Button>
      <Button onClick={() => setSettings(value => ({ ...value, playback: { ...value.playback, preference: "spotify-web", fallback: "silent" } }))}>Use silent fallback</Button>
      <Button onClick={() => setRoom(value => ({ ...value, room: { ...value.room, playback: { ...value.room.playback, track: { ...track, id: "t2", title: "Newest recording" }, updatedAt: Date.now() } } }))}>Change track</Button>
      <Button onClick={() => setDelayedOpen(true)}>Open delayed panel</Button>
      <Button onClick={() => releaseModule?.()}>Resolve panel module</Button>
      <Button onClick={() => setFlakyOpen(true)}>Open flaky panel</Button>
      <Button onClick={() => setRoomSettingsOpen(true)}>Open room settings</Button>
    </div>}
    <RoomWorkspace value={pane} onValueChange={setPane} defaultLayout={{ radio: 20, player: 45, chat: 35 }}
      roomNotice={polished && <><RoomThemeBanner prompt={new URLSearchParams(location.search).get("theme") || "After hours"} /><RoomAnnouncementBanner roomId={room.room.id} userId={user.id} announcement={{ id: "fixture-note", text: "One song per turn. Pick something you love.", authorId: user.id, updatedAt: 1, expiresAt: null }} serverTime={room.serverTime} canEdit={false} connected={connected} /></>}
      radio={polished ? <MusicRail snapshot={room} currentUserId={user.id} accessToken="fixture" connected={connected} setNotice={() => {}} requestAction={requestAction} /> : <div className="panel"><input aria-label="Music search" /></div>}
      chat={polished ? <aside className="chat panel"><div className="chat-header"><strong>Room chat</strong><div className="chat-presence"><small>2 listeners</small><div ref={setChatHeaderActions} className="chat-header-actions" /></div></div><div className="supabase-chat-body"><RealtimeChat headerActionsContainer={chatHeaderActions} historyRoomSlug={room.room.id} historySource={chatHistorySource} notifications={settings.notifications} client={chatClient} roomName="soundspin:player-room" user={user} roomUsers={room.users} messages={chatMessages} onSend={async () => {}} isVisible={pane === "chat"} /></div></aside> : <div className="chat panel"><textarea aria-label="Chat draft" /></div>}
      player={<div className="player-column" data-revision={revision}><NowPlaying snapshot={room} currentUserId={reactingListener ? "listener" : user.id} isDj canControlPlayback accessToken="fixture" compact={settings.playback.compactPlayer} onToggleCompact={() => setSettings(value => ({ ...value, playback: { ...value.playback, compactPlayer: !value.playback.compactPlayer } }))} settingsOpen={settingsOpen} onCloseSettings={() => setSettingsOpen(false)} userSettings={settings} onUserSettingsChange={setSettings} roomConnected={connected} onOpenSettings={() => setSettingsOpen(true)} requestAction={requestAction} providerPlayers={adapters} /></div>} />
    {delayedOpen && <DeferredDialog title="Deferred panel" load={loadDelayed} componentProps={{ onClose: () => setDelayedOpen(false) }} />}
    {flakyOpen && <DeferredDialog title="Deferred panel" load={loadFlaky} componentProps={{ onClose: () => setFlakyOpen(false) }} />}
    {roomSettingsOpen && <RoomSettingsDialog snapshot={room} currentUserId={user.id} accessToken="fixture" connected={connected} onNotice={() => { if (qa.savedRoomSettings) qa.setAllowedProviders(qa.savedRoomSettings.allowedProviders); }} onClose={() => setRoomSettingsOpen(false)} />}
  </main>;
}
createRoot(document.getElementById("root")!).render(<ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}><TooltipProvider><Harness /></TooltipProvider></ThemeProvider>);
