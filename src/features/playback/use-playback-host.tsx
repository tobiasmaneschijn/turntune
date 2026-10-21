import { createElement, useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { PlaybackAdapterControls, PlayerStatus } from "./provider-playback";
import { playbackProvider, type RegisteredPlaybackProps } from "./provider-registry";
import type { PlaybackTarget } from "./playback-selection";
import { PLAYBACK_PREFERENCES } from "./playback-selection";
import type { PlaybackPreference } from "../settings/user-settings";
import type { Provider } from "../../types";
import { PROVIDER_DEFINITIONS } from "../../../shared/providers";
import { PlaybackMetrics } from "./playback-metrics";

/** Owns adapter selection and event lifetime; SDK command order stays inside each adapter. */
export function usePlaybackHost({ target, suppressed, controlsRef, preference, allowedProviders, ...props }: Omit<RegisteredPlaybackProps, "mode" | "mapping" | "syncRevision"> & {
  target?: PlaybackTarget;
  suppressed: boolean;
  controlsRef: Ref<PlaybackAdapterControls>;
  preference: PlaybackPreference;
  allowedProviders: readonly Provider[];
}) {
  const [syncRevision, setSyncRevision] = useState(0);
  const nativeControls = useRef<PlaybackAdapterControls>(null);
  const retained = useRef<PlaybackTarget | undefined>(undefined);
  // Only an empty queue can retain a session. A provider switch relinquishes it.
  const preferred = PLAYBACK_PREFERENCES[preference];
  const preferredMode = preferred.provider && preferred.mode === "default" ? PROVIDER_DEFINITIONS[preferred.provider].defaultPlaybackMode : preferred.mode;
  if (target) retained.current = target;
  else if (props.playback.track || (retained.current && (!allowedProviders.includes(retained.current.provider)
    || (preferred.provider && (preferred.provider !== retained.current.provider || preferredMode !== retained.current.mode))
    || !playbackProvider(retained.current.provider).persistent?.(retained.current.mode, props)))) retained.current = undefined;
  const activeTarget = suppressed ? undefined : target || retained.current;
  const registration = activeTarget ? playbackProvider(activeTarget.provider) : undefined;
  const persistent = Boolean(activeTarget && registration?.persistent?.(activeTarget.mode, props));
  const metrics = useRef<PlaybackMetrics>(null);
  metrics.current ??= new PlaybackMetrics();
  const metricIntent = useRef<Parameters<PlaybackMetrics["setIntent"]>[0]>(null);
  metricIntent.current = {
    key: `${props.roomSlug}:${props.userId}:${activeTarget?.provider}:${activeTarget?.mode}:${activeTarget?.mapping.providerId}:${props.playback.track?.id}:${syncRevision}`,
    provider: activeTarget?.provider,
    enabled: Boolean(activeTarget && props.playback.track && props.playback.playing && !registration?.connectionState?.(props.connections, props.accessToken)),
    playback: props.playback
  };
  const updateMetricIntent = () => { if (metricIntent.current) metrics.current!.setIntent(metricIntent.current); };
  useEffect(updateMetricIntent);
  const identity = `${props.roomSlug}:${props.userId}:${activeTarget?.provider}:${activeTarget?.mode}:${activeTarget?.mapping.providerId}:${props.playback.track?.id}:${props.playback.revision}`;
  const generation = useRef({ identity, token: {} });
  if (generation.current.identity !== identity) generation.current = { identity, token: {} };
  const token = generation.current.token;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const onVisibility = () => metrics.current?.visibilityChanged();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive.current = false;
      document.removeEventListener("visibilitychange", onVisibility);
      // StrictMode immediately reinstalls effects using this same tracker.
      queueMicrotask(() => { if (!alive.current) metrics.current?.dispose(); });
    };
  }, []);
  const valid = () => alive.current && generation.current.token === token;
  const onStatus = useCallback((status: PlayerStatus) => {
    if (valid() && (!status.trackId || status.trackId === props.playback.track?.id)) {
      updateMetricIntent();
      metrics.current?.status(status);
      props.onStatus(status);
    }
  }, [token, props.onStatus]);
  const onError = useCallback((message: string) => {
    if (valid()) { updateMetricIntent(); metrics.current?.error(message); props.onError?.(message); }
  }, [token, props.onError]);
  const onEnded = useCallback(() => { if (valid()) props.onEnded(); }, [token, props.onEnded]);
  const onConnectionLost = useCallback((message: string) => {
    if (valid()) { updateMetricIntent(); metrics.current?.error(message); props.onConnectionLost(message); }
  }, [token, props.onConnectionLost]);
  useImperativeHandle(controlsRef, () => ({ sync() {
    // SDK activation must execute in the caller's user gesture before React effects.
    nativeControls.current?.sync();
    setSyncRevision(revision => revision + 1);
  } }), []);
  const player = activeTarget && registration ? createElement(registration.Player, {
    ...props, key: `${props.roomSlug}:${props.userId}:${activeTarget.provider}:${activeTarget.mode}`,
    mode: activeTarget.mode, mapping: target?.mapping, syncRevision, controlsRef: nativeControls,
    onStatus, onError, onEnded, onConnectionLost
  }) : null;
  return {
    persistentPlayer: persistent && !registration?.video ? player : null,
    stagePlayer: !persistent && !registration?.video ? player : null,
    videoPlayer: registration?.video ? player : null,
    registration
  };
}
