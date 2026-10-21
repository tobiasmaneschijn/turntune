import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { AppleMusicPlayer } from "../../../../src/features/playback/providers/AppleMusicPlayer";
import { SoundCloudPlayer } from "../../../../src/features/playback/providers/SoundCloudPlayer";
import { AudiusPlayer } from "../../../../src/features/playback/providers/AudiusPlayer";
import { NowPlaying, type NowPlayingLocalState } from "../../../../src/features/playback/components/NowPlaying";
import { TooltipProvider } from "../../../../src/components/ui/tooltip";
import { readUserSettings } from "../../../../src/features/settings/user-settings";
import type { Playback, RoomSnapshot } from "../../../../src/types";
import type { PlayerStatus } from "../../../../src/features/playback/providers/YouTubePlayer";
import { configureTelemetry, type MetricOptions, type MetricType } from "../../../../shared/observability";
import "../../../../src/styles/shadcn.css";
import "../../../../src/styles/index.css";

const requestedProvider = new URLSearchParams(location.search).get("provider");
const provider = requestedProvider === "apple" || requestedProvider === "audius" ? requestedProvider : "soundcloud";
const hostMode = new URLSearchParams(location.search).has("host");
const root = createRoot(document.getElementById("root")!);
const calls: { method: string; value?: unknown }[] = [];
const statusCallbacks: number[] = [];
const statusSamples: (PlayerStatus & { version: number })[] = [];
const endCallbacks: number[] = [];
const errors: string[] = [];
if (provider === "audius") {
  const nativePlay = HTMLMediaElement.prototype.play;
  let blockPlay = new URLSearchParams(location.search).has("block-audio");
  HTMLMediaElement.prototype.play = function () {
    calls.push({ method: "audio:play", value: { activated: navigator.userActivation.isActive } });
    if (blockPlay) {
      blockPlay = false;
      return Promise.reject(new DOMException("User activation required", "NotAllowedError"));
    }
    return nativePlay.call(this);
  };
}
const metrics: Array<{ type: MetricType; name: string; value: number; options: MetricOptions }> = [];
configureTelemetry({ captureError() {}, log() {}, metric(type, name, value, options) { metrics.push({ type, name, value, options }); }, async flush() {} });
const positionCallbacks: ((position: number) => void)[] = [];
const pausedCallbacks: { callback: (paused: boolean) => void; paused: boolean }[] = [];
const listeners = new Map<string, (event?: unknown) => void>();
const readyCallbacks: ((event?: unknown) => void)[] = [];
const loadCallbacks: (() => void)[] = [];
const hostRequests: string[] = [];
let hostState: NowPlayingLocalState | undefined;
let deferredFinish: (() => void) | undefined;
let hostSettings = readUserSettings();
hostSettings = { ...hostSettings, playback: { ...hostSettings.playback, defaultVolume: 50 } };
let deferWidgetReady = new URLSearchParams(location.search).has("defer-ready");
let deferWidgetLoad = false;
let widgetCreations = 0;
let widgetPaused = true;
let deferPaused = false;
let now = 100_000;
Date.now = () => now;
let callbackVersion = 0;
let accessToken = "initial-token";
let userId = "listener-one";
localStorage.setItem("soundspin-apple-account-id", new URLSearchParams(location.search).get("apple-owner") || userId);
let syncRevision = 0;
let configurations = 0;
let failNextPlay = false;
let playback: Playback = {
  track: {
    id: "room-track",
    provider,
    providerId: provider === "audius" ? "D7KyD" : "provider-track",
    permalinkUrl: provider === "audius" ? "https://audius.co/test/track" : "https://soundcloud.com/test/track",
    title: "Regression track",
    durationMs: 180_000,
    mappings: { apple: { providerId: "123456789" } },
    addedBy: { id: "dj", name: "DJ", avatarSeed: "dj" },
    addedAt: now
  },
  playing: true,
  position: 10,
  updatedAt: now
};

let musicAuthorized = true;
const playbackStates = { playing: 2, paused: 3, stopped: 4, ended: 5, completed: 10 };
function createMusic() { return {
  isAuthorized: musicAuthorized,
  currentPlaybackTime: 10,
  currentPlaybackDuration: 180,
  playbackState: playbackStates.stopped as number | string,
  volume: 1,
  authorize: async () => { musicAuthorized = true; music.isAuthorized = true; calls.push({ method: "authorize" }); return "music-user-token"; },
  unauthorize: async () => { musicAuthorized = false; music.isAuthorized = false; calls.push({ method: "unauthorize" }); },
  setQueue: async (value: unknown) => { calls.push({ method: "setQueue", value }); },
  async seekToTime(value: number) { calls.push({ method: "seek", value }); this.currentPlaybackTime = value; },
  play: async () => {
    calls.push({ method: "play" });
    if (failNextPlay) { failNextPlay = false; throw new Error("Temporary Apple playback interruption"); }
    music.playbackState = playbackStates.playing;
  },
  pause: async () => { calls.push({ method: "pause" }); music.playbackState = playbackStates.paused; }
}; }
let music = createMusic();
window.MusicKit = {
  PlaybackStates: playbackStates,
  configure: () => {
    calls.push({ method: "configure" });
    if (configurations++ > 0) music = createMusic();
  },
  getInstance: () => music
};

const widget = {
  bind(event: string, listener: (event?: unknown) => void) {
    listeners.set(event, listener);
    if (event === "ready") {
      readyCallbacks.push(listener);
      if (!deferWidgetReady) queueMicrotask(() => listener());
    }
  },
  load(url: string, options: { callback?: () => void }) {
    calls.push({ method: "load", value: url });
    if (deferWidgetLoad && options.callback) loadCallbacks.push(options.callback);
    else queueMicrotask(() => options.callback?.());
  },
  play() { calls.push({ method: "play" }); },
  pause() { calls.push({ method: "pause" }); },
  seekTo(value: number) {
    calls.push({ method: "seek", value });
    queueMicrotask(() => listeners.get("seek")?.());
  },
  setVolume() {},
  getDuration(callback: (duration: number) => void) { callback(180_000); },
  getPosition(callback: (position: number) => void) { positionCallbacks.push(callback); },
  isPaused(callback: (paused: boolean) => void) {
    if (deferPaused) pausedCallbacks.push({ callback, paused: widgetPaused });
    else callback(widgetPaused);
  }
};
window.SC = { Widget: Object.assign(() => { widgetCreations++; return widget; }, {
  Events: { READY: "ready", LOAD_PROGRESS: "load", PLAY_PROGRESS: "progress", SEEK: "seek", FINISH: "finish", ERROR: "error" }
}) };

function render() {
  if (hostMode) {
    const user = { id: userId, name: "Listener", avatarSeed: userId };
    const snapshot: RoomSnapshot = {
      room: {
        id: "provider-switch-room", name: "Provider switch", ownerUserId: userId,
        moderatorUserIds: [], djRoleUserIds: [], isPublic: true, passwordProtected: false,
        settings: {}, djUserId: userId, djQueueUserIds: [], queue: [], history: [],
        playback, vibe: null, createdAt: now
      },
      users: [user], djUsers: [user], serverTime: now
    };
    root.render(createElement(TooltipProvider, null, createElement(NowPlaying, {
      snapshot, currentUserId: userId, accessToken, isDj: true, canControlPlayback: true,
      compact: false, onToggleCompact() {}, settingsOpen: false, onCloseSettings() {},
      userSettings: hostSettings, onUserSettingsChange(settings) { hostSettings = settings; render(); },
      onLocalStateChange(state) { hostState = state; },
      requestAction(event, payload, reply) {
        hostRequests.push(event);
        if (provider === "audius" && event === "playback:update") {
          const update = payload as { playing: boolean; position: number };
          playback = { ...playback, playing: update.playing, position: update.position, updatedAt: now };
          render();
        }
        reply({ ok: true });
      }
    })));
    return;
  }
  const version = callbackVersion;
  const common = {
    playback,
    syncRevision,
    isDj: true,
    volume: 50,
    onEnded: () => endCallbacks.push(version),
    onError: (message: string) => errors.push(message),
    onStatus: (status: PlayerStatus) => {
      statusCallbacks.push(version);
      statusSamples.push({ ...status, version });
    }
  };
  root.render(provider === "apple"
    ? createElement(AppleMusicPlayer, { ...common, accessToken, userId, mapping: { providerId: "provider-track" } })
    : provider === "audius" ? createElement(AudiusPlayer, { ...common, accessToken, userId, roomSlug: "provider-switch-room" })
    : createElement(SoundCloudPlayer, common));
}

Object.assign(window, {
  providerTest: {
    calls,
    statusCallbacks,
    statusSamples,
    endCallbacks,
    errors,
    metrics,
    inspectHost: () => ({ state: hostState, requests: hostRequests, musicPlaying: music.playbackState === playbackStates.playing, track: playback.track }),
    holdSoundCloudCallbacks() {
      deferPaused = true;
      listeners.get("progress")?.({ currentPosition: 179_000 });
      deferredFinish = listeners.get("finish");
    },
    reportSoundCloudProgress(position: number) {
      const held = deferPaused;
      deferPaused = false;
      listeners.get("progress")?.({ currentPosition: position });
      deferPaused = held;
    },
    releaseSoundCloudCallbacks() {
      deferPaused = false;
      for (const pending of pausedCallbacks.splice(0)) pending.callback(pending.paused);
      deferredFinish?.(); deferredFinish = undefined;
    },
    inspectMusic: () => ({ volume: music.volume, authorized: music.isAuthorized }),
    failNextMusicPlay: () => { failNextPlay = true; },
    get widgetCreations() { return widgetCreations; },
    get pendingLoads() { return loadCallbacks.length; },
    resolveReady(index: number) { readyCallbacks[index]?.(); },
    deferWidgetLoads(value: boolean) { deferWidgetLoad = value; },
    resolveLoad() { loadCallbacks.shift()?.(); },
    get pendingPositions() { return positionCallbacks.length; },
    get pendingPaused() { return pausedCallbacks.length; },
    setNow(value: number) { now = value; },
    resolvePosition(value: number) { positionCallbacks.shift()?.(value); },
    setWidgetPaused(value: boolean) { widgetPaused = value; },
    deferPaused() { deferPaused = true; },
    resolvePaused() {
      deferPaused = false;
      const pending = pausedCallbacks.shift();
      pending?.callback(pending.paused);
    },
    setMusicState(progress: number, state: string) {
      music.currentPlaybackTime = progress;
      music.playbackState = playbackStates[state as keyof typeof playbackStates] ?? state;
    },
    render(options: { userId?: string; accessToken?: string; callbackVersion?: number; position?: number; playing?: boolean; syncRevision?: number; trackId?: string; providerId?: string }) {
      userId = options.userId ?? userId;
      accessToken = options.accessToken ?? accessToken;
      callbackVersion = options.callbackVersion ?? callbackVersion;
      syncRevision = options.syncRevision ?? syncRevision;
      if (options.position !== undefined || options.playing !== undefined) playback = { ...playback, position: options.position ?? playback.position, playing: options.playing ?? playback.playing, updatedAt: now };
      if (options.trackId && playback.track) playback = { ...playback, track: { ...playback.track, id: options.trackId, permalinkUrl: `https://soundcloud.com/test/${options.trackId}` }, updatedAt: now };
      if (options.providerId && playback.track) playback = { ...playback, track: { ...playback.track, providerId: options.providerId }, updatedAt: now };
      render();
    },
    unmount() { root.unmount(); }
  }
});
render();
