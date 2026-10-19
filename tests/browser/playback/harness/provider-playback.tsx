import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { AppleMusicPlayer } from "../../../../src/features/playback/providers/AppleMusicPlayer";
import { SoundCloudPlayer } from "../../../../src/features/playback/providers/SoundCloudPlayer";
import type { Playback } from "../../../../src/types";
import type { PlayerStatus } from "../../../../src/features/playback/providers/YouTubePlayer";

const provider = new URLSearchParams(location.search).get("provider") === "apple" ? "apple" : "soundcloud";
const root = createRoot(document.getElementById("root")!);
const calls: { method: string; value?: unknown }[] = [];
const statusCallbacks: number[] = [];
const statusSamples: (PlayerStatus & { version: number })[] = [];
const endCallbacks: number[] = [];
const errors: string[] = [];
const positionCallbacks: ((position: number) => void)[] = [];
const pausedCallbacks: { callback: (paused: boolean) => void; paused: boolean }[] = [];
const listeners = new Map<string, (event?: unknown) => void>();
const readyCallbacks: ((event?: unknown) => void)[] = [];
const loadCallbacks: (() => void)[] = [];
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
    providerId: "provider-track",
    permalinkUrl: "https://soundcloud.com/test/track",
    title: "Regression track",
    durationMs: 180_000,
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
  playbackState: playbackStates.playing as number | string,
  volume: 1,
  authorize: async () => { musicAuthorized = true; music.isAuthorized = true; calls.push({ method: "authorize" }); return "music-user-token"; },
  unauthorize: async () => { musicAuthorized = false; music.isAuthorized = false; calls.push({ method: "unauthorize" }); },
  setQueue: async (value: unknown) => { calls.push({ method: "setQueue", value }); },
  async seekToTime(value: number) { calls.push({ method: "seek", value }); this.currentPlaybackTime = value; },
  play: async () => {
    calls.push({ method: "play" });
    if (failNextPlay) { failNextPlay = false; throw new Error("Temporary Apple playback interruption"); }
  },
  pause: async () => { calls.push({ method: "pause" }); }
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
    : createElement(SoundCloudPlayer, common));
}

Object.assign(window, {
  providerTest: {
    calls,
    statusCallbacks,
    statusSamples,
    endCallbacks,
    errors,
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
    render(options: { userId?: string; accessToken?: string; callbackVersion?: number; position?: number; playing?: boolean; syncRevision?: number; trackId?: string }) {
      userId = options.userId ?? userId;
      accessToken = options.accessToken ?? accessToken;
      callbackVersion = options.callbackVersion ?? callbackVersion;
      syncRevision = options.syncRevision ?? syncRevision;
      if (options.position !== undefined || options.playing !== undefined) playback = { ...playback, position: options.position ?? playback.position, playing: options.playing ?? playback.playing, updatedAt: now };
      if (options.trackId && playback.track) playback = { ...playback, track: { ...playback.track, id: options.trackId, permalinkUrl: `https://soundcloud.com/test/${options.trackId}` }, updatedAt: now };
      render();
    },
    unmount() { root.unmount(); }
  }
});
render();
