import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MusicRail, type MusicRailAction, type MusicRailActionName, type MusicRailControls } from "../../../../src/features/music/components/MusicRail";
import { ThemeProvider } from "../../../../src/components/theme-provider";
import type { SocketReply } from "../../../../src/lib/socket-request";
import type { Provider, RoomSnapshot, Track, User } from "../../../../src/types";
import "../../../../src/styles/shadcn.css";
import "../../../../src/styles/index.css";
import "../../../../src/styles/open-room.css";
import "./music.css";

const inlinePanel = new URLSearchParams(location.search).has("inline");
if (inlinePanel) document.documentElement.setAttribute("data-room-design", "open-room");

const self: User = { id: "self", name: "Alex", avatarSeed: "alex", avatarKey: "pulse" };
const other: User = { id: "other", name: "Casey", avatarSeed: "casey", avatarKey: "pulse" };
const tracks: Track[] = ["Alpha", "Beta", "Gamma"].map((title, index) => ({
  id: `queue-${title}`, title, artist: "Fixture Artist", provider: "youtube", providerId: ["dQw4w9WgXcQ", "9bZkp7q19f0", "kJQP7kiw5Fk"][index], durationMs: 183000,
  addedBy: self, addedAt: 1
}));

function initialSnapshot(roomId = "fixture-room"): RoomSnapshot {
  const scenario = new URLSearchParams(location.search).get("scenario");
  const artworkList = (kind: string) => Array.from({ length: 100 }, (_, index): Track => ({ ...tracks[0], id: `${kind}-${index}`, title: `${kind} track ${index}`, provider: "spotify", providerId: `${kind}-${index}`, artworkUrl: `/tests/browser/music/harness/art/${kind}-${index}.svg` }));
  const listener = ["listener", "restricted", "listener-quiet", "library-listener"].includes(scenario || "");
  const quiet = scenario === "quiet" || scenario === "listener-quiet";
  return {
    room: { id: roomId, name: "Music tools", ownerUserId: other.id, moderatorUserIds: [], djRoleUserIds: [], isPublic: true, passwordProtected: false,
      settings: { spotifyEnabled: true, djAccess: scenario === "restricted" ? "roles" : "everyone" },
      djUserId: quiet ? null : other.id,
      djQueueUserIds: listener ? [other.id] : [self.id, other.id],
      queue: scenario === "library-artwork-preload" ? artworkList("queue") : quiet || listener ? [] : tracks.map((track) => ({ ...track })),
      history: scenario === "library-artwork-preload" ? artworkList("history") : [{ ...tracks[1], id: "history-beta", artist: "Past Artist", provider: "spotify", providerId: "5bJ1DrEM4hNCafcDd1oxHx", addedBy: other, playedAt: Date.UTC(2026, 9, 6, 20, 45) }, { ...tracks[2], id: "history-gamma", artist: "Another Artist" }],
      playback: { track: quiet ? null : { ...tracks[0], id: "currently-playing", providerId: "Zi_XLOBDo_Y", addedBy: other }, playing: !quiet, position: 30, updatedAt: Date.now() },
      vibe: null, createdAt: 1 },
    users: [self, other], djUsers: [self, other], serverTime: Date.now()
  };
}

const commands: Array<{ event: MusicRailActionName; payload: any }> = [];
const waitingActions: Array<(response?: SocketReply) => void> = [];
let deferAction = false;
let counter = 0;
const undoTracks = new Map<string, { track: Track; after?: string; before?: string; roomId: string }>();

declare global {
  interface Window {
    musicQol: {
      commands: typeof commands;
      deferNextAction(): void;
      resolveNext(response?: SocketReply): void;
      setRoom(roomId: string): void;
      setConnected(connected: boolean): void;
      snapshot(): RoomSnapshot;
      setDj(userId: string | null): void;
      setTrackMetadata(trackId: string, title: string, artist: string): void;
      setAllowedProviders(providers: Provider[]): void;
      openQueue(): void;
    };
  }
}

function Harness() {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [connected, setConnected] = useState(true);
  const [notice, setNotice] = useState("");
  const controlsRef = useRef<MusicRailControls>(null);
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const update = (next: RoomSnapshot) => { latest.current = next; setSnapshot(next); };

  const requestAction: MusicRailAction = (event, payload, reply) => {
    commands.push({ event, payload });
    const roomId = latest.current.room.id;
    const execute = (forced?: SocketReply) => {
      if (forced?.ok === false) { reply(forced); return; }
      if (latest.current.room.id !== roomId) { reply({ ok: true, position: 9 }); return; }
      const next: RoomSnapshot = { ...latest.current, room: { ...latest.current.room, queue: [...latest.current.room.queue], djQueueUserIds: [...latest.current.room.djQueueUserIds] } };
      let result: SocketReply = { ok: true };
      const data = payload as any;
      if (event === "dj:join") {
        next.room.djQueueUserIds.unshift(self.id);
        if (!next.room.playback.track && next.room.queue.length) {
          next.room.playback = { track: next.room.queue.shift()!, playing: true, position: 0, updatedAt: Date.now() };
          next.room.djUserId = self.id;
        }
      }
      if (event === "dj:leave") next.room.djQueueUserIds = next.room.djQueueUserIds.filter((id) => id !== self.id);
      if (event === "queue:add") {
        const track: Track = { ...data, id: `added-${++counter}`, addedBy: self, addedAt: Date.now() };
        if (!next.room.playback.track && next.room.djQueueUserIds.includes(self.id)) {
          next.room.playback = { track, playing: true, position: 0, updatedAt: Date.now() };
          next.room.djUserId = self.id;
          result = { ok: true, started: true, position: 0 };
        } else {
          next.room.queue.push(track);
          result = { ok: true, position: next.room.queue.length };
        }
      }
      if (event === "queue:remove" || event === "queue:move" || event === "queue:play-next") {
        const index = next.room.queue.findIndex((track) => track.id === data.trackId);
        if (index < 0) { reply({ ok: false, error: "Track not found." }); return; }
        const before = next.room.queue[index - 1]?.id; const after = next.room.queue[index + 1]?.id;
        const [track] = next.room.queue.splice(index, 1);
        if (event === "queue:remove") { const token = crypto.randomUUID(); undoTracks.set(token, { track, before, after, roomId }); result.undo = { token, title: track.title, expiresAt: Date.now() + 15_000 }; }
        if (event !== "queue:remove") next.room.queue.splice(event === "queue:play-next" ? 0 : data.toIndex, 0, track);
      }
      if (event === "queue:undo") {
        const receipt = undoTracks.get(data.token);
        if (!receipt || receipt.roomId !== roomId) { reply({ ok: false, error: "Undo expired." }); return; }
        const after = next.room.queue.findIndex((track) => track.id === receipt.after);
        const before = next.room.queue.findIndex((track) => track.id === receipt.before);
        const index = after >= 0 ? after : before >= 0 ? before + 1 : next.room.queue.length;
        next.room.queue.splice(index, 0, receipt.track); undoTracks.delete(data.token); result.position = index + 1;
      }
      if (event === "queue:set-add") result = { ok: true, added: 1, skipped: [{ title: "Unavailable recording", reason: "This recording is unavailable on its source provider." }] };
      next.serverTime = Date.now();
      update(next);
      reply(forced || result);
    };
    if (deferAction) { deferAction = false; waitingActions.push(execute); }
    else execute();
  };

  window.musicQol = {
    commands,
    deferNextAction: () => { deferAction = true; },
    resolveNext: (response) => { const execute = waitingActions.shift(); if (!execute) throw new Error("No pending action"); execute(response); },
    setRoom: (roomId) => update(initialSnapshot(roomId)),
    setConnected,
    setDj: (userId) => update({ ...latest.current, room: { ...latest.current.room, djUserId: userId } }),
    setTrackMetadata: (trackId, title, artist) => update({ ...latest.current, room: { ...latest.current.room, queue: latest.current.room.queue.map((track) => track.id === trackId ? { ...track, title, artist } : track) } }),
    setAllowedProviders: (allowedProviders) => update({ ...latest.current, room: { ...latest.current.room, settings: { ...latest.current.room.settings, allowedProviders } } }),
    snapshot: () => latest.current,
    openQueue: () => controlsRef.current?.openQueue()
  };

  return <><p className="music-harness-heading">Production MusicRail · deterministic actions</p><main className="music-qol-harness" style={{ display: new URLSearchParams(location.search).has("hideMusic") ? "none" : undefined, width: inlinePanel ? 320 : undefined }}><MusicRail snapshot={snapshot} currentUserId={self.id} accessToken={new URLSearchParams(location.search).get("scenario")?.startsWith("library") ? "fixture-access-token" : undefined} connected={connected} requestAction={requestAction} setNotice={setNotice} controlsRef={controlsRef} inlineAddMusic={inlinePanel} /></main><output className="music-harness-output" aria-label="Last music notice">{notice}</output></>;
}

createRoot(document.getElementById("root")!).render(<ThemeProvider><Harness /></ThemeProvider>);
