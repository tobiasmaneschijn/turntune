import { useCallback, useEffect, useRef, useState } from "react";
import type { ProviderTrackMapping } from "../types";
import { PlaybackCommandLifecycle, playbackTargetPosition, type CheckpointProviderPlaybackProps, type PlaybackCommandLease } from "../provider-playback";
import { createAppleMusicSession } from "../apple-music-session";
import { createPlayerApiLoader } from "../player-api-loader";
import { PlaybackEndTracker } from "../playback-progress";
import { storeValue } from "../lib/browser-storage";
import { requestJson } from "../lib/authenticated-http";

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
  PlaybackStates?: { completed: number; ended: number; stopped: number; playing: number; paused: number };
  configure(options: { developerToken: string; storefrontId: string; app: { name: string; build: string } }): Promise<unknown> | unknown;
  getInstance(): MusicKitInstance;
}

declare global {
  interface Window { MusicKit?: MusicKitGlobal }
}

const musicKitLifecycle = new PlaybackCommandLifecycle();

const loadMusicKitScript = createPlayerApiLoader({
  src: "https://js-cdn.music.apple.com/musickit/v3/musickit.js",
  label: "Apple MusicKit",
  readApi: () => window.MusicKit,
  readyEvent: "musickitloaded"
});

const musicKitSession = createAppleMusicSession<MusicKitInstance>({
  requestToken: async (accessToken) => {
    const payload = await requestJson<{ developerToken?: string; storefront?: string }>("/api/apple/token", {
      accessToken, errorMessage: "Apple Music is not configured."
    });
    if (!payload.developerToken) throw new Error("Apple Music is not configured.");
    return { developerToken: payload.developerToken, storefront: payload.storefront };
  },
  configure: async (payload) => {
    const sdk = await loadMusicKitScript();
    await sdk.configure({
      developerToken: payload.developerToken,
      storefrontId: payload.storefront || "us",
      app: { name: "Lydman", build: "1.0.0" }
    });
    return sdk.getInstance();
  }
});

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
}: CheckpointProviderPlaybackProps & {
  mapping: ProviderTrackMapping;
  accessToken: string;
}) {
  const musicRef = useRef<MusicKitInstance | null>(null);
  const leaseRef = useRef<PlaybackCommandLease | null>(null);
  const commandRef = useRef("");
  const loadedTrackRef = useRef("");
  const endTrackerRef = useRef(new PlaybackEndTracker());
  const accessTokenRef = useRef(accessToken);
  const volumeRef = useRef(volume);
  const onEndedRef = useRef(onEnded);
  const onStatusRef = useRef(onStatus);
  const onErrorRef = useRef(onError);
  const [authorized, setAuthorized] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [sessionRevision, setSessionRevision] = useState(0);
  const track = playback.track;

  accessTokenRef.current = accessToken;
  volumeRef.current = volume;
  onEndedRef.current = onEnded;
  onStatusRef.current = onStatus;
  onErrorRef.current = onError;

  useEffect(() => {
    onErrorRef.current?.(error);
  }, [error]);

  // The app's auth token can refresh while audio is playing. MusicKit owns
  // its own authorization, so refreshing that token must not reset its queue.
  useEffect(() => {
    let alive = true;
    const lease = musicKitLifecycle.claim();
    leaseRef.current = lease;
    commandRef.current = "";
    loadedTrackRef.current = "";
    setReady(false);
    setError("");
    void lease.enqueue(async () => {
      const music = await musicKitSession.get(accessTokenRef.current);
      if (!alive || !lease.current()) return;
      musicRef.current = music;
      music.volume = volumeRef.current / 100;
      const isAuthorized = Boolean(music.isAuthorized);
      setAuthorized(isAuthorized);
      reportAppleAuthorization(isAuthorized);
      setReady(true);
    }).catch((cause) => {
      if (alive) setError(cause instanceof Error ? cause.message : "Could not initialize Apple Music.");
    });
    return () => {
      alive = false;
      musicRef.current = null;
      leaseRef.current = null;
      // Configuration can also finish after unmount; stop its final singleton
      // after the shared queue, unless another adapter has taken ownership.
      void lease.release(async () => { await musicKitSession.current()?.pause(); }).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const lease = leaseRef.current;
    if (!lease || (!ready && syncRevision === 0)) return;
    let alive = true;
    let refreshing = false;
    const renew = () => {
      if (!alive || !lease.current() || refreshing || !musicKitSession.refreshDue()) return;
      refreshing = true;
      void lease.enqueue(async () => {
        const music = await musicKitSession.get(accessTokenRef.current);
        if (!alive || !lease.current()) return;
        if (music !== musicRef.current) {
          musicRef.current = music;
          music.volume = volumeRef.current / 100;
          loadedTrackRef.current = "";
          commandRef.current = "";
          // configure() replaces the v3 singleton. Replay the latest room
          // checkpoint on the new instance after renewal completes.
          setSessionRevision((revision) => revision + 1);
        }
        const isAuthorized = Boolean(music.isAuthorized);
        setAuthorized(isAuthorized);
        reportAppleAuthorization(isAuthorized);
        setReady(true);
        setError("");
      }).catch((cause) => {
        if (alive) setError(cause instanceof Error ? cause.message : "Could not renew Apple Music playback.");
      }).finally(() => { refreshing = false; });
    };
    const wake = () => { if (document.visibilityState !== "hidden") renew(); };
    renew();
    const timer = window.setInterval(renew, 30_000);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [ready, syncRevision]);

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
    const lease = leaseRef.current;
    if (!musicRef.current || !lease || !authorized || !ready) return;
    const trackKey = track ? `${track.id}:${mapping.providerId}` : "";
    const signature = `${trackKey}:${playback.playing}:${playback.position}:${playback.updatedAt}:${syncRevision}:${sessionRevision}`;
    if (commandRef.current === signature) return;
    commandRef.current = signature;
    let alive = true;
    // MusicKit queue writes are asynchronous and cannot be cancelled. Serialize
    // them so a slower old track cannot replace the latest room track.
    void lease.enqueue(async () => {
      if (!alive) return;
      try {
        const music = await musicKitSession.get(accessTokenRef.current);
        if (!alive || !lease.current()) return;
        if (music !== musicRef.current) {
          musicRef.current = music;
          music.volume = volumeRef.current / 100;
          loadedTrackRef.current = "";
        }
        if (!music.isAuthorized) {
          setAuthorized(false);
          reportAppleAuthorization(false);
          return;
        }
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
        await music.seekToTime?.(playbackTargetPosition(playback));
        if (!alive) return;
        if (playback.playing) await music.play();
        else await music.pause();
        if (alive) setError("");
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : "Apple Music playback failed.");
      }
    }).catch((cause) => {
      if (alive) setError(cause instanceof Error ? cause.message : "Apple Music playback failed.");
    });
    return () => { alive = false; };
  }, [track?.id, playback.playing, playback.position, playback.updatedAt, mapping.providerId, authorized, ready, syncRevision, sessionRevision]);

  useEffect(() => {
    if (!track || !authorized) return;
    const interval = window.setInterval(() => {
      const music = musicRef.current;
      if (!music || loadedTrackRef.current !== `${track.id}:${mapping.providerId}`) return;
      const currentTime = Number(music.currentPlaybackTime || 0);
      const duration = Number(music.currentPlaybackDuration || track.durationMs && track.durationMs / 1000 || 0);
      const states = window.MusicKit?.PlaybackStates;
      const playing = states && music.playbackState === states.playing ? true
        : states && music.playbackState === states.paused ? false : undefined;
      onStatusRef.current({ ready: true, buffering: playback.playing && currentTime === 0, currentTime, duration, playing, trackId: track.id });
      const stopped = Boolean(states && [states.completed, states.ended, states.stopped].includes(music.playbackState as number)) ||
        music.playbackState === "completed" || music.playbackState === "stopped" || music.playbackState === "ended";
      if (endTrackerRef.current.observe(`${track.id}:${mapping.providerId}:${playback.position}:${playback.updatedAt}`,
        currentTime, duration, stopped, playback.playing && isDj)) {
        onEndedRef.current();
      }
    }, 750);
    return () => window.clearInterval(interval);
  }, [track?.id, track?.durationMs, mapping.providerId, authorized, playback.playing, playback.position, playback.updatedAt, isDj]);

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
