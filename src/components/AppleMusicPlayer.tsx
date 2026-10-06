import { useCallback, useEffect, useRef, useState } from "react";
import type { Playback, ProviderTrackMapping } from "../types";
import type { PlayerStatus } from "./YouTubePlayer";
import { createPlayerApiLoader } from "../player-api-loader";
import { PlaybackEndTracker } from "../playback-progress";
import { storeValue } from "../lib/browser-storage";

interface MusicKitInstance {
  isAuthorized?: boolean;
  authorize(): Promise<string>;
  setQueue(options: { song: string }): Promise<unknown>;
  play(): Promise<unknown>;
  pause(): Promise<unknown> | void;
  seekToTime?(seconds: number): Promise<unknown> | void;
  currentPlaybackTime: number;
  currentPlaybackDuration: number;
  playbackState: number | string;
  nowPlayingItem?: { id?: string };
  volume?: number;
}

interface MusicKitGlobal {
  PlaybackStates?: { completed: number; ended: number; stopped: number };
  configure(options: { developerToken: string; storefrontId: string; app: { name: string; build: string } }): Promise<unknown> | unknown;
  getInstance(): MusicKitInstance;
}

declare global {
  interface Window { MusicKit?: MusicKitGlobal }
}

let configuredMusicKit: Promise<MusicKitInstance> | null = null;
let musicKitOwner: object | null = null;
let musicKitCommands: Promise<void> = Promise.resolve();

const loadMusicKitScript = createPlayerApiLoader({
  src: "https://js-cdn.music.apple.com/musickit/v3/musickit.js",
  label: "Apple MusicKit",
  readApi: () => window.MusicKit,
  readyEvent: "musickitloaded"
});

async function getMusicKit(accessToken: string) {
  if (configuredMusicKit) return configuredMusicKit;
  configuredMusicKit = (async () => {
    const response = await fetch("/api/apple/token", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000)
    });
    const payload = await response.json() as { developerToken?: string; storefront?: string; error?: string };
    if (!response.ok || !payload.developerToken) throw new Error(payload.error || "Apple Music is not configured.");
    const sdk = await loadMusicKitScript();
    await sdk.configure({
      developerToken: payload.developerToken,
      storefrontId: payload.storefront || "us",
      app: { name: "Lydman", build: "1.0.0" }
    });
    return sdk.getInstance();
  })().catch((cause) => {
    configuredMusicKit = null;
    throw cause;
  });
  return configuredMusicKit;
}

function targetPosition(playback: Playback) {
  return Math.max(0, playback.position + (playback.playing ? (Date.now() - playback.updatedAt) / 1000 : 0));
}

function reportAppleAuthorization(authorized: boolean) {
  storeValue("soundspin-apple-authorized", String(authorized));
  window.dispatchEvent(new Event("soundspin:apple-authorization"));
}

export function AppleMusicPlayer({
  playback,
  syncRevision,
  mapping,
  isDj,
  volume,
  accessToken,
  onEnded,
  onStatus,
  onError
}: {
  playback: Playback;
  syncRevision: number;
  mapping: ProviderTrackMapping;
  isDj: boolean;
  volume: number;
  accessToken: string;
  onEnded: () => void;
  onStatus: (status: PlayerStatus) => void;
  onError?: (message: string) => void;
}) {
  const musicRef = useRef<MusicKitInstance | null>(null);
  const commandRef = useRef("");
  const loadedTrackRef = useRef("");
  const endTrackerRef = useRef(new PlaybackEndTracker());
  const [authorized, setAuthorized] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const track = playback.track;

  useEffect(() => {
    if (error) onError?.(error);
  }, [error, onError]);

  useEffect(() => {
    let alive = true;
    const owner = {};
    musicKitOwner = owner;
    commandRef.current = "";
    loadedTrackRef.current = "";
    setReady(false);
    setError("");
    void getMusicKit(accessToken).then((music) => {
      if (!alive) return;
      musicRef.current = music;
      const isAuthorized = Boolean(music.isAuthorized);
      setAuthorized(isAuthorized);
      reportAppleAuthorization(isAuthorized);
      setReady(true);
    }).catch((cause) => {
      if (alive) setError(cause instanceof Error ? cause.message : "Could not initialize Apple Music.");
    });
    return () => {
      alive = false;
      const music = musicRef.current;
      musicRef.current = null;
      if (musicKitOwner !== owner) return;
      musicKitOwner = null;
      // A provider switch must stop audio after any in-flight queue operation.
      musicKitCommands = musicKitCommands.then(async () => {
        if (!musicKitOwner) await music?.pause();
      }).catch(() => undefined);
    };
  }, [accessToken]);

  const authorize = useCallback(() => {
    const music = musicRef.current;
    if (!music) return;
    setError("");
    void music.authorize().then(() => {
      if (musicRef.current !== music) return;
      setAuthorized(true);
      reportAppleAuthorization(true);
    }).catch((cause) => {
      if (musicRef.current !== music) return;
      setError(cause instanceof Error ? cause.message : "Apple Music authorization failed.");
    });
  }, []);

  useEffect(() => {
    if (musicRef.current) musicRef.current.volume = volume / 100;
  }, [volume, ready]);

  useEffect(() => {
    const music = musicRef.current;
    if (!music || !authorized || !ready) return;
    const trackKey = track ? `${track.id}:${mapping.providerId}` : "";
    const signature = `${trackKey}:${playback.playing}:${playback.position}:${playback.updatedAt}:${syncRevision}`;
    if (commandRef.current === signature) return;
    commandRef.current = signature;
    let alive = true;
    // MusicKit queue writes are asynchronous and cannot be cancelled. Serialize
    // them so a slower old track cannot replace the latest room track.
    musicKitCommands = musicKitCommands.then(async () => {
      if (!alive) return;
      try {
        if (!track) {
          await music.pause();
          loadedTrackRef.current = "";
          return;
        }
        if (loadedTrackRef.current !== trackKey) {
          await music.setQueue({ song: mapping.providerId });
          if (!alive) return;
          loadedTrackRef.current = trackKey;
        }
        await music.seekToTime?.(targetPosition(playback));
        if (!alive) return;
        if (playback.playing) await music.play();
        else await music.pause();
        if (alive) setError("");
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : "Apple Music playback failed.");
      }
    });
    return () => { alive = false; };
  }, [track?.id, playback.playing, playback.position, playback.updatedAt, mapping.providerId, authorized, ready, syncRevision]);

  useEffect(() => {
    if (!track || !authorized) return;
    const interval = window.setInterval(() => {
      const music = musicRef.current;
      if (!music || loadedTrackRef.current !== `${track.id}:${mapping.providerId}`) return;
      const currentTime = Number(music.currentPlaybackTime || 0);
      const duration = Number(music.currentPlaybackDuration || track.durationMs && track.durationMs / 1000 || 0);
      onStatus({ ready: true, buffering: playback.playing && currentTime === 0, currentTime, duration });
      const states = window.MusicKit?.PlaybackStates;
      const stopped = Boolean(states && [states.completed, states.ended, states.stopped].includes(music.playbackState as number)) ||
        music.playbackState === "completed" || music.playbackState === "stopped" || music.playbackState === "ended";
      if (endTrackerRef.current.observe(`${track.id}:${mapping.providerId}`, currentTime, duration, stopped, playback.playing && isDj)) {
        onEnded();
      }
    }, 750);
    return () => window.clearInterval(interval);
  }, [track?.id, track?.durationMs, mapping.providerId, authorized, playback.playing, isDj, onEnded, onStatus]);

  return (
    <div className="provider-player-shell apple-player-shell">
      <strong>Apple Music in Lydman</strong>
      {!authorized ? (
        <button type="button" onClick={authorize} disabled={!ready}>Connect Apple Music</button>
      ) : (
        <small>{error || "Connected and following the room"}</small>
      )}
      {!authorized && error && <small>{error}</small>}
    </div>
  );
}
