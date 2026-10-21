import i18n from "../../../i18n";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { AlertCircle, CircleHelp, Heart, Info, ListMusic, ThumbsDown, Maximize2, Minimize2, MoreHorizontal, RefreshCw, Settings as SettingsIcon, Volume2, VolumeX, X } from "lucide-react";
import { PauseIcon, PlayIcon, SkipIcon } from "../../../components/Icons";
import { Button } from "../../../components/ui/button";
import { Slider } from "../../../components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../../../components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../../../components/ui/sheet";
import { TrackArtwork, trackArtworkUrl } from "../../music/components/TrackArtwork";
import { TrackDetailsDialog } from "../../music/components/TrackDetailsDialog";
import { DeferredDialog } from "../../../components/DeferredDialog";
import { playbackFeedback, localPlaybackAligned } from "../playback-feedback";
import { providerLabel } from "../../music/music-presentation";
import type { SocketReply } from "../../../lib/socket-request";
import "../../../styles/playback-qol.css";
import "../../../styles/room-player.css";
import { allowedRoomProviders, PROVIDER_DEFINITIONS } from "../../../../shared/providers";
import type { PlaybackAdapterControls, PlayerStatus } from "../provider-playback";
import type { ProviderPlayerOverrides } from "../provider-registry";
import { playbackProvider } from "../provider-registry";
import { resolvePlaybackSelection } from "../playback-selection";
import { usePlaybackHost } from "../use-playback-host";
import { useProviderConnections } from "../use-provider-connections";
import { socket } from "../../../lib/socket";
import { requestSocketAction } from "../../../lib/socket-request";
import type { RoomSnapshot } from "../../../types";
import type { SoundSpinUserSettings } from "../../settings/user-settings";
import { useCoalescedDecoration, useVisibleDecorations } from "../../../hooks/use-visible-decorations";
import { notifyWithAttention } from "../../../lib/notifications";
import { useRoomNotificationMuted } from "../../rooms/hooks/use-room-notifications";
import { EmptyPlayerDock } from "./EmptyPlayerDock";
import { PlaybackTimeline } from "./PlaybackTimeline";
import { PlaybackVideo } from "./PlaybackVideo";
import { formatPlaybackTime } from "../format-playback-time";
import { useArtworkColor } from "../use-artwork-color";
import { useMediaQuery } from "../../../hooks/use-media-query";
import { LiveReactionFaces } from "./LiveReactionFaces";
import { writeSongDrag, songFromTrack } from "../../music/song-drag";
import type { ChatSongMoment } from "../../chat/song-moments";

const loadUserSettings = () => import("../../settings/UserSettingsDialog").then(module => ({ default: module.UserSettingsDialog }));
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

function BangOMeter({
  snapshot,
  currentUserId,
  roomConnected,
  requestAction,
  compact = false
}: {
  snapshot: RoomSnapshot;
  currentUserId: string;
  roomConnected: boolean;
  requestAction: typeof defaultRequestAction;
  compact?: boolean;
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
    <section ref={meterRef} className={`bang-meter ${compact ? "bang-meter--compact" : ""} ${decorationsEnabled ? "" : "decorations-off"}`} aria-label={t("nowPlaying.meterLabel")}>
      {compact && <span className="sr-only">{t("nowPlaying.reactionSummary", { positive: positiveVotes, negative: negativeVotes })}</span>}
      <div className="bang-meter-heading">
        <span>{t("nowPlaying.meterTitle")}</span>
        <small>{t("nowPlaying.reactionCount", { count: votes.length, total: eligibleListenerCount })}</small>
      </div>
      <div
        className={`bang-meter-body ${addedByCurrentUser ? "is-readonly" : ""}`}
        role="group"
        aria-label={addedByCurrentUser ? t("nowPlaying.listenerReactions") : t("nowPlaying.reactLabel")}
      >
      <LiveReactionFaces scope={`${snapshot.room.id}:${currentUserId}:${track?.id || ""}`}
        votes={Object.fromEntries(Object.entries(vibe?.votes || {}).filter(([userId]) => userId !== track?.addedBy.id))}
        users={snapshot.users} currentUserId={currentUserId} connected={roomConnected} enabled={decorationsEnabled} />
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
            {compact && <span className="bang-reaction-count" aria-hidden="true">{negativeVotes}</span>}
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
            {compact && <span className="bang-reaction-count" aria-hidden="true">{positiveVotes}</span>}
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
  onOpenQueue,
  controlsRef,
  onLocalStateChange,
  requestAction = defaultRequestAction,
  providerPlayers,
  isolatedPreview = false,
  previewReactions = false,
  presentation = "panel",
  songMoments,
  onOpenSongMoment
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
  onOpenQueue?: () => void;
  controlsRef?: Ref<NowPlayingControls>;
  onLocalStateChange?: (state: NowPlayingLocalState) => void;
  requestAction?: (event: string, payload: unknown, reply: (result: SocketReply) => void) => void;
  /** Deterministic adapters can exercise the production player without third-party audio. */
  providerPlayers?: ProviderPlayerOverrides;
  /** An offline preview must not change the signed-in listener's provider session. */
  isolatedPreview?: boolean;
  /** Only the isolated landing walkthrough can reveal reactions below the mini player. */
  previewReactions?: boolean;
  /** Presentation changes never change the provider's owner or mount position. */
  presentation?: "panel" | "dock";
  songMoments?: ChatSongMoment[];
  onOpenSongMoment?: (messageId: string) => void;
}) {
  const { t } = useTranslation("music");
  const playback = snapshot.room.playback;
  const mobile = useMediaQuery("(max-width: 640px)");
  const track = playback.track;
  const volume = userSettings.playback.defaultVolume;
  const [roomNotificationsMuted] = useRoomNotificationMuted(currentUserId, snapshot.room.id);
  const spotifyEnabled = snapshot.room.settings.spotifyEnabled === true;
  const roomSlug = snapshot.room.id;
  const [fallbackApprovedTrackId, setFallbackApprovedTrackId] = useState("");
  const unavailableNotifiedTrackRef = useRef("");
  const playbackErrorNotifiedRef = useRef("");
  const selection = resolvePlaybackSelection({ playback, settings: snapshot.room.settings,
    preference: userSettings.playback.preference, fallback: userSettings.playback.fallback, approvedTrackId: fallbackApprovedTrackId });
  const { preference: playbackPreference, preferredProvider, preferredAllowed, providerFallback, fallbackNeedsApproval, fallbackSuppressed } = selection;
  const effectiveProvider = selection.target?.provider;
  const effectiveMapping = selection.target?.mapping;
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const [playerStatus, setPlayerStatus] = useState<PlayerStatus>({
    ready: false,
    buffering: false,
    currentTime: 0,
    duration: 0
  });
  const adapterControls = useRef<PlaybackAdapterControls>(null);
  const [playbackError, setPlaybackError] = useState("");
  const [providerPlaybackError, setProviderPlaybackError] = useState("");
  const localPlaybackError = playbackError || providerPlaybackError;
  const [pendingCommand, setPendingCommand] = useState("");
  const [syncFeedback, setSyncFeedback] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false);
  const [mobileControlsMounted, setMobileControlsMounted] = useState(false);
  const suppressMobileReturnFocus = useRef(false);
  const [dismissedError, setDismissedError] = useState("");
  const detailsButtonRef = useRef<HTMLButtonElement>(null);
  const dockMenuRef = useRef<HTMLButtonElement>(null);
  const pendingCommandRef = useRef("");
  const syncStartedRef = useRef<number | null>(null);
  const lastAudibleVolumeRef = useRef(volume > 0 ? volume : 80);
  const aliveRef = useRef(true);
  const identity = `${currentUserId}:${snapshot.room.id}:${track?.id || ""}:${playbackPreference}:${effectiveProvider}:${selection.target?.mode}:${effectiveMapping?.providerId}:${allowedRoomProviders(snapshot.room.settings).join(",")}`;
  const identityRef = useRef(identity);
  const statusIdentityRef = useRef("");
  identityRef.current = identity;
  const { connections, connectionError, loadConnections, connectProvider, connectSpotify, disconnectSpotify, handleConnectionLost } = useProviderConnections({
    accessToken, userId: currentUserId, roomSlug, spotifyEnabled, isolatedPreview,
    onPlaybackError: setPlaybackError, onProviderError: setProviderPlaybackError
  });
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);
  useEffect(() => { if (volume > 0) lastAudibleVolumeRef.current = volume; }, [volume]);
  useEffect(() => {
    pendingCommandRef.current = "";
    setPendingCommand("");
    setSeekPreview(null);
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

  const runCommand = (command: string, event: string, payload: unknown) => {
    if (!roomConnected || !canControlPlayback || pendingCommandRef.current || (!track && event !== "playback:resume")) return;
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
    adapterControls.current?.sync();
  };

  const handleEnded = useCallback(() => {
    if (track && isDj && roomConnected) requestAction("playback:ended", { trackId: track.id, revision:playback.revision }, () => {});
  }, [track?.id, playback.revision, isDj, roomConnected, requestAction]);

  const shownPosition = seekPreview ?? playerStatus.currentTime;
  const definition = effectiveProvider ? PROVIDER_DEFINITIONS[effectiveProvider] : undefined;
  const isLive = definition?.supportsLive === true && statusIdentityRef.current === identity && playerStatus.trackId === track?.id && playerStatus.isLive === true;
  const previewArtwork = effectiveMapping?.artworkUrl || (track ? trackArtworkUrl(track) : undefined);
  const checkedProvider = effectiveProvider || preferredProvider;
  const connectionState = playbackProvider(checkedProvider).connectionState?.(connections, accessToken);
  const needsConnection = connectionState === "needs-connection";
  const { persistentPlayer, stagePlayer, videoPlayer, registration } = usePlaybackHost({
    playback, target: selection.target, suppressed: fallbackNeedsApproval || fallbackSuppressed,
    preference: playbackPreference, allowedProviders: allowedRoomProviders(snapshot.room.settings),
    controlsRef: adapterControls, isDj, volume, accessToken, userId: currentUserId, roomSlug,
    settings: userSettings.playback, connections, onConnect: () => connectProvider(checkedProvider),
    onStatus: handleStatus, onError: handleError, onEnded: handleEnded,
    onConnectionLost: handleConnectionLost, players: providerPlayers
  });
  const providerName = effectiveProvider ? providerLabel(effectiveProvider) : playbackPreference === "source" ? t("nowPlaying.roomSource") : providerLabel(preferredProvider);
  const localVolumeSupported = definition?.supportsLocalVolume !== false;
  const locallyMuted = localVolumeSupported && volume === 0;
  const feedback = playbackFeedback({
    connected: roomConnected, roomPlaying: playback.playing, status: playerStatus,
    error: localPlaybackError, provider: providerName, muted: locallyMuted,
    fallback: fallbackNeedsApproval ? "ask" : fallbackSuppressed ? "silent" : undefined,
    needsConnection
  });
  const controlsUnavailable = !canControlPlayback || !roomConnected || Boolean(pendingCommand);
  const providerActionRequired = fallbackNeedsApproval || fallbackSuppressed || needsConnection;
  const playbackNeedsExplanation = !roomConnected || providerActionRequired || !playerStatus.ready || playerStatus.buffering ||
    (typeof playerStatus.playing === "boolean" && playerStatus.playing !== playback.playing);
  const docked = presentation === "dock";
  const mobileDock = docked && mobile;
  const showPreviewReactions = isolatedPreview && mobileDock && previewReactions;
  const openMobileControls = () => { suppressMobileReturnFocus.current = false; setMobileControlsMounted(true); setMobileControlsOpen(true); };
  const openPlaybackSettings = () => { if (mobileDock) setMobileControlsOpen(false); onOpenSettings?.(); };
  const artworkColor = useArtworkColor(`${track?.id || ""}:${track ? trackArtworkUrl(track) || "" : ""}`);
  const errorNoticeKey = `${identity}:${localPlaybackError}:${connectionError}`;
  useEffect(() => { if (!localPlaybackError && !connectionError) setDismissedError(""); }, [localPlaybackError, connectionError]);
  const currentDj = snapshot.users.find(user => user.id === snapshot.room.djUserId);
  const setVolume = (next: number) => onUserSettingsChange({
    ...userSettings, playback: { ...userSettings.playback, defaultVolume: next }
  });
  const toggleMute = () => { if (localVolumeSupported) setVolume(volume === 0 ? lastAudibleVolumeRef.current : 0); };
  const retryLocalPlayback = () => {
    if ((fallbackNeedsApproval || fallbackSuppressed) && track) setFallbackApprovedTrackId(track.id);
    syncPlayback();
  };
  useImperativeHandle(controlsRef, () => ({ toggleMute, retryPlayback: retryLocalPlayback }));
  const providerState: NowPlayingLocalState["providerState"] = connectionError && PROVIDER_DEFINITIONS[checkedProvider].personalSession ? "error" :
    connectionState || (!track ? "idle" : playerStatus.ready ? "ready" : "loading");
  const audioState: NowPlayingLocalState["audioState"] = !track ? "quiet" : locallyMuted ? "muted" : fallbackSuppressed ? "suppressed" :
    Boolean(localPlaybackError) ? "error" : fallbackNeedsApproval || (playback.playing && playerStatus.playing === false) ? "needs-activation" :
    playerStatus.playing === true && !playerStatus.buffering ? "playing" :
    !playback.playing ? "paused" : "loading";
  useEffect(() => {
    onLocalStateChange?.({ providerName, providerState, audioState, statusText: track ? feedback.text : i18n.t("music:nowPlaying.waitingTrack"), statusTone: feedback.tone, muted: locallyMuted, localVolumeSupported });
  }, [onLocalStateChange, providerName, providerState, audioState, feedback.text, feedback.tone, Boolean(track), locallyMuted, localVolumeSupported]);
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

  const commandFeedback = (pendingCommand || syncFeedback) && <p className="playback-command-feedback" role="status">{pendingCommand || syncFeedback}</p>;
  const retryFailedPlayback = () => {
    if (!track && snapshot.room.radio?.stopped && snapshot.room.capabilities?.djsPlayback) {
      runCommand(i18n.t("music:nowPlaying.resuming"), "playback:resume", {});
    } else syncPlayback();
  };
  const recoveryFeedback = (!docked || mobileDock || dismissedError !== errorNoticeKey) && (localPlaybackError || connectionError) && <div className="player-recovery-stack">
    {localPlaybackError && <div className="playback-recovery" role="alert"><AlertCircle size={16} /><span>{localPlaybackError}</span><Button variant="outline" size="sm" onClick={retryFailedPlayback}>{t("nowPlaying.retry")}</Button>{onOpenSettings && <Button variant="ghost" size="sm" onClick={openPlaybackSettings}>{t("nowPlaying.generalSettings")}</Button>}</div>}
    {connectionError && connectionError !== localPlaybackError && <div className="playback-recovery" role="alert"><span>{connectionError}</span><Button variant="outline" size="sm" onClick={loadConnections}>{t("nowPlaying.retryConnection")}</Button></div>}
    {docked && !mobileDock && <Button variant="ghost" size="icon-sm" className="playback-notice-dismiss" aria-label={t("nowPlaying.dismissError", { defaultValue: "Dismiss error" })} onClick={() => setDismissedError(errorNoticeKey)}><X size={16} /></Button>}
  </div>;

  return (
    <>
      <section className={`now-playing panel ${!docked && compact ? "compact" : ""} ${docked ? "now-playing--dock" : ""} ${docked && !track ? "now-playing--empty" : ""} ${showPreviewReactions ? "now-playing--preview-reactions" : ""}`}
        style={docked && track ? artworkColor.style : undefined}
        data-needs-attention={docked ? providerActionRequired || Boolean(localPlaybackError || connectionError) : undefined}>
      {!docked && <div className="now-playing-heading">
        <h2 className="section-kicker">{t("nowPlaying.title")}</h2>
        <Button variant="ghost" size="sm" type="button"
          onClick={onToggleCompact}
          title={compact ? t("nowPlaying.focusPlayerTitle") : t("nowPlaying.focusChatTitle")}>
          {compact ? <Maximize2 size={15} /> : <Minimize2 size={15} />}
          <span>{compact ? t("nowPlaying.focusPlayer") : t("nowPlaying.focusChat")}</span>
        </Button>
      </div>}
      {persistentPlayer}
      {track ? (
        <>
          <div className="now-playing-main">
          <div data-provider={effectiveProvider} className={`track-stage ${registration?.artworkPreview && previewArtwork ? "has-album-art" : ""} ${providerActionRequired ? "requires-action" : ""} ${registration?.stageClassName || ""}`}>
            <TrackArtwork track={track} />
            {registration?.artworkPreview && previewArtwork && (
              <TrackArtwork track={track} src={previewArtwork} artworkSources={effectiveMapping?.artworkSources} className="album-art-preview" alt={t("nowPlaying.artwork", { title: track.title })} />
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
            ) : selection.target ? videoPlayer ? <PlaybackVideo docked={docked}>{videoPlayer}</PlaybackVideo> : stagePlayer : (
              <div className="provider-player-shell">
                <strong>{t("nowPlaying.noVersion")}</strong>
                <small>{t("nowPlaying.chooseProvider")}</small>
              </div>
            )}
          </div>
          <div className="player-details">
          <div className="current-track">
            {docked && <span className="dock-song-drag" draggable={roomConnected}
              title={t("nowPlaying.dragSongToChat")}
              onDragStart={event => {
                if (!roomConnected || !writeSongDrag(event.dataTransfer, snapshot.room.id, songFromTrack(track, playerStatus.currentTime))) event.preventDefault();
              }}><TrackArtwork track={track} compact className="dock-track-artwork" onImageReady={artworkColor.onArtworkReady} /></span>}
            <div className="current-track-copy">
              <div className="current-track-title">
                <h3 title={track.title}>{track.title}</h3>
                <Button ref={detailsButtonRef} variant="ghost" size="icon" className="track-details-action" aria-label={t("nowPlaying.trackDetails")} title={t("nowPlaying.trackDetails")} onClick={() => setDetailsOpen(true)}><Info size={16} /></Button>
              </div>
              <p className="current-track-meta">
                {mobileDock && track.provider !== "audius" ? <span className="current-track-artist" title={track.artist || providerLabel(track.provider)}>{track.artist || providerLabel(track.provider)}</span> : <>
                {track.artist && <span className="current-track-artist" title={track.artist}>{track.artist}</span>}
                {track.artist && <span aria-hidden="true">·</span>}
                {track.permalinkUrl ? (
                  <a href={track.permalinkUrl} target="_blank" rel="noreferrer">{providerLabel(track.provider)}</a>
                ) : providerLabel(track.provider)}</>}
              </p>
              {docked && currentDj && <small className="dock-track-dj">{t("nowPlaying.djBy", { name: currentDj.name, defaultValue: "DJ {{name}}" })}</small>}
            </div>
          </div>
          {mobileDock && onOpenQueue && <Button variant="ghost" size="icon" className="dock-queue-action" aria-label={t("nowPlaying.openQueue")} aria-haspopup="dialog" title={t("nowPlaying.queueCount", { count: snapshot.room.queue.length })} onClick={onOpenQueue}><ListMusic size={20} /></Button>}
          {docked && <div className="dock-player-actions">{mobileDock ? <Button ref={dockMenuRef} variant="ghost" size="icon" aria-label={t("nowPlaying.controls")} title={t("nowPlaying.controls")} aria-haspopup="dialog" aria-expanded={mobileControlsOpen} onClick={openMobileControls}>{localPlaybackError || connectionError || providerActionRequired ? <AlertCircle size={20} /> : <MoreHorizontal size={20} />}</Button> : <DropdownMenu>
            <DropdownMenuTrigger render={<Button ref={dockMenuRef} variant="ghost" size="icon" aria-label={t("nowPlaying.controls")} title={t("nowPlaying.controls")} />}><MoreHorizontal size={18} /></DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="dock-player-menu">
              {onOpenSettings && <DropdownMenuItem onClick={openPlaybackSettings}><SettingsIcon />{t("nowPlaying.settings")}</DropdownMenuItem>}
              <DropdownMenuItem onClick={() => setDetailsOpen(true)}><Info />{t("nowPlaying.trackDetails")}</DropdownMenuItem>
              {localPlaybackError && <DropdownMenuItem onClick={syncPlayback}><RefreshCw />{t("nowPlaying.retry")}</DropdownMenuItem>}
              {connectionError && <DropdownMenuItem onClick={loadConnections}><RefreshCw />{t("nowPlaying.retryConnection")}</DropdownMenuItem>}
              {snapshot.room.settings.skipVote?.enabled && track.addedBy.id !== currentUserId && <DropdownMenuCheckboxItem checked={snapshot.room.radio?.skipVote.voted ?? false} disabled={!roomConnected || Boolean(pendingCommand)} onCheckedChange={() => runCommand(i18n.t("music:nowPlaying.savingSkipVote"), "playback:skip-vote", { trackId: track.id, vote: !snapshot.room.radio?.skipVote.voted })}>{snapshot.room.radio?.skipVote.voted ? t("nowPlaying.retractSkipVote") : t("nowPlaying.voteSkip")} · {snapshot.room.radio?.skipVote.count ?? 0}/{snapshot.room.radio?.skipVote.required ?? 3}</DropdownMenuCheckboxItem>}
              {snapshot.room.capabilities?.djsPlayback && <DropdownMenuCheckboxItem checked={snapshot.room.radio?.stopAfterTrackId === track.id} disabled={!roomConnected || Boolean(pendingCommand)} onCheckedChange={() => runCommand(i18n.t("music:nowPlaying.updatingStopAfter"), "playback:stop-after", { enabled: snapshot.room.radio?.stopAfterTrackId !== track.id })}>{snapshot.room.radio?.stopAfterTrackId === track.id ? t("nowPlaying.cancelStopAfter") : t("nowPlaying.stopAfter")}</DropdownMenuCheckboxItem>}
              <DropdownMenuSeparator />
              {!localPlaybackError && !connectionError && playbackNeedsExplanation && <p className="dock-menu-help">{feedback.text}</p>}
              <p className="dock-menu-help">{!localVolumeSupported ? t("nowPlaying.mixcloudVolume") : !roomConnected ? t("nowPlaying.reconnectHelp") : canControlPlayback ? t("nowPlaying.localVolumeHelp") : t("nowPlaying.djLocalVolumeHelp")}</p>
            </DropdownMenuContent>
          </DropdownMenu>}</div>}
          <div className="player-transport">
          <div className="playback-progress">
            {isLive ? <span>{t("nowPlaying.live")}</span> : (
              <>
                <span>{formatPlaybackTime(shownPosition)}</span>
                <PlaybackTimeline key={identity}
                  duration={playerStatus.duration} value={shownPosition}
                  disabled={controlsUnavailable || !playerStatus.duration}
                  readOnly={docked && !canControlPlayback}
                  label={t("nowPlaying.position")}
                  songMoments={songMoments} onOpenSongMoment={onOpenSongMoment}
                  valueText={value => i18n.t("music:nowPlaying.positionValue", { position: formatPlaybackTime(value), duration: formatPlaybackTime(playerStatus.duration) })}
                  onPreview={value => setSeekPreview(typeof value === "number" ? value : value[0])}
                  onCommit={commitSeek} />
                <span>{formatPlaybackTime(playerStatus.duration)}</span>
              </>
            )}
          </div>
          <div className="player-controls" role="group" aria-label={t("nowPlaying.controls")}>
            <Button variant="ghost" className="round-button dock-sync" size="icon" disabled={!roomConnected || syncStartedRef.current !== null} onClick={syncPlayback} aria-label={t("nowPlaying.sync")} title={t("nowPlaying.sync")} aria-busy={syncStartedRef.current !== null}>
              <RefreshCw size={19} />
            </Button>
            <Button disabled={controlsUnavailable} className="round-button primary" size="icon-lg" onClick={() => update(!playback.playing)} aria-label={playback.playing ? t("nowPlaying.pause") : t("nowPlaying.play")} aria-describedby="playback-control-help" aria-busy={Boolean(pendingCommand)}>
              {playback.playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
            </Button>
            <Button variant="ghost" disabled={controlsUnavailable} className="round-button dock-next" size="icon" onClick={() => runCommand(i18n.t("music:nowPlaying.skipping"), "queue:next", { trackId: track.id })} aria-label={t("nowPlaying.next")} aria-describedby="playback-control-help">
              <SkipIcon size={20} />
            </Button>
          </div>
          </div>
          <div className="player-utilities">
            {(!docked || feedback.tone !== "error") && <div className="sync-status" data-status={feedback.tone} data-expanded={feedback.tone === "error" || feedback.tone === "pending" || locallyMuted || !playback.playing} role="status" title={feedback.text}>
              <span />{feedback.text}
            </div>}
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
            {onOpenSettings && <Button variant="ghost" size="sm" className="playback-device-action" aria-label={t(playbackPreference === "spotify-desktop" ? "nowPlaying.desktopSettingsLabel" : "nowPlaying.settingsLabel", { provider: providerName })} title={t("nowPlaying.settings")} onClick={openPlaybackSettings}><SettingsIcon size={18} aria-hidden="true" /><span>{t("nowPlaying.settings")}</span></Button>}
          </div>
          {!docked && commandFeedback}
          {!docked && recoveryFeedback}
          </div>
          </div>
          {(!mobileDock || showPreviewReactions) && <BangOMeter snapshot={snapshot} currentUserId={currentUserId} roomConnected={roomConnected} requestAction={requestAction} compact={docked} />}
          {!docked && <div className="player-session-actions">
          {snapshot.room.settings.skipVote?.enabled && track.addedBy.id!==currentUserId && <Button variant="outline" size="sm" disabled={!roomConnected||Boolean(pendingCommand)} aria-pressed={snapshot.room.radio?.skipVote.voted??false} onClick={()=>runCommand(i18n.t("music:nowPlaying.savingSkipVote"),"playback:skip-vote",{trackId:track.id,vote:!snapshot.room.radio?.skipVote.voted})}>{snapshot.room.radio?.skipVote.voted?t("nowPlaying.retractSkipVote"):t("nowPlaying.voteSkip")} · {snapshot.room.radio?.skipVote.count??0}/{snapshot.room.radio?.skipVote.required??3}</Button>}
          {snapshot.room.capabilities?.djsPlayback && <Button variant="ghost" size="sm" disabled={!roomConnected||Boolean(pendingCommand)} aria-pressed={snapshot.room.radio?.stopAfterTrackId===track.id} onClick={()=>runCommand(i18n.t("music:nowPlaying.updatingStopAfter"),"playback:stop-after",{enabled:snapshot.room.radio?.stopAfterTrackId!==track.id})}>{snapshot.room.radio?.stopAfterTrackId===track.id?t("nowPlaying.cancelStopAfter"):t("nowPlaying.stopAfter")}</Button>}
          </div>}
        </>
      ) : docked ? <EmptyPlayerDock volume={volume} minimal={mobileDock} onOpenQueue={onOpenQueue} onOpenControls={openMobileControls} controlsOpen={mobileControlsOpen} controlsRef={dockMenuRef} stopped={snapshot.room.radio?.stopped} onResume={snapshot.room.radio?.stopped && snapshot.room.capabilities?.djsPlayback && canControlPlayback ? () => runCommand(i18n.t("music:nowPlaying.resuming"), "playback:resume", {}) : undefined} resumeDisabled={!roomConnected || Boolean(pendingCommand)} /> : (
        <div className="empty-player">
          <span className="empty-disc"><PlayIcon size={28} /></span>
          <h2>{snapshot.room.radio?.stopped ? t("nowPlaying.stopped") : t("nowPlaying.empty")}</h2>
          {snapshot.room.radio?.stopped ? snapshot.room.capabilities?.djsPlayback&&<Button disabled={!roomConnected||Boolean(pendingCommand)} onClick={()=>runCommand(i18n.t("music:nowPlaying.resuming"),"playback:resume",{})}>{t("nowPlaying.resume")}</Button> : onAddTrack ? <Button type="button" onClick={onAddTrack}>{t("nowPlaying.addTrack")}</Button> : <p>{t("nowPlaying.addTrackHelp")}</p>}
        </div>
      )}
      {docked && !mobileDock && commandFeedback}
      {docked && !mobileDock && recoveryFeedback}
      </section>
      {mobileDock && !isolatedPreview && mobileControlsMounted && <Sheet open={mobileControlsOpen} onOpenChange={setMobileControlsOpen}>
        <SheetContent side="bottom" keepMounted className="mobile-playback-controls" finalFocus={() => suppressMobileReturnFocus.current ? false : dockMenuRef.current}>
          <SheetHeader><SheetTitle>{t("nowPlaying.controls")}</SheetTitle></SheetHeader>
          <div className="mobile-playback-controls-body">
            {track && <>
              <div className="playback-progress">
                {isLive ? <span>{t("nowPlaying.live")}</span> : <>
                  <span>{formatPlaybackTime(shownPosition)}</span>
                  <PlaybackTimeline key={identity} duration={playerStatus.duration} value={shownPosition}
                    disabled={controlsUnavailable || !playerStatus.duration} readOnly={!canControlPlayback}
                    label={t("nowPlaying.position")} songMoments={songMoments} onOpenSongMoment={onOpenSongMoment ? messageId => { suppressMobileReturnFocus.current = true; setMobileControlsOpen(false); onOpenSongMoment(messageId); } : undefined}
                    valueText={value => i18n.t("music:nowPlaying.positionValue", { position: formatPlaybackTime(value), duration: formatPlaybackTime(playerStatus.duration) })}
                    onPreview={value => setSeekPreview(typeof value === "number" ? value : value[0])} onCommit={commitSeek} />
                  <span>{formatPlaybackTime(playerStatus.duration)}</span>
                </>}
              </div>
              <div className="mobile-playback-transport" role="group" aria-label={t("nowPlaying.controls")}>
                <Button variant="ghost" size="icon" disabled={!roomConnected || syncStartedRef.current !== null} onClick={syncPlayback} aria-label={t("nowPlaying.sync")} title={t("nowPlaying.sync")} aria-busy={syncStartedRef.current !== null}><RefreshCw size={20} /></Button>
                <Button size="icon" disabled={controlsUnavailable} onClick={() => update(!playback.playing)} aria-label={playback.playing ? t("nowPlaying.pause") : t("nowPlaying.play")} aria-busy={Boolean(pendingCommand)}>{playback.playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />}</Button>
                <Button variant="ghost" size="icon" disabled={controlsUnavailable} onClick={() => runCommand(i18n.t("music:nowPlaying.skipping"), "queue:next", { trackId: track.id })} aria-label={t("nowPlaying.next")}><SkipIcon size={20} /></Button>
              </div>
              <div className="mobile-playback-volume">
                <Button variant="ghost" size="icon" disabled={!localVolumeSupported} onClick={toggleMute} aria-label={locallyMuted ? t("nowPlaying.unmute") : t("nowPlaying.mute")} aria-pressed={locallyMuted}>{locallyMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}</Button>
                <Slider min={0} max={100} value={[volume]} aria-label={t("nowPlaying.volume")} disabled={!localVolumeSupported}
                  getAriaValueText={(_formatted, value) => i18n.t("music:nowPlaying.percent", { value })}
                  onValueChange={value => setVolume(typeof value === "number" ? value : value[0])} />
              </div>
              <p className="mobile-playback-help">{!roomConnected ? t("nowPlaying.reconnectHelp") : !localVolumeSupported ? t("nowPlaying.mixcloudVolume") : canControlPlayback ? t("nowPlaying.localVolumeHelp") : t("nowPlaying.djLocalVolumeHelp")}</p>
              <BangOMeter snapshot={snapshot} currentUserId={currentUserId} roomConnected={roomConnected} requestAction={requestAction} compact />
              {(feedback.tone === "error" || feedback.tone === "pending" || playbackNeedsExplanation) && <p className="mobile-playback-status" role="status">{feedback.text}</p>}
              {(fallbackNeedsApproval || fallbackSuppressed) && <Button variant="outline" onClick={() => setFallbackApprovedTrackId(track.id)}>{t("nowPlaying.useForTrack", { provider: providerName })}</Button>}
              {needsConnection && <Button variant="outline" disabled={!connections.providers[checkedProvider]?.configured} onClick={() => connectProvider(checkedProvider)}>{t("nowPlaying.connectSpotify")}</Button>}
              {commandFeedback}
              {recoveryFeedback}
              <div className="mobile-playback-actions">
                <Button variant="ghost" onClick={() => { setMobileControlsOpen(false); setDetailsOpen(true); }}><Info size={18} />{t("nowPlaying.trackDetails")}</Button>
                {snapshot.room.settings.skipVote?.enabled && track.addedBy.id !== currentUserId && <Button variant="ghost" disabled={!roomConnected || Boolean(pendingCommand)} aria-pressed={snapshot.room.radio?.skipVote.voted ?? false} onClick={() => runCommand(i18n.t("music:nowPlaying.savingSkipVote"), "playback:skip-vote", { trackId: track.id, vote: !snapshot.room.radio?.skipVote.voted })}>{snapshot.room.radio?.skipVote.voted ? t("nowPlaying.retractSkipVote") : t("nowPlaying.voteSkip")} · {snapshot.room.radio?.skipVote.count ?? 0}/{snapshot.room.radio?.skipVote.required ?? 3}</Button>}
                {snapshot.room.capabilities?.djsPlayback && <Button variant="ghost" disabled={!roomConnected || Boolean(pendingCommand)} aria-pressed={snapshot.room.radio?.stopAfterTrackId === track.id} onClick={() => runCommand(i18n.t("music:nowPlaying.updatingStopAfter"), "playback:stop-after", { enabled: snapshot.room.radio?.stopAfterTrackId !== track.id })}>{snapshot.room.radio?.stopAfterTrackId === track.id ? t("nowPlaying.cancelStopAfter") : t("nowPlaying.stopAfter")}</Button>}
              </div>
            </>}
            {!track && snapshot.room.radio?.stopped && snapshot.room.capabilities?.djsPlayback && canControlPlayback && <Button disabled={!roomConnected || Boolean(pendingCommand)} onClick={() => runCommand(i18n.t("music:nowPlaying.resuming"), "playback:resume", {})}>{t("nowPlaying.resume")}</Button>}
            {!track && commandFeedback}
            {!track && recoveryFeedback}
            {onOpenSettings && <Button variant="ghost" className="mobile-playback-settings" onClick={openPlaybackSettings}><SettingsIcon size={18} />{t("nowPlaying.settings")}</Button>}
          </div>
        </SheetContent>
      </Sheet>}
      <TrackDetailsDialog track={track} open={detailsOpen} onOpenChange={setDetailsOpen} durationMs={track?.durationMs || playerStatus.duration * 1000} isLive={isLive} returnFocusRef={docked && mobile ? dockMenuRef : detailsButtonRef} />
      {settingsOpen && (
        <DeferredDialog title={t("nowPlaying.generalSettings")} load={loadUserSettings} componentProps={{ settings: userSettings, spotifyEnabled, roomSlug, connections, connectionError, onRetryConnections: loadConnections, accessToken, onSettingsChange: onUserSettingsChange, onConnectSpotify: connectSpotify, onDisconnectSpotify: disconnectSpotify, onClose: onCloseSettings }} />
      )}
    </>
  );
}
