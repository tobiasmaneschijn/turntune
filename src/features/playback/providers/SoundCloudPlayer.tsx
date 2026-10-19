import { useTranslation } from "react-i18next";
import i18n from "../../../i18n";
import { useEffect, useRef, useState } from "react";
import { createPlayerApiLoader } from "./player-api-loader";
import { playbackNeedsSeek, playbackTargetPosition, type CheckpointProviderPlaybackProps } from "../provider-playback";

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
  label: () => i18n.t("music:soundcloud.sdkLabel"),
  readApi: () => window.SC?.Widget
});
const WIDGET_DEADLINE_MS = 15_000;

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
}: CheckpointProviderPlaybackProps) {
  const { t } = useTranslation("music");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const widgetRef = useRef<SoundCloudWidgetApi | null>(null);
  const aliveRef = useRef(false);
  const loadingTrackRef = useRef(false);
  const loadedTrackIdRef = useRef<string | null>(null);
  const loadingTrackIdRef = useRef(playback.track?.id || null);
  const failedInitializationRef = useRef(false);
  const deadlineRef = useRef<number | null>(null);
  const commandRevisionRef = useRef(0);
  const pendingSeekRef = useRef<{ trackId: string; revision: number } | null>(null);
  const playbackRef = useRef(playback);
  const isDjRef = useRef(isDj);
  const onEndedRef = useRef(onEnded);
  const onStatusRef = useRef(onStatus);
  const onErrorRef = useRef(onError);
  const [ready, setReady] = useState(false);
  const [loadedRevision, setLoadedRevision] = useState(0);
  const [widgetAttempt, setWidgetAttempt] = useState(() => ({
    revision: 0, trackId: playback.track?.id || null,
    url: widgetUrl(playback.track?.permalinkUrl || "https://soundcloud.com")
  }));
  const cancelDeadline = () => {
    if (deadlineRef.current !== null) window.clearTimeout(deadlineRef.current);
    deadlineRef.current = null;
  };

  playbackRef.current = playback;
  isDjRef.current = isDj;
  onEndedRef.current = onEnded;
  onStatusRef.current = onStatus;
  onErrorRef.current = onError;

  useEffect(() => {
    let active = true;
    let initialized = false;
    aliveRef.current = true;
    failedInitializationRef.current = false;
    loadingTrackIdRef.current = widgetAttempt.trackId;
    setReady(false);
    void loadApi().then(() => {
      if (!active || !iframeRef.current || !window.SC) return;
      const widget = window.SC.Widget(iframeRef.current);
      widgetRef.current = widget;
      const events = window.SC.Widget.Events;
      deadlineRef.current = window.setTimeout(() => {
        if (!active || initialized || widgetRef.current !== widget) return;
        deadlineRef.current = null;
        failedInitializationRef.current = true;
        commandRevisionRef.current += 1;
        onStatusRef.current({ ready: false, buffering: false, currentTime: 0, duration: 0 });
        onErrorRef.current?.(i18n.t("music:soundcloud.readyTimeout"));
      }, WIDGET_DEADLINE_MS);
      widget.bind(events.READY, () => {
        // READY has no track identifier and can also fire during widget.load().
        // Only use it for the iframe's initial URL; load callbacks own every
        // subsequent transition and cannot confuse an old READY for a new one.
        if (!active || failedInitializationRef.current || loadingTrackRef.current || loadedTrackIdRef.current) return;
        cancelDeadline();
        initialized = true;
        loadedTrackIdRef.current = widgetAttempt.trackId;
        setReady(true);
      });
      widget.bind(events.LOAD_PROGRESS, (progress) => {
        if (!active || loadingTrackRef.current || loadedTrackIdRef.current !== playbackRef.current.track?.id) return;
        const trackId = loadedTrackIdRef.current;
        const revision = commandRevisionRef.current;
        widget.isPaused((paused) => {
          if (!active || loadingTrackRef.current || revision !== commandRevisionRef.current || trackId !== loadedTrackIdRef.current || trackId !== playbackRef.current.track?.id) return;
          onStatusRef.current({
            ready: true,
            buffering: (progress?.loadProgress || 0) < (progress?.relativePosition || 0),
            currentTime: (progress?.currentPosition || 0) / 1000,
            duration: 0,
            playing: !paused,
            trackId: trackId || undefined
          });
        });
      });
      widget.bind(events.PLAY_PROGRESS, (progress) => {
        if (!active || loadingTrackRef.current || loadedTrackIdRef.current !== playbackRef.current.track?.id) return;
        const trackId = loadedTrackIdRef.current;
        const revision = commandRevisionRef.current;
        widget.getDuration((duration) => {
          if (!active || loadingTrackRef.current || revision !== commandRevisionRef.current || trackId !== loadedTrackIdRef.current || trackId !== playbackRef.current.track?.id) return;
          widget.isPaused((paused) => {
            if (!active || loadingTrackRef.current || revision !== commandRevisionRef.current || trackId !== loadedTrackIdRef.current || trackId !== playbackRef.current.track?.id) return;
            onStatusRef.current({
              ready: true,
              buffering: false,
              currentTime: (progress?.currentPosition || 0) / 1000,
              duration: duration / 1000,
              playing: !paused,
              trackId: trackId || undefined
            });
            if (!paused || !playbackRef.current.playing) onErrorRef.current?.("");
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
        cancelDeadline();
        failedInitializationRef.current = !initialized;
        const newerTrackWaiting = loadingTrackIdRef.current !== playbackRef.current.track?.id;
        loadingTrackRef.current = false;
        loadedTrackIdRef.current = null;
        pendingSeekRef.current = null;
        commandRevisionRef.current += 1;
        onStatusRef.current({ ready: false, buffering: false, currentTime: 0, duration: 0 });
        onErrorRef.current?.(i18n.t("music:soundcloud.unavailable"));
        if (newerTrackWaiting) setLoadedRevision((revision) => revision + 1);
      });
    }).catch((cause) => {
      if (!active) return;
      cancelDeadline();
      failedInitializationRef.current = true;
      onStatusRef.current({ ready: false, buffering: false, currentTime: 0, duration: 0 });
      onErrorRef.current?.(cause instanceof Error ? cause.message : i18n.t("music:soundcloud.initializeFailed"));
    });

    return () => {
      active = false;
      cancelDeadline();
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
  }, [widgetAttempt.revision]);

  useEffect(() => {
    if (!failedInitializationRef.current) return;
    // A fresh iframe is necessary when its initial READY never arrived. The
    // shared SDK loader also retries failed downloads on the next attempt.
    failedInitializationRef.current = false;
    setWidgetAttempt(previous => ({ revision: previous.revision + 1, trackId: playback.track?.id || null,
      url: widgetUrl(playback.track?.permalinkUrl || "https://soundcloud.com") }));
  }, [syncRevision, playback.track?.id, playback.track?.permalinkUrl]);

  useEffect(() => {
    const widget = widgetRef.current;
    const track = playback.track;
    if (!ready || !widget) return;
    if (!track?.permalinkUrl) {
      cancelDeadline();
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
      loadingTrackIdRef.current = track.id;
      pendingSeekRef.current = null;
      const loadRevision = ++commandRevisionRef.current;
      onStatusRef.current({ ready: true, buffering: true, currentTime: 0, duration: 0 });
      cancelDeadline();
      deadlineRef.current = window.setTimeout(() => {
        if (!aliveRef.current || widgetRef.current !== widget || commandRevisionRef.current !== loadRevision) return;
        deadlineRef.current = null;
        loadingTrackRef.current = false;
        loadedTrackIdRef.current = null;
        pendingSeekRef.current = null;
        commandRevisionRef.current += 1;
        try { widget.pause(); } catch { /* The timed-out iframe may already be unreachable. */ }
        onStatusRef.current({ ready: false, buffering: false, currentTime: 0, duration: 0 });
        onErrorRef.current?.(i18n.t("music:soundcloud.trackTimeout"));
        // Do not leave a newer room track behind the abandoned load.
        if (playbackRef.current.track?.id !== track.id) setLoadedRevision(revision => revision + 1);
      }, WIDGET_DEADLINE_MS);
      widget.load(track.permalinkUrl, widgetOptions(() => {
        if (!aliveRef.current || widgetRef.current !== widget || commandRevisionRef.current !== loadRevision) return;
        cancelDeadline();
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
      const position = playbackTargetPosition(current);
      const currentPosition = currentPositionMs / 1000;
      if (playbackNeedsSeek(currentPosition, position, "checkpoint")) {
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
      const revision = commandRevisionRef.current;
      const valid = () => aliveRef.current && !loadingTrackRef.current &&
        revision === commandRevisionRef.current && loadedTrackIdRef.current === trackId && playbackRef.current.track?.id === trackId;
      widget.getPosition((positionMs) => {
        if (!valid()) return;
        const currentTime = positionMs / 1000;
        widget.getDuration((durationMs) => {
          if (!valid()) return;
          // play()/pause() are commands; only the iframe can confirm its state.
          widget.isPaused((paused) => {
            if (!valid()) return;
            onStatusRef.current({
              ready: true,
              buffering: false,
              currentTime,
              duration: durationMs / 1000,
              playing: !paused,
              trackId
            });
            if (!paused || !playbackRef.current.playing) onErrorRef.current?.("");
            // Background drift uses tolerance; explicit room seeks above do not.
            const latest = playbackRef.current;
            if (!paused && latest.playing && !pendingSeekRef.current &&
              playbackNeedsSeek(currentTime, playbackTargetPosition(latest), "health")) {
              const seekRevision = ++commandRevisionRef.current;
              pendingSeekRef.current = { trackId, revision: seekRevision };
              widget.seekTo(playbackTargetPosition(latest) * 1000);
            }
          });
        });
      });
    }, 750);
    return () => window.clearInterval(timer);
  }, [ready]);

  return (
    <div className="soundcloud-shell">
      <iframe
        key={widgetAttempt.revision}
        ref={iframeRef}
        src={widgetAttempt.url}
        title={t("soundcloud.playerTitle", { title: playback.track?.title || t("soundcloud.currentTrack") })}
        allow="autoplay"
        scrolling="no"
      />
    </div>
  );
}
