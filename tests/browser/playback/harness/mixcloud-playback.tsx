import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { MixcloudPlayer } from "../../../../src/features/playback/providers/MixcloudPlayer";
import type { Playback } from "../../../../src/types";
import type { PlayerStatus } from "../../../../src/features/playback/provider-playback";

type Listener = (...values: number[]) => void;
type WidgetState = { position: number; duration: number; paused: boolean };
const calls: Array<{ widget: number; method: string; value?: number }> = [];
const samples: Array<PlayerStatus & { version: number }> = [];
const errors: string[] = [];
const ends: number[] = [];
const widgets: Array<{ state: WidgetState; events: Record<string, Set<Listener>>; past: Record<string, Listener[]>; resolveReady(): void }> = [];
const pendingPositions: Array<{ widget: number; resolve(value: number): void }> = [];
const pendingSeeks: Array<{ widget: number; value: number; resolve(allowed: boolean): void }> = [];
const pendingPlays: Array<{ widget: number; resolve(): void }> = [];
const deferReady = new URLSearchParams(location.search).has("defer-ready");
let denySeek = false;
let deferSeek = false;
let deferPosition = false;
let deferPlay = false;
let blockPlay = false;
let now = 100_000;
let syncRevision = 0;
let version = 0;
let isDj = true;
Date.now = () => now;
const root = createRoot(document.getElementById("root")!);
let playback: Playback = {
  track: { id: "room-track", provider: "mixcloud", providerId: "/test/show/", title: "Recorded show", durationMs: 180_000,
    permalinkUrl: "https://www.mixcloud.com/test/show/", addedBy: { id: "dj", name: "DJ", avatarSeed: "dj" }, addedAt: now },
  playing: true, position: 10, updatedAt: now
};

window.Mixcloud = {
  PlayerWidget() {
    const widget = widgets.length;
    const state: WidgetState = { position: 0, duration: 180, paused: true };
    const events: Record<string, Set<Listener>> = {};
    const past: Record<string, Listener[]> = {};
    let resolveReady = () => {};
    const ready = new Promise<void>(resolve => { resolveReady = resolve; });
    widgets.push({ state, events, past, resolveReady });
    if (!deferReady) resolveReady();
    const eventApi = Object.fromEntries(["progress", "buffering", "play", "pause", "ended", "error"].map(name => {
      events[name] = new Set(); past[name] = [];
      return [name, { on(listener: Listener) { events[name].add(listener); past[name].push(listener); }, off(listener: Listener) { events[name].delete(listener); } }];
    }));
    return {
      ready,
      events: eventApi as ReturnType<NonNullable<Window["Mixcloud"]>["PlayerWidget"]>["events"],
      play() {
        calls.push({ widget, method: "play" });
        return new Promise<void>(resolve => {
          const finish = () => {
            if (!blockPlay) { state.paused = false; for (const listener of events.play) listener(); }
            resolve();
          };
          if (deferPlay) pendingPlays.push({ widget, resolve: finish });
          else finish();
        });
      },
      pause() { calls.push({ widget, method: "pause" }); state.paused = true; return Promise.resolve(); },
      seek(value: number) {
        calls.push({ widget, method: "seek", value });
        return new Promise<boolean>(resolve => {
          const finish = (allowed: boolean) => { if (allowed) state.position = value; resolve(allowed); };
          if (deferSeek) pendingSeeks.push({ widget, value, resolve: finish });
          else finish(!denySeek);
        });
      },
      getPosition() {
        if (deferPosition) { deferPosition = false; return new Promise<number>(resolve => pendingPositions.push({ widget, resolve })); }
        return Promise.resolve(state.position);
      },
      getDuration: () => Promise.resolve(state.duration),
      getIsPaused: () => Promise.resolve(state.paused)
    };
  }
};

function render() {
  const callbackVersion = version;
  root.render(createElement(MixcloudPlayer, {
    playback, syncRevision, isDj, volume: 50,
    onEnded: () => ends.push(callbackVersion),
    onStatus: status => samples.push({ ...status, version: callbackVersion }),
    onError: message => { errors.push(message); document.getElementById("error")!.textContent = message; }
  }));
}

Object.assign(window, { mixcloudTest: {
  calls, samples, errors, ends,
  get widgetCount() { return widgets.length; },
  get pendingPositions() { return pendingPositions.length; },
  get pendingSeeks() { return pendingSeeks.length; },
  get pendingPlays() { return pendingPlays.length; },
  listenerCount(index: number) { return Object.values(widgets[index].events).reduce((count, listeners) => count + listeners.size, 0); },
  resolveReady(index: number) { widgets[index].resolveReady(); },
  setNow(value: number) { now = value; },
  setState(index: number, state: Partial<WidgetState>) { Object.assign(widgets[index].state, state); },
  setDenySeek(value: boolean) { denySeek = value; },
  setDeferSeek(value: boolean) { deferSeek = value; },
  setDeferPosition() { deferPosition = true; },
  setDeferPlay(value: boolean) { deferPlay = value; },
  setBlockPlay(value: boolean) { blockPlay = value; },
  resolvePosition(value: number) { pendingPositions.shift()?.resolve(value); },
  resolveSeek(allowed = true) { pendingSeeks.shift()?.resolve(allowed); },
  resolvePlay() { pendingPlays.shift()?.resolve(); },
  emit(index: number, event: string, stale = false) {
    const listeners = stale ? widgets[index].past[event] : [...widgets[index].events[event]];
    for (const listener of listeners || []) listener();
  },
  render(options: { trackId?: string; position?: number; playing?: boolean; syncRevision?: number; isDj?: boolean; version?: number }) {
    isDj = options.isDj ?? isDj; version = options.version ?? version; syncRevision = options.syncRevision ?? syncRevision;
    if (options.position !== undefined || options.playing !== undefined) playback = { ...playback, position: options.position ?? playback.position,
      playing: options.playing ?? playback.playing, updatedAt: now };
    if (options.trackId && playback.track) playback = { ...playback, track: { ...playback.track, id: options.trackId,
      providerId: `/test/${options.trackId}/`, permalinkUrl: `https://www.mixcloud.com/test/${options.trackId}/` }, updatedAt: now };
    render();
  },
  unmount() { root.unmount(); }
} });
render();
