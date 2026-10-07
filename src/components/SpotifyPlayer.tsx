import { useEffect, useRef, useState } from "react";
import { Music2 } from "lucide-react";
import type { ProviderTrackMapping } from "../types";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { PlaybackCommandLifecycle, type PlaybackCommandLease, type ProviderPlaybackProps } from "../provider-playback";
import { createPlayerApiLoader } from "../player-api-loader";
import { PlaybackEndTracker } from "../playback-progress";
import { spotifyPlaybackSignature, spotifySyncActions, spotifyTargetPositionMs, type SpotifyPlaybackObservation } from "../spotify-playback-sync";
import { readStoredValue, storeValue } from "../lib/browser-storage";
import { requestJson } from "../lib/authenticated-http";

interface SpotifySdkState {
  paused: boolean;
  position: number;
  duration: number;
  track_window: { current_track: { uri: string } };
}

interface SpotifySdkPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: string, listener: (payload: never) => void): boolean;
  removeListener(event: string): boolean;
  getCurrentState(): Promise<SpotifySdkState | null>;
  setVolume(volume: number): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  activateElement(): Promise<void>;
}

declare global {
  interface Window {
    Spotify?: {
      Player: new (options: {
        name: string;
        volume: number;
        getOAuthToken: (callback: (token: string) => void) => void;
      }) => SpotifySdkPlayer;
    };
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

let spotifyWebPlayerSingleton: SpotifySdkPlayer | null = null;
let spotifyWebDeviceIdSingleton = "";
let spotifyWebOwner: object | null = null;
let spotifyWebPauseTimer: number | undefined;
let spotifyWebTokenProvider: ((callback: (token: string) => void) => void) | null = null;
const spotifyDesktopLifecycles = new Map<string, PlaybackCommandLifecycle>();

function removeSpotifyListeners(player: SpotifySdkPlayer | null) {
  for (const event of ["ready", "not_ready", "initialization_error", "authentication_error", "account_error", "playback_error", "autoplay_failed"]) {
    player?.removeListener(event);
  }
}

const loadSpotifySdk = createPlayerApiLoader({
  src: "https://sdk.scdn.co/spotify-player.js",
  label: "Spotify's web player",
  readApi: () => window.Spotify,
  readyCallback: "onSpotifyWebPlaybackSDKReady"
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (spotifyWebPauseTimer !== undefined) window.clearTimeout(spotifyWebPauseTimer);
    removeSpotifyListeners(spotifyWebPlayerSingleton);
    spotifyWebPlayerSingleton?.disconnect();
    spotifyWebPlayerSingleton = null;
    spotifyWebDeviceIdSingleton = "";
    spotifyWebOwner = null;
    spotifyWebTokenProvider = null;
  });
}

async function api<T>(path: string, accessToken: string, init?: RequestInit) {
  if (!init?.method || init.method === "GET") return requestJson<T>(path, { ...init, accessToken, errorMessage: "Spotify request failed." });
  const response = await fetch(path, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers
    }
  });
  if (response.status === 204) return null as T;
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Spotify request failed.");
  return payload;
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

function isDeviceUnavailable(error: unknown) {
  return /device not found|no active device|device.*offline/i.test(error instanceof Error ? error.message : "");
}

async function transferSpotifyPlayback(accessToken: string, deviceId: string, current: () => boolean) {
  let lastError: unknown;
  for (const delay of [0, 250, 750, 1_500]) {
    if (delay) await wait(delay);
    if (!current()) return;
    try {
      await api("/api/spotify/playback", accessToken, {
        method: "POST",
        body: JSON.stringify({ action: "transfer", deviceId })
      });
      return;
    } catch (error) {
      lastError = error;
      if (!isDeviceUnavailable(error)) throw error;
    }
  }
  throw lastError;
}

export function SpotifyPlayer({
  playback,
  mapping,
  mode,
  isDj,
  volume,
  accessToken,
  preferredDeviceId,
  resumeAfterReconnect,
  onEnded,
  onStatus,
  onConnectionLost,
  onError
}: ProviderPlaybackProps & {
  mapping?: ProviderTrackMapping;
  mode: "web" | "desktop";
  accessToken: string;
  preferredDeviceId?: string;
  resumeAfterReconnect: boolean;
  onConnectionLost: (message: string) => void;
}) {
  const playerRef = useRef<SpotifySdkPlayer | null>(null);
  const deviceIdRef = useRef("");
  const commandRef = useRef("");
  const endTrackerRef = useRef(new PlaybackEndTracker());
  const hasBeenReadyRef = useRef(false);
  const suppressedReconnectRef = useRef("");
  const playbackRef = useRef(playback);
  const mappingRef = useRef(mapping);
  const accessTokenRef = useRef(accessToken);
  const onConnectionLostRef = useRef(onConnectionLost);
  const resumeAfterReconnectRef = useRef(resumeAfterReconnect);
  const modeRef = useRef(mode);
  const generationRef = useRef(0);
  const commandsRef = useRef(Promise.resolve());
  const desktopLeaseRef = useRef<PlaybackCommandLease | null>(null);
  const ownedDesktopUriRef = useRef("");
  const wakePendingRef = useRef(false);
  const manualSyncRequestedRef = useRef(false);
  const recoverWebPlayerRef = useRef<() => void>(() => undefined);
  const [deviceId, setDeviceId] = useState("");
  const [error, setError] = useState("");
  const [activationNeeded, setActivationNeeded] = useState(false);
  const [activationDismissed, setActivationDismissed] = useState(false);
  const [activating, setActivating] = useState(false);
  const [activationRevision, setActivationRevision] = useState(0);
  const track = playback.track;
  const spotifyUri = mapping ? `spotify:track:${mapping.providerId}` : "";
  playbackRef.current = playback;
  mappingRef.current = mapping;
  accessTokenRef.current = accessToken;
  onConnectionLostRef.current = onConnectionLost;
  resumeAfterReconnectRef.current = resumeAfterReconnect;
  modeRef.current = mode;

  const reconcilePlayback = (force = false, wake = false) => {
    if (wake && wakePendingRef.current) return commandsRef.current;
    if (wake) wakePendingRef.current = true;
    const generation = generationRef.current;
    const currentDeviceId = deviceIdRef.current;
    const currentPlayback = playbackRef.current;
    const currentMapping = mappingRef.current;
    const signature = spotifyPlaybackSignature(currentPlayback, currentMapping, currentDeviceId);
    const desktopLease = modeRef.current === "desktop" ? desktopLeaseRef.current : null;
    const current = () => (!desktopLease || desktopLease.current()) && generationRef.current === generation && currentDeviceId === deviceIdRef.current &&
      signature === spotifyPlaybackSignature(playbackRef.current, mappingRef.current, deviceIdRef.current);
    const reconcile = async () => {
      if (!current() || !currentDeviceId) return;
      if (!force && suppressedReconnectRef.current === signature) return;
      if (!force && !wake && commandRef.current === signature) return;
      const player = modeRef.current === "web" ? playerRef.current : null;
      let observation: SpotifyPlaybackObservation | null = null;
      if (player) {
        const state = await player.getCurrentState();
        if (state) observation = { uri: state.track_window.current_track.uri, paused: state.paused, positionMs: state.position };
      } else if (modeRef.current === "desktop") {
        const { state } = await api<{ state?: { device?: { id?: string }; is_playing?: boolean; progress_ms?: number; item?: { uri?: string } } | null }>(
          "/api/spotify/playback", accessTokenRef.current);
        if (state && state.device?.id === currentDeviceId) {
          observation = { uri: state.item?.uri || "", paused: !state.is_playing, positionMs: state.progress_ms || 0 };
        }
      }
      if (!current()) return;
      const uri = currentMapping ? `spotify:track:${currentMapping.providerId}` : "";
      // An explicit room checkpoint (including a small seek) takes precedence
      // over the tolerance used for background/focus health checks.
      const checkpointChanged = !wake && Boolean(commandRef.current) && commandRef.current !== signature;
      const actions = spotifySyncActions(currentPlayback, uri, observation, force, Date.now(), checkpointChanged ? 0 : undefined);
      for (const action of actions) {
        if (!current()) return;
        if (desktopLease && uri && (action.action === "play" || action.action === "resume")) {
          // Record ownership before the network request: cleanup may start while
          // Spotify is still applying an uninterruptible play command.
          ownedDesktopUriRef.current = uri;
        }
        const positionMs = action.action === "seek" || action.action === "play" ? spotifyTargetPositionMs(currentPlayback) : undefined;
        if (player && action.action !== "play") {
          if (action.action === "seek") await player.seek(positionMs!);
          else if (action.action === "pause") await player.pause();
          else await player.resume();
        } else {
          const sendCommand = () => api("/api/spotify/playback", accessTokenRef.current, {
            method: "POST",
            body: JSON.stringify({ ...action, deviceId: currentDeviceId,
              ...(positionMs !== undefined ? { positionMs: spotifyTargetPositionMs(currentPlayback) } : {}) })
          });
          try {
            await sendCommand();
          } catch (cause) {
            if (!player || !isDeviceUnavailable(cause) || !current()) throw cause;
            await transferSpotifyPlayback(accessTokenRef.current, currentDeviceId, current);
            if (!current()) return;
            await sendCommand();
          }
        }
      }
      if (current()) {
        commandRef.current = signature;
        if (desktopLease && uri && currentPlayback.playing) ownedDesktopUriRef.current = uri;
        setError("");
      }
    };
    const task = commandsRef.current.then(() => desktopLease ? desktopLease.enqueue(reconcile) : reconcile()).catch((cause) => {
      if (!current()) return;
      commandRef.current = "";
      const message = cause instanceof Error ? cause.message : "Could not sync Spotify playback.";
      setError(message);
      if (modeRef.current === "web" && isDeviceUnavailable(cause)) recoverWebPlayerRef.current();
      if (/connect spotify/i.test(message)) onConnectionLostRef.current(message);
    }).finally(() => { if (wake) wakePendingRef.current = false; });
    commandsRef.current = task;
    return task;
  };
  const reconcilePlaybackRef = useRef(reconcilePlayback);
  reconcilePlaybackRef.current = reconcilePlayback;

  useEffect(() => {
    onError?.(error);
  }, [error, onError]);

  useEffect(() => {
    const syncPlayback = () => {
      const currentPlayback = playbackRef.current;
      const currentMapping = mappingRef.current;
      if (!currentPlayback.track || !currentMapping) return;
      commandRef.current = "";
      suppressedReconnectRef.current = "";
      const handleFailure = (cause: unknown) => {
        const message = cause instanceof Error ? cause.message : "Could not sync Spotify playback.";
        setError(message);
        if (mode === "web" && isDeviceUnavailable(cause)) recoverWebPlayerRef.current();
      };
      if (mode === "desktop") {
        const currentDeviceId = deviceIdRef.current;
        if (!currentDeviceId) {
          setError("Open the selected Spotify device, then sync again.");
          return;
        }
        void reconcilePlaybackRef.current(true);
        return;
      }
      const player = playerRef.current;
      if (!player) {
        recoverWebPlayerRef.current();
        return;
      }
      // This call is intentionally made directly inside the click-dispatched
      // event so browsers count Sync as a playback activation gesture.
      void player.activateElement().then(async () => {
        setActivationNeeded(false);
        setActivationDismissed(false);
        const currentDeviceId = deviceIdRef.current;
        if (!currentDeviceId) {
          manualSyncRequestedRef.current = true;
          recoverWebPlayerRef.current();
          return;
        }
        await reconcilePlaybackRef.current(true);
      }).catch((cause) => {
        handleFailure(cause);
        if (!isDeviceUnavailable(cause)) {
          setActivationNeeded(true);
          setActivationDismissed(false);
        }
      });
    };
    window.addEventListener("soundspin:playback-sync", syncPlayback);
    return () => window.removeEventListener("soundspin:playback-sync", syncPlayback);
  }, [mode]);

  useEffect(() => {
    generationRef.current += 1;
    let alive = true;
    let cleanupWebPlayer = () => undefined;
    setError("");
    commandRef.current = "";
    if (mode === "desktop") {
      let selectedDevice = "";
      let lifecycle: PlaybackCommandLifecycle | undefined;
      let lease: PlaybackCommandLease | undefined;
      ownedDesktopUriRef.current = "";
      void api<{ devices?: Array<{ id: string | null; name: string; type: string; is_active: boolean; is_restricted: boolean }> }>(
        "/api/spotify/devices",
        accessTokenRef.current
      ).then(({ devices = [] }) => {
        if (!alive) return;
        const available = devices.filter((device) => device.id && !device.is_restricted);
        const saved = preferredDeviceId ?? readStoredValue("soundspin-spotify-device-id");
        const selected = available.find((device) => device.id === saved) ||
          available.find((device) => device.is_active && device.type === "Computer") ||
          available.find((device) => device.is_active) ||
          available.find((device) => device.type === "Computer") ||
          available[0];
        if (!selected?.id) throw new Error("Open Spotify on your computer or another device, then try again.");
        selectedDevice = selected.id;
        lifecycle = spotifyDesktopLifecycles.get(selected.id) || new PlaybackCommandLifecycle();
        spotifyDesktopLifecycles.set(selected.id, lifecycle);
        lease = lifecycle.claim();
        desktopLeaseRef.current = lease;
        storeValue("soundspin-spotify-device-id", selected.id);
        deviceIdRef.current = selected.id;
        setDeviceId(selected.id);
      }).catch((cause) => {
        if (!alive) return;
        const message = cause instanceof Error ? cause.message : "Could not find a Spotify device.";
        setError(message);
        onConnectionLostRef.current(message);
      });
      return () => {
        const ownedUri = ownedDesktopUriRef.current;
        const sessionToken = accessTokenRef.current;
        alive = false;
        generationRef.current += 1;
        deviceIdRef.current = "";
        desktopLeaseRef.current = null;
        if (!lease || !lifecycle) return;
        const releasedLifecycle = lifecycle;
        void lease.release(async () => {
          if (!ownedUri) return;
          // Pause only the recording/device this adapter controlled, after all
          // in-flight commands; leave playback moved elsewhere by the user alone.
          const { state } = await api<{ state?: { device?: { id?: string }; item?: { uri?: string } } | null }>(
            "/api/spotify/playback", sessionToken);
          if (releasedLifecycle.owned || state?.device?.id !== selectedDevice || state.item?.uri !== ownedUri) return;
          await api("/api/spotify/playback", sessionToken, {
            method: "POST", body: JSON.stringify({ action: "pause", deviceId: selectedDevice })
          });
        }).catch(() => {
          // Provider cleanup is best effort if the session/device went offline.
        }).finally(() => {
          if (!releasedLifecycle.owned && spotifyDesktopLifecycles.get(selectedDevice) === releasedLifecycle) {
            spotifyDesktopLifecycles.delete(selectedDevice);
          }
        });
      };
    }

    const webOwner = {};
    spotifyWebOwner = webOwner;
    // The SDK is reused across mounts, but its authorization must use the
    // active component's session and callbacks after an app token refresh.
    spotifyWebTokenProvider = (callback) => {
      void api<{ accessToken: string }>("/api/spotify/token", accessTokenRef.current)
        .then(({ accessToken: spotifyToken }) => { if (alive) callback(spotifyToken); })
        .catch((cause) => {
          if (!alive) return;
          const message = cause instanceof Error ? cause.message : "Spotify authorization expired.";
          setError(message);
          onConnectionLostRef.current(message);
        });
    };
    if (spotifyWebPauseTimer !== undefined) {
      window.clearTimeout(spotifyWebPauseTimer);
      spotifyWebPauseTimer = undefined;
    }

    void loadSpotifySdk().then((sdk) => {
      if (!alive) return;
      let reconnectTimer: number | undefined;
      let readyWatchdog: number | undefined;
      let reconnectAttempts = 0;
      let reconnecting = false;
      const player = spotifyWebPlayerSingleton || new sdk.Player({
        name: "Lydman Web Player",
        volume: volume / 100,
        getOAuthToken: (callback) => spotifyWebTokenProvider?.(callback)
      });
      spotifyWebPlayerSingleton = player;
      removeSpotifyListeners(player);
      playerRef.current = player;
      const scheduleReconnect = (immediate = false) => {
        if (!alive || reconnecting || reconnectTimer !== undefined) return;
        const delay = immediate ? 0 : Math.min(1_000 * (2 ** reconnectAttempts), 15_000);
        setError("Reconnecting the Lydman Spotify device…");
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = undefined;
          if (!alive) return;
          reconnecting = true;
          generationRef.current += 1;
          player.disconnect();
          spotifyWebDeviceIdSingleton = "";
          deviceIdRef.current = "";
          setDeviceId("");
          void wait(250).then(async () => {
            if (!alive) return;
            const connected = await player.connect();
            if (!connected) throw new Error("Spotify did not accept the reconnect request.");
            if (deviceIdRef.current) {
              reconnecting = false;
              return;
            }
            reconnectAttempts += 1;
            readyWatchdog = window.setTimeout(() => {
              readyWatchdog = undefined;
              reconnecting = false;
              scheduleReconnect();
            }, 6_000);
          }).catch((cause) => {
            if (!alive) return;
            reconnecting = false;
            reconnectAttempts += 1;
            setError(cause instanceof Error ? cause.message : "Spotify reconnection failed.");
            scheduleReconnect();
          });
        }, delay);
      };
      recoverWebPlayerRef.current = () => scheduleReconnect(true);

      player.addListener("ready", ((payload: { device_id: string }) => {
        if (!alive) return;
        if (readyWatchdog !== undefined) window.clearTimeout(readyWatchdog);
        if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
        readyWatchdog = undefined;
        reconnectTimer = undefined;
        reconnecting = false;
        reconnectAttempts = 0;
        const wasReconnecting = hasBeenReadyRef.current;
        hasBeenReadyRef.current = true;
        spotifyWebDeviceIdSingleton = payload.device_id;
        deviceIdRef.current = payload.device_id;
        const currentPlayback = playbackRef.current;
        setError("");
        suppressedReconnectRef.current = wasReconnecting && !resumeAfterReconnectRef.current && !manualSyncRequestedRef.current
          ? spotifyPlaybackSignature(currentPlayback, mappingRef.current, payload.device_id)
          : "";
        manualSyncRequestedRef.current = false;
        commandRef.current = "";
        setDeviceId(payload.device_id);
        setActivationRevision((revision) => revision + 1);
      }) as (payload: never) => void);
      player.addListener("not_ready", (() => {
        if (alive) {
          generationRef.current += 1;
          deviceIdRef.current = "";
          spotifyWebDeviceIdSingleton = "";
          setDeviceId("");
          scheduleReconnect();
        }
      }) as (payload: never) => void);
      player.addListener("initialization_error", ((payload: { message: string }) => {
        if (alive) setError(payload.message || "Spotify could not initialize this browser player.");
      }) as (payload: never) => void);
      player.addListener("authentication_error", ((payload: { message: string }) => {
        if (alive) {
          setError(payload.message);
          onConnectionLostRef.current(payload.message);
        }
      }) as (payload: never) => void);
      player.addListener("account_error", ((payload: { message: string }) => {
        if (alive) setError(payload.message || "Spotify Premium is required.");
      }) as (payload: never) => void);
      player.addListener("playback_error", ((payload: { message: string }) => {
        if (!alive) return;
        setError(payload.message || "Spotify playback stopped unexpectedly.");
        if (isDeviceUnavailable(new Error(payload.message))) scheduleReconnect();
      }) as (payload: never) => void);
      player.addListener("autoplay_failed", (() => {
        if (alive) {
          setActivationNeeded(true);
          setActivationDismissed(false);
        }
      }) as (payload: never) => void);
      const wakePlayer = () => {
        if (!alive || document.visibilityState === "hidden") return;
        if (!playbackRef.current.track || !mappingRef.current) return;
        const currentDeviceId = deviceIdRef.current;
        if (!currentDeviceId) {
          scheduleReconnect(true);
          return;
        }
        void reconcilePlaybackRef.current(false, true);
      };
      window.addEventListener("online", wakePlayer);
      window.addEventListener("focus", wakePlayer);
      document.addEventListener("visibilitychange", wakePlayer);
      cleanupWebPlayer = () => {
        if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
        if (readyWatchdog !== undefined) window.clearTimeout(readyWatchdog);
        window.removeEventListener("online", wakePlayer);
        window.removeEventListener("focus", wakePlayer);
        document.removeEventListener("visibilitychange", wakePlayer);
      };

      if (spotifyWebDeviceIdSingleton) {
        hasBeenReadyRef.current = true;
        deviceIdRef.current = spotifyWebDeviceIdSingleton;
        setDeviceId(spotifyWebDeviceIdSingleton);
        setError("");
        return;
      }

      return player.connect().then((connected) => {
        if (!connected) {
          scheduleReconnect();
          throw new Error("Spotify could not connect the Lydman Web Player.");
        }
        if (!alive || deviceIdRef.current) return;
        readyWatchdog = window.setTimeout(() => {
          readyWatchdog = undefined;
          scheduleReconnect();
        }, 6_000);
      });
    }).catch((cause) => {
      if (alive) setError(cause instanceof Error ? cause.message : "Could not initialize Spotify.");
    });
    return () => {
      alive = false;
      generationRef.current += 1;
      cleanupWebPlayer();
      recoverWebPlayerRef.current = () => undefined;
      if (spotifyWebOwner === webOwner) {
        spotifyWebOwner = null;
        spotifyWebTokenProvider = null;
        removeSpotifyListeners(playerRef.current);
        spotifyWebPauseTimer = window.setTimeout(() => {
          spotifyWebPauseTimer = undefined;
          if (spotifyWebOwner) return;
          void spotifyWebPlayerSingleton?.pause().catch(() => {
            // The SDK can already be paused or briefly unavailable during navigation.
          });
        }, 100);
      }
      playerRef.current = null;
      deviceIdRef.current = "";
    };
  }, [mode, preferredDeviceId]);

  useEffect(() => {
    if (mode === "web") {
      void playerRef.current?.setVolume(volume / 100).catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Could not set Spotify volume.");
        if (isDeviceUnavailable(cause)) recoverWebPlayerRef.current();
      });
    } else if (deviceId) {
      const lease = desktopLeaseRef.current;
      const sessionToken = accessTokenRef.current;
      void lease?.enqueue(async () => {
        await api("/api/spotify/playback", sessionToken, {
          method: "POST",
          body: JSON.stringify({ action: "volume", deviceId, volumePercent: volume })
        });
      }).catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Could not set Spotify volume.");
      });
    }
  }, [mode, volume, deviceId]);

  useEffect(() => {
    if (mode === "web" && track && mapping && !deviceId) recoverWebPlayerRef.current();
  }, [mode, track?.id, mapping?.providerId, deviceId]);

  useEffect(() => {
    if (!deviceId) return;
    void reconcilePlaybackRef.current();
  }, [track?.id, mapping?.providerId, playback.playing, playback.position, playback.updatedAt, deviceId, activationRevision, mode]);

  useEffect(() => {
    if (!track || !mapping) return;
    let alive = true;
    let polling = false;
    const update = async () => {
      if (polling) return;
      polling = true;
      try {
        if (mode === "web" && playerRef.current) {
          const state = await playerRef.current.getCurrentState();
          if (!alive || !state) return;
          const currentTime = state.position / 1000;
          const duration = state.duration / 1000;
          const sameRecording = state.track_window.current_track.uri === spotifyUri;
          onStatus({ ready: true, buffering: playback.playing && !sameRecording, currentTime: sameRecording ? currentTime : 0, duration: sameRecording ? duration : 0, playing: sameRecording && !state.paused, trackId: sameRecording ? track.id : undefined });
          if (endTrackerRef.current.observe(`${track.id}:${spotifyUri}:${playback.position}:${playback.updatedAt}`, sameRecording ? currentTime : 0,
            duration, sameRecording && state.paused, playback.playing && isDj)) {
            onEnded();
          }
          return;
        }
        if (mode === "desktop") {
          const payload = await api<{ state?: { device?: { id?: string }; is_playing?: boolean; progress_ms?: number; item?: { uri?: string; duration_ms?: number } } | null }>(
            "/api/spotify/playback",
            accessToken
          );
          if (!alive) return;
          const state = payload.state;
          const currentTime = (state?.progress_ms || 0) / 1000;
          const duration = (state?.item?.duration_ms || track.durationMs || 0) / 1000;
          const sameRecording = state?.device?.id === deviceId && state?.item?.uri === spotifyUri;
          onStatus({
            ready: Boolean(deviceId),
            buffering: Boolean(playback.playing && !sameRecording),
            currentTime: sameRecording ? currentTime : 0,
            duration: sameRecording ? duration : 0,
            playing: sameRecording && Boolean(state?.is_playing),
            trackId: sameRecording ? track.id : undefined
          });
          if (endTrackerRef.current.observe(`${track.id}:${spotifyUri}:${playback.position}:${playback.updatedAt}`, sameRecording ? currentTime : 0,
            duration, sameRecording && !state?.is_playing, playback.playing && isDj)) {
            onEnded();
          }
        }
      } catch {
        // Command errors are surfaced above; transient polling errors are ignored.
      } finally {
        polling = false;
      }
    };
    void update();
    const interval = window.setInterval(() => void update(), 1_500);
    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, [track?.id, track?.durationMs, mode, accessToken, deviceId, spotifyUri, playback.playing, playback.position, playback.updatedAt, isDj, onEnded, onStatus]);

  const activateSpotify = () => {
    const player = playerRef.current;
    if (!player) return;
    setActivating(true);
    setError("");
    void player.activateElement().then(() => {
      setActivationNeeded(false);
      setActivationDismissed(false);
      commandRef.current = "";
      suppressedReconnectRef.current = "";
      if (!deviceIdRef.current) {
        manualSyncRequestedRef.current = true;
        recoverWebPlayerRef.current();
      }
      setActivationRevision((revision) => revision + 1);
    }).catch((cause) => {
      setError(cause instanceof Error ? cause.message : "Spotify playback could not be enabled.");
    }).finally(() => setActivating(false));
  };

  if (!error && !activationNeeded) return null;

  return (
    <>
      {error && (
        <div className="spotify-playback-overlay error"><small>{error}</small></div>
      )}
      {activationNeeded && mode === "web" && !activationDismissed && (
        <Dialog open onOpenChange={(open) => { if (!open) setActivationDismissed(true); }}>
          <DialogContent className="spotify-activation-dialog" showCloseButton={false}>
            <div className="spotify-activation-icon"><Music2 /></div>
            <DialogHeader className="spotify-activation-copy">
              <DialogTitle>Enable Spotify playback</DialogTitle>
              <DialogDescription>
                Your browser blocked autoplay. Enable playback to start audio.
              </DialogDescription>
            </DialogHeader>
            {error && <div className="dialog-error" role="alert">{error}</div>}
            <DialogFooter className="spotify-activation-actions">
              <Button type="button" variant="outline" onClick={() => setActivationDismissed(true)}>Not now</Button>
              <Button type="button" onClick={activateSpotify} disabled={activating}>{activating ? "Enabling…" : "Enable playback"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {activationNeeded && mode === "web" && activationDismissed && (
        <div className="spotify-playback-overlay">
          <button type="button" onClick={() => setActivationDismissed(false)}>Enable Spotify playback</button>
        </div>
      )}
    </>
  );
}
