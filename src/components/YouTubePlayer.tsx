import { useEffect, useRef, useState } from "react";
import type { Playback } from "../types";
import { createPlayerApiLoader } from "../player-api-loader";

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
  setVolume(volume: number): void;
  destroy(): void;
}

export interface PlayerStatus {
  ready: boolean;
  buffering: boolean;
  currentTime: number;
  duration: number;
}

const loadApi = createPlayerApiLoader({
  src: "https://www.youtube.com/iframe_api",
  label: "the YouTube player",
  readApi: () => window.YT?.Player ? window.YT : undefined,
  readyCallback: "onYouTubeIframeAPIReady"
});

function targetPosition(playback: Playback) {
  return playback.position + (playback.playing ? (Date.now() - playback.updatedAt) / 1000 : 0);
}

export function YouTubePlayer({
  playback,
  syncRevision,
  isDj,
  volume,
  onEnded,
  onStatus,
  onError
}: {
  playback: Playback;
  syncRevision: number;
  isDj: boolean;
  volume: number;
  onEnded: () => void;
  onStatus: (status: PlayerStatus) => void;
  onError?: (message: string) => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayerApi | null>(null);
  const trackIdRef = useRef<string | null>(null);
  const playbackRef = useRef(playback);
  const onStatusRef = useRef(onStatus);
  const isDjRef = useRef(isDj);
  const onEndedRef = useRef(onEnded);
  const onErrorRef = useRef(onError);
  const [ready, setReady] = useState(false);

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
            const current = playbackRef.current;
            if (event.data === window.YT?.PlayerState.ENDED && isDjRef.current && current.playing &&
              current.track?.id === trackIdRef.current) {
              onEndedRef.current();
            }
            onStatusRef.current({
              ready: true,
              buffering: event.data === window.YT?.PlayerState.BUFFERING,
              currentTime: playerRef.current?.getCurrentTime() || 0,
              duration: playerRef.current?.getDuration() || 0
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
      trackIdRef.current = null;
      onStatusRef.current({ ready: true, buffering: false, currentTime: 0, duration: 0 });
      return;
    }
    const position = targetPosition(playback);
    if (trackIdRef.current !== playback.track.id) {
      trackIdRef.current = playback.track.id;
      const action = playback.playing ? "loadVideoById" : "cueVideoById";
      player[action]({ videoId: playback.track.providerId, startSeconds: position });
    } else {
      player.seekTo(position, true);
      playback.playing ? player.playVideo() : player.pauseVideo();
    }
  }, [ready, playback.track?.id, playback.playing, playback.position, playback.updatedAt, syncRevision]);

  useEffect(() => {
    if (!ready || !playerRef.current) return;
    playerRef.current.setVolume(volume);
  }, [ready, volume]);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      const current = playbackRef.current;
      if (!player || !current.track) return;
      const currentTime = player.getCurrentTime();
      onStatusRef.current({
        ready: true,
        buffering: player.getPlayerState() === window.YT?.PlayerState.BUFFERING,
        currentTime,
        duration: player.getDuration() || 0
      });
      if (current.playing) {
        const expected = targetPosition(current);
        if (Math.abs(currentTime - expected) > 2.5) player.seekTo(expected, true);
      }
    }, 750);
    return () => window.clearInterval(timer);
  }, [ready]);

  return <div className="youtube-shell"><div ref={mountRef} /></div>;
}
