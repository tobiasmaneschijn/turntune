import { useEffect, useImperativeHandle, useRef } from "react";
import i18n from "../../../i18n";
import { requestJson } from "../../../lib/authenticated-http";
import { playbackNeedsSeek, playbackTargetPosition, type CheckpointProviderPlaybackProps, type PlaybackSyncIntent } from "../provider-playback";
import type { ProviderTrackMapping } from "../../../types";

interface AudiusSession {
  identity: string;
  synchronize(intent: PlaybackSyncIntent): void;
}

function validPlaybackUrl(payload: unknown, providerId: string): payload is { url: string } {
  if (!payload || typeof payload !== "object" || !("url" in payload) || typeof payload.url !== "string") return false;
  try {
    const url = new URL(payload.url);
    return url.protocol === "https:" && url.hostname === "api.audius.co" && !url.port && !url.username && !url.password && !url.hash
      && url.pathname === `/v1/tracks/${encodeURIComponent(providerId)}/stream`
      && url.searchParams.getAll("api_key").length === 1 && Boolean(url.searchParams.get("api_key"))
      && url.searchParams.getAll("app_name").length <= 1
      && (!url.searchParams.has("app_name") || url.searchParams.get("app_name") === "TurnTune")
      && [...url.searchParams.keys()].every(key => key === "api_key" || key === "app_name");
  } catch { return false; }
}

/** Streams use the public Audius API key; the application's private bearer token stays on the server. */
export function AudiusPlayer({ playback, mapping, syncRevision, isDj, volume, accessToken, userId, roomSlug,
  controlsRef, onStatus, onEnded, onError }: CheckpointProviderPlaybackProps & {
  mapping?: ProviderTrackMapping;
  accessToken?: string;
  userId: string;
  roomSlug: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const sessionRef = useRef<AudiusSession | null>(null);
  const providerId = mapping?.providerId ?? playback.track?.providerId;
  const identity = `${roomSlug}:${userId}:${playback.track?.id ?? ""}:${providerId ?? ""}`;
  const currentRef = useRef({ identity, playback, isDj, volume, accessToken, onStatus, onEnded, onError });
  currentRef.current = { identity, playback, isDj, volume, accessToken, onStatus, onEnded, onError };

  useImperativeHandle(controlsRef, () => ({ sync() {
    // Preserve the user's activation before the host schedules its checkpoint update.
    sessionRef.current?.synchronize("manual");
  } }), []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!providerId || !playback.track) {
      currentRef.current.onStatus({ ready: true, buffering: false, playing: false, currentTime: 0, duration: 0 });
      return;
    }
    let active = true;
    let sourceRequest: AbortController | null = null;
    let streamUrl = "";
    let failed = false;
    let buffering = true;
    let played = false;
    let ended = false;
    let commandRevision = 0;
    let pendingPlay = false;
    let startupTimeout: number | undefined;
    const session: AudiusSession = { identity, synchronize() {} };
    sessionRef.current = session;
    const current = () => active && sessionRef.current === session && currentRef.current.identity === identity;
    const clearStartupTimeout = () => { window.clearTimeout(startupTimeout); startupTimeout = undefined; };
    const report = () => {
      if (!current()) return;
      const latest = currentRef.current;
      latest.onStatus({
        ready: !failed && audio.readyState >= HTMLMediaElement.HAVE_METADATA,
        buffering: !failed && buffering,
        playing: !audio.paused && !audio.ended,
        currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
        duration: Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (latest.playback.track?.durationMs ?? 0) / 1000,
        trackId: latest.playback.track?.id
      });
    };
    const fail = (message: string) => {
      if (!current()) return;
      clearStartupTimeout();
      failed = true;
      buffering = false;
      currentRef.current.onError?.(message);
      report();
    };
    const watchStartup = () => {
      clearStartupTimeout();
      startupTimeout = window.setTimeout(() => {
        if (current() && audio.readyState < HTMLMediaElement.HAVE_METADATA) {
          commandRevision++;
          pendingPlay = false;
          audio.pause();
          fail(i18n.t("music:audius.playbackFailed"));
        }
      }, 15_000);
    };
    const start = () => {
      if (!current() || pendingPlay || (!audio.paused && !audio.ended)) return;
      // Native play() rewinds an ended recording. Wait for the next room track.
      if (audio.ended) return;
      const revision = ++commandRevision;
      pendingPlay = true;
      // Call play synchronously, especially when invoked by the Sync button.
      void audio.play().then(() => {
        if (!current()) return;
        if (!currentRef.current.playback.playing) audio.pause();
        if (revision === commandRevision) currentRef.current.onError?.("");
        report();
      }).catch((error: unknown) => {
        if (!current() || revision !== commandRevision || !currentRef.current.playback.playing) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        buffering = false;
        currentRef.current.onError?.(i18n.t(error instanceof DOMException && error.name === "NotAllowedError"
          ? "music:audius.playbackBlocked" : "music:audius.playbackFailed"));
        report();
      }).finally(() => { if (current() && revision === commandRevision) pendingPlay = false; });
    };
    const loadSource = () => {
      if (!current() || sourceRequest) return;
      const controller = new AbortController();
      sourceRequest = controller;
      failed = false;
      buffering = currentRef.current.playback.playing;
      report();
      void requestJson<{ url: string }>(`/api/audius/playback?id=${encodeURIComponent(providerId)}`, {
        accessToken: currentRef.current.accessToken,
        headers: { "x-soundspin-room": roomSlug }, signal: controller.signal,
        errorMessage: i18n.t("music:audius.unavailable"),
        validate: (payload): payload is { url: string } => validPlaybackUrl(payload, providerId)
      }).then(payload => {
        if (!current() || controller.signal.aborted) return;
        streamUrl = payload.url;
        audio.src = streamUrl;
        audio.load();
        watchStartup();
      }).catch(error => {
        if (current() && !controller.signal.aborted) fail(error instanceof Error ? error.message : i18n.t("music:audius.unavailable"));
      }).finally(() => { if (sourceRequest === controller) sourceRequest = null; });
    };
    session.synchronize = intent => {
      if (!current()) return;
      const latest = currentRef.current;
      audio.volume = Math.max(0, Math.min(1, latest.volume / 100));
      if (!streamUrl) {
        if (intent === "manual") loadSource();
        return;
      }
      if (intent === "manual" && failed) {
        failed = false;
        buffering = latest.playback.playing;
        audio.load();
        watchStartup();
      }
      if (failed) return;
      if (!latest.playback.playing) {
        commandRevision++;
        pendingPlay = false;
        audio.pause();
        buffering = false;
      }
      if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
        const desired = playbackTargetPosition(latest.playback);
        const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : undefined;
        const target = duration ? Math.min(desired, duration) : desired;
        if (playbackNeedsSeek(audio.currentTime, target, intent)) {
          try { audio.currentTime = target; }
          catch { if (intent !== "health") currentRef.current.onError?.(i18n.t("music:audius.playbackFailed")); }
        }
      }
      if (latest.playback.playing && intent !== "health") start();
      report();
    };
    const onMetadata = () => {
      if (!current()) return;
      clearStartupTimeout();
      failed = false;
      session.synchronize("checkpoint");
    };
    const onPlaying = () => {
      if (!current()) return;
      if (!currentRef.current.playback.playing) { audio.pause(); report(); return; }
      played = true;
      buffering = false;
      currentRef.current.onError?.("");
      report();
    };
    const onWaiting = () => { if (current()) { buffering = currentRef.current.playback.playing; report(); } };
    const onFinished = () => {
      if (!current()) return;
      buffering = false;
      report();
      if (audio.ended && played && !ended && currentRef.current.isDj && currentRef.current.playback.playing) {
        ended = true;
        currentRef.current.onEnded();
      }
    };
    const onMediaError = () => fail(i18n.t("music:audius.playbackFailed"));
    const events: Array<[string, EventListener]> = [
      ["loadedmetadata", onMetadata], ["playing", onPlaying], ["waiting", onWaiting], ["stalled", onWaiting],
      ["pause", report], ["seeked", report], ["timeupdate", report], ["ended", onFinished], ["error", onMediaError]
    ];
    for (const [event, listener] of events) audio.addEventListener(event, listener);
    const health = window.setInterval(() => {
      if (!current()) return;
      // Browser recovery and manual Sync own resumes; health checks preserve healthy audio.
      if (!audio.paused && !audio.ended && !failed) session.synchronize("health");
      else report();
    }, 750);
    audio.volume = Math.max(0, Math.min(1, currentRef.current.volume / 100));
    loadSource();
    return () => {
      active = false;
      commandRevision++;
      sourceRequest?.abort();
      clearStartupTimeout();
      window.clearInterval(health);
      for (const [event, listener] of events) audio.removeEventListener(event, listener);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [identity]);

  useEffect(() => {
    sessionRef.current?.synchronize("checkpoint");
  }, [identity, playback.playing, playback.position, playback.updatedAt, syncRevision]);
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = Math.max(0, Math.min(1, volume / 100));
  }, [volume]);

  return <audio key={identity} ref={audioRef} preload="auto" />;
}
