import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { AppleMusicPlayer } from "../../src/components/AppleMusicPlayer";
import { SoundCloudPlayer } from "../../src/components/SoundCloudPlayer";
import type { Playback } from "../../src/types";
import type { PlayerStatus } from "../../src/components/YouTubePlayer";

const provider = new URLSearchParams(location.search).get("provider") === "apple" ? "apple" : "soundcloud";
const root = createRoot(document.getElementById("root")!);
const calls: { method: string; value?: unknown }[] = [];
const statusCallbacks: number[] = [];
const statusSamples: (PlayerStatus & { version: number })[] = [];
const endCallbacks: number[] = [];
const positionCallbacks: ((position: number) => void)[] = [];
const pausedCallbacks: { callback: (paused: boolean) => void; paused: boolean }[] = [];
const listeners = new Map<string, (event?: unknown) => void>();
let widgetPaused = true;
let deferPaused = false;
let now = 100_000;
Date.now = () => now;
let callbackVersion = 0;
let accessToken = "initial-token";
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

const playbackStates = { playing: 2, paused: 3, stopped: 4, ended: 5, completed: 10 };
const music = {
  isAuthorized: true,
  currentPlaybackTime: 10,
  currentPlaybackDuration: 180,
  playbackState: playbackStates.playing as number | string,
  authorize: async () => "music-user-token",
  setQueue: async (value: unknown) => { calls.push({ method: "setQueue", value }); },
  seekToTime: async (value: number) => { calls.push({ method: "seek", value }); },
  play: async () => { calls.push({ method: "play" }); },
  pause: async () => { calls.push({ method: "pause" }); }
};
window.MusicKit = {
  PlaybackStates: playbackStates,
  configure: () => { calls.push({ method: "configure" }); },
  getInstance: () => music
};

const widget = {
  bind(event: string, listener: (event?: unknown) => void) {
    listeners.set(event, listener);
    if (event === "ready") queueMicrotask(() => listener());
  },
  load(_url: string, options: { callback?: () => void }) { queueMicrotask(() => options.callback?.()); },
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
window.SC = { Widget: Object.assign(() => widget, {
  Events: { READY: "ready", LOAD_PROGRESS: "load", PLAY_PROGRESS: "progress", SEEK: "seek", FINISH: "finish", ERROR: "error" }
}) };

function render() {
  const version = callbackVersion;
  const common = {
    playback,
    syncRevision: 0,
    isDj: true,
    volume: 50,
    onEnded: () => endCallbacks.push(version),
    onStatus: (status: PlayerStatus) => {
      statusCallbacks.push(version);
      statusSamples.push({ ...status, version });
    }
  };
  root.render(provider === "apple"
    ? createElement(AppleMusicPlayer, { ...common, accessToken, mapping: { providerId: "provider-track" } })
    : createElement(SoundCloudPlayer, common));
}

Object.assign(window, {
  providerTest: {
    calls,
    statusCallbacks,
    statusSamples,
    endCallbacks,
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
    render(options: { accessToken?: string; callbackVersion?: number; position?: number }) {
      accessToken = options.accessToken ?? accessToken;
      callbackVersion = options.callbackVersion ?? callbackVersion;
      if (options.position !== undefined) playback = { ...playback, position: options.position, updatedAt: now };
      render();
    },
    unmount() { root.unmount(); }
  }
});
render();
