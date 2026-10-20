import { createRoot } from "react-dom/client";
import "../../../../src/styles/shadcn.css";
import "../../../../src/styles/index.css";
import { SpotifyPlayer } from "../../../../src/features/playback/providers/SpotifyPlayer";
import type { PlayerStatus } from "../../../../src/features/playback/providers/YouTubePlayer";
import { resetProviderSession, setProviderAccount } from "../../../../src/features/playback/provider-session";
import type { Playback, ProviderTrackMapping, Track } from "../../../../src/types";

interface MockState {
  paused: boolean;
  position: number;
  duration: number;
  track_window: { current_track: { uri: string } };
}

interface Command {
  source: "sdk" | "api";
  action: string;
  positionMs?: number;
  spotifyUri?: string;
  deviceId?: string;
  authorization?: string | null;
}

const commands: Command[] = [];
const statuses: PlayerStatus[] = [];
const errors: string[] = [];
const connectionsLost: string[] = [];
let sdkState: MockState | null = null;
let sdkUpdatedAt = Date.now();
let deferredState: { state: MockState | null; resolve: (state: MockState | null) => void } | undefined;
let deferNextState = false;
let sdkPlayer: MockSpotifyPlayer | undefined;
const sdkPlayers: MockSpotifyPlayer[] = [];
let deferNextPlay = false;
let deferredPlay: (() => void) | undefined;

function readState(): MockState | null {
  if (!sdkState) return null;
  return {
    ...sdkState,
    position: sdkState.position + (sdkState.paused ? 0 : Date.now() - sdkUpdatedAt),
    track_window: { current_track: { ...sdkState.track_window.current_track } }
  };
}

function setState(state: MockState | null) {
  sdkState = state;
  sdkUpdatedAt = Date.now();
}

function setPaused(paused: boolean) {
  const current = readState();
  if (current) setState({ ...current, paused });
}

class MockSpotifyPlayer {
  private listeners = new Map<string, Array<(payload: never) => void>>();

  constructor(private options: { getOAuthToken: (callback: (token: string) => void) => void }) {
    sdkPlayer = this; sdkPlayers.push(this);
  }

  async connect() {
    commands.push({ source: "sdk", action: "connect" });
    await new Promise<void>((resolve) => this.options.getOAuthToken(() => resolve()));
    this.emit("ready", { device_id: "mock-web-device" });
    return true;
  }

  disconnect() {
    commands.push({ source: "sdk", action: "disconnect" });
  }

  addListener(event: string, listener: (payload: never) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) || []), listener]);
    return true;
  }

  removeListener(event?: string) {
    if (event) this.listeners.delete(event);
    else this.listeners.clear();
    return true;
  }

  emit(event: string, payload: unknown = {}) {
    for (const listener of this.listeners.get(event) || []) listener(payload as never);
  }

  async getCurrentState() {
    commands.push({ source: "sdk", action: "getCurrentState" });
    const state = readState();
    if (!deferNextState) return state;
    deferNextState = false;
    return new Promise<MockState | null>((resolve) => { deferredState = { state, resolve }; });
  }

  async setVolume() {
    commands.push({ source: "sdk", action: "setVolume" });
  }

  async pause() {
    commands.push({ source: "sdk", action: "pause" });
    setPaused(true);
  }

  async resume() {
    commands.push({ source: "sdk", action: "resume" });
    setPaused(false);
  }

  async seek(positionMs: number) {
    commands.push({ source: "sdk", action: "seek", positionMs });
    const current = readState();
    if (current) setState({ ...current, position: positionMs });
  }

  async activateElement() {
    commands.push({ source: "sdk", action: "activateElement" });
  }

  requestTokenCallback(callback: (token: string) => void) { this.options.getOAuthToken(callback); }

  requestToken() {
    return new Promise<string>((resolve) => this.options.getOAuthToken(resolve));
  }
}

window.Spotify = { Player: MockSpotifyPlayer };

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = new URL(url, location.href).pathname;
  if (path.startsWith("/api/spotify/") && new Headers(init?.headers).get("x-soundspin-room") !== "fixture-room") return Response.json({ error: "An enabled room is required." }, { status: 403 });
  if (path === "/api/spotify/token") {
    commands.push({ source: "api", action: "token", authorization: new Headers(init?.headers).get("Authorization") });
    return Response.json({ accessToken: "mock-spotify-access-token" });
  }
  if (path === "/api/spotify/devices") {
    return Response.json({ devices: [{ id: "mock-desktop-device", name: "Mock computer", type: "Computer", is_active: true, is_restricted: false }] });
  }
  if (path !== "/api/spotify/playback") return realFetch(input, init);
  if (init?.method !== "POST") {
    commands.push({ source: "api", action: "getCurrentState" });
    const current = readState();
    return Response.json({ state: current ? {
      device: { id: mode === "desktop" ? "mock-desktop-device" : "mock-web-device" },
      is_playing: !current.paused,
      progress_ms: current.position,
      item: { uri: current.track_window.current_track.uri, duration_ms: current.duration }
    } : null });
  }
  const command = JSON.parse(String(init.body)) as Omit<Command, "source">;
  commands.push({ source: "api", ...command });
  if (command.action === "play") {
    if (deferNextPlay) {
      deferNextPlay = false;
      await new Promise<void>((resolve) => { deferredPlay = resolve; });
    }
    setState({
      paused: false,
      position: command.positionMs || 0,
      duration: 240_000,
      track_window: { current_track: { uri: command.spotifyUri || "spotify:track:track-a" } }
    });
  } else if (command.action === "pause") {
    setPaused(true);
  } else if (command.action === "resume") {
    setPaused(false);
  } else if (command.action === "seek") {
    const current = readState();
    if (current) setState({ ...current, position: command.positionMs || 0 });
  }
  return new Response(null, { status: 204 });
};

const user = { id: "listener", name: "Listener", avatarSeed: "listener" };
function createTrack(id: string): Track {
  return { id, provider: "spotify", providerId: id, title: id, durationMs: 240_000, addedAt: Date.now(), addedBy: user };
}

let playback: Playback = { track: createTrack("track-a"), playing: true, position: 60, updatedAt: Date.now() };
let mapping: ProviderTrackMapping | undefined = { providerId: "track-a" };
let resumeAfterReconnect = new URLSearchParams(location.search).get("resume") !== "false";
let accessToken = "mock-app-access-token";
let userId = "listener-one";
const mode = new URLSearchParams(location.search).get("mode") === "desktop" ? "desktop" : "web";
const root = createRoot(document.getElementById("root")!);
const onStatus = (status: PlayerStatus) => { statuses.push(status); };
const onEnded = () => { errors.push("unexpected track end"); };
const onConnectionLost = (message: string) => { connectionsLost.push(message); };
const onError = (message: string) => { errors.push(message); };
let mounted = true;

function render() {
  root.render(mounted ? <SpotifyPlayer roomSlug="fixture-room"
    playback={playback}
    mapping={mapping}
    mode={mode}
    isDj={false}
    volume={75}
    accessToken={accessToken}
    userId={userId}
    resumeAfterReconnect={resumeAfterReconnect}
    onEnded={onEnded}
    onStatus={onStatus}
    onConnectionLost={onConnectionLost}
    onError={onError}
  /> : <div>Following room source</div>);
}

export interface PlaybackHarness {
  inspect(): { commands: Command[]; state: MockState | null; playback: Playback; statuses: PlayerStatus[]; errors: string[]; connectionsLost: string[]; pendingState: boolean; pendingPlay: boolean };
  resetCommands(): void;
  setSdkState(state: { uri?: string; positionMs?: number; paused?: boolean } | null): void;
  updatePlayback(update: { trackId?: string; playing?: boolean; position?: number; updatedAt?: number; resumeAfterReconnect?: boolean }): void;
  wake(events: Array<"focus" | "visible" | "hidden" | "online">): void;
  emit(event: string, payload?: unknown): void;
  deferNextState(): void;
  resolvePendingState(): void;
  sync(): void;
  refreshAccessToken(token: string): void;
  switchAccount(id: string, token: string): void;
  disconnectProvider(): Promise<void>;
  logout(): void;
  requestSdkToken(): Promise<string | undefined>;
  requestOldSdkToken(): void;
  deferNextPlay(): void;
  resolvePendingPlay(): void;
  fallback(): void;
  mount(): void;
}

declare global {
  interface Window { playbackHarness: PlaybackHarness }
}

window.playbackHarness = {
  inspect: () => ({ commands: [...commands], state: readState(), playback, statuses: [...statuses], errors: [...errors], connectionsLost: [...connectionsLost], pendingState: Boolean(deferredState), pendingPlay: Boolean(deferredPlay) }),
  resetCommands: () => { commands.length = 0; },
  setSdkState: (state) => {
    if (!state) { setState(null); return; }
    const current = readState();
    setState({
      paused: state.paused ?? current?.paused ?? false,
      position: state.positionMs ?? current?.position ?? 0,
      duration: 240_000,
      track_window: { current_track: { uri: state.uri ?? current?.track_window.current_track.uri ?? "spotify:track:track-a" } }
    });
  },
  updatePlayback: (update) => {
    playback = {
      ...playback,
      playing: update.playing ?? playback.playing,
      position: update.position ?? playback.position,
      updatedAt: update.updatedAt ?? Date.now(),
      track: update.trackId ? createTrack(update.trackId) : playback.track
    };
    if (update.trackId) mapping = { providerId: update.trackId };
    resumeAfterReconnect = update.resumeAfterReconnect ?? resumeAfterReconnect;
    render();
  },
  wake: (events) => {
    for (const event of events) {
      if (event === "visible" || event === "hidden") {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: event === "hidden" ? "hidden" : "visible" });
        document.dispatchEvent(new Event("visibilitychange"));
      } else {
        window.dispatchEvent(new Event(event));
      }
    }
  },
  emit: (event, payload) => { sdkPlayer?.emit(event, payload); },
  deferNextState: () => { deferNextState = true; },
  resolvePendingState: () => {
    const pending = deferredState;
    deferredState = undefined;
    pending?.resolve(pending.state);
  },
  sync: () => { window.dispatchEvent(new Event("soundspin:playback-sync")); },
  refreshAccessToken: (token) => { accessToken = token; render(); },
  requestSdkToken: async () => sdkPlayer?.requestToken(),
  requestOldSdkToken: () => sdkPlayers[0]?.requestTokenCallback(() => commands.push({source:"sdk", action:"stale-token"})),
  switchAccount: (id, token) => { userId = id; accessToken = token; setProviderAccount(id); render(); },
  disconnectProvider: () => resetProviderSession("spotify"),
  logout: () => { setProviderAccount(null); mounted = false; render(); },
  deferNextPlay: () => { deferNextPlay = true; },
  resolvePendingPlay: () => { const resolve = deferredPlay; deferredPlay = undefined; resolve?.(); },
  fallback: () => { mounted = false; render(); },
  mount: () => { mounted = true; render(); }
};

render();
