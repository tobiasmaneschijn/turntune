import { useEffect, useRef, useState } from "react";
import type { Playback } from "../types";
import type { PlayerStatus } from "./YouTubePlayer";
import { createPlayerApiLoader } from "../player-api-loader";

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
}

interface SoundCloudWidgetOptions {
  auto_play: boolean;
  visual: boolean;
  color: string;
  single_active: boolean;
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
    SEEK: string;
    FINISH: string;
    ERROR: string;
  };
}

declare global {
  interface Window {
    SC?: { Widget: SoundCloudWidgetFactory };
  }
}

const loadApi = createPlayerApiLoader({
  src: "https://w.soundcloud.com/player/api.js",
  label: "the SoundCloud player",
  readApi: () => window.SC?.Widget
});

function targetPosition(playback: Playback) {
  return playback.position + (playback.playing ? (Date.now() - playback.updatedAt) / 1000 : 0);
}

const widgetOptions = (callback?: () => void): SoundCloudWidgetOptions => {
  const options: SoundCloudWidgetOptions = {
    auto_play: false,
    visual: true,
    color: "d8ff57",
    // React can briefly overlap widget lifecycles during navigation. Do not let
    // SoundCloud's global single-player coordination pause the active iframe.
    single_active: false,
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
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const widgetRef = useRef<SoundCloudWidgetApi | null>(null);
  const aliveRef = useRef(false);
  const loadingTrackRef = useRef(false);
  const loadedTrackIdRef = useRef<string | null>(null);
  const initialTrackIdRef = useRef(playback.track?.id || null);
  const initialUrlRef = useRef(widgetUrl(playback.track?.permalinkUrl || "https://soundcloud.com"));
  const commandRevisionRef = useRef(0);
  const pendingSeekRef = useRef<{ trackId: string; revision: number } | null>(null);
  const playbackRef = useRef(playback);
  const isDjRef = useRef(isDj);
  const onEndedRef = useRef(onEnded);
  const onStatusRef = useRef(onStatus);
  const onErrorRef = useRef(onError);
  const [ready, setReady] = useState(false);
  const [loadedRevision, setLoadedRevision] = useState(0);

  playbackRef.current = playback;
  isDjRef.current = isDj;
  onEndedRef.current = onEnded;
  onStatusRef.current = onStatus;
  onErrorRef.current = onError;

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
        if (!active || loadingTrackRef.current || loadedTrackIdRef.current !== playbackRef.current.track?.id) return;
        onStatusRef.current({
          ready: true,
          buffering: (progress?.loadProgress || 0) < (progress?.relativePosition || 0),
          currentTime: (progress?.currentPosition || 0) / 1000,
          duration: 0
        });
      });
      widget.bind(events.PLAY_PROGRESS, (progress) => {
        if (!active || loadingTrackRef.current || loadedTrackIdRef.current !== playbackRef.current.track?.id) return;
        const trackId = loadedTrackIdRef.current;
        widget.getDuration((duration) => {
          if (!active || loadingTrackRef.current || trackId !== loadedTrackIdRef.current || trackId !== playbackRef.current.track?.id) return;
          onStatusRef.current({
            ready: true,
            buffering: false,
            currentTime: (progress?.currentPosition || 0) / 1000,
            duration: duration / 1000
          });
        });
      });
      widget.bind(events.SEEK, () => {
        const pending = pendingSeekRef.current;
        const current = playbackRef.current;
        if (
          !active ||
          !pending ||
          pending.revision !== commandRevisionRef.current ||
          pending.trackId !== current.track?.id ||
          pending.trackId !== loadedTrackIdRef.current
        ) return;
        pendingSeekRef.current = null;
        current.playing ? widget.play() : widget.pause();
      });
      widget.bind(events.FINISH, () => {
        if (
          active &&
          !loadingTrackRef.current &&
          isDjRef.current &&
          playbackRef.current.playing &&
          loadedTrackIdRef.current === playbackRef.current.track?.id
        ) {
          onEndedRef.current();
        }
      });
      widget.bind(events.ERROR, () => {
        if (!active) return;
        loadingTrackRef.current = false;
        loadedTrackIdRef.current = null;
        pendingSeekRef.current = null;
        commandRevisionRef.current += 1;
        onStatusRef.current({ ready: false, buffering: false, currentTime: 0, duration: 0 });
        onErrorRef.current?.("This SoundCloud track could not be played. It may be unavailable in your region.");
      });
    }).catch((cause) => {
      if (!active) return;
      onStatusRef.current({ ready: false, buffering: false, currentTime: 0, duration: 0 });
      onErrorRef.current?.(cause instanceof Error ? cause.message : "Could not initialize SoundCloud playback.");
    });

    return () => {
      active = false;
      aliveRef.current = false;
      loadingTrackRef.current = false;
      loadedTrackIdRef.current = null;
      pendingSeekRef.current = null;
      commandRevisionRef.current += 1;
      // Do not call widget.unbind() here. React has already detached the iframe
      // by the time passive cleanup runs, and the SoundCloud SDK then tries to
      // postMessage() through a null contentWindow.
      widgetRef.current = null;
    };
  }, []);

  useEffect(() => {
    const widget = widgetRef.current;
    const track = playback.track;
    if (!ready || !widget) return;
    if (!track?.permalinkUrl) {
      widget.pause();
      loadingTrackRef.current = false;
      loadedTrackIdRef.current = null;
      pendingSeekRef.current = null;
      commandRevisionRef.current += 1;
      return;
    }
    if (loadingTrackRef.current) return;
    if (loadedTrackIdRef.current !== track.id) {
      loadingTrackRef.current = true;
      pendingSeekRef.current = null;
      const loadRevision = ++commandRevisionRef.current;
      onStatusRef.current({ ready: true, buffering: true, currentTime: 0, duration: 0 });
      widget.load(track.permalinkUrl, widgetOptions(() => {
        if (!aliveRef.current || commandRevisionRef.current !== loadRevision) return;
        loadedTrackIdRef.current = track.id;
        loadingTrackRef.current = false;
        setLoadedRevision((revision) => revision + 1);
      }));
      return;
    }
    const revision = ++commandRevisionRef.current;
    widget.getPosition((currentPositionMs) => {
      if (
        !aliveRef.current ||
        loadingTrackRef.current ||
        revision !== commandRevisionRef.current ||
        playbackRef.current.track?.id !== track.id ||
        loadedTrackIdRef.current !== track.id
      ) return;

      // The iframe may answer late after browser throttling. Calculate the
      // room target when sending the command, not when requesting its position.
      const current = playbackRef.current;
      const position = targetPosition(current);
      const currentPosition = currentPositionMs / 1000;
      if (Math.abs(currentPosition - position) > 2.5) {
        // Widget commands cross the iframe through asynchronous postMessage.
        // Wait for SEEK before playing so a late seek cannot pause a track that
        // already started. Near the beginning, skip the unnecessary seek.
        pendingSeekRef.current = { trackId: track.id, revision };
        if (!current.playing) widget.pause();
        widget.seekTo(position * 1000);
        return;
      }

      pendingSeekRef.current = null;
      current.playing ? widget.play() : widget.pause();
    });
  }, [ready, loadedRevision, playback.track?.id, playback.track?.permalinkUrl, playback.playing, playback.position, playback.updatedAt, syncRevision]);

  useEffect(() => {
    if (ready && !loadingTrackRef.current) widgetRef.current?.setVolume(volume);
  }, [ready, loadedRevision, volume]);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setInterval(() => {
      const widget = widgetRef.current;
      const current = playbackRef.current;
      if (!widget || !current.track || loadingTrackRef.current || loadedTrackIdRef.current !== current.track.id) return;
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
      });
    }, 750);
    return () => window.clearInterval(timer);
  }, [ready]);

  return (
    <div className="soundcloud-shell">
      <iframe
        ref={iframeRef}
        src={initialUrlRef.current}
        title={`SoundCloud player for ${playback.track?.title || "current track"}`}
        allow="autoplay"
        scrolling="no"
      />
    </div>
  );
}
