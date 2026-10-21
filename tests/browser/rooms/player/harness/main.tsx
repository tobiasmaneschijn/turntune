import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import "@fontsource-variable/inter";
import "../../../../../src/styles/shadcn.css";
import "../../../../../src/styles/index.css";
import { NowPlaying } from "../../../../../src/features/playback/components/NowPlaying";
import { ListeningChecklist } from "../../../../../src/features/playback/components/ListeningChecklist";
import { RoomSettingsDialog } from "../../../../../src/features/rooms/components/RoomSettingsDialog";
import { MusicRail, type MusicRailControls } from "../../../../../src/features/music/components/MusicRail";
import { useMediaQuery } from "../../../../../src/hooks/use-media-query";
import { RealtimeChat, type RealtimeChatHandle } from "../../../../../src/features/chat/components/realtime-chat";
import type { ChatSongMoment } from "../../../../../src/features/chat/song-moments";
import type { ChatMessage } from "../../../../../src/features/chat/model";
import { songFromTrack } from "../../../../../src/features/music/song-drag";
import { RoomHeader } from "../../../../../src/features/rooms/components/RoomHeader";
import { RoomAnnouncementBanner } from "../../../../../src/features/rooms/components/RoomAnnouncementBanner";
import { RoomThemeBanner } from "../../../../../src/features/rooms/components/RoomThemeBanner";
import { RoomSessionNotices } from "../../../../../src/features/rooms/components/RoomRulesDialog";
import type { ChatHistorySource } from "../../../../../src/features/chat/history-reader";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RoomWorkspace } from "../../../../../src/features/rooms/components/RoomWorkspace";
import { DeferredDialog } from "../../../../../src/components/DeferredDialog";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "../../../../../src/components/ui/dialog";
import { ThemeProvider } from "../../../../../src/components/theme-provider";
import { TooltipProvider } from "../../../../../src/components/ui/tooltip";
import { Button } from "../../../../../src/components/ui/button";
import { readUserSettings } from "../../../../../src/features/settings/user-settings";
import type { YouTubePlayer, PlayerStatus } from "../../../../../src/features/playback/providers/YouTubePlayer";
import type { Provider, RoomSnapshot, Track } from "../../../../../src/types";
import type { SocketReply } from "../../../../../src/lib/socket-request";
const polished = new URLSearchParams(location.search).has("workspace");
const reactingListener = new URLSearchParams(location.search).has("listener");

const user = { id: "player-user", name: "Mira", avatarSeed: "mira" };
const track: Track = { id: "t1", provider: "youtube", providerId: "fixture0001", title: "A very long recording title that remains readable in its full track details", artist: "The Evening Ensemble", permalinkUrl: "https://www.youtube.com/watch?v=fixture0001", durationMs: 180000, addedBy: user, addedAt: 1 };
const snapshot: RoomSnapshot = { room: { id: "player-room", name: "Evening radio", ownerUserId: user.id, moderatorUserIds: [], djRoleUserIds: [], isPublic: true, passwordProtected: false, settings: { spotifyEnabled: true }, djUserId: user.id, djQueueUserIds: [], queue: [], history: [], playback: { track, playing: true, position: 30, updatedAt: Date.now() }, vibe: null, createdAt: 1 }, users: [user, { ...user, id: "listener", name: "Jonas" }], djUsers: [user], serverTime: Date.now() };
if (new URLSearchParams(location.search).has("reactions")) {
  snapshot.users.push({ id: "mira", name: "mira", avatarSeed: "mira" });
  snapshot.room.vibe = { trackId: track.id, votes: { mira: -1 } };
}
if (polished) {
  snapshot.room.name = "Evening Radio";
  snapshot.users.push({ id: "sam", name: "Sam", avatarSeed: "sam", avatarKey: "midnight" }, { id: "alex", name: "Alex", avatarSeed: "alex", avatarKey: "orbit" });
  snapshot.room.capabilities = {
    owner: true, staff: true, invite: true, chat: true, media: true, links: true, polls: true,
    joinDj: true, playback: true, chatParticipants: true, djsPlayback: true,
    roomDetailsMusic: true, accessInvites: true
  };
  snapshot.room.djQueueUserIds = [user.id, "listener"];
  snapshot.djUsers = snapshot.users;
  snapshot.room.playback.track = { ...track, providerId: "dX3k_QDnzHE", title: "Midnight City", artist: "M83" };
  snapshot.room.queue = ["Sunset Lover", "A Walk", "Tadow", "Awake", "Kerala", "Open Eye Signal", "Intro"].map((title, index) => ({ ...track, id: `queue-${index}`, providerId: `fixture00${index + 2}`, title, artist: ["Petit Biscuit", "Tycho", "Masego", "Tycho", "Bonobo", "Jon Hopkins", "The xx"][index] }));
  snapshot.room.queue[0].providerId = "4fQeaM62mOY";
}
const chatClient = { channel() { return { on() { return this; }, subscribe(callback: (status: string) => void) { queueMicrotask(() => callback("SUBSCRIBED")); return this; }, async send() { return "ok"; } }; }, async removeChannel() { return "ok"; } } as unknown as SupabaseClient;
const chatMessages: ChatMessage[] = [{ id: "hello-1", content: "This is the perfect soundtrack for the evening.", type: "text", user: snapshot.users[1], createdAt: "2026-10-06T18:30:00Z", song: polished && snapshot.room.playback.track ? songFromTrack(snapshot.room.playback.track, 45) : undefined }, { id: "hello-2", content: "Queued a few favorites for my next turn.", type: "text", user, createdAt: "2026-10-06T18:31:00Z" }];
if (polished && new URLSearchParams(location.search).has("empty")) { snapshot.room.playback.track = null; snapshot.room.queue = []; snapshot.room.djUserId = null; }
if (polished && new URLSearchParams(location.search).has("warning")) {
  snapshot.room.ownStatus = { warnings: [{ id: "fixture-warning", text: "Keep room chat respectful.", createdAt: 1 }] };
}
if (polished) [
  "I've got Tycho lined up after this.", "Nice. Keeping the queue open tonight?", "Yep, join whenever you're ready.",
  "Just got here. This is a good one.", "Welcome back.", "Anyone listening on headphones?", "I am. Turned it up a little.",
  "Added a couple of quieter tracks for later.", "Sounds good.", "Going to make some tea. Back in a minute.",
  "Leaving this on while I finish up.", "Same here."
].forEach((content, index) => chatMessages.push({ id: `study-${index}`, content, type: "text", user: snapshot.users[index % snapshot.users.length], createdAt: `2026-10-06T18:${String(32 + index).padStart(2, "0")}:00Z` }));
const chatHistorySource: ChatHistorySource = {
  loadPage: async () => ({ messages: chatMessages, hasMore: false }),
  search: async query => ({ messages: chatMessages.filter(message => message.content.toLowerCase().includes(query.toLowerCase())), hasMore: false }),
  loadContext: async () => null,
  loadMessage: async id => chatMessages.find(message => message.id === id) || null,
  saveMessage: async () => {},
  saveReaction: async () => {},
  loadMediaUrl: async () => "",
};
type TestState = { spotifyActive: boolean; setSpotifyEnabled: (enabled: boolean) => void; useSpotify: () => void; mounts: number; calls: string[]; requests: Array<{ event: string; payload: unknown }>; pending?: (reply: SocketReply) => void; ready: boolean; actualPlaying?: boolean; buffering: boolean; failConnections: boolean; status?: (value: PlayerStatus) => void; error?: (text: string) => void; update: () => void; setVotes: (votes: Record<string, -1 | 1>) => void; setAllowedProviders: (providers: Provider[]) => void; useMixcloud: () => void; savedRoomSettings?: { allowedProviders: Provider[] } };
const qa: TestState = { spotifyActive: false, setSpotifyEnabled: () => {}, useSpotify: () => {}, mounts: 0, calls: [], requests: [], ready: true, actualPlaying: undefined, buffering: false, failConnections: false, update: () => {}, setVotes: () => {}, setAllowedProviders: () => {}, useMixcloud: () => {} };
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
    if (polished && new URLSearchParams(location.search).has("error")) queueMicrotask(() => onError?.("Could not start playback."));
  }, [playback.track?.id, playback.playing, playback.updatedAt, syncRevision, onStatus]);
  return playback.track?.provider === "mixcloud"
    ? <div className="mixcloud-shell"><iframe title="Fixture Mixcloud player" style={{ width: "100%", height: 120, border: 0 }} /><button type="button">Play Mixcloud</button></div>
    : <div className="youtube-shell"><iframe title="Fixture YouTube player" style={{ width: "100%", height: "100%", border: 0 }} /><span>Fixture provider · volume {volume}</span></div>;
}
function SpotifyFixture({ playback, onStatus }: React.ComponentProps<typeof FixturePlayer>) {
  useEffect(() => { qa.spotifyActive = true; return () => { qa.spotifyActive = false; }; }, []);
  useEffect(() => { onStatus({ ready: true, buffering: false, currentTime: playback.position, duration: 180, trackId: playback.track?.id }); }, [playback, onStatus]);
  return null;
}
const adapters = { youtube: FixturePlayer, mixcloud: FixturePlayer, spotify: SpotifyFixture };
const requestAction = (event: string, payload: unknown, reply: (result: SocketReply) => void) => { qa.calls.push(event); qa.requests.push({ event, payload }); qa.pending = reply; };
function ReadyDialog({ onClose }: { onClose: () => void }) { return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent><DialogTitle>Deferred panel</DialogTitle><DialogDescription>Ready</DialogDescription></DialogContent></Dialog>; }
let releaseModule: () => void;
const loadDelayed = () => new Promise<{ default: typeof ReadyDialog }>((resolve) => { releaseModule = () => resolve({ default: ReadyDialog }); });
let rejectOnce = true;
const loadFlaky = () => rejectOnce ? (rejectOnce = false, Promise.reject(new Error("Module unavailable"))) : Promise.resolve({ default: ReadyDialog });
function Harness() {
  const [settings, setSettings] = useState(readUserSettings);
  const [pane, setPane] = useState<"radio" | "player" | "chat">(polished ? "chat" : "player");
  const [activityContainer, setActivityContainer] = useState<HTMLDivElement | null>(null);
  const [musicOpen, setMusicOpen] = useState(true);
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);
  const [musicOpenRequest, setMusicOpenRequest] = useState(0);
  const musicControls = useRef<MusicRailControls>(null);
  const chatControls = useRef<RealtimeChatHandle>(null);
  const [songMoments, setSongMoments] = useState<ChatSongMoment[]>([]);
  const narrow = useMediaQuery("(max-width: 1024px)");
  const openQueue = () => { setMusicOpen(true); setMusicOpenRequest(request => request + 1); setPane("radio"); if (!narrow) requestAnimationFrame(() => musicControls.current?.openQueue()); };
  const openSearch = () => { setMusicOpen(true); setMusicOpenRequest(request => request + 1); setPane("radio"); requestAnimationFrame(() => requestAnimationFrame(() => musicControls.current?.focusSearch())); };
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
  return <main className={polished ? "app-shell open-room" : "app-shell"}>
    {polished ? <RoomHeader unified roomName={room.room.name} roomSlug={room.room.id} listenerCount={room.users.length} currentUser={user} onHome={() => {}} onSettings={() => setSettingsOpen(true)} onProfile={() => {}} onResetLayout={() => {}} onNotice={() => {}} onOpenQueue={openQueue} onOpenRoomDetails={() => setMobileDetailsOpen(true)} connected={connected} participants={room.users} ownerUserId={user.id} djUserId={user.id} onOpenProfile={() => {}} /> : <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: 8 }}>
      <Button onClick={() => setConnected(value => !value)}>Toggle room connection</Button>
      <Button onClick={() => setSettings(value => ({ ...value, playback: { ...value.playback, preference: "spotify-web", fallback: "silent" } }))}>Use silent fallback</Button>
      <Button onClick={() => setRoom(value => ({ ...value, room: { ...value.room, playback: { ...value.room.playback, track: { ...track, id: "t2", title: "Newest recording" }, updatedAt: Date.now() } } }))}>Change track</Button>
      <Button onClick={() => setDelayedOpen(true)}>Open delayed panel</Button>
      <Button onClick={() => releaseModule?.()}>Resolve panel module</Button>
      <Button onClick={() => setFlakyOpen(true)}>Open flaky panel</Button>
      <Button onClick={() => setRoomSettingsOpen(true)}>Open room settings</Button>
    </div>}
    <RoomWorkspace experience={polished} activityContainerRef={setActivityContainer} musicOpen={musicOpen} musicOpenRequest={musicOpenRequest} mobileDetailsOpen={mobileDetailsOpen} onMobileDetailsOpenChange={setMobileDetailsOpen} value={pane} onValueChange={setPane} defaultLayout={{ radio: 20, player: 45, chat: 35 }}
      listeningChecklist={polished && <ListeningChecklist userId={user.id} providerName="YouTube" providerState={room.room.playback.track ? "ready" : "idle"} audioState={room.room.playback.track ? "playing" : "quiet"} onOpenSettings={() => setSettingsOpen(true)} onChooseMusic={openSearch} />}
      roomStatus={polished && <RoomSessionNotices snapshot={room} accessToken="fixture" connected={connected} onRules={() => {}} />}
      roomNotice={polished && <><RoomThemeBanner prompt={new URLSearchParams(location.search).get("theme") || "After hours"} /><RoomAnnouncementBanner roomId={room.room.id} userId={user.id} announcement={{ id: "fixture-note", text: "One song per turn. Pick something you love.", authorId: user.id, updatedAt: 1, expiresAt: null }} serverTime={room.serverTime} canEdit={false} connected={connected} /></>}
      radio={polished ? <MusicRail controlsRef={musicControls} activityContainer={activityContainer} inlineAddMusic onOpenProfile={() => {}} onClose={narrow ? undefined : () => setMusicOpen(false)} snapshot={room} currentUserId={user.id} accessToken="fixture" connected={connected} setNotice={() => {}} requestAction={requestAction} /> : <div className="panel"><input aria-label="Music search" /></div>}
      chat={polished ? <aside className="chat panel"><div className="chat-header"><strong>Room chat</strong><div className="chat-presence"><small>2 listeners</small><div ref={setChatHeaderActions} className="chat-header-actions" /></div></div><div className="supabase-chat-body"><RealtimeChat ref={chatControls} onSongMomentsChange={setSongMoments} currentSong={room.room.playback.track ? songFromTrack(room.room.playback.track, 30) : undefined} headerActionsContainer={chatHeaderActions} historyRoomSlug={room.room.id} historySource={chatHistorySource} notifications={settings.notifications} client={chatClient} roomName="soundspin:player-room" user={user} roomUsers={room.users} messages={chatMessages} onSend={async () => {}} isVisible={!narrow || pane === "chat"} /></div></aside> : <div className="chat panel"><textarea aria-label="Chat draft" /></div>}
      player={<div className="player-column" data-revision={revision}><NowPlaying songMoments={songMoments} onOpenSongMoment={messageId => { setPane("chat"); requestAnimationFrame(() => requestAnimationFrame(() => chatControls.current?.revealMessage(messageId))); }} onOpenQueue={polished ? openQueue : undefined} onAddTrack={polished ? openSearch : undefined} presentation={polished ? "dock" : "panel"} snapshot={room} currentUserId={reactingListener ? "listener" : user.id} isDj canControlPlayback accessToken="fixture" compact={settings.playback.compactPlayer} onToggleCompact={() => setSettings(value => ({ ...value, playback: { ...value.playback, compactPlayer: !value.playback.compactPlayer } }))} settingsOpen={settingsOpen} onCloseSettings={() => setSettingsOpen(false)} userSettings={settings} onUserSettingsChange={setSettings} roomConnected={connected} onOpenSettings={() => setSettingsOpen(true)} requestAction={requestAction} providerPlayers={adapters} /></div>} />
    {delayedOpen && <DeferredDialog title="Deferred panel" load={loadDelayed} componentProps={{ onClose: () => setDelayedOpen(false) }} />}
    {flakyOpen && <DeferredDialog title="Deferred panel" load={loadFlaky} componentProps={{ onClose: () => setFlakyOpen(false) }} />}
    {roomSettingsOpen && <RoomSettingsDialog snapshot={room} currentUserId={user.id} accessToken="fixture" connected={connected} onNotice={() => { if (qa.savedRoomSettings) qa.setAllowedProviders(qa.savedRoomSettings.allowedProviders); }} onClose={() => setRoomSettingsOpen(false)} />}
  </main>;
}
createRoot(document.getElementById("root")!).render(<ThemeProvider attribute="class" defaultTheme="dark"><TooltipProvider><Harness /></TooltipProvider></ThemeProvider>);
