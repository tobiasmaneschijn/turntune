import { useEffect, useRef, useState } from "react";
import type { Playback } from "../types";

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
      PlayerState: { ENDED: number };
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
  destroy(): void;
}

let apiPromise: Promise<void> | null = null;

function loadApi() {
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
  });
  return apiPromise;
}

function targetPosition(playback: Playback) {
  return playback.position + (playback.playing ? (Date.now() - playback.updatedAt) / 1000 : 0);
}

export function YouTubePlayer({
  playback,
  isDj,
  onEnded
}: {
  playback: Playback;
  isDj: boolean;
  onEnded: () => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayerApi | null>(null);
  const trackIdRef = useRef<string | null>(null);
  const playbackRef = useRef(playback);
  const [ready, setReady] = useState(false);

  playbackRef.current = playback;

  useEffect(() => {
    let active = true;
    void loadApi().then(() => {
      if (!active || !mountRef.current || !window.YT) return;
      playerRef.current = new window.YT.Player(mountRef.current, {
        playerVars: { controls: 0, disablekb: 1, modestbranding: 1, playsinline: 1 },
        events: {
          onReady: () => setReady(true),
          onStateChange: (event) => {
            if (event.data === window.YT?.PlayerState.ENDED && isDj) onEnded();
          }
        }
      });
    });
    return () => {
      active = false;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready || !playerRef.current || !playback.track) return;
    const player = playerRef.current;
    const position = targetPosition(playback);
    if (trackIdRef.current !== playback.track.id) {
      trackIdRef.current = playback.track.id;
      const action = playback.playing ? "loadVideoById" : "cueVideoById";
      player[action]({ videoId: playback.track.providerId, startSeconds: position });
    } else {
      player.seekTo(position, true);
      playback.playing ? player.playVideo() : player.pauseVideo();
    }
  }, [ready, playback.track?.id, playback.playing, playback.position, playback.updatedAt]);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      const current = playbackRef.current;
      if (!player || !current.playing || !current.track) return;
      const expected = targetPosition(current);
      if (Math.abs(player.getCurrentTime() - expected) > 2.5) player.seekTo(expected, true);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [ready]);

  return <div className="youtube-shell"><div ref={mountRef} /></div>;
}
