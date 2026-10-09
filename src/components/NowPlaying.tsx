import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { AlertCircle, Heart, Info, ThumbsDown, Maximize2, Minimize2, RefreshCw, Settings as SettingsIcon, Volume2, VolumeX } from "lucide-react";
import { PauseIcon, PlayIcon, SkipIcon } from "./Icons";
import { Button } from "./ui/button";
import { Slider } from "./ui/slider";
import { TrackArtwork, trackArtworkUrl } from "./TrackArtwork";
import { TrackDetailsDialog } from "./TrackDetailsDialog";
import { DeferredDialog } from "./DeferredDialog";
import { playbackFeedback, localPlaybackAligned } from "../playback-feedback";
import type { ComponentType } from "react";
import type { SocketReply } from "../socket-request";
import "../styles/playback-qol.css";
import { SoundCloudPlayer } from "./SoundCloudPlayer";
import { SpotifyPlayer } from "./SpotifyPlayer";
import { AppleMusicPlayer } from "./AppleMusicPlayer";
import { YouTubePlayer } from "./YouTubePlayer";
import { MixcloudPlayer } from "./MixcloudPlayer";
import { allowedRoomProviders, PROVIDER_LABELS, roomAllowsProvider } from "../../shared/providers";
import type { PlayerStatus } from "../provider-playback";
import { requestJson } from "../lib/authenticated-http";
import { socket } from "../socket";
import { requestSocketAction } from "../socket-request";
import type { Provider, RoomSnapshot } from "../types";
import type { SoundSpinUserSettings } from "../playback-settings";
import { useCoalescedDecoration, useVisibleDecorations } from "../hooks/use-visible-decorations";
import { notifyWithAttention } from "../notifications";
import { useRoomNotificationMuted } from "../hooks/use-room-notifications";

const loadUserSettings = () => import("./UserSettingsDialog").then(module => ({ default: module.UserSettingsDialog }));
const defaultRequestAction = (event: string, payload: unknown, reply: (result: SocketReply) => void) => requestSocketAction(socket, event, payload, reply);

export interface NowPlayingControls { toggleMute: () => void; retryPlayback: () => void; }
export interface NowPlayingLocalState {
  providerName: string;
  providerState: "ready" | "loading" | "idle" | "error" | "needs-connection" | "unconfigured";
  audioState: "playing" | "paused" | "quiet" | "muted" | "suppressed" | "error" | "needs-activation" | "loading";
  statusText: string;
  statusTone: "error" | "pending" | "quiet" | "live";
  muted: boolean;
  localVolumeSupported?: boolean;
}

function providerLabel(provider: Provider) {
  return PROVIDER_LABELS[provider];
}

function formatPlaybackTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const rounded = Math.floor(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remaining = rounded % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function BangOMeter({
  snapshot,
  currentUserId,
  roomConnected,
  requestAction
}: {
  snapshot: RoomSnapshot;
  currentUserId: string;
  roomConnected: boolean;
  requestAction: typeof defaultRequestAction;
}) {
  const track = snapshot.room.playback.track;
  const [pending, setPending] = useState(false);
  const [voteError, setVoteError] = useState("");
  const meterRef = useRef<HTMLElement>(null);
  const decorationsEnabled = useVisibleDecorations(meterRef);
  const decorationsRef = useRef(decorationsEnabled);
  decorationsRef.current = decorationsEnabled;
  const [acceptedAccent, setAcceptedAccent] = useState<-1 | 1 | 0>(0);
  const requestedVote = useRef<{ trackId: string; value: -1 | 1 | 0; acknowledged: boolean } | null>(null);
  const currentVoteRef = useRef<-1 | 1 | 0>(0);
  const lastAccentAt = useRef(0);
  const pendingRef = useRef(false);
  const activeRef = useRef(true);
  const trackRef = useRef(track?.id);
  trackRef.current = track?.id;
  useEffect(() => { activeRef.current = true; return () => { activeRef.current = false; }; }, []);
  useEffect(() => { pendingRef.current = false; setPending(false); setVoteError(""); requestedVote.current = null; setAcceptedAccent(0); }, [track?.id]);
  const vibe = track && snapshot.room.vibe?.trackId === track.id
    ? snapshot.room.vibe
    : null;
  const eligibleUserIds = new Set(
    snapshot.users
      .filter((user) => user.id !== track?.addedBy.id)
      .map((user) => user.id)
  );
  const votes = Object.entries(vibe?.votes || {})
    .filter(([userId]) => eligibleUserIds.has(userId))
    .map(([, vote]) => vote);
  const eligibleListenerCount = eligibleUserIds.size;
  const sentiment = votes.length
    ? votes.reduce<number>((total, vote) => total + vote, 0) / votes.length
    : 0;
  const participation = eligibleListenerCount
    ? votes.length / eligibleListenerCount
    : 0;
  const currentVote = vibe?.votes[currentUserId];
  currentVoteRef.current = currentVote || 0;
  const addedByCurrentUser = track?.addedBy.id === currentUserId;
  const positiveVotes = votes.filter((vote) => vote === 1).length;
  const negativeVotes = votes.filter((vote) => vote === -1).length;
  const label =
    !votes.length ? (addedByCurrentUser ? "Listeners rate your track" : "Waiting on the room") :
    votes.length === 1 ? "First reaction is in" :
    sentiment >= .6 ? "Certified banger" :
    sentiment >= .2 ? "Room is feeling it" :
    sentiment <= -.6 ? "Not landing" :
    sentiment <= -.2 ? "Cooling off" :
    "Split room";
  const pulseShape = [9, 13, 18, 25, 31, 25, 18, 13, 9];
  const aggregate = useCoalescedDecoration(`${sentiment}:${participation}:${votes.length}`, decorationsEnabled);
  const [decorativeSentiment, decorativeParticipation, decorativeVotes] = aggregate.split(":").map(Number);
  const pulseTone = !decorativeVotes ? "idle" : decorativeSentiment >= .2 ? "positive" : decorativeSentiment <= -.2 ? "negative" : "mixed";
  const confirmAccepted = () => {
    const intent = requestedVote.current;
    if (!intent?.acknowledged || intent.trackId !== trackRef.current || intent.value !== currentVoteRef.current) return;
    requestedVote.current = null;
    if (decorationsRef.current && intent.value !== 0 && Date.now() - lastAccentAt.current > 500) {
      lastAccentAt.current = Date.now(); setAcceptedAccent(intent.value);
    }
  };
  useEffect(() => { confirmAccepted(); }, [currentVote, track?.id, decorationsEnabled]);
  useEffect(() => {
    if (!acceptedAccent || !decorationsEnabled) { setAcceptedAccent(0); return; }
    const timer = window.setTimeout(() => setAcceptedAccent(0), 180);
    return () => window.clearTimeout(timer);
  }, [acceptedAccent, decorationsEnabled]);
  const pulseHeights = pulseShape.map((height, index) => {
    const direction = (index - 4) / 4;
    const lean = 1 + decorativeSentiment * direction * .65;
    const energy = .56 + decorativeParticipation * .44;
    return Math.max(4, Math.round(height * lean * energy));
  });

  const vote = (value: -1 | 1) => {
    if (addedByCurrentUser || !roomConnected || !track || pendingRef.current) return;
    const requestTrackId = track.id;
    pendingRef.current = true;
    setPending(true);
    setVoteError("");
    requestedVote.current = { trackId: requestTrackId, value: currentVote === value ? 0 : value, acknowledged: false };
    requestAction("vibe:vote", { trackId: requestTrackId, value: currentVote === value ? 0 : value }, (result) => {
      if (!activeRef.current || trackRef.current !== requestTrackId) return;
      pendingRef.current = false;
      setPending(false);
      if (!result.ok) { requestedVote.current = null; setVoteError(result.error || "Could not save your reaction. Try again."); }
      else if (requestedVote.current?.trackId === requestTrackId) { requestedVote.current.acknowledged = true; confirmAccepted(); }
    });
  };

  return (
    <section ref={meterRef} className={`bang-meter ${decorationsEnabled ? "" : "decorations-off"}`} aria-label="Bang-O-Meter for the current track">
      <div className="bang-meter-heading">
        <span>Bang-O-Meter</span>
        <small>{votes.length} of {eligibleListenerCount} reacted</small>
      </div>
      <div
        className={`bang-meter-body ${addedByCurrentUser ? "is-readonly" : ""}`}
        role="group"
        aria-label={addedByCurrentUser ? "Listener reactions" : "React to the current track"}
      >
        <button
          type="button"
          className={`bang-reaction bang-negative ${currentVote === -1 ? "active" : ""} ${acceptedAccent === -1 ? "is-accepted" : ""}`}
          aria-pressed={currentVote === -1}
          disabled={addedByCurrentUser || !roomConnected || pending}
          title={addedByCurrentUser ? "Only listeners can react to a track you added" : undefined}
          onClick={() => vote(-1)}
        >
          <ThumbsDown size={16} />
          <span>Not it</span>
          <strong>{negativeVotes}</strong>
        </button>
        <div className="bang-pulse-summary">
          <div
            className={`bang-pulse bang-pulse-${pulseTone}`}
            style={{ opacity: decorativeVotes ? .58 + decorativeParticipation * .42 : .3 }}
            aria-hidden="true"
          >
            {pulseHeights.map((height, index) => <i key={index} style={{ height: `${height}px` }} />)}
          </div>
          <strong>{label}</strong>
        </div>
        <button
          type="button"
          className={`bang-reaction bang-positive ${currentVote === 1 ? "active" : ""} ${acceptedAccent === 1 ? "is-accepted" : ""}`}
          aria-pressed={currentVote === 1}
          disabled={addedByCurrentUser || !roomConnected || pending}
          title={addedByCurrentUser ? "Only listeners can react to a track you added" : undefined}
          onClick={() => vote(1)}
        >
          <Heart size={16} />
          <span>Love it</span>
          <strong>{positiveVotes}</strong>
        </button>
      </div>
      {addedByCurrentUser && <small className="bang-owner-note sr-only">Only other listeners can react to your track.</small>}
      {pending && <small role="status">Saving your reaction…</small>}
      {voteError && <small role="alert">{voteError}</small>}
    </section>
  );
}

export function NowPlaying({
  snapshot,
  isDj,
  canControlPlayback,
  currentUserId,
  accessToken,
  compact,
  onToggleCompact,
  settingsOpen,
  onCloseSettings,
  userSettings,
  onUserSettingsChange,
  roomConnected = true,
  onOpenSettings,
  onAddTrack,
  controlsRef,
  onLocalStateChange,
  requestAction = defaultRequestAction,
  providerPlayers
}: {
  snapshot: RoomSnapshot;
  isDj: boolean;
  canControlPlayback: boolean;
  currentUserId: string;
  accessToken?: string;
  compact: boolean;
  onToggleCompact: () => void;
  settingsOpen: boolean;
  onCloseSettings: () => void;
  userSettings: SoundSpinUserSettings;
  onUserSettingsChange: (settings: SoundSpinUserSettings) => void;
  roomConnected?: boolean;
  onOpenSettings?: () => void;
  onAddTrack?: () => void;
  controlsRef?: Ref<NowPlayingControls>;
  onLocalStateChange?: (state: NowPlayingLocalState) => void;
  requestAction?: (event: string, payload: unknown, reply: (result: SocketReply) => void) => void;
  /** Deterministic adapters can exercise the production player without third-party audio. */
  providerPlayers?: Partial<{
    youtube: ComponentType<React.ComponentProps<typeof YouTubePlayer>>;
    soundcloud: ComponentType<React.ComponentProps<typeof SoundCloudPlayer>>;
    spotify: ComponentType<React.ComponentProps<typeof SpotifyPlayer>>;
    apple: ComponentType<React.ComponentProps<typeof AppleMusicPlayer>>;
    mixcloud: ComponentType<React.ComponentProps<typeof MixcloudPlayer>>;
  }>;
}) {
  const playback = snapshot.room.playback;
  const track = playback.track;
  const volume = userSettings.playback.defaultVolume;
  const [roomNotificationsMuted] = useRoomNotificationMuted(currentUserId, snapshot.room.id);
  const playbackPreference = userSettings.playback.preference;
  const [spotifyWebStarted, setSpotifyWebStarted] = useState(false);
  const [fallbackApprovedTrackId, setFallbackApprovedTrackId] = useState("");
  const unavailableNotifiedTrackRef = useRef("");
  const playbackErrorNotifiedRef = useRef("");
  const [connections, setConnections] = useState({
    loaded: false,
    spotifyConfigured: false,
    spotifyConnected: false,
    spotifyProfile: null as { displayName: string; product?: string } | null,
    appleConfigured: false
  });
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const [playerStatus, setPlayerStatus] = useState<PlayerStatus>({
    ready: false,
    buffering: false,
    currentTime: 0,
    duration: 0
  });
  const [syncRevision, setSyncRevision] = useState(0);
  const [playbackError, setPlaybackError] = useState("");
  const [providerPlaybackError, setProviderPlaybackError] = useState("");
  const localPlaybackError = playbackError || providerPlaybackError;
  const [connectionError, setConnectionError] = useState("");
  const [pendingCommand, setPendingCommand] = useState("");
  const [syncFeedback, setSyncFeedback] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsButtonRef = useRef<HTMLButtonElement>(null);
  const pendingCommandRef = useRef("");
  const syncStartedRef = useRef<number | null>(null);
  const lastAudibleVolumeRef = useRef(volume > 0 ? volume : 80);
  const aliveRef = useRef(true);
  const identity = `${snapshot.room.id}:${track?.id || ""}:${playbackPreference}:${allowedRoomProviders(snapshot.room.settings).join(",")}`;
  const identityRef = useRef(identity);
  const statusIdentityRef = useRef("");
  const accessTokenRef = useRef(accessToken);
  const connectionRequestRef = useRef<AbortController | null>(null);
  accessTokenRef.current = accessToken;
  identityRef.current = identity;
  const Youtube = providerPlayers?.youtube || YouTubePlayer;
  const Soundcloud = providerPlayers?.soundcloud || SoundCloudPlayer;
  const Spotify = providerPlayers?.spotify || SpotifyPlayer;
  const Apple = providerPlayers?.apple || AppleMusicPlayer;
  const Mixcloud = providerPlayers?.mixcloud || MixcloudPlayer;

  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);
  useEffect(() => () => connectionRequestRef.current?.abort(), []);
  useEffect(() => { if (volume > 0) lastAudibleVolumeRef.current = volume; }, [volume]);
  useEffect(() => {
    pendingCommandRef.current = "";
    setPendingCommand("");
    setProviderPlaybackError("");
    syncStartedRef.current = null;
    setSyncFeedback("");
    if (statusIdentityRef.current !== identity) setPlayerStatus({ ready: false, buffering: false, currentTime: 0, duration: 0 });
  }, [identity]);

  const handleStatus = useCallback((status: PlayerStatus) => {
    if (!aliveRef.current || identityRef.current !== identity || (status.trackId && status.trackId !== track?.id)) return;
    statusIdentityRef.current = identity;
    setPlayerStatus(status);
    if (syncStartedRef.current !== null) {
      const expected = playback.position + (playback.playing ? Math.max(0, Date.now() - playback.updatedAt) / 1000 : 0);
      if (localPlaybackAligned(status, playback.playing, expected)) {
        syncStartedRef.current = null;
        setSyncFeedback("Playback aligned with the room");
      }
    }
  }, [identity, playback.position, playback.playing, playback.updatedAt, track?.id]);
  const handleError = useCallback((message: string) => {
    if (aliveRef.current && identityRef.current === identity) setProviderPlaybackError(message);
  }, [identity]);

  useEffect(() => {
    if (!syncFeedback || syncStartedRef.current === null) return;
    const timeout = window.setTimeout(() => {
      syncStartedRef.current = null;
      setSyncFeedback("Sync requested · check your playback or try again");
    }, 8000);
    return () => window.clearTimeout(timeout);
  }, [syncFeedback, identity]);

  useEffect(() => {
    setSeekPreview(null);
  }, [playback.updatedAt, playback.track?.id]);

  useEffect(() => {
    setFallbackApprovedTrackId("");
    setPlaybackError("");
    setProviderPlaybackError("");
    playbackErrorNotifiedRef.current = "";
  }, [playback.track?.id]);

  const loadConnections = useCallback(() => {
    if (!accessToken) return;
    const requestToken = accessToken;
    connectionRequestRef.current?.abort();
    const controller = new AbortController();
    connectionRequestRef.current = controller;
    setConnectionError("");
    void requestJson<{
      spotify?: { configured?: boolean; connected?: boolean; profile?: { displayName: string; product?: string } | null };
      apple?: { configured?: boolean };
    }>("/api/music/connections", { accessToken, signal: controller.signal, errorMessage: "Could not load music connections." })
      .then((payload) => {
        if (!aliveRef.current || accessTokenRef.current !== requestToken) return;
        setConnections({
          loaded: true,
          spotifyConfigured: Boolean(payload.spotify?.configured),
          spotifyConnected: Boolean(payload.spotify?.connected),
          spotifyProfile: payload.spotify?.profile || null,
          appleConfigured: Boolean(payload.apple?.configured)
        });
      })
      .catch(() => {
        if (!controller.signal.aborted && aliveRef.current && accessTokenRef.current === requestToken) setConnectionError("Could not check your music connections. Try again.");
      });
  }, [accessToken]);

  useEffect(loadConnections, [loadConnections]);

  const handleSpotifyConnectionLost = useCallback((message: string) => {
    loadConnections();
    setProviderPlaybackError(message);
  }, [loadConnections]);

  const connectSpotify = useCallback(() => {
    if (!accessToken) return;
    void requestJson<{ url?: string }>(`/api/spotify/connect?returnTo=${encodeURIComponent(location.pathname)}`, {
      accessToken, errorMessage: "Could not connect Spotify."
    }).then((payload) => {
      if (!payload.url) throw new Error("Could not connect Spotify.");
      location.assign(payload.url);
    }).catch((error) => setPlaybackError(error instanceof Error ? error.message : "Could not connect Spotify."));
  }, [accessToken]);

  const disconnectSpotify = useCallback(() => {
    if (!accessToken) return;
    void fetch("/api/spotify/connection", {
      method: "DELETE",
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${accessToken}` }
    }).then((response) => {
      if (!response.ok) throw new Error("Could not disconnect Spotify.");
      setConnections((current) => ({ ...current, spotifyConnected: false, spotifyProfile: null }));
    }).catch((error) => {
      setPlaybackError(error instanceof Error ? error.message : "Could not disconnect Spotify.");
    });
  }, [accessToken]);

  const runCommand = (command: string, event: string, payload: unknown) => {
    if (!roomConnected || !canControlPlayback || pendingCommandRef.current || !track) return;
    pendingCommandRef.current = command;
    setPendingCommand(command);
    setPlaybackError("");
    const requestIdentity = identity;
    requestAction(event, payload, (result) => {
      if (!aliveRef.current || identityRef.current !== requestIdentity) return;
      pendingCommandRef.current = "";
      setPendingCommand("");
      if (!result.ok) {
        setSeekPreview(null);
        setPlaybackError(result.error || "Could not update room playback.");
      }
    });
  };

  const update = (playing: boolean) => {
    const position = playback.position + (playback.playing ? (Date.now() - playback.updatedAt) / 1000 : 0);
    runCommand(playing ? "Starting room…" : "Pausing room…", "playback:update", { trackId: track?.id, playing, position });
  };

  const commitSeek = (value: number | readonly number[]) => {
    if (!canControlPlayback || !track) return;
    const position = typeof value === "number" ? value : value[0];
    if (!Number.isFinite(position)) return;
    runCommand("Seeking room…", "playback:update", { trackId: track.id, playing: playback.playing, position });
  };

  const syncPlayback = () => {
    setPlaybackError("");
    setProviderPlaybackError("");
    syncStartedRef.current = Date.now();
    setSyncFeedback("Sync requested…");
    window.dispatchEvent(new Event("soundspin:playback-sync"));
    setSyncRevision((revision) => revision + 1);
  };

  const handleEnded = useCallback(() => {
    if (track && isDj && roomConnected) requestAction("playback:ended", { trackId: track.id, revision:playback.revision }, () => {});
  }, [track?.id, playback.revision, isDj, roomConnected, requestAction]);

  const shownPosition = seekPreview ?? playerStatus.currentTime;
  const preferredProvider: Provider = playbackPreference.startsWith("spotify")
    ? "spotify"
    : playbackPreference === "apple"
      ? "apple"
      : track?.provider || "youtube";
  const mappedPreferredTrack = track?.mappings?.[preferredProvider];
  const preferredAllowed = roomAllowsProvider(snapshot.room.settings, preferredProvider);
  const sourceAllowed = Boolean(track && roomAllowsProvider(snapshot.room.settings, track.provider));
  const trustedPreferredMapping = preferredAllowed && mappedPreferredTrack && (
    preferredProvider !== "spotify" ||
    track?.provider === "spotify" ||
    mappedPreferredTrack.matchMethod === "isrc" ||
    mappedPreferredTrack.matchMethod === "exact-metadata"
  )
    ? mappedPreferredTrack
    : undefined;
  const preferredMapping = trustedPreferredMapping || (preferredAllowed && track?.provider === preferredProvider
    ? { providerId: track.providerId, permalinkUrl: track.permalinkUrl }
    : undefined);
  const effectiveProvider = preferredMapping ? preferredProvider : sourceAllowed ? track?.provider : undefined;
  const isLive = effectiveProvider === "youtube" && statusIdentityRef.current === identity && playerStatus.trackId === track?.id && playerStatus.isLive === true;
  const effectiveMapping = preferredMapping || (track && sourceAllowed
    ? { providerId: track.providerId, permalinkUrl: track.permalinkUrl, artworkUrl: track.artworkUrl }
    : undefined);
  const previewArtwork = effectiveMapping?.artworkUrl || (track ? trackArtworkUrl(track) : undefined);
  const providerFallback = Boolean(track && effectiveProvider && preferredProvider !== effectiveProvider);
  const fallbackNeedsApproval = providerFallback && preferredAllowed && userSettings.playback.fallback === "ask" && fallbackApprovedTrackId !== track?.id;
  const fallbackIsSilent = providerFallback && preferredAllowed && userSettings.playback.fallback === "silent";
  const fallbackSuppressed = fallbackIsSilent && fallbackApprovedTrackId !== track?.id;
  const spotifyReady = Boolean(accessToken && connections.spotifyConnected);
  const webPlaybackAllowed = playbackPreference !== "spotify-desktop" && playbackPreference !== "apple";
  const keepSpotifyWebMounted = roomAllowsProvider(snapshot.room.settings, "spotify") && spotifyReady && webPlaybackAllowed && (
    effectiveProvider === "spotify" ||
    (!track && spotifyWebStarted)
  );
  const providerName = effectiveProvider ? providerLabel(effectiveProvider) : playbackPreference === "source" ? "Room source" : providerLabel(preferredProvider);
  const localVolumeSupported = effectiveProvider !== "mixcloud";
  const locallyMuted = localVolumeSupported && volume === 0;
  const feedback = playbackFeedback({
    connected: roomConnected, roomPlaying: playback.playing, status: playerStatus,
    error: localPlaybackError, provider: providerName, muted: locallyMuted,
    fallback: fallbackNeedsApproval ? "ask" : fallbackSuppressed ? "silent" : undefined,
    needsConnection: effectiveProvider === "spotify" && !spotifyReady
  });
  const controlsUnavailable = !canControlPlayback || !roomConnected || Boolean(pendingCommand);
  const providerActionRequired = fallbackNeedsApproval || fallbackSuppressed || (effectiveProvider === "spotify" && !spotifyReady);
  const setVolume = (next: number) => onUserSettingsChange({
    ...userSettings, playback: { ...userSettings.playback, defaultVolume: next }
  });
  const toggleMute = () => { if (localVolumeSupported) setVolume(volume === 0 ? lastAudibleVolumeRef.current : 0); };
  const retryLocalPlayback = () => {
    if ((fallbackNeedsApproval || fallbackSuppressed) && track) setFallbackApprovedTrackId(track.id);
    syncPlayback();
  };
  useImperativeHandle(controlsRef, () => ({ toggleMute, retryPlayback: retryLocalPlayback }));
  const checkedProvider = effectiveProvider || preferredProvider;
  const providerState: NowPlayingLocalState["providerState"] = connectionError && (checkedProvider === "spotify" || checkedProvider === "apple") ? "error" :
    checkedProvider === "spotify" && connections.loaded && !connections.spotifyConfigured ? "unconfigured" :
    checkedProvider === "apple" && connections.loaded && !connections.appleConfigured ? "unconfigured" :
    checkedProvider === "spotify" && connections.loaded && !spotifyReady ? "needs-connection" :
    !track ? "idle" : playerStatus.ready ? "ready" : "loading";
  const audioState: NowPlayingLocalState["audioState"] = !track ? "quiet" : locallyMuted ? "muted" : fallbackSuppressed ? "suppressed" :
    Boolean(localPlaybackError) ? "error" : fallbackNeedsApproval || (playback.playing && playerStatus.playing === false) ? "needs-activation" :
    playerStatus.playing === true && !playerStatus.buffering ? "playing" :
    !playback.playing ? "paused" : "loading";
  useEffect(() => {
    onLocalStateChange?.({ providerName, providerState, audioState, statusText: track ? feedback.text : "Waiting for the next track", statusTone: feedback.tone, muted: locallyMuted, localVolumeSupported });
  }, [onLocalStateChange, providerName, providerState, audioState, feedback.text, feedback.tone, Boolean(track), locallyMuted, localVolumeSupported]);
  useEffect(() => {
    if (!webPlaybackAllowed) setSpotifyWebStarted(false);
    else if (effectiveProvider === "spotify") setSpotifyWebStarted(true);
    else if (track && playbackPreference !== "spotify-web") setSpotifyWebStarted(false);
  }, [effectiveProvider, playbackPreference, track?.id, webPlaybackAllowed]);

  useEffect(() => {
    if (!providerFallback || !preferredAllowed || !track || !userSettings.notifications.unavailableTrack || unavailableNotifiedTrackRef.current === track.id) return;
    unavailableNotifiedTrackRef.current = track.id;
    notifyWithAttention({ key: `${currentUserId}:${snapshot.room.id}:fallback:${track.id}:${preferredProvider}`, title: "Playback fallback needed", body: `${track.title} is not available on ${providerLabel(preferredProvider)}.`, backgroundOnly: userSettings.notifications.backgroundOnly, muted: roomNotificationsMuted });
  }, [providerFallback, preferredAllowed, preferredProvider, track?.id, track?.title, userSettings.notifications.unavailableTrack, userSettings.notifications.backgroundOnly, roomNotificationsMuted, currentUserId, snapshot.room.id]);

  useEffect(() => {
    const message = localPlaybackError;
    if (!message || !userSettings.notifications.playbackErrors || playbackErrorNotifiedRef.current === message) return;
    playbackErrorNotifiedRef.current = message;
    notifyWithAttention({ key: `${currentUserId}:${snapshot.room.id}:playback-error:${track?.id}:${message}`, title: "Lydman playback error", body: message, backgroundOnly: userSettings.notifications.backgroundOnly, muted: roomNotificationsMuted });
  }, [localPlaybackError, userSettings.notifications.playbackErrors, userSettings.notifications.backgroundOnly, roomNotificationsMuted, currentUserId, snapshot.room.id, track?.id]);

  return (
    <>
      <section className={`now-playing panel ${compact ? "compact" : ""}`}>
      <div className="now-playing-heading">
        <h2 className="section-kicker">Now playing</h2>
        <Button variant="ghost" size="sm" type="button" onClick={onToggleCompact} title={compact ? "Focus the player" : "Give chat more room"}>
          {compact ? <Maximize2 size={15} /> : <Minimize2 size={15} />}
          <span>{compact ? "Focus player" : "Focus chat"}</span>
        </Button>
      </div>
      {keepSpotifyWebMounted && (
        <Spotify
          playback={playback}
          mapping={effectiveProvider === "spotify" ? effectiveMapping : undefined}
          mode="web"
          isDj={isDj}
          volume={volume}
          accessToken={accessToken!}
          preferredDeviceId={userSettings.playback.spotifyDeviceId}
          resumeAfterReconnect={userSettings.playback.resumeAfterReconnect}
          onEnded={handleEnded}
          onStatus={handleStatus}
          onConnectionLost={handleSpotifyConnectionLost}
          onError={handleError}
        />
      )}
      {track ? (
        <>
          <div className="now-playing-main">
          <div className={`track-stage ${effectiveProvider === "spotify" && previewArtwork ? "has-album-art" : ""} ${providerActionRequired ? "requires-action" : ""} ${effectiveProvider === "mixcloud" ? "has-mixcloud" : ""}`}>
            <TrackArtwork track={track} />
            {effectiveProvider === "spotify" && previewArtwork && (
              <TrackArtwork track={track} src={previewArtwork} className="album-art-preview" alt={`${track.title} album artwork`} />
            )}
            {fallbackNeedsApproval ? (
              <div className="provider-player-shell fallback-player-shell">
                <strong>Use the room source?</strong>
                <small>No {providerLabel(preferredProvider)} match.</small>
                <Button type="button" onClick={() => setFallbackApprovedTrackId(track.id)}>Play with {providerLabel(effectiveProvider!)}</Button>
              </div>
            ) : fallbackSuppressed ? (
              <div className="provider-player-shell fallback-player-shell">
                <strong>Track unavailable</strong>
                <small>No {providerLabel(preferredProvider)} match. Playback on this device is paused.</small>
                <Button type="button" onClick={() => setFallbackApprovedTrackId(track.id)}>Use {providerName} for this track</Button>
              </div>
            ) : effectiveProvider === "spotify" && effectiveMapping ? (
              spotifyReady ? (
                keepSpotifyWebMounted ? null : (
                  <Spotify
                    playback={playback}
                    mapping={effectiveMapping}
                    mode={playbackPreference === "spotify-desktop" ? "desktop" : "web"}
                    isDj={isDj}
                    volume={volume}
                    accessToken={accessToken!}
                    preferredDeviceId={userSettings.playback.spotifyDeviceId}
                    resumeAfterReconnect={userSettings.playback.resumeAfterReconnect}
                    onEnded={handleEnded}
                    onStatus={handleStatus}
                    onConnectionLost={handleSpotifyConnectionLost}
                    onError={handleError}
                  />
                )
              ) : (
                <div className="provider-player-shell spotify-player-shell">
                  <strong>Connect Spotify to listen</strong>
                  <Button type="button" onClick={connectSpotify} disabled={!connections.spotifyConfigured}>Connect Spotify</Button>
                </div>
              )
            ) : effectiveProvider === "apple" && effectiveMapping && accessToken ? (
              <Apple
                playback={playback}
                syncRevision={syncRevision}
                mapping={effectiveMapping}
                isDj={isDj}
                volume={volume}
                accessToken={accessToken}
                onEnded={handleEnded}
                onStatus={handleStatus}
                onError={handleError}
              />
            ) : effectiveProvider === "soundcloud" ? (
              <Soundcloud
                playback={playback}
                syncRevision={syncRevision}
                isDj={isDj}
                volume={volume}
                onEnded={handleEnded}
                onStatus={handleStatus}
                onError={handleError}
              />
            ) : effectiveProvider === "mixcloud" ? (
              <Mixcloud playback={playback} syncRevision={syncRevision} isDj={isDj} volume={volume}
                onEnded={handleEnded} onStatus={handleStatus} onError={handleError} />
            ) : effectiveProvider === "youtube" ? (
              <Youtube
                playback={playback}
                syncRevision={syncRevision}
                isDj={isDj}
                volume={volume}
                accessToken={accessToken}
                // The track ID lets the server reject duplicate/stale ended events.
                onEnded={handleEnded}
                onStatus={handleStatus}
                onError={handleError}
              />
            ) : (
              <div className="provider-player-shell">
                <strong>No playable version is available</strong>
                <small>Choose another playback provider.</small>
              </div>
            )}
          </div>
          <div className="player-details">
          <div className="current-track">
            <div>
              <div className="current-track-title">
                <h3 title={track.title}>{track.title}</h3>
                <Button ref={detailsButtonRef} variant="ghost" size="icon" className="track-details-action" aria-label="Track details" title="Track details" onClick={() => setDetailsOpen(true)}><Info size={16} /></Button>
              </div>
              <p className="current-track-meta">
                {track.artist && <span className="current-track-artist" title={track.artist}>{track.artist}</span>}
                {track.artist && <span aria-hidden="true">·</span>}
                {track.permalinkUrl ? (
                  <a href={track.permalinkUrl} target="_blank" rel="noreferrer">{providerLabel(track.provider)}</a>
                ) : providerLabel(track.provider)}
              </p>
            </div>
            <div className="player-controls">
              <Button disabled={controlsUnavailable} className="round-button primary" size="icon-lg" onClick={() => update(!playback.playing)} aria-label={playback.playing ? "Pause room" : "Play room"} aria-describedby="playback-control-help" aria-busy={Boolean(pendingCommand)}>
                {playback.playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
              </Button>
              <Button variant="outline" className="round-button" size="icon" disabled={!roomConnected || syncFeedback === "Sync requested…"} onClick={syncPlayback} aria-label="Sync playback with room" title="Sync playback with room" aria-busy={syncFeedback === "Sync requested…"}>
                <RefreshCw size={19} />
              </Button>
              <Button variant="outline" disabled={controlsUnavailable} className="round-button" size="icon" onClick={() => runCommand("Skipping track…", "queue:next", { trackId: track.id })} aria-label="Next track" aria-describedby="playback-control-help">
                <SkipIcon size={20} />
              </Button>
            </div>
          </div>
          <div className="playback-progress">
            {isLive ? <span>Live</span> : (
              <>
                <span>{formatPlaybackTime(shownPosition)}</span>
                <Slider
                  min={0}
                  max={Math.max(playerStatus.duration, 1)}
                  step={1}
                  value={[Math.min(shownPosition, Math.max(playerStatus.duration, 1))]}
                  disabled={controlsUnavailable || !playerStatus.duration}
                  aria-label="Playback position"
                  getAriaValueText={(_formatted, value) => `${formatPlaybackTime(value)} of ${formatPlaybackTime(playerStatus.duration)}`}
                  onValueChange={(value) => setSeekPreview(typeof value === "number" ? value : value[0])}
                  onValueCommitted={commitSeek}
                />
                <span>{formatPlaybackTime(playerStatus.duration)}</span>
              </>
            )}
          </div>
          <div className="player-footer">
            <div className="sync-status" data-status={feedback.tone} role="status">
              <span />{feedback.text}
            </div>
            {providerFallback && <small className="provider-fallback">{preferredAllowed ? `No ${providerLabel(preferredProvider)} match` : `${providerLabel(preferredProvider)} is disabled in this room`} · {fallbackNeedsApproval ? "awaiting your choice" : fallbackSuppressed ? "local playback silent" : `using ${providerLabel(effectiveProvider!)}`}</small>}
            <div className="volume-control">
              <Button variant="ghost" size="icon" disabled={!localVolumeSupported} onClick={toggleMute} aria-label={locallyMuted ? "Unmute my audio" : "Mute my audio"} aria-pressed={locallyMuted}>{locallyMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}</Button>
              <Slider
                min={0}
                max={100}
                value={[volume]}
                aria-label="Volume"
                disabled={!localVolumeSupported}
                getAriaValueText={(_formatted, value) => `${value} percent`}
                onValueChange={(value) => setVolume(typeof value === "number" ? value : value[0])}
              />
            </div>
            {!localVolumeSupported && <small className="playback-control-help">Use your device volume for Mixcloud.</small>}
          </div>
          <div className="player-secondary-actions">
            <details className="playback-options">
              <summary>Controls help</summary>
              <p id="playback-control-help" className="playback-control-help">{!roomConnected ? "Reconnect to control playback." : !localVolumeSupported ? canControlPlayback ? "Playback controls affect the room." : "The DJ controls playback." : canControlPlayback ? "Playback controls affect the room. Volume and mute are local." : "The DJ controls playback. Volume and mute are local."}</p>
            </details>
            {onOpenSettings && <Button variant="ghost" size="sm" className="playback-device-action" aria-label={`Playback settings · Playback source: ${providerName}${playbackPreference === "spotify-desktop" ? " Desktop" : ""}`} onClick={onOpenSettings}><SettingsIcon size={14} /> Playback settings</Button>}
          </div>
          {(pendingCommand || syncFeedback) && <p className="playback-command-feedback" role="status">{pendingCommand || syncFeedback}</p>}
          {localPlaybackError && <div className="playback-recovery" role="alert"><AlertCircle size={16} /><span>{localPlaybackError}</span><Button variant="outline" size="sm" onClick={syncPlayback}>Retry playback</Button>{onOpenSettings && <Button variant="ghost" size="sm" onClick={onOpenSettings}>Settings</Button>}</div>}
          {connectionError && <div className="playback-recovery" role="alert"><span>{connectionError}</span><Button variant="outline" size="sm" onClick={loadConnections}>Retry connection check</Button></div>}
          </div>
          </div>
          <BangOMeter snapshot={snapshot} currentUserId={currentUserId} roomConnected={roomConnected} requestAction={requestAction} />
          {snapshot.room.settings.skipVote?.enabled && track.addedBy.id!==currentUserId && <Button variant="outline" size="sm" disabled={!roomConnected||Boolean(pendingCommand)} aria-pressed={snapshot.room.radio?.skipVote.voted??false} onClick={()=>runCommand("Saving skip vote…","playback:skip-vote",{trackId:track.id,vote:!snapshot.room.radio?.skipVote.voted})}>{snapshot.room.radio?.skipVote.voted?"Retract skip vote":"Vote to skip"} · {snapshot.room.radio?.skipVote.count??0}/{snapshot.room.radio?.skipVote.required??3}</Button>}
          {snapshot.room.capabilities?.djsPlayback && <Button variant="ghost" size="sm" disabled={!roomConnected||Boolean(pendingCommand)} aria-pressed={snapshot.room.radio?.stopAfterTrackId===track.id} onClick={()=>runCommand("Updating stop after track…","playback:stop-after",{enabled:snapshot.room.radio?.stopAfterTrackId!==track.id})}>{snapshot.room.radio?.stopAfterTrackId===track.id?"Cancel stop after track":"Stop after this track"}</Button>}
        </>
      ) : (
        <div className="empty-player">
          <span className="empty-disc"><PlayIcon size={28} /></span>
          <h2>{snapshot.room.radio?.stopped ? "Room playback is stopped" : "No track playing"}</h2>
          {snapshot.room.radio?.stopped ? snapshot.room.capabilities?.djsPlayback&&<Button disabled={!roomConnected||Boolean(pendingCommand)} onClick={()=>runCommand("Resuming room…","playback:resume",{})}>Resume room</Button> : onAddTrack ? <Button type="button" onClick={onAddTrack}>Add a track</Button> : <p>Add a track to start playback.</p>}
        </div>
      )}
      </section>
      <TrackDetailsDialog track={track} open={detailsOpen} onOpenChange={setDetailsOpen} durationMs={track?.durationMs || playerStatus.duration * 1000} isLive={isLive} returnFocusRef={detailsButtonRef} />
      {settingsOpen && (
        <DeferredDialog title="Settings" load={loadUserSettings} componentProps={{ settings: userSettings, connections, connectionError, onRetryConnections: loadConnections, accessToken, onSettingsChange: onUserSettingsChange, onConnectSpotify: connectSpotify, onDisconnectSpotify: disconnectSpotify, onClose: onCloseSettings }} />
      )}
    </>
  );
}
