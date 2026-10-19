import i18n from "../i18n";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { AlertCircle, CircleHelp, Heart, Info, ThumbsDown, Maximize2, Minimize2, RefreshCw, Settings as SettingsIcon, Volume2, VolumeX } from "lucide-react";
import { PauseIcon, PlayIcon, SkipIcon } from "./Icons";
import { Button } from "./ui/button";
import { Slider } from "./ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { TrackArtwork, trackArtworkUrl } from "./TrackArtwork";
import { TrackDetailsDialog } from "./TrackDetailsDialog";
import { DeferredDialog } from "./DeferredDialog";
import { playbackFeedback, localPlaybackAligned } from "../playback-feedback";
import { providerLabel } from "../music-presentation";
import type { ComponentType } from "react";
import type { SocketReply } from "../socket-request";
import "../styles/playback-qol.css";
import { SoundCloudPlayer } from "./SoundCloudPlayer";
import { SpotifyPlayer } from "./SpotifyPlayer";
import { AppleMusicPlayer } from "./AppleMusicPlayer";
import { resetProviderSession, setProviderAccount } from "../provider-session";
import { YouTubePlayer } from "./YouTubePlayer";
import { MixcloudPlayer } from "./MixcloudPlayer";
import { allowedRoomProviders, roomAllowsProvider } from "../../shared/providers";
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
  const { t } = useTranslation("music");
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
  const currentVote = vibe?.votes[currentUserId];
  currentVoteRef.current = currentVote || 0;
  const addedByCurrentUser = track?.addedBy.id === currentUserId;
  const voteDisabled = addedByCurrentUser || !roomConnected || pending;
  const positiveVotes = votes.filter((vote) => vote === 1).length;
  const negativeVotes = votes.filter((vote) => vote === -1).length;
  const label =
    !votes.length ? (addedByCurrentUser ? t("nowPlaying.rateYourTrack") : t("nowPlaying.waitingReactions")) :
    votes.length === 1 ? t("nowPlaying.firstReaction") :
    sentiment >= .6 ? t("nowPlaying.bangerVerdict") :
    sentiment >= .2 ? t("nowPlaying.positiveVerdict") :
    sentiment <= -.6 ? t("nowPlaying.negativeVerdict") :
    sentiment <= -.2 ? t("nowPlaying.coolingVerdict") :
    t("nowPlaying.splitVerdict");
  const aggregate = useCoalescedDecoration(JSON.stringify([track?.id, sentiment]), decorationsEnabled);
  const [decorativeTrackId, decorativeSentiment] = JSON.parse(aggregate) as [string | null, number];
  // A new track or an empty room must not inherit the previous needle position.
  const needleSentiment = votes.length && decorativeTrackId === track?.id ? decorativeSentiment : sentiment;
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
      if (!result.ok) { requestedVote.current = null; setVoteError(result.error || i18n.t("music:nowPlaying.reactionFailed")); }
      else if (requestedVote.current?.trackId === requestTrackId) { requestedVote.current.acknowledged = true; confirmAccepted(); }
    });
  };

  return (
    <section ref={meterRef} className={`bang-meter ${decorationsEnabled ? "" : "decorations-off"}`} aria-label={t("nowPlaying.meterLabel")}>
      <div className="bang-meter-heading">
        <span>{t("nowPlaying.meterTitle")}</span>
        <small>{t("nowPlaying.reactionCount", { count: votes.length, total: eligibleListenerCount })}</small>
      </div>
      <div
        className={`bang-meter-body ${addedByCurrentUser ? "is-readonly" : ""}`}
        role="group"
        aria-label={addedByCurrentUser ? t("nowPlaying.listenerReactions") : t("nowPlaying.reactLabel")}
      >
      <div className="bang-meter-face">
        <div
          key={track?.id}
          className="bang-gauge"
          data-empty={!votes.length}
          role="img"
          aria-label={t("nowPlaying.reactionSummary", { positive: positiveVotes, negative: negativeVotes })}
        >
          <svg viewBox="0 0 320 112" aria-hidden="true">
            <path className="bang-gauge-arc" d="M 72.99 63.43 A 96 96 0 0 1 247.01 63.43" />
            {Array.from({ length: 11 }, (_, index) => {
              const angle = (-65 + index * 13) * Math.PI / 180;
              return <line
                key={index}
                className={`bang-gauge-tick ${index >= 7 ? "bang-gauge-tick-positive" : ""}`}
                x1={160 + Math.sin(angle) * 89}
                y1={104 - Math.cos(angle) * 89}
                x2={160 + Math.sin(angle) * 96}
                y2={104 - Math.cos(angle) * 96}
              />;
            })}
            <g className="bang-gauge-needle" style={{ transform: `rotate(${needleSentiment * 65}deg)`, opacity: votes.length ? 1 : .3 }}>
              <line x1="160" y1="104" x2="160" y2="28" />
            </g>
            <circle className="bang-gauge-pivot" cx="160" cy="104" r="4" />
          </svg>
          <div className="bang-gauge-scale" aria-hidden="true"><span>{t("nowPlaying.lame")}</span><span>{t("nowPlaying.banger")}</span></div>
        </div>
        <strong className="bang-meter-verdict" aria-live="polite">{label}</strong>
      </div>
        <Tooltip>
          <TooltipTrigger
            render={<button disabled={voteDisabled} />}
            type="button"
            className={`bang-reaction bang-negative ${currentVote === -1 ? "active" : ""} ${acceptedAccent === -1 ? "is-accepted" : ""}`}
            aria-label={t("nowPlaying.voteLame")}
            aria-pressed={currentVote === -1}
            disabled={voteDisabled}
            title={addedByCurrentUser ? t("nowPlaying.ownerVoteTitle") : undefined}
            onClick={() => vote(-1)}
          >
            <ThumbsDown size={20} aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>{t("nowPlaying.lame")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={<button disabled={voteDisabled} />}
            type="button"
            className={`bang-reaction bang-positive ${currentVote === 1 ? "active" : ""} ${acceptedAccent === 1 ? "is-accepted" : ""}`}
            aria-label={t("nowPlaying.voteBanger")}
            aria-pressed={currentVote === 1}
            disabled={voteDisabled}
            title={addedByCurrentUser ? t("nowPlaying.ownerVoteTitle") : undefined}
            onClick={() => vote(1)}
          >
            <Heart size={20} aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>{t("nowPlaying.banger")}</TooltipContent>
        </Tooltip>
      </div>
      {addedByCurrentUser && <small className="bang-owner-note sr-only">{t("nowPlaying.ownerVoteHelp")}</small>}
      {pending && <small role="status">{t("nowPlaying.savingReaction")}</small>}
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
  providerPlayers,
  isolatedPreview = false
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
  /** An offline preview must not change the signed-in listener's provider session. */
  isolatedPreview?: boolean;
}) {
  const { t } = useTranslation("music");
  useEffect(() => {
    if (isolatedPreview) return;
    setProviderAccount(currentUserId); setSpotifyWebStarted(false);
    setConnections({ loaded: false, spotifyConfigured: false, spotifyConnected: false, spotifyProfile: null, appleConfigured: false });
  }, [currentUserId, isolatedPreview]);
  const playback = snapshot.room.playback;
  const track = playback.track;
  const volume = userSettings.playback.defaultVolume;
  const [roomNotificationsMuted] = useRoomNotificationMuted(currentUserId, snapshot.room.id);
  const spotifyEnabled = snapshot.room.settings.spotifyEnabled === true;
  const roomSlug = snapshot.room.id;
  const playbackPreference = !spotifyEnabled && userSettings.playback.preference.startsWith("spotify") ? "source" : userSettings.playback.preference;
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
  const spotifyOperationRef = useRef<AbortController | null>(null);
  accessTokenRef.current = accessToken;
  identityRef.current = identity;
  const Youtube = providerPlayers?.youtube || YouTubePlayer;
  const Soundcloud = providerPlayers?.soundcloud || SoundCloudPlayer;
  const Spotify = providerPlayers?.spotify || SpotifyPlayer;
  const Apple = providerPlayers?.apple || AppleMusicPlayer;
  const Mixcloud = providerPlayers?.mixcloud || MixcloudPlayer;

  useEffect(() => {
    if (isolatedPreview) return;
    if (!spotifyEnabled) { void resetProviderSession("spotify"); setSpotifyWebStarted(false); }
  }, [spotifyEnabled, roomSlug, isolatedPreview]);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);
  useEffect(() => () => connectionRequestRef.current?.abort(), []);
  useEffect(() => {
    spotifyOperationRef.current?.abort(); spotifyOperationRef.current = null;
    return () => { spotifyOperationRef.current?.abort(); spotifyOperationRef.current = null; };
  }, [spotifyEnabled, roomSlug, accessToken]);
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
        setSyncFeedback(i18n.t("music:nowPlaying.syncAligned"));
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
      setSyncFeedback(i18n.t("music:nowPlaying.syncCheck"));
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
    }>("/api/music/connections", { accessToken, headers: { "x-soundspin-room": roomSlug }, signal: controller.signal, errorMessage: i18n.t("music:nowPlaying.connectionsFailed") })
      .then((payload) => {
        if (controller.signal.aborted || !aliveRef.current || accessTokenRef.current !== requestToken) return;
        setConnections({
          loaded: true,
          spotifyConfigured: spotifyEnabled && Boolean(payload.spotify?.configured),
          spotifyConnected: spotifyEnabled && Boolean(payload.spotify?.connected),
          spotifyProfile: spotifyEnabled ? payload.spotify?.profile || null : null,
          appleConfigured: Boolean(payload.apple?.configured)
        });
      })
      .catch(() => {
        if (!controller.signal.aborted && aliveRef.current && accessTokenRef.current === requestToken) setConnectionError(i18n.t("music:nowPlaying.connectionCheckFailed"));
      });
  }, [accessToken, spotifyEnabled, roomSlug]);

  useEffect(loadConnections, [loadConnections]);

  const handleSpotifyConnectionLost = useCallback((message: string) => {
    loadConnections();
    setProviderPlaybackError(message);
  }, [loadConnections]);

  const connectSpotify = useCallback(() => {
    if (!accessToken || !spotifyEnabled || spotifyOperationRef.current) return;
    const controller = new AbortController(); spotifyOperationRef.current = controller;
    void requestJson<{ url?: string }>(`/api/spotify/connect?roomSlug=${encodeURIComponent(roomSlug)}&returnTo=${encodeURIComponent(location.pathname)}`, {
      accessToken, signal: controller.signal, headers: { "x-soundspin-room": roomSlug }, errorMessage: i18n.t("music:nowPlaying.spotifyConnectFailed")
    }).then((payload) => {
      if (controller.signal.aborted || !aliveRef.current || accessTokenRef.current !== accessToken) return;
      if (!payload.url) throw new Error(i18n.t("music:nowPlaying.spotifyConnectFailed"));
      location.assign(payload.url);
    }).catch((error) => { if (!controller.signal.aborted) setPlaybackError(error instanceof Error ? error.message : i18n.t("music:nowPlaying.spotifyConnectFailed")); })
      .finally(() => { if (spotifyOperationRef.current === controller) spotifyOperationRef.current = null; });
  }, [accessToken, spotifyEnabled, roomSlug]);

  const disconnectSpotify = useCallback(() => {
    if (!accessToken || !spotifyEnabled || spotifyOperationRef.current) return;
    const controller = new AbortController(); spotifyOperationRef.current = controller;
    void fetch("/api/spotify/connection", {
      method: "DELETE",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      headers: { Authorization: `Bearer ${accessToken}`, "x-soundspin-room": roomSlug }
    }).then((response) => {
      if (!response.ok) throw new Error(i18n.t("music:nowPlaying.spotifyDisconnectFailed"));
      if (controller.signal.aborted || !aliveRef.current || accessTokenRef.current !== accessToken) return;
      connectionRequestRef.current?.abort();
      void resetProviderSession("spotify");
      setSpotifyWebStarted(false);
      setConnections((current) => ({ ...current, spotifyConnected: false, spotifyProfile: null }));
    }).catch((error) => {
      if (!controller.signal.aborted) setPlaybackError(error instanceof Error ? error.message : i18n.t("music:nowPlaying.spotifyDisconnectFailed"));
    }).finally(() => { if (spotifyOperationRef.current === controller) spotifyOperationRef.current = null; });
  }, [accessToken, spotifyEnabled, roomSlug]);

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
        setPlaybackError(result.error || i18n.t("music:nowPlaying.updateFailed"));
      }
    });
  };

  const update = (playing: boolean) => {
    const position = playback.position + (playback.playing ? (Date.now() - playback.updatedAt) / 1000 : 0);
    runCommand(playing ? i18n.t("music:nowPlaying.starting") : i18n.t("music:nowPlaying.pausing"), "playback:update", { trackId: track?.id, playing, position });
  };

  const commitSeek = (value: number | readonly number[]) => {
    if (!canControlPlayback || !track) return;
    const position = typeof value === "number" ? value : value[0];
    if (!Number.isFinite(position)) return;
    runCommand(i18n.t("music:nowPlaying.seeking"), "playback:update", { trackId: track.id, playing: playback.playing, position });
  };

  const syncPlayback = () => {
    setPlaybackError("");
    setProviderPlaybackError("");
    syncStartedRef.current = Date.now();
    setSyncFeedback(i18n.t("music:nowPlaying.syncRequested"));
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
  const providerName = effectiveProvider ? providerLabel(effectiveProvider) : playbackPreference === "source" ? t("nowPlaying.roomSource") : providerLabel(preferredProvider);
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
    onLocalStateChange?.({ providerName, providerState, audioState, statusText: track ? feedback.text : i18n.t("music:nowPlaying.waitingTrack"), statusTone: feedback.tone, muted: locallyMuted, localVolumeSupported });
  }, [onLocalStateChange, providerName, providerState, audioState, feedback.text, feedback.tone, Boolean(track), locallyMuted, localVolumeSupported]);
  useEffect(() => {
    if (!webPlaybackAllowed) setSpotifyWebStarted(false);
    else if (effectiveProvider === "spotify") setSpotifyWebStarted(true);
    else if (track && playbackPreference !== "spotify-web") setSpotifyWebStarted(false);
  }, [effectiveProvider, playbackPreference, track?.id, webPlaybackAllowed]);

  useEffect(() => {
    if (!providerFallback || !preferredAllowed || !track || !userSettings.notifications.unavailableTrack || unavailableNotifiedTrackRef.current === track.id) return;
    unavailableNotifiedTrackRef.current = track.id;
    notifyWithAttention({ key: `${currentUserId}:${snapshot.room.id}:fallback:${track.id}:${preferredProvider}`, title: i18n.t("music:nowPlaying.fallbackNotification"), body: i18n.t("music:nowPlaying.fallbackNotificationBody", { title: track.title, provider: providerLabel(preferredProvider) }), backgroundOnly: userSettings.notifications.backgroundOnly, muted: roomNotificationsMuted });
  }, [providerFallback, preferredAllowed, preferredProvider, track?.id, track?.title, userSettings.notifications.unavailableTrack, userSettings.notifications.backgroundOnly, roomNotificationsMuted, currentUserId, snapshot.room.id]);

  useEffect(() => {
    const message = localPlaybackError;
    if (!message || !userSettings.notifications.playbackErrors || playbackErrorNotifiedRef.current === message) return;
    playbackErrorNotifiedRef.current = message;
    notifyWithAttention({ key: `${currentUserId}:${snapshot.room.id}:playback-error:${track?.id}:${message}`, title: i18n.t("music:nowPlaying.errorNotification"), body: message, backgroundOnly: userSettings.notifications.backgroundOnly, muted: roomNotificationsMuted });
  }, [localPlaybackError, userSettings.notifications.playbackErrors, userSettings.notifications.backgroundOnly, roomNotificationsMuted, currentUserId, snapshot.room.id, track?.id]);

  return (
    <>
      <section className={`now-playing panel ${compact ? "compact" : ""}`}>
      <div className="now-playing-heading">
        <h2 className="section-kicker">{t("nowPlaying.title")}</h2>
        <Button variant="ghost" size="sm" type="button" onClick={onToggleCompact} title={compact ? t("nowPlaying.focusPlayerTitle") : t("nowPlaying.focusChatTitle")}>
          {compact ? <Maximize2 size={15} /> : <Minimize2 size={15} />}
          <span>{compact ? t("nowPlaying.focusPlayer") : t("nowPlaying.focusChat")}</span>
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
          userId={currentUserId}
          roomSlug={roomSlug}
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
              <TrackArtwork track={track} src={previewArtwork} className="album-art-preview" alt={t("nowPlaying.artwork", { title: track.title })} />
            )}
            {fallbackNeedsApproval ? (
              <div className="provider-player-shell fallback-player-shell">
                <strong>{t("nowPlaying.useRoomSource")}</strong>
                <small>{t("nowPlaying.noMatch", { provider: providerLabel(preferredProvider) })}</small>
                <Button type="button" onClick={() => setFallbackApprovedTrackId(track.id)}>{t("nowPlaying.playWith", { provider: providerLabel(effectiveProvider!) })}</Button>
              </div>
            ) : fallbackSuppressed ? (
              <div className="provider-player-shell fallback-player-shell">
                <strong>{t("nowPlaying.unavailable")}</strong>
                <small>{t("nowPlaying.noMatchPaused", { provider: providerLabel(preferredProvider) })}</small>
                <Button type="button" onClick={() => setFallbackApprovedTrackId(track.id)}>{t("nowPlaying.useForTrack", { provider: providerName })}</Button>
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
                    userId={currentUserId}
                    roomSlug={roomSlug}
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
                  <strong>{t("nowPlaying.connectSpotifyHelp")}</strong>
                  <Button type="button" onClick={connectSpotify} disabled={!connections.spotifyConfigured}>{t("nowPlaying.connectSpotify")}</Button>
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
                userId={currentUserId}
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
                <strong>{t("nowPlaying.noVersion")}</strong>
                <small>{t("nowPlaying.chooseProvider")}</small>
              </div>
            )}
          </div>
          <div className="player-details">
          <div className="current-track">
            <div>
              <div className="current-track-title">
                <h3 title={track.title}>{track.title}</h3>
                <Button ref={detailsButtonRef} variant="ghost" size="icon" className="track-details-action" aria-label={t("nowPlaying.trackDetails")} title={t("nowPlaying.trackDetails")} onClick={() => setDetailsOpen(true)}><Info size={16} /></Button>
              </div>
              <p className="current-track-meta">
                {track.artist && <span className="current-track-artist" title={track.artist}>{track.artist}</span>}
                {track.artist && <span aria-hidden="true">·</span>}
                {track.permalinkUrl ? (
                  <a href={track.permalinkUrl} target="_blank" rel="noreferrer">{providerLabel(track.provider)}</a>
                ) : providerLabel(track.provider)}
              </p>
            </div>
          </div>
          <div className="player-transport">
          <div className="playback-progress">
            {isLive ? <span>{t("nowPlaying.live")}</span> : (
              <>
                <span>{formatPlaybackTime(shownPosition)}</span>
                <Slider
                  min={0}
                  max={Math.max(playerStatus.duration, 1)}
                  step={1}
                  value={[Math.min(shownPosition, Math.max(playerStatus.duration, 1))]}
                  disabled={controlsUnavailable || !playerStatus.duration}
                  aria-label={t("nowPlaying.position")}
                  getAriaValueText={(_formatted, value) => i18n.t("music:nowPlaying.positionValue", { position: formatPlaybackTime(value), duration: formatPlaybackTime(playerStatus.duration) })}
                  onValueChange={(value) => setSeekPreview(typeof value === "number" ? value : value[0])}
                  onValueCommitted={commitSeek}
                />
                <span>{formatPlaybackTime(playerStatus.duration)}</span>
              </>
            )}
          </div>
          <div className="player-controls" role="group" aria-label={t("nowPlaying.controls")}>
            <Button variant="ghost" className="round-button" size="icon" disabled={!roomConnected || syncStartedRef.current !== null} onClick={syncPlayback} aria-label={t("nowPlaying.sync")} title={t("nowPlaying.sync")} aria-busy={syncStartedRef.current !== null}>
              <RefreshCw size={19} />
            </Button>
            <Button disabled={controlsUnavailable} className="round-button primary" size="icon-lg" onClick={() => update(!playback.playing)} aria-label={playback.playing ? t("nowPlaying.pause") : t("nowPlaying.play")} aria-describedby="playback-control-help" aria-busy={Boolean(pendingCommand)}>
              {playback.playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
            </Button>
            <Button variant="ghost" disabled={controlsUnavailable} className="round-button" size="icon" onClick={() => runCommand(i18n.t("music:nowPlaying.skipping"), "queue:next", { trackId: track.id })} aria-label={t("nowPlaying.next")} aria-describedby="playback-control-help">
              <SkipIcon size={20} />
            </Button>
          </div>
          </div>
          <div className="player-utilities">
            <div className="sync-status" data-status={feedback.tone} data-expanded={feedback.tone === "error" || feedback.tone === "pending" || locallyMuted || !playback.playing} role="status" title={feedback.text}>
              <span />{feedback.text}
            </div>
            {providerFallback && <small className="provider-fallback">{t("nowPlaying.fallbackStatus", { context: `${preferredAllowed ? "noMatch" : "disabled"}${fallbackNeedsApproval ? "Awaiting" : fallbackSuppressed ? "Silent" : "Using"}`, preferredProvider: providerLabel(preferredProvider), effectiveProvider: effectiveProvider ? providerLabel(effectiveProvider) : providerName })}</small>}
            <div className="volume-control">
              <Button variant="ghost" size="icon" disabled={!localVolumeSupported} onClick={toggleMute} aria-label={locallyMuted ? t("nowPlaying.unmute") : t("nowPlaying.mute")} aria-pressed={locallyMuted}>{locallyMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}</Button>
              <Slider
                min={0}
                max={100}
                value={[volume]}
                aria-label={t("nowPlaying.volume")}
                disabled={!localVolumeSupported}
                getAriaValueText={(_formatted, value) => i18n.t("music:nowPlaying.percent", { value })}
                onValueChange={(value) => setVolume(typeof value === "number" ? value : value[0])}
              />
            </div>
            {!localVolumeSupported && <small className="playback-control-help">{t("nowPlaying.mixcloudVolume")}</small>}
            <details className="playback-options">
              <summary aria-label={t("nowPlaying.controlsHelp")} title={t("nowPlaying.controlsHelp")}><CircleHelp size={18} aria-hidden="true" /><span>{t("nowPlaying.controlsHelp")}</span></summary>
              <p id="playback-control-help" className="playback-control-help">{!roomConnected ? t("nowPlaying.reconnectHelp") : !localVolumeSupported ? canControlPlayback ? t("nowPlaying.roomControlsHelp") : t("nowPlaying.djControlsHelp") : canControlPlayback ? t("nowPlaying.localVolumeHelp") : t("nowPlaying.djLocalVolumeHelp")}</p>
            </details>
            {onOpenSettings && <Button variant="ghost" size="sm" className="playback-device-action" aria-label={t(playbackPreference === "spotify-desktop" ? "nowPlaying.desktopSettingsLabel" : "nowPlaying.settingsLabel", { provider: providerName })} title={t("nowPlaying.settings")} onClick={onOpenSettings}><SettingsIcon size={18} aria-hidden="true" /><span>{t("nowPlaying.settings")}</span></Button>}
          </div>
          {(pendingCommand || syncFeedback) && <p className="playback-command-feedback" role="status">{pendingCommand || syncFeedback}</p>}
          {localPlaybackError && <div className="playback-recovery" role="alert"><AlertCircle size={16} /><span>{localPlaybackError}</span><Button variant="outline" size="sm" onClick={syncPlayback}>{t("nowPlaying.retry")}</Button>{onOpenSettings && <Button variant="ghost" size="sm" onClick={onOpenSettings}>{t("nowPlaying.generalSettings")}</Button>}</div>}
          {connectionError && <div className="playback-recovery" role="alert"><span>{connectionError}</span><Button variant="outline" size="sm" onClick={loadConnections}>{t("nowPlaying.retryConnection")}</Button></div>}
          </div>
          </div>
          <BangOMeter snapshot={snapshot} currentUserId={currentUserId} roomConnected={roomConnected} requestAction={requestAction} />
          <div className="player-session-actions">
          {snapshot.room.settings.skipVote?.enabled && track.addedBy.id!==currentUserId && <Button variant="outline" size="sm" disabled={!roomConnected||Boolean(pendingCommand)} aria-pressed={snapshot.room.radio?.skipVote.voted??false} onClick={()=>runCommand(i18n.t("music:nowPlaying.savingSkipVote"),"playback:skip-vote",{trackId:track.id,vote:!snapshot.room.radio?.skipVote.voted})}>{snapshot.room.radio?.skipVote.voted?t("nowPlaying.retractSkipVote"):t("nowPlaying.voteSkip")} · {snapshot.room.radio?.skipVote.count??0}/{snapshot.room.radio?.skipVote.required??3}</Button>}
          {snapshot.room.capabilities?.djsPlayback && <Button variant="ghost" size="sm" disabled={!roomConnected||Boolean(pendingCommand)} aria-pressed={snapshot.room.radio?.stopAfterTrackId===track.id} onClick={()=>runCommand(i18n.t("music:nowPlaying.updatingStopAfter"),"playback:stop-after",{enabled:snapshot.room.radio?.stopAfterTrackId!==track.id})}>{snapshot.room.radio?.stopAfterTrackId===track.id?t("nowPlaying.cancelStopAfter"):t("nowPlaying.stopAfter")}</Button>}
          </div>
        </>
      ) : (
        <div className="empty-player">
          <span className="empty-disc"><PlayIcon size={28} /></span>
          <h2>{snapshot.room.radio?.stopped ? t("nowPlaying.stopped") : t("nowPlaying.empty")}</h2>
          {snapshot.room.radio?.stopped ? snapshot.room.capabilities?.djsPlayback&&<Button disabled={!roomConnected||Boolean(pendingCommand)} onClick={()=>runCommand(i18n.t("music:nowPlaying.resuming"),"playback:resume",{})}>{t("nowPlaying.resume")}</Button> : onAddTrack ? <Button type="button" onClick={onAddTrack}>{t("nowPlaying.addTrack")}</Button> : <p>{t("nowPlaying.addTrackHelp")}</p>}
        </div>
      )}
      </section>
      <TrackDetailsDialog track={track} open={detailsOpen} onOpenChange={setDetailsOpen} durationMs={track?.durationMs || playerStatus.duration * 1000} isLive={isLive} returnFocusRef={detailsButtonRef} />
      {settingsOpen && (
        <DeferredDialog title={t("nowPlaying.generalSettings")} load={loadUserSettings} componentProps={{ settings: userSettings, spotifyEnabled, roomSlug, connections, connectionError, onRetryConnections: loadConnections, accessToken, onSettingsChange: onUserSettingsChange, onConnectSpotify: connectSpotify, onDisconnectSpotify: disconnectSpotify, onClose: onCloseSettings }} />
      )}
    </>
  );
}
