import { useEffect, useRef, useState } from "react";
import { createPlayerApiLoader } from "../player-api-loader";
import { playbackNeedsSeek, playbackTargetPosition, type CheckpointProviderPlaybackProps } from "../provider-playback";
export type { PlayerStatus } from "../provider-playback";

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement,
        options: {
          videoId?: string;
          playerVars?: Record<string, number>;
          events?: Record<string, (event: { data: number }) => void>;
        }
      ) => YouTubePlayerApi;
      PlayerState: { ENDED: number; BUFFERING: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YouTubePlayerApi {
  loadVideoById(options: { videoId: string; startSeconds: number }): void;
  cueVideoById(options: { videoId: string; startSeconds: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getVideoUrl(): string;
  setVolume(volume: number): void;
  destroy(): void;
}

const loadApi = createPlayerApiLoader({
  src: "https://www.youtube.com/iframe_api",
  label: "the YouTube player",
  readApi: () => window.YT?.Player ? window.YT : undefined,
  readyCallback: "onYouTubeIframeAPIReady"
});

function loadedVideoId(player: YouTubePlayerApi) {
  // getVideoUrl() describes the loaded video, while loadVideoById() is only a
  // request. The old video's events can still arrive during that transition.
  try {
    const url = new URL(player.getVideoUrl());
    return url.searchParams.get("v") || (url.hostname === "youtu.be" ? url.pathname.slice(1) : "");
  } catch { return ""; }
}

function trackKey(playback: CheckpointProviderPlaybackProps["playback"]) {
  return playback.track ? `${playback.track.id}:${playback.track.providerId}` : "";
}

export function YouTubePlayer({
  playback,
  syncRevision,
  isDj,
  volume,
  onEnded,
  onStatus,
  onError
}: CheckpointProviderPlaybackProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayerApi | null>(null);
  const requestedTrackKeyRef = useRef("");
  const confirmedTrackKeyRef = useRef("");
  const playedTrackKeyRef = useRef("");
  const endedCheckpointRef = useRef("");
  const playbackRef = useRef(playback);
  const onStatusRef = useRef(onStatus);
  const isDjRef = useRef(isDj);
  const onEndedRef = useRef(onEnded);
  const onErrorRef = useRef(onError);
  const [ready, setReady] = useState(false);
  const [loadedRevision, setLoadedRevision] = useState(0);

  playbackRef.current = playback;
  onStatusRef.current = onStatus;
  isDjRef.current = isDj;
  onEndedRef.current = onEnded;
  onErrorRef.current = onError;

  useEffect(() => {
    let active = true;
    void loadApi().then(() => {
      if (!active || !mountRef.current || !window.YT) return;
      // The SDK replaces its target with an iframe. Keep React's host intact
      // so effect cleanup/replay always has a connected element to mount into.
      const target = document.createElement("div");
      mountRef.current.replaceChildren(target);
      playerRef.current = new window.YT.Player(target, {
        playerVars: { controls: 0, disablekb: 1, modestbranding: 1, playsinline: 1 },
        events: {
          onReady: () => { if (active) setReady(true); },
          onStateChange: (event) => {
            if (!active) return;
            const player = playerRef.current;
            const current = playbackRef.current;
            const key = trackKey(current);
            if (!player || !current.track || key !== requestedTrackKeyRef.current || loadedVideoId(player) !== current.track.providerId) return;
            const state = player.getPlayerState();
            // Do not attribute an old ENDED event to a repeated video requested
            // for a new room track until that request has actually started.
            if (state === window.YT?.PlayerState.ENDED && playedTrackKeyRef.current !== key) return;
            if (state !== window.YT?.PlayerState.ENDED && confirmedTrackKeyRef.current !== key) {
              confirmedTrackKeyRef.current = key;
              setLoadedRevision((revision) => revision + 1);
            }
            if (state === 1) playedTrackKeyRef.current = key;
            if (state === 1 || state === 2 || state === 5) onErrorRef.current?.("");
            const checkpoint = `${key}:${current.position}:${current.updatedAt}`;
            if (event.data === window.YT?.PlayerState.ENDED && state === window.YT?.PlayerState.ENDED &&
              isDjRef.current && current.playing && endedCheckpointRef.current !== checkpoint) {
              endedCheckpointRef.current = checkpoint;
              onEndedRef.current();
            }
            onStatusRef.current({
              ready: true,
              buffering: state === window.YT?.PlayerState.BUFFERING,
              currentTime: player.getCurrentTime() || 0,
              duration: player.getDuration() || 0,
              playing: state === 1,
              trackId: current.track.id
            });
          },
          onError: () => {
            if (!active) return;
            onStatusRef.current({ ready: false, buffering: false, currentTime: 0, duration: 0 });
            onErrorRef.current?.("This YouTube track could not be played. It may be unavailable or blocked from embedding.");
          }
        }
      });
    }).catch((cause) => {
      if (!active) return;
      onStatusRef.current({ ready: false, buffering: false, currentTime: 0, duration: 0 });
      onErrorRef.current?.(cause instanceof Error ? cause.message : "Could not initialize YouTube playback.");
    });
    return () => {
      active = false;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready || !playerRef.current) return;
    const player = playerRef.current;
    if (!playback.track) {
      player.pauseVideo();
      requestedTrackKeyRef.current = "";
      confirmedTrackKeyRef.current = "";
      playedTrackKeyRef.current = "";
      onStatusRef.current({ ready: true, buffering: false, currentTime: 0, duration: 0 });
      return;
    }
    const position = playbackTargetPosition(playback);
    const key = trackKey(playback);
    if (requestedTrackKeyRef.current !== key) {
      requestedTrackKeyRef.current = key;
      confirmedTrackKeyRef.current = "";
      playedTrackKeyRef.current = "";
      endedCheckpointRef.current = "";
      onStatusRef.current({ ready: true, buffering: playback.playing, currentTime: 0, duration: 0 });
      const action = playback.playing ? "loadVideoById" : "cueVideoById";
      player[action]({ videoId: playback.track.providerId, startSeconds: position });
    } else {
      // A room checkpoint may change before the requested video finishes
      // loading. Apply its latest intent after the SDK confirms that video.
      if (confirmedTrackKeyRef.current !== key || loadedVideoId(player) !== playback.track.providerId) return;
      player.seekTo(position, true);
      playback.playing ? player.playVideo() : player.pauseVideo();
    }
  }, [ready, loadedRevision, playback.track?.id, playback.track?.providerId, playback.playing, playback.position, playback.updatedAt, syncRevision]);

  useEffect(() => {
    if (!ready || !playerRef.current) return;
    playerRef.current.setVolume(volume);
  }, [ready, volume]);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      const current = playbackRef.current;
      const key = trackKey(current);
      if (!player || !current.track || key !== requestedTrackKeyRef.current || key !== confirmedTrackKeyRef.current || loadedVideoId(player) !== current.track.providerId) return;
      const state = player.getPlayerState();
      if (state === window.YT?.PlayerState.ENDED && playedTrackKeyRef.current !== key) return;
      if (state === 1) playedTrackKeyRef.current = key;
      const currentTime = player.getCurrentTime();
      onStatusRef.current({
        ready: true,
        buffering: state === window.YT?.PlayerState.BUFFERING,
        currentTime,
        duration: player.getDuration() || 0,
        playing: state === 1,
        trackId: current.track.id
      });
      if (current.playing && state !== window.YT?.PlayerState.ENDED) {
        const expected = playbackTargetPosition(current);
        if (playbackNeedsSeek(currentTime, expected, "health")) player.seekTo(expected, true);
      }
    }, 750);
    return () => window.clearInterval(timer);
  }, [ready]);

  return <div className="youtube-shell"><div ref={mountRef} /></div>;
}
