import { useEffect, useRef, useState } from "react";
import { Music2 } from "lucide-react";
import type { Playback, ProviderTrackMapping } from "../types";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import type { PlayerStatus } from "./YouTubePlayer";

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

let spotifySdkPromise: Promise<NonNullable<Window["Spotify"]>> | null = null;

function loadSpotifySdk() {
  if (window.Spotify) return Promise.resolve(window.Spotify);
  if (spotifySdkPromise) return spotifySdkPromise;
  spotifySdkPromise = new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Spotify player took too long to load.")), 15_000);
    window.onSpotifyWebPlaybackSDKReady = () => {
      window.clearTimeout(timeout);
      if (window.Spotify) resolve(window.Spotify);
      else reject(new Error("Spotify player did not initialize."));
    };
    if (!document.querySelector('script[src="https://sdk.scdn.co/spotify-player.js"]')) {
      const script = document.createElement("script");
      script.src = "https://sdk.scdn.co/spotify-player.js";
      script.async = true;
      script.onerror = () => reject(new Error("Could not load Spotify's web player."));
      document.body.appendChild(script);
    }
  });
  return spotifySdkPromise;
}

async function api<T>(path: string, accessToken: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
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
      if (!/device not found/i.test(error instanceof Error ? error.message : "")) throw error;
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
  onEnded,
  onStatus,
  onConnectionLost
}: {
  playback: Playback;
  mapping?: ProviderTrackMapping;
  mode: "web" | "desktop";
  isDj: boolean;
  volume: number;
  accessToken: string;
  onEnded: () => void;
  onStatus: (status: PlayerStatus) => void;
  onConnectionLost: (message: string) => void;
}) {
  const playerRef = useRef<SpotifySdkPlayer | null>(null);
  const deviceIdRef = useRef("");
  const commandRef = useRef("");
  const endedTrackRef = useRef("");
  const lastProgressRef = useRef(0);
  const [deviceId, setDeviceId] = useState("");
  const [error, setError] = useState("");
  const [activationNeeded, setActivationNeeded] = useState(false);
  const [activationDismissed, setActivationDismissed] = useState(false);
  const [activating, setActivating] = useState(false);
  const [activationRevision, setActivationRevision] = useState(0);
  const track = playback.track;
  const spotifyUri = mapping ? `spotify:track:${mapping.providerId}` : "";

  useEffect(() => {
    let alive = true;
    setError("");
    commandRef.current = "";
    if (mode === "desktop") {
      void api<{ devices?: Array<{ id: string | null; name: string; type: string; is_active: boolean; is_restricted: boolean }> }>(
        "/api/spotify/devices",
        accessToken
      ).then(({ devices = [] }) => {
        if (!alive) return;
        const available = devices.filter((device) => device.id && !device.is_restricted);
        const saved = localStorage.getItem("soundspin-spotify-device-id");
        const selected = available.find((device) => device.id === saved) ||
          available.find((device) => device.is_active && device.type === "Computer") ||
          available.find((device) => device.is_active) ||
          available.find((device) => device.type === "Computer") ||
          available[0];
        if (!selected?.id) throw new Error("Open Spotify on your computer or another device, then try again.");
        localStorage.setItem("soundspin-spotify-device-id", selected.id);
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

    void loadSpotifySdk().then((sdk) => {
      if (!alive) return;
      const player = new sdk.Player({
        name: "SoundSpin Web Player",
        volume: volume / 100,
        getOAuthToken: (callback) => {
          void api<{ accessToken: string }>("/api/spotify/token", accessToken)
            .then(({ accessToken: spotifyToken }) => callback(spotifyToken))
            .catch((cause) => {
              const message = cause instanceof Error ? cause.message : "Spotify authorization expired.";
              setError(message);
              onConnectionLost(message);
            });
        }
      });
      playerRef.current = player;
      player.addListener("ready", ((payload: { device_id: string }) => {
        if (!alive) return;
        deviceIdRef.current = payload.device_id;
        void transferSpotifyPlayback(accessToken, payload.device_id)
          .then(() => {
            if (!alive || deviceIdRef.current !== payload.device_id) return;
            setError("");
            setDeviceId(payload.device_id);
          })
          .catch((cause) => {
            if (!alive) return;
            setError(cause instanceof Error ? cause.message : "Could not activate the SoundSpin Spotify device.");
          });
      }) as (payload: never) => void);
      player.addListener("not_ready", (() => {
        if (alive) {
          deviceIdRef.current = "";
          setDeviceId("");
          setError("The SoundSpin Spotify player went offline.");
        }
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
      player.addListener("autoplay_failed", (() => {
        if (alive) {
          setActivationNeeded(true);
          setActivationDismissed(false);
        }
      }) as (payload: never) => void);
      return player.connect().then((connected) => {
        if (!connected) throw new Error("Spotify could not connect the SoundSpin Web Player.");
      });
    }).catch((cause) => {
      if (alive) setError(cause instanceof Error ? cause.message : "Could not initialize Spotify.");
    });
    return () => {
      alive = false;
      playerRef.current?.removeListener();
      playerRef.current?.disconnect();
      playerRef.current = null;
      deviceIdRef.current = "";
    };
  }, [mode, accessToken, onConnectionLost]);

  useEffect(() => {
    if (mode === "web") {
      void playerRef.current?.setVolume(volume / 100);
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
    if (!deviceId) return;
    if (!track || !mapping) {
      const signature = `idle:${deviceId}:${track?.id || "empty"}`;
      if (commandRef.current === signature) return;
      commandRef.current = signature;
      void api("/api/spotify/playback", accessToken, {
        method: "POST",
        body: JSON.stringify({ action: "pause", deviceId })
      }).catch((cause) => {
        if (!/no active device|device not found/i.test(cause instanceof Error ? cause.message : "")) {
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
      if (mode !== "web" || !/device not found/i.test(cause instanceof Error ? cause.message : "")) throw cause;
      await transferSpotifyPlayback(accessToken, deviceId);
      return sendCommand();
    }).then(() => setError("")).catch((cause) => {
      const message = cause instanceof Error ? cause.message : "Spotify playback failed.";
      setError(message);
      if (/connect spotify/i.test(message)) onConnectionLost(message);
    });
  }, [track?.id, mapping?.providerId, playback.playing, playback.position, playback.updatedAt, deviceId, spotifyUri, accessToken, onConnectionLost, activationRevision, mode]);

  useEffect(() => {
    if (!track || !mapping) return;
    let alive = true;
    const update = async () => {
      try {
        if (mode === "web" && playerRef.current) {
          const state = await playerRef.current.getCurrentState();
          if (!alive || !state) return;
          const currentTime = state.position / 1000;
          const duration = state.duration / 1000;
          onStatus({ ready: true, buffering: false, currentTime, duration });
          if (isDj && state.paused && duration > 0 && lastProgressRef.current >= duration - 2 && endedTrackRef.current !== track.id) {
            endedTrackRef.current = track.id;
            onEnded();
          }
          lastProgressRef.current = currentTime;
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
          onStatus({
            ready: Boolean(deviceId),
            buffering: Boolean(playback.playing && state?.item?.uri !== spotifyUri),
            currentTime,
            duration
          });
          if (isDj && !state?.is_playing && duration > 0 && lastProgressRef.current >= duration - 2 && endedTrackRef.current !== track.id) {
            endedTrackRef.current = track.id;
            onEnded();
          }
          lastProgressRef.current = currentTime;
        }
      } catch {
        // Command errors are surfaced above; transient polling errors are ignored.
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
                Spotify needs one click before SoundSpin can play audio in this browser. You only need to do this when the browser blocks autoplay.
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
