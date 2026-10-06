import { useEffect, useRef, useState } from "react";
import { Music2 } from "lucide-react";
import type { Playback, ProviderTrackMapping } from "../types";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import type { PlayerStatus } from "./YouTubePlayer";
import { createPlayerApiLoader } from "../player-api-loader";
import { PlaybackEndTracker } from "../playback-progress";
import { readStoredValue, storeValue } from "../lib/browser-storage";

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
  removeListener(event?: string): boolean;
  getCurrentState(): Promise<SpotifySdkState | null>;
  setVolume(volume: number): Promise<void>;
  pause(): Promise<void>;
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

const loadSpotifySdk = createPlayerApiLoader({
  src: "https://sdk.scdn.co/spotify-player.js",
  label: "Spotify's web player",
  readApi: () => window.Spotify,
  readyCallback: "onSpotifyWebPlaybackSDKReady"
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (spotifyWebPauseTimer !== undefined) window.clearTimeout(spotifyWebPauseTimer);
    spotifyWebPlayerSingleton?.removeListener();
    spotifyWebPlayerSingleton?.disconnect();
    spotifyWebPlayerSingleton = null;
    spotifyWebDeviceIdSingleton = "";
    spotifyWebOwner = null;
    spotifyWebTokenProvider = null;
  });
}

async function api<T>(path: string, accessToken: string, init?: RequestInit) {
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

async function transferSpotifyPlayback(accessToken: string, deviceId: string) {
  let lastError: unknown;
  for (const delay of [0, 250, 750, 1_500]) {
    if (delay) await wait(delay);
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

function targetPositionMs(playback: Playback) {
  return Math.max(0, Math.floor((
    playback.position + (playback.playing ? (Date.now() - playback.updatedAt) / 1000 : 0)
  ) * 1000));
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
}: {
  playback: Playback;
  mapping?: ProviderTrackMapping;
  mode: "web" | "desktop";
  isDj: boolean;
  volume: number;
  accessToken: string;
  preferredDeviceId?: string;
  resumeAfterReconnect: boolean;
  onEnded: () => void;
  onStatus: (status: PlayerStatus) => void;
  onConnectionLost: (message: string) => void;
  onError?: (message: string) => void;
}) {
  const playerRef = useRef<SpotifySdkPlayer | null>(null);
  const deviceIdRef = useRef("");
  const commandRef = useRef("");
  const endTrackerRef = useRef(new PlaybackEndTracker());
  const hasBeenReadyRef = useRef(false);
  const suppressedReconnectRef = useRef("");
  const playbackRef = useRef(playback);
  const mappingRef = useRef(mapping);
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

  useEffect(() => {
    if (error) onError?.(error);
  }, [error, onError]);

  useEffect(() => {
    const syncPlayback = () => {
      const currentPlayback = playbackRef.current;
      const currentMapping = mappingRef.current;
      if (!currentPlayback.track || !currentMapping) return;
      const currentTrack = currentPlayback.track;
      commandRef.current = "";
      const syncDevice = async (currentDeviceId: string) => {
        const positionMs = targetPositionMs(currentPlayback);
        if (currentPlayback.playing) {
          await api("/api/spotify/playback", accessToken, {
            method: "POST",
            body: JSON.stringify({
              action: "play",
              deviceId: currentDeviceId,
              spotifyUri: `spotify:track:${currentMapping.providerId}`,
              positionMs
            })
          });
        } else {
          await api("/api/spotify/playback", accessToken, {
            method: "POST",
            body: JSON.stringify({ action: "seek", deviceId: currentDeviceId, positionMs })
          });
          await api("/api/spotify/playback", accessToken, {
            method: "POST",
            body: JSON.stringify({ action: "pause", deviceId: currentDeviceId })
          });
        }
        commandRef.current = `${currentTrack.id}:${currentPlayback.playing}:${currentPlayback.position}:${currentPlayback.updatedAt}:${currentDeviceId}`;
        setActivationRevision((revision) => revision + 1);
        setError("");
      };
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
        void syncDevice(currentDeviceId).catch(handleFailure);
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
          recoverWebPlayerRef.current();
          return;
        }
        await transferSpotifyPlayback(accessToken, currentDeviceId);
        await syncDevice(currentDeviceId);
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
  }, [mode, accessToken]);

  useEffect(() => {
    let alive = true;
    let cleanupWebPlayer = () => undefined;
    setError("");
    commandRef.current = "";
    if (mode === "desktop") {
      void api<{ devices?: Array<{ id: string | null; name: string; type: string; is_active: boolean; is_restricted: boolean }> }>(
        "/api/spotify/devices",
        accessToken
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
        storeValue("soundspin-spotify-device-id", selected.id);
        deviceIdRef.current = selected.id;
        setDeviceId(selected.id);
      }).catch((cause) => {
        if (!alive) return;
        const message = cause instanceof Error ? cause.message : "Could not find a Spotify device.";
        setError(message);
        onConnectionLost(message);
      });
      return () => { alive = false; };
    }

    const webOwner = {};
    spotifyWebOwner = webOwner;
    // The SDK is reused across mounts, but its authorization must use the
    // active component's session and callbacks after an app token refresh.
    spotifyWebTokenProvider = (callback) => {
      void api<{ accessToken: string }>("/api/spotify/token", accessToken)
        .then(({ accessToken: spotifyToken }) => { if (alive) callback(spotifyToken); })
        .catch((cause) => {
          if (!alive) return;
          const message = cause instanceof Error ? cause.message : "Spotify authorization expired.";
          setError(message);
          onConnectionLost(message);
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
      player.removeListener();
      playerRef.current = player;
      const scheduleReconnect = (immediate = false) => {
        if (!alive || reconnecting || reconnectTimer !== undefined) return;
        const delay = immediate ? 0 : Math.min(1_000 * (2 ** reconnectAttempts), 15_000);
        setError("Reconnecting the Lydman Spotify device…");
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = undefined;
          if (!alive) return;
          reconnecting = true;
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
        const activateDevice = currentPlayback.track && mappingRef.current
          ? transferSpotifyPlayback(accessToken, payload.device_id)
          : Promise.resolve();
        void activateDevice
          .then(() => {
            if (!alive || deviceIdRef.current !== payload.device_id) return;
            setError("");
            suppressedReconnectRef.current = wasReconnecting && !resumeAfterReconnect
              ? `${currentPlayback.track?.id || "empty"}:${currentPlayback.updatedAt}`
              : "";
            commandRef.current = "";
            setDeviceId(payload.device_id);
          })
          .catch((cause) => {
            if (!alive) return;
            setError(cause instanceof Error ? cause.message : "Could not activate the Lydman Spotify device.");
            scheduleReconnect();
          });
      }) as (payload: never) => void);
      player.addListener("not_ready", (() => {
        if (alive) {
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
          onConnectionLost(payload.message);
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
        void transferSpotifyPlayback(accessToken, currentDeviceId).then(() => {
          if (!alive) return;
          commandRef.current = "";
          setActivationRevision((revision) => revision + 1);
        }).catch(() => scheduleReconnect(true));
      };
      window.addEventListener("online", wakePlayer);
      document.addEventListener("visibilitychange", wakePlayer);
      cleanupWebPlayer = () => {
        if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
        if (readyWatchdog !== undefined) window.clearTimeout(readyWatchdog);
        window.removeEventListener("online", wakePlayer);
        document.removeEventListener("visibilitychange", wakePlayer);
      };

      if (spotifyWebDeviceIdSingleton) {
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
      });
    }).catch((cause) => {
      if (alive) setError(cause instanceof Error ? cause.message : "Could not initialize Spotify.");
    });
    return () => {
      alive = false;
      cleanupWebPlayer();
      recoverWebPlayerRef.current = () => undefined;
      if (spotifyWebOwner === webOwner) {
        spotifyWebOwner = null;
        spotifyWebTokenProvider = null;
        playerRef.current?.removeListener();
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
  }, [mode, accessToken, onConnectionLost, preferredDeviceId, resumeAfterReconnect]);

  useEffect(() => {
    if (mode === "web") {
      void playerRef.current?.setVolume(volume / 100).catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Could not set Spotify volume.");
        recoverWebPlayerRef.current();
      });
    } else if (deviceId) {
      void api("/api/spotify/playback", accessToken, {
        method: "POST",
        body: JSON.stringify({ action: "volume", deviceId, volumePercent: volume })
      }).catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Could not set Spotify volume.");
      });
    }
  }, [mode, volume, deviceId, accessToken]);

  useEffect(() => {
    if (mode === "web" && track && mapping && !deviceId) recoverWebPlayerRef.current();
  }, [mode, track?.id, mapping?.providerId, deviceId]);

  useEffect(() => {
    if (!deviceId) return;
    if (suppressedReconnectRef.current === `${track?.id || "empty"}:${playback.updatedAt}`) return;
    if (!track || !mapping) {
      const signature = `idle:${deviceId}:${track?.id || "empty"}`;
      if (commandRef.current === signature) return;
      commandRef.current = signature;
      void api("/api/spotify/playback", accessToken, {
        method: "POST",
        body: JSON.stringify({ action: "pause", deviceId })
      }).catch((cause) => {
        if (mode === "web" && isDeviceUnavailable(cause)) {
          commandRef.current = "";
          recoverWebPlayerRef.current();
        } else {
          setError(cause instanceof Error ? cause.message : "Could not pause Spotify playback.");
        }
      });
      return;
    }
    const signature = `${track.id}:${playback.playing}:${playback.position}:${playback.updatedAt}:${deviceId}`;
    if (commandRef.current === signature) return;
    commandRef.current = signature;
    const command = playback.playing
      ? { action: "play", deviceId, spotifyUri, positionMs: targetPositionMs(playback) }
      : { action: "pause", deviceId };
    const sendCommand = () => api("/api/spotify/playback", accessToken, {
      method: "POST",
      body: JSON.stringify(command)
    });
    void sendCommand().catch(async (cause) => {
      if (mode !== "web" || !isDeviceUnavailable(cause)) throw cause;
      try {
        await transferSpotifyPlayback(accessToken, deviceId);
        return await sendCommand();
      } catch (recoveryError) {
        if (!isDeviceUnavailable(recoveryError)) throw recoveryError;
        commandRef.current = "";
        recoverWebPlayerRef.current();
        return null;
      }
    }).then(() => setError("")).catch((cause) => {
      const message = cause instanceof Error ? cause.message : "Spotify playback failed.";
      setError(message);
      if (/connect spotify/i.test(message)) onConnectionLost(message);
    });
  }, [track?.id, mapping?.providerId, playback.playing, playback.position, playback.updatedAt, deviceId, spotifyUri, accessToken, onConnectionLost, activationRevision, mode]);

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
          onStatus({ ready: true, buffering: playback.playing && !sameRecording, currentTime: sameRecording ? currentTime : 0, duration: sameRecording ? duration : 0 });
          if (endTrackerRef.current.observe(`${track.id}:${spotifyUri}`, sameRecording ? currentTime : 0,
            duration, sameRecording && state.paused, playback.playing && isDj)) {
            onEnded();
          }
          return;
        }
        if (mode === "desktop") {
          const payload = await api<{ state?: { is_playing?: boolean; progress_ms?: number; item?: { uri?: string; duration_ms?: number } } | null }>(
            "/api/spotify/playback",
            accessToken
          );
          if (!alive) return;
          const state = payload.state;
          const currentTime = (state?.progress_ms || 0) / 1000;
          const duration = (state?.item?.duration_ms || track.durationMs || 0) / 1000;
          const sameRecording = state?.item?.uri === spotifyUri;
          onStatus({
            ready: Boolean(deviceId),
            buffering: Boolean(playback.playing && !sameRecording),
            currentTime: sameRecording ? currentTime : 0,
            duration: sameRecording ? duration : 0
          });
          if (endTrackerRef.current.observe(`${track.id}:${spotifyUri}`, sameRecording ? currentTime : 0,
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
  }, [track?.id, track?.durationMs, mode, accessToken, deviceId, spotifyUri, playback.playing, isDj, onEnded, onStatus]);

  const activateSpotify = () => {
    const player = playerRef.current;
    if (!player) return;
    setActivating(true);
    setError("");
    void player.activateElement().then(() => {
      setActivationNeeded(false);
      setActivationDismissed(false);
      commandRef.current = "";
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
                Spotify needs one click before Lydman can play audio in this browser. You only need to do this when the browser blocks autoplay.
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
