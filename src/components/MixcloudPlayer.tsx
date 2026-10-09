import { useEffect, useRef, useState } from "react";
import { isMixcloudShowKey } from "../../shared/mixcloud";
import { createPlayerApiLoader } from "../player-api-loader";
import { playbackNeedsSeek, playbackTargetPosition, type CheckpointProviderPlaybackProps, type PlaybackSyncIntent } from "../provider-playback";

type Listener = (...values: number[]) => void;
interface WidgetEvent { on(listener: Listener): void; off(listener: Listener): void }
interface MixcloudWidget {
  ready: PromiseLike<void>;
  play(): PromiseLike<void>;
  pause(): PromiseLike<void>;
  seek(seconds: number): PromiseLike<boolean>;
  getPosition(): PromiseLike<number>;
  getDuration(): PromiseLike<number>;
  getIsPaused(): PromiseLike<boolean>;
  events: Record<"progress" | "buffering" | "play" | "pause" | "ended" | "error", WidgetEvent>;
}
declare global {
  interface Window { Mixcloud?: { PlayerWidget(iframe: HTMLIFrameElement): MixcloudWidget } }
}

const loadApi = createPlayerApiLoader({
  src: "https://widget.mixcloud.com/media/js/widgetApi.js",
  label: "the Mixcloud player",
  readApi: () => window.Mixcloud
});
const SEEK_DENIED = "Mixcloud refused this seek. Playback may be out of sync with the room.";
const AUTOPLAY_BLOCKED = "Press Play Mixcloud to start playback.";
const seconds = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
class WidgetTimeoutError extends Error {}

function bounded<T>(operation: PromiseLike<T>, message: string, timeoutMs = 8_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new WidgetTimeoutError(message)), timeoutMs);
    Promise.resolve(operation).then(resolve, reject).finally(() => window.clearTimeout(timer));
  });
}

export function MixcloudPlayer({ playback, syncRevision, isDj, onEnded, onStatus, onError }: CheckpointProviderPlaybackProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const widgetRef = useRef<MixcloudWidget | null>(null);
  const playbackRef = useRef(playback);
  const callbacksRef = useRef({ isDj, onEnded, onStatus, onError });
  const commandRevision = useRef(0);
  const commands = useRef<Promise<void>>(Promise.resolve());
  const busy = useRef(false);
  const failed = useRef(false);
  const deniedSeek = useRef(false);
  const checkpointRef = useRef(playback);
  const appliedCheckpoint = useRef<typeof playback | null>(null);
  const synchronizeRef = useRef<(intent: PlaybackSyncIntent) => void>(() => {});
  const failRef = useRef<(message: string) => void>(() => {});
  const [attempt, setAttempt] = useState(0);
  const [readyWidget, setReadyWidget] = useState<MixcloudWidget | null>(null);
  const [needsPlay, setNeedsPlay] = useState(false);
  const trackId = playback.track?.id;
  const showKey = playback.track?.providerId || "";
  const previousCheckpoint = checkpointRef.current;
  if (previousCheckpoint.track?.id !== trackId || previousCheckpoint.position !== playback.position ||
    previousCheckpoint.playing !== playback.playing || previousCheckpoint.updatedAt !== playback.updatedAt) {
    // Invalidate iframe responses as soon as React receives a new checkpoint.
    commandRevision.current++;
    checkpointRef.current = playback;
  }
  playbackRef.current = playback;
  callbacksRef.current = { isDj, onEnded, onStatus, onError };

  useEffect(() => {
    let active = true;
    let widget: MixcloudWidget | undefined;
    let polling: number | undefined;
    let sampling = false;
    let buffering = false;
    let ended = false;
    let pendingEnded: number | null = null;
    const bindings: Array<[WidgetEvent, Listener]> = [];
    const valid = () => active && widgetRef.current === widget && playbackRef.current.track?.id === trackId;
    const fail = (message: string) => {
      if (!active) return;
      failed.current = true;
      commandRevision.current++;
      busy.current = false;
      setReadyWidget(null);
      callbacksRef.current.onStatus({ ready: false, buffering: false, playing: false, currentTime: 0, duration: 0, trackId });
      callbacksRef.current.onError?.(message);
    };
    failRef.current = fail;
    widgetRef.current = null;
    commands.current = Promise.resolve();
    busy.current = false;
    failed.current = false;
    deniedSeek.current = false;
    appliedCheckpoint.current = null;
    setReadyWidget(null);
    setNeedsPlay(false);
    callbacksRef.current.onStatus({ ready: false, buffering: true, currentTime: 0, duration: 0, trackId });

    const sample = async () => {
      if (!valid() || !widget || sampling || failed.current) return;
      sampling = true;
      const revision = commandRevision.current;
      try {
        const [position, duration, paused] = await bounded(Promise.all([
          widget.getPosition(), widget.getDuration(), widget.getIsPaused()
        ]), "Mixcloud playback status took too long to load.");
        if (!valid() || revision !== commandRevision.current) return;
        const currentTime = seconds(position);
        callbacksRef.current.onStatus({ ready: true, buffering, currentTime, duration: seconds(duration), playing: !paused, isLive: false, trackId });
        if (pendingEnded !== null && !busy.current) {
          const completionRevision = pendingEnded;
          pendingEnded = null;
          if (!ended && completionRevision === revision && appliedCheckpoint.current === checkpointRef.current &&
            seconds(duration) > 0 && currentTime >= seconds(duration) - 1 && playbackRef.current.playing) {
            ended = true;
            if (callbacksRef.current.isDj) callbacksRef.current.onEnded();
          }
        }
        const waitingForPlay = paused && playbackRef.current.playing && !busy.current && !buffering && !ended;
        setNeedsPlay(waitingForPlay);
        if (waitingForPlay && !deniedSeek.current) callbacksRef.current.onError?.(AUTOPLAY_BLOCKED);
        else if (!deniedSeek.current) callbacksRef.current.onError?.("");
        if (!paused && playbackRef.current.playing && !busy.current && !deniedSeek.current && !ended &&
          playbackNeedsSeek(currentTime, playbackTargetPosition(playbackRef.current), "health")) {
          synchronizeRef.current("health");
        } else if (!paused && !playbackRef.current.playing && !busy.current) {
          synchronizeRef.current("health");
        }
      } catch (cause) {
        if (valid() && revision === commandRevision.current) callbacksRef.current.onError?.(cause instanceof Error ? cause.message : "Could not read Mixcloud playback.");
      } finally { sampling = false; }
    };

    void (async () => {
      try {
        if (!isMixcloudShowKey(showKey)) { fail("This Mixcloud show key is invalid."); return; }
        const api = await loadApi();
        if (!active || !iframeRef.current) return;
        widget = api.PlayerWidget(iframeRef.current);
        widgetRef.current = widget;
        await bounded(widget.ready, "The Mixcloud player took too long to become ready. Sync to try again.", 15_000);
        if (!valid() || failed.current) return;
        const bind = (name: keyof MixcloudWidget["events"], listener: Listener) => {
          const event = widget!.events[name];
          event.on(listener);
          bindings.push([event, listener]);
        };
        bind("progress", () => { buffering = false; void sample(); });
        bind("buffering", () => { buffering = true; void sample(); });
        bind("play", () => { buffering = false; ended = false; void sample(); });
        bind("pause", () => { buffering = false; void sample(); });
        bind("ended", () => {
          if (!valid() || failed.current || ended) return;
          pendingEnded = commandRevision.current;
          void sample();
        });
        bind("error", () => { if (valid()) fail("This Mixcloud show could not be played. Sync to try again."); });
        setReadyWidget(widget);
        polling = window.setInterval(() => void sample(), 750);
      } catch (cause) {
        if (active) fail(cause instanceof Error ? cause.message : "Could not initialize Mixcloud playback.");
      }
    })();

    return () => {
      active = false;
      commandRevision.current++;
      if (polling !== undefined) window.clearInterval(polling);
      for (const [event, listener] of bindings) event.off(listener);
      // Detached iframes stop audio; a pending SDK response must not update a new show.
      if (widget) { try { void Promise.resolve(widget.pause()).catch(() => {}); } catch { /* iframe already detached */ } }
      if (widgetRef.current === widget) widgetRef.current = null;
    };
  }, [trackId, showKey, attempt]);

  useEffect(() => {
    if (failed.current) setAttempt(previous => previous + 1);
  }, [syncRevision]);

  synchronizeRef.current = (intent) => {
    const widget = readyWidget;
    if (!widget || widget !== widgetRef.current || failed.current) return;
    const id = playbackRef.current.track?.id;
    const revision = ++commandRevision.current;
    const valid = () => widget === widgetRef.current && revision === commandRevision.current && playbackRef.current.track?.id === id && !failed.current;
    busy.current = true;
    commands.current = commands.current.catch(() => {}).then(async () => {
      if (!valid()) return;
      try {
        const observed = await bounded(widget.getPosition(), "Mixcloud playback took too long to respond. Sync to try again.");
        if (!valid()) return;
        const current = playbackRef.current;
        if (!current.playing) await bounded(widget.pause(), "Could not pause Mixcloud playback.");
        if (!valid()) return;
        const target = playbackTargetPosition(playbackRef.current);
        if (playbackNeedsSeek(observed, target, intent)) {
          const allowed = await bounded(widget.seek(target), "Mixcloud seek took too long to respond. Sync to try again.");
          if (!valid()) return;
          deniedSeek.current = !allowed;
          callbacksRef.current.onError?.(allowed ? "" : SEEK_DENIED);
        }
        if (!valid()) return;
        if (playbackRef.current.playing) await bounded(widget.play(), "Could not start Mixcloud playback. Press Play Mixcloud to try again.");
        if (valid()) appliedCheckpoint.current = checkpointRef.current;
      } catch (cause) {
        if (valid()) {
          if (cause instanceof WidgetTimeoutError) failRef.current(cause.message);
          else {
            setNeedsPlay(playbackRef.current.playing);
            callbacksRef.current.onError?.(cause instanceof Error ? cause.message : "Mixcloud playback failed.");
          }
        }
      } finally { if (valid()) busy.current = false; }
    });
  };

  useEffect(() => {
    synchronizeRef.current("checkpoint");
  }, [readyWidget, playback.playing, playback.position, playback.updatedAt, syncRevision]);

  const startPlayback = () => {
    const widget = widgetRef.current;
    const id = playbackRef.current.track?.id;
    const checkpoint = checkpointRef.current;
    if (!widget || !playbackRef.current.playing || failed.current) return;
    const revision = commandRevision.current;
    // Invoke directly in the click handler so the browser receives the user gesture.
    void bounded(widget.play(), "Could not start Mixcloud playback. Try again.").then(() => {
      if (widgetRef.current !== widget || playbackRef.current.track?.id !== id) return;
      if (revision !== commandRevision.current || checkpoint !== checkpointRef.current || !playbackRef.current.playing) {
        synchronizeRef.current("checkpoint");
        return;
      }
      if (checkpoint === checkpointRef.current) appliedCheckpoint.current = checkpoint;
      setNeedsPlay(false);
      if (!deniedSeek.current) callbacksRef.current.onError?.("");
    }).catch(cause => {
      if (widgetRef.current === widget && playbackRef.current.track?.id === id && revision === commandRevision.current && playbackRef.current.playing) callbacksRef.current.onError?.(cause instanceof Error ? cause.message : "Mixcloud playback failed.");
    });
  };

  return <div className="mixcloud-shell">
    <iframe key={`${trackId}:${showKey}:${attempt}`} ref={iframeRef}
      src={`https://www.mixcloud.com/widget/iframe/?${new URLSearchParams({ feed: showKey, mini: "true", hide_cover: "false", light: "false" })}`}
      title={`Mixcloud player for ${playback.track?.title || "current show"}`} allow="autoplay" scrolling="no"
      style={{ width: "100%", height: 120, border: 0 }} />
    {needsPlay && playback.playing && <button type="button" onClick={startPlayback}>Play Mixcloud</button>}
  </div>;
}
