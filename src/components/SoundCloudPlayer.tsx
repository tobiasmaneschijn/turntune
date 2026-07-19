import { useEffect, useRef, useState } from "react";
import type { Playback } from "../types";
import type { PlayerStatus } from "./YouTubePlayer";

interface SoundCloudProgress {
  currentPosition?: number;
  loadProgress?: number;
  relativePosition?: number;
}

interface SoundCloudWidgetApi {
  bind(eventName: string, listener: (event?: SoundCloudProgress) => void): void;
  load(url: string, options: SoundCloudWidgetOptions): void;
  play(): void;
  pause(): void;
  seekTo(milliseconds: number): void;
  setVolume(volume: number): void;
  getDuration(callback: (milliseconds: number) => void): void;
  getPosition(callback: (milliseconds: number) => void): void;
  isPaused(callback: (paused: boolean) => void): void;
}

interface SoundCloudWidgetOptions {
  auto_play: boolean;
  visual: boolean;
  color: string;
  sharing: boolean;
  download: boolean;
  buying: boolean;
  show_comments: boolean;
  callback?: () => void;
}

interface SoundCloudWidgetFactory {
  (iframe: HTMLIFrameElement): SoundCloudWidgetApi;
  Events: {
    READY: string;
    LOAD_PROGRESS: string;
    PLAY_PROGRESS: string;
    FINISH: string;
    ERROR: string;
  };
}

declare global {
  interface Window {
    SC?: { Widget: SoundCloudWidgetFactory };
  }
}

let apiPromise: Promise<void> | null = null;

function loadApi() {
  if (window.SC?.Widget) return Promise.resolve();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://w.soundcloud.com/player/api.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load the SoundCloud player."));
    document.head.appendChild(script);
  });
  return apiPromise;
}

function targetPosition(playback: Playback) {
  return playback.position + (playback.playing ? (Date.now() - playback.updatedAt) / 1000 : 0);
}

const widgetOptions = (callback?: () => void): SoundCloudWidgetOptions => {
  const options: SoundCloudWidgetOptions = {
    auto_play: false,
    visual: true,
    color: "d8ff57",
    sharing: false,
    download: false,
    buying: false,
    show_comments: false
  };
  if (callback) options.callback = callback;
  return options;
};

function widgetUrl(permalinkUrl: string) {
  const params = new URLSearchParams({
    url: permalinkUrl,
    ...Object.fromEntries(
      Object.entries(widgetOptions()).map(([key, value]) => [key, String(value)])
    )
  });
  return `https://w.soundcloud.com/player/?${params}`;
}

export function SoundCloudPlayer({
  playback,
  isDj,
  volume,
  onEnded,
  onStatus
}: {
  playback: Playback;
  isDj: boolean;
  volume: number;
  onEnded: () => void;
  onStatus: (status: PlayerStatus) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const widgetRef = useRef<SoundCloudWidgetApi | null>(null);
  const aliveRef = useRef(false);
  const loadingTrackRef = useRef(false);
  const loadedTrackIdRef = useRef<string | null>(null);
  const initialTrackIdRef = useRef(playback.track?.id || null);
  const playbackRef = useRef(playback);
  const isDjRef = useRef(isDj);
  const onEndedRef = useRef(onEnded);
  const onStatusRef = useRef(onStatus);
  const [ready, setReady] = useState(false);

  playbackRef.current = playback;
  isDjRef.current = isDj;
  onEndedRef.current = onEnded;
  onStatusRef.current = onStatus;

  useEffect(() => {
    let active = true;
    aliveRef.current = true;
    void loadApi().then(() => {
      if (!active || !iframeRef.current || !window.SC) return;
      const widget = window.SC.Widget(iframeRef.current);
      widgetRef.current = widget;
      const events = window.SC.Widget.Events;
      widget.bind(events.READY, () => {
        // READY has no track identifier and can also fire during widget.load().
        // Only use it for the iframe's initial URL; load callbacks own every
        // subsequent transition and cannot confuse an old READY for a new one.
        if (!active || loadingTrackRef.current || loadedTrackIdRef.current) return;
        loadedTrackIdRef.current = initialTrackIdRef.current;
        setReady(true);
      });
      widget.bind(events.LOAD_PROGRESS, (progress) => {
        if (!active || loadingTrackRef.current) return;
        onStatusRef.current({
          ready: true,
          buffering: (progress?.loadProgress || 0) < (progress?.relativePosition || 0),
          currentTime: (progress?.currentPosition || 0) / 1000,
          duration: 0
        });
      });
      widget.bind(events.PLAY_PROGRESS, (progress) => {
        if (!active || loadingTrackRef.current) return;
        widget.getDuration((duration) => {
          if (!active || loadingTrackRef.current) return;
          onStatusRef.current({
            ready: true,
            buffering: false,
            currentTime: (progress?.currentPosition || 0) / 1000,
            duration: duration / 1000
          });
        });
      });
      widget.bind(events.FINISH, () => {
        if (
          active &&
          !loadingTrackRef.current &&
          isDjRef.current &&
          loadedTrackIdRef.current === playbackRef.current.track?.id
        ) {
          onEndedRef.current();
        }
      });
      widget.bind(events.ERROR, () => {
        if (!active) return;
        onStatusRef.current({ ready: false, buffering: false, currentTime: 0, duration: 0 });
      });
    }).catch(() => {
      if (active) onStatusRef.current({ ready: false, buffering: false, currentTime: 0, duration: 0 });
    });

    return () => {
      active = false;
      aliveRef.current = false;
      loadingTrackRef.current = false;
      loadedTrackIdRef.current = null;
      // Do not call widget.unbind() here. React has already detached the iframe
      // by the time passive cleanup runs, and the SoundCloud SDK then tries to
      // postMessage() through a null contentWindow.
      widgetRef.current = null;
    };
  }, []);

  useEffect(() => {
    const widget = widgetRef.current;
    const track = playback.track;
    if (!ready || !widget || !track?.permalinkUrl) return;
    if (loadedTrackIdRef.current !== track.id) {
      loadingTrackRef.current = true;
      setReady(false);
      widget.load(track.permalinkUrl, widgetOptions(() => {
        if (!aliveRef.current) return;
        loadedTrackIdRef.current = track.id;
        loadingTrackRef.current = false;
        setReady(true);
      }));
      return;
    }
    if (loadingTrackRef.current) return;
    widget.seekTo(targetPosition(playback) * 1000);
    playback.playing ? widget.play() : widget.pause();
  }, [ready, playback.track?.id, playback.track?.permalinkUrl, playback.playing, playback.position, playback.updatedAt]);

  useEffect(() => {
    if (ready && !loadingTrackRef.current) widgetRef.current?.setVolume(volume);
  }, [ready, volume]);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setInterval(() => {
      const widget = widgetRef.current;
      const current = playbackRef.current;
      if (!widget || !current.track || loadingTrackRef.current) return;
      const trackId = current.track.id;
      widget.getPosition((positionMs) => {
        if (!aliveRef.current || loadingTrackRef.current || playbackRef.current.track?.id !== trackId) return;
        const currentTime = positionMs / 1000;
        widget.getDuration((durationMs) => {
          if (!aliveRef.current || loadingTrackRef.current || playbackRef.current.track?.id !== trackId) return;
          onStatusRef.current({
            ready: true,
            buffering: false,
            currentTime,
            duration: durationMs / 1000
          });
        });
        if (current.playing && Math.abs(currentTime - targetPosition(current)) > 2.5) {
          widget.seekTo(targetPosition(current) * 1000);
        }
      });
      widget.isPaused((paused) => {
        if (!aliveRef.current || loadingTrackRef.current || playbackRef.current.track?.id !== trackId) return;
        if (current.playing && paused) widget.play();
        if (!current.playing && !paused) widget.pause();
      });
    }, 750);
    return () => window.clearInterval(timer);
  }, [ready]);

  const permalinkUrl = playback.track?.permalinkUrl || "https://soundcloud.com";
  return (
    <div className="soundcloud-shell">
      <iframe
        ref={iframeRef}
        src={widgetUrl(permalinkUrl)}
        title={`SoundCloud player for ${playback.track?.title || "current track"}`}
        allow="autoplay"
        scrolling="no"
      />
    </div>
  );
}
