import { createElement, useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { PlaybackAdapterControls, PlayerStatus } from "./provider-playback";
import { playbackProvider, type RegisteredPlaybackProps } from "./provider-registry";
import type { PlaybackTarget } from "./playback-selection";
import { PLAYBACK_PREFERENCES } from "./playback-selection";
import type { PlaybackPreference } from "../settings/user-settings";
import type { Provider } from "../../types";
import { PROVIDER_DEFINITIONS } from "../../../shared/providers";

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
  const identity = `${props.roomSlug}:${props.userId}:${activeTarget?.provider}:${activeTarget?.mode}:${activeTarget?.mapping.providerId}:${props.playback.track?.id}:${props.playback.revision}`;
  const generation = useRef({ identity, token: {} });
  if (generation.current.identity !== identity) generation.current = { identity, token: {} };
  const token = generation.current.token;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const valid = () => alive.current && generation.current.token === token;
  const onStatus = useCallback((status: PlayerStatus) => {
    if (valid() && (!status.trackId || status.trackId === props.playback.track?.id)) props.onStatus(status);
  }, [token, props.onStatus]);
  const onError = useCallback((message: string) => { if (valid()) props.onError?.(message); }, [token, props.onError]);
  const onEnded = useCallback(() => { if (valid()) props.onEnded(); }, [token, props.onEnded]);
  const onConnectionLost = useCallback((message: string) => { if (valid()) props.onConnectionLost(message); }, [token, props.onConnectionLost]);
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
  return { persistentPlayer: persistent ? player : null, stagePlayer: persistent ? null : player, registration };
}
