import { createRoot } from "react-dom/client";
import { YouTubePlayer, type PlayerStatus } from "../../src/components/YouTubePlayer";
import type { Playback } from "../../src/types";

type Call = { method: string; videoId?: string; position?: number };
const calls: Call[] = [];
const statuses: (PlayerStatus & { version: number })[] = [];
const ends: { version: number; trackId: string }[] = [];
const errors: string[] = [];
const root = createRoot(document.getElementById("root")!);
let instance: FakeYouTubePlayer;
let callbackVersion = 0;
let playback: Playback = {
  track: { id: "track-a", provider: "youtube", providerId: "aaaaaaaaaaa", title: "First recording", durationMs: 180_000,
    addedBy: { id: "dj", name: "DJ", avatarSeed: "dj" }, addedAt: 100_000 },
  playing: true, position: 10, updatedAt: 100_000
};
Date.now = () => 100_000;

class FakeYouTubePlayer {
  videoId = "";
  requestedVideoId = "";
  state = -1;
  position = 0;
  duration = 180;
  constructor(element: HTMLElement, private options: { events?: Record<string, (event: { data: number }) => void> }) {
    instance = this;
    element.replaceWith(document.createElement("iframe"));
    calls.push({ method: "create" });
    queueMicrotask(() => this.options.events?.onReady?.({ data: 0 }));
  }
  loadVideoById({ videoId, startSeconds }: { videoId: string; startSeconds: number }) {
    this.requestedVideoId = videoId;
    calls.push({ method: "load", videoId, position: startSeconds });
    // Keep the old video visible until the test explicitly completes loading.
  }
  cueVideoById({ videoId, startSeconds }: { videoId: string; startSeconds: number }) {
    this.requestedVideoId = videoId;
    calls.push({ method: "cue", videoId, position: startSeconds });
  }
  playVideo() { calls.push({ method: "play", videoId: this.videoId }); this.state = 1; }
  pauseVideo() { calls.push({ method: "pause", videoId: this.videoId }); this.state = 2; }
  seekTo(position: number) { calls.push({ method: "seek", videoId: this.videoId, position }); this.position = position; }
  setVolume() {}
  getVideoUrl() { return this.videoId ? `https://www.youtube.com/watch?v=${this.videoId}` : ""; }
  getCurrentTime() { return this.position; }
  getDuration() { return this.duration; }
  getPlayerState() { return this.state; }
  destroy() { calls.push({ method: "destroy" }); }
  emit(state: number) { this.options.events?.onStateChange?.({ data: state }); }
}
window.YT = { Player: FakeYouTubePlayer, PlayerState: { ENDED: 0, BUFFERING: 3 } };

function render() {
  const version = callbackVersion;
  const trackId = playback.track!.id;
  root.render(<YouTubePlayer playback={playback} syncRevision={0} isDj volume={50}
    onStatus={(status) => statuses.push({ ...status, version })}
    onEnded={() => ends.push({ version, trackId })} onError={(error) => errors.push(error)} />);
}

export interface YouTubeHarness {
  inspect(): { calls: Call[]; statuses: (PlayerStatus & { version: number })[]; ends: { version: number; trackId: string }[]; errors: string[] };
  clearCalls(): void;
  updatePlayback(options: { trackId?: string; videoId?: string; playing?: boolean; position?: number; callbackVersion?: number }): void;
  completeLoad(state?: number, position?: number): void;
  emitState(state: number, position?: number): void;
  emitStaleEvent(state: number): void;
  unmount(): void;
}
declare global { interface Window { youtubeTest: YouTubeHarness } }
window.youtubeTest = {
  inspect: () => ({ calls: [...calls], statuses: [...statuses], ends: [...ends], errors: [...errors] }),
  clearCalls: () => { calls.length = 0; },
  updatePlayback(options) {
    playback = { ...playback, playing: options.playing ?? playback.playing, position: options.position ?? playback.position,
      track: { ...playback.track!, id: options.trackId ?? playback.track!.id, providerId: options.videoId ?? playback.track!.providerId } };
    callbackVersion = options.callbackVersion ?? callbackVersion;
    render();
  },
  completeLoad(state = 1, position = 10) {
    instance.videoId = instance.requestedVideoId;
    instance.state = state;
    instance.position = position;
    instance.emit(state);
  },
  emitState(state, position) {
    instance.state = state;
    instance.position = position ?? instance.position;
    instance.emit(state);
  },
  emitStaleEvent: (state) => instance.emit(state),
  unmount: () => root.unmount()
};
render();
