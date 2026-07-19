import { useCallback, useEffect, useRef, useState } from "react";
import type { Playback, ProviderTrackMapping } from "../types";
import type { PlayerStatus } from "./YouTubePlayer";

interface MusicKitInstance {
  isAuthorized?: boolean;
  authorize(): Promise<string>;
  setQueue(options: { song: string }): Promise<unknown>;
  play(): Promise<unknown>;
  pause(): void;
  seekToTime?(seconds: number): Promise<unknown> | void;
  currentPlaybackTime: number;
  currentPlaybackDuration: number;
  playbackState: number | string;
  nowPlayingItem?: { id?: string };
  volume?: number;
}

interface MusicKitGlobal {
  configure(options: { developerToken: string; storefrontId: string; app: { name: string; build: string } }): Promise<unknown> | unknown;
  getInstance(): MusicKitInstance;
}

declare global {
  interface Window { MusicKit?: MusicKitGlobal }
}

let musicKitScriptPromise: Promise<MusicKitGlobal> | null = null;
let configuredMusicKit: Promise<MusicKitInstance> | null = null;

function loadMusicKitScript() {
  if (window.MusicKit) return Promise.resolve(window.MusicKit);
  if (musicKitScriptPromise) return musicKitScriptPromise;
  musicKitScriptPromise = new Promise((resolve, reject) => {
    const ready = () => window.MusicKit ? resolve(window.MusicKit) : reject(new Error("Apple Music did not initialize."));
    document.addEventListener("musickitloaded", ready, { once: true });
    if (!document.querySelector('script[src="https://js-cdn.music.apple.com/musickit/v3/musickit.js"]')) {
      const script = document.createElement("script");
      script.src = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";
      script.async = true;
      script.onerror = () => reject(new Error("Could not load Apple MusicKit."));
      document.body.appendChild(script);
    }
    window.setTimeout(() => {
      if (!window.MusicKit) reject(new Error("Apple Music took too long to load."));
    }, 15_000);
  });
  return musicKitScriptPromise;
}

async function getMusicKit(accessToken: string) {
  if (configuredMusicKit) return configuredMusicKit;
  configuredMusicKit = (async () => {
    const response = await fetch("/api/apple/token", { headers: { Authorization: `Bearer ${accessToken}` } });
    const payload = await response.json() as { developerToken?: string; storefront?: string; error?: string };
    if (!response.ok || !payload.developerToken) throw new Error(payload.error || "Apple Music is not configured.");
    const sdk = await loadMusicKitScript();
    await sdk.configure({
      developerToken: payload.developerToken,
      storefrontId: payload.storefront || "us",
      app: { name: "SoundSpin", build: "1.0.0" }
    });
    return sdk.getInstance();
  })();
  return configuredMusicKit;
}

function targetPosition(playback: Playback) {
  return Math.max(0, playback.position + (playback.playing ? (Date.now() - playback.updatedAt) / 1000 : 0));
}

function reportAppleAuthorization(authorized: boolean) {
  localStorage.setItem("soundspin-apple-authorized", String(authorized));
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
  const endedTrackRef = useRef("");
  const lastProgressRef = useRef(0);
  const [authorized, setAuthorized] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const track = playback.track;

  useEffect(() => {
    if (error) onError?.(error);
  }, [error, onError]);

  useEffect(() => {
    let alive = true;
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
    return () => { alive = false; };
  }, [accessToken]);

  const authorize = useCallback(() => {
    const music = musicRef.current;
    if (!music) return;
    setError("");
    void music.authorize().then(() => {
      setAuthorized(true);
      reportAppleAuthorization(true);
    }).catch((cause) => {
      setError(cause instanceof Error ? cause.message : "Apple Music authorization failed.");
    });
  }, []);

  useEffect(() => {
    if (musicRef.current) musicRef.current.volume = volume / 100;
  }, [volume, ready]);

  useEffect(() => {
    const music = musicRef.current;
    if (!music || !track || !authorized) return;
    const signature = `${track.id}:${playback.playing}:${playback.position}:${playback.updatedAt}:${syncRevision}`;
    if (commandRef.current === signature) return;
    commandRef.current = signature;
    let alive = true;
    void (async () => {
      try {
        if (loadedTrackRef.current !== track.id) {
          await music.setQueue({ song: mapping.providerId });
          if (!alive) return;
          loadedTrackRef.current = track.id;
        }
        await music.seekToTime?.(targetPosition(playback));
        if (!alive) return;
        if (playback.playing) await music.play();
        else music.pause();
        if (alive) setError("");
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : "Apple Music playback failed.");
      }
    })();
    return () => { alive = false; };
  }, [track?.id, playback.playing, playback.position, playback.updatedAt, mapping.providerId, authorized, syncRevision]);

  useEffect(() => {
    if (!track || !authorized) return;
    const interval = window.setInterval(() => {
      const music = musicRef.current;
      if (!music) return;
      const currentTime = Number(music.currentPlaybackTime || 0);
      const duration = Number(music.currentPlaybackDuration || track.durationMs && track.durationMs / 1000 || 0);
      onStatus({ ready: true, buffering: playback.playing && currentTime === 0, currentTime, duration });
      const stopped = music.playbackState === 0 || music.playbackState === 1 || music.playbackState === 8 ||
        music.playbackState === "completed" || music.playbackState === "stopped" || music.playbackState === "ended";
      if (isDj && stopped && duration > 0 && lastProgressRef.current >= duration - 2 && endedTrackRef.current !== track.id) {
        endedTrackRef.current = track.id;
        onEnded();
      }
      lastProgressRef.current = currentTime;
    }, 750);
    return () => window.clearInterval(interval);
  }, [track?.id, track?.durationMs, authorized, playback.playing, isDj, onEnded, onStatus]);

  return (
    <div className="provider-player-shell apple-player-shell">
      <strong>Apple Music in SoundSpin</strong>
      {!authorized ? (
        <button type="button" onClick={authorize} disabled={!ready}>Connect Apple Music</button>
      ) : (
        <small>{error || "Connected and following the room"}</small>
      )}
      {!authorized && error && <small>{error}</small>}
    </div>
  );
}
