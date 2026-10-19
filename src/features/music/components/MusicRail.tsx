import { useTranslation } from 'react-i18next';
import { type FormEvent, type RefObject, useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Bookmark, Check, ChevronDown, Clock3, ExternalLink, GripVertical, Info, ListMusic, Loader2, LockKeyhole, MoreHorizontal, Plus, Search, Trash2, X } from "lucide-react";
import { Avatar } from "../../../components/Avatar";
import { ParticipantActions } from "../../rooms/components/ParticipantActions";
import { TrackArtwork } from "./TrackArtwork";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "../../../components/ui/input-group";
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "../../../components/ui/empty";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../../../components/ui/dropdown-menu";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../components/ui/tabs";
import { Skeleton } from "../../../components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../../../components/ui/sheet";
import { useMediaQuery } from "../../../hooks/use-media-query";
import { MusicLibraryPanel } from "./MusicLibraryPanel";
import { TrackDetailsDialog } from "./TrackDetailsDialog";
import { libraryTrack, requestPrivateLibrary, type LibraryMutation, type LibraryTrack, type PrivateLibrary, type SavedSet } from "../music-library";
import { storeValue } from "../../../lib/browser-storage";
import { detectMusicProvider, formatTrackDuration, parseMusicLink, providerLabel, readSearchProvider, SEARCH_PROVIDER_STORAGE_KEY, trackSourceUrl, type ProviderSearchResult } from "../music-presentation";
import { socket } from "../../../lib/socket";
import { requestSocketAction, type SocketReply } from "../../../lib/socket-request";
import type { Provider, RoomSnapshot, Track } from "../../../types";
import { allowedRoomProviders, roomAllowsProvider } from "../../../../shared/providers";
import "../../../styles/music-qol.css";

export type MusicRailActionName = "queue:add" | "queue:remove" | "queue:undo" | "queue:set-add" | "queue:move" | "queue:play-next" | "queue:exception" | "queue:exception-request" | "dj:join" | "dj:leave";
export type MusicRailAction = (event: MusicRailActionName, payload: unknown, reply: (result: SocketReply) => void) => void;

export interface MusicRailProps {
  snapshot: RoomSnapshot;
  currentUserId: string;
  accessToken?: string;
  setNotice: (message: string) => void;
  connected?: boolean;
  /** Uses the production socket contract; fixtures can inject an authoritative fake. */
  requestAction?: MusicRailAction;
  controlsRef?: RefObject<MusicRailControls | null>;
}
export interface MusicRailControls { focusSearch: () => void; openQueue: () => void }

interface TrackInput {
  provider: Provider;
  providerId: string;
  title: string;
  artist?: string;
  artworkUrl?: string;
  permalinkUrl?: string;
  durationMs?: number;
}

interface PendingOperation {
  kind: "add" | "resolve" | "dj" | "queue";
  key?: string;
  trackId?: string;
}

const defaultRequestAction: MusicRailAction = (event, payload, reply) => requestSocketAction(socket, event, payload, reply);
const resultKey = (provider: Provider, id: string) => `${provider}:${id}`;
const matchesResult = (track: Track | null, result: Pick<ProviderSearchResult, "provider" | "id">) => Boolean(track && (
  (track.provider === result.provider && track.providerId === result.id) || track.mappings?.[result.provider]?.providerId === result.id
));

function asTrackInput(result: ProviderSearchResult): TrackInput {
  return { provider: result.provider, providerId: result.id, title: result.title, artist: result.artist,
    artworkUrl: result.thumbnail, permalinkUrl: result.permalinkUrl, durationMs: result.durationMs };
}

/** Reset personal rail state on room/account changes, without touching the player. */
export function MusicRail(props: MusicRailProps) {
  return <MusicRailContent key={`${props.snapshot.room.id}:${props.currentUserId}`} {...props} />;
}

function MusicRailContent({ snapshot, currentUserId, accessToken, setNotice, connected = socket.connected, requestAction = defaultRequestAction, controlsRef }: MusicRailProps) {
  const { t, i18n } = useTranslation('music');
  const [tab, setTab] = useState<"history" | "queue" | "library">("queue");
  const [addMusicOpen, setAddMusicOpen] = useState(false);
  const [lineupOpen, setLineupOpen] = useState(false);
  const [saveSetOpen, setSaveSetOpen] = useState(false);
  const narrow = useMediaQuery("(max-width: 640px)");
  const lineupId = useId();
  const djStatusId = useId();
  const linkFormId = useId();
  const roomProviders = allowedRoomProviders(snapshot.room.settings);
  const searchableProviders: Provider[] = roomProviders.filter((candidate) => candidate !== "apple");
  const providerPolicyKey = roomProviders.join(",");
  const [provider, setProvider] = useState<Provider>(() => {
    const preferred = readSearchProvider();
    return searchableProviders.includes(preferred) ? preferred : searchableProviders[0] || "youtube";
  });
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProviderSearchResult[]>([]);
  const [completedQuery, setCompletedQuery] = useState<string | null>(null);
  const [requestedQuery, setRequestedQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [pending, setPending] = useState<PendingOperation | null>(null);
  const [actionError, setActionError] = useState("");
  const [status, setStatusMessage] = useState("");
  const [showQueueLink, setShowQueueLink] = useState(false);
  const setStatus = (message: string, queueAdded = false) => { setStatusMessage(message); setShowQueueLink(queueAdded); };
  const [addAcknowledgements, setAddAcknowledgements] = useState<Record<string, SocketReply>>({});
  const [manualOpen, setManualOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [resolvedTrack, setResolvedTrack] = useState<TrackInput | null>(null);
  const [historyFilter, setHistoryFilter] = useState("");
  const [draggedTrackId, setDraggedTrackId] = useState("");
  const [undoReceipt, setUndoReceipt] = useState<SocketReply["undo"]>();
  const [undoExpired, setUndoExpired] = useState(false);
  const [detailsTrack, setDetailsTrack] = useState<Track | LibraryTrack | null>(null);
  const [privateLibrary, setPrivateLibrary] = useState<PrivateLibrary | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const [importSkipped, setImportSkipped] = useState<Array<{ title: string; reason: string }>>([]);
  const [turnAccent, setTurnAccent] = useState(false);
  const libraryBusyRef = useRef(false);
  const libraryRequestRef = useRef<AbortController | null>(null);
  const previousDjRef = useRef(snapshot.room.djUserId);
  const setImportIntentRef = useRef(new Map<string, string>());
  const detailsReturnFocusRef = useRef<HTMLElement | null>(null);
  const activeRef = useRef(true);
  const snapshotRef = useRef(snapshot);
  const tabRef = useRef(tab);
  const pendingRef = useRef<PendingOperation | null>(null);
  const searchRequestRef = useRef<AbortController | null>(null);
  const resolveRequestRef = useRef<AbortController | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const addMusicReturnFocusRef = useRef<HTMLElement | null>(null);
  const addMusicButtonRef = useRef<HTMLButtonElement>(null);
  const lineupButtonRef = useRef<HTMLButtonElement>(null);
  const djActionButtonRef = useRef<HTMLButtonElement>(null);
  const queueTabRef = useRef<HTMLButtonElement>(null);
  const libraryTabRef = useRef<HTMLButtonElement>(null);
  const saveSetInputRef = useRef<HTMLInputElement>(null);
  const queueSaveFocusRef = useRef(false);
  const queueButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const historyButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  snapshotRef.current = snapshot;
  tabRef.current = tab;

  const openAddMusic = () => {
    if (!addMusicOpen) addMusicReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setAddMusicOpen(true);
    if (addMusicOpen) searchInputRef.current?.focus();
  };
  const openQueue = () => {
    // View queue is a deliberate destination change; return focus to its tab.
    if (addMusicOpen) addMusicReturnFocusRef.current = queueTabRef.current;
    setAddMusicOpen(false);
    setTab("queue");
  };

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      searchRequestRef.current?.abort();
      resolveRequestRef.current?.abort();
      libraryRequestRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    searchRequestRef.current?.abort();
    resolveRequestRef.current?.abort();
    setSearching(false);
    setResults([]);
    setCompletedQuery(null);
    setSearchError("");
    setResolvedTrack(null);
    if (pendingRef.current?.kind === "resolve") {
      pendingRef.current = null;
      setPending(null);
    }
    if (!searchableProviders.includes(provider)) {
      const next = searchableProviders[0] || "youtube";
      setProvider(next);
      if (searchableProviders.length) storeValue(SEARCH_PROVIDER_STORAGE_KEY, next);
    }
  }, [providerPolicyKey]);

  useEffect(() => {
    if (!controlsRef) return;
    const controls = { focusSearch: openAddMusic, openQueue: () => {
      openQueue();
      requestAnimationFrame(() => { if (activeRef.current) queueTabRef.current?.focus({ preventScroll: true }); });
    } };
    controlsRef.current = controls;
    return () => { if (controlsRef.current === controls) controlsRef.current = null; };
  }, [controlsRef, addMusicOpen]);
  useEffect(() => {
    if (previousDjRef.current === snapshot.room.djUserId) return;
    previousDjRef.current = snapshot.room.djUserId;
    if (!snapshot.room.djUserId || document.visibilityState !== "visible") return;
    setTurnAccent(true);
    const timer = setTimeout(() => setTurnAccent(false), 360);
    return () => { clearTimeout(timer); setTurnAccent(false); };
  }, [snapshot.room.djUserId]);
  useEffect(() => {
    setUndoExpired(false);
    if (!undoReceipt) return;
    const offset = snapshotRef.current.serverTime - Date.now();
    const wait = Math.max(0, Math.min(15_000, undoReceipt.expiresAt - Date.now() - offset));
    const timer = setTimeout(() => setUndoExpired(true), wait);
    return () => clearTimeout(timer);
  }, [undoReceipt]);
  useEffect(() => {
    // Keep panel feedback stable while its View queue action may hold focus.
    if (!status || pending || libraryBusy || addMusicOpen) return;
    const timer = setTimeout(() => setStatus(""), 5_000);
    return () => clearTimeout(timer);
  }, [status, pending, libraryBusy, addMusicOpen]);

  const refreshLibrary = async () => {
    if (!accessToken || libraryBusyRef.current) return;
    libraryRequestRef.current?.abort();
    const request = new AbortController();
    libraryRequestRef.current = request;
    setLibraryLoading(true); setLibraryError("");
    try { const library = await requestPrivateLibrary(accessToken, undefined, request.signal); if (activeRef.current && !request.signal.aborted) setPrivateLibrary(library); }
    catch (error) { if (activeRef.current && !request.signal.aborted) setLibraryError(error instanceof Error ? error.message : t('rail.loadLibraryError')); }
    finally { if (activeRef.current && libraryRequestRef.current === request) setLibraryLoading(false); }
  };
  useEffect(() => { if (tab === "library" && !privateLibrary && accessToken) void refreshLibrary(); }, [tab, accessToken]);
  const mutateLibrary = async (mutation: LibraryMutation) => {
    if (!accessToken || libraryBusyRef.current) return false;
    libraryBusyRef.current = true; setLibraryBusy(true); setLibraryError(""); setActionError(""); setStatus(t('rail.savingLibrary'));
    libraryRequestRef.current?.abort(); setLibraryLoading(false);
    const request = new AbortController(); libraryRequestRef.current = request;
    try {
      const library = await requestPrivateLibrary(accessToken, mutation, request.signal);
      if (!activeRef.current || request.signal.aborted) return false;
      setPrivateLibrary(library);
      setStatus(mutation.type === "save-pick" ? t('rail.favoriteSaved', { title: mutation.track.title }) : mutation.type === "save-set" ? t('rail.setSaved', { name: mutation.name }) : t('rail.libraryUpdated'));
      return true;
    } catch (error) {
      if (activeRef.current && !request.signal.aborted) { const message = error instanceof Error ? error.message : t('rail.saveLibraryError'); setLibraryError(message); setActionError(message); setStatus(""); }
      return false;
    } finally { libraryBusyRef.current = false; if (activeRef.current) setLibraryBusy(false); }
  };
  const savePick = (track: Track | LibraryTrack) => void mutateLibrary({ type: "save-pick", track: libraryTrack(track) });
  const isSaved = (track: Track) => Boolean(privateLibrary?.picks.some((pick) => pick.track.provider === track.provider && pick.track.providerId === track.providerId));
  const openTrackDetails = (track: Track | LibraryTrack, focus?: HTMLElement) => { detailsReturnFocusRef.current = focus || (document.activeElement instanceof HTMLElement ? document.activeElement : null); setDetailsTrack(track); };

  // Acknowledgements bridge the interval before the personalized snapshot arrives.
  // Once confirmed there, only authoritative queue/playback state controls the row.
  useEffect(() => {
    const confirmed = Object.keys(addAcknowledgements).filter((key) => {
      const [resultProvider, id] = key.split(":");
      const item = { provider: resultProvider as Provider, id };
      return matchesResult(snapshot.room.playback.track, item) || snapshot.room.queue.some((track) => matchesResult(track, item));
    });
    if (confirmed.length) setAddAcknowledgements((current) => {
      const next = { ...current };
      confirmed.forEach((key) => delete next[key]);
      return next;
    });
  }, [snapshot.room.queue, snapshot.room.playback.track, addAcknowledgements]);

  const joinedDjQueue = snapshot.room.djQueueUserIds.includes(currentUserId);
  const canJoinDjQueue = snapshot.room.capabilities?.joinDj ?? (snapshot.room.settings.djAccess !== "roles" || snapshot.room.ownerUserId === currentUserId ||
    snapshot.room.moderatorUserIds.includes(currentUserId) || snapshot.room.djRoleUserIds.includes(currentUserId));
  const djJoinMessage = snapshot.room.ownStatus?.rulesAccepted===false ? t('rail.acceptRulesFirst') : snapshot.room.ownStatus?.djSuspendedUntil!==undefined ? t('rail.suspensionActive') : snapshot.room.settings.djJoinLocked || snapshot.room.settings.sessionOverrides?.some(s=>s.kind==="dj-lock"&&s.expiresAt>Date.now()) ? t('rail.rotationLocked') : snapshot.room.settings.djCapacity&&snapshot.room.djQueueUserIds.length>=snapshot.room.settings.djCapacity ? t('rail.rotationFull') : t('rail.djRoleRequiredMessage');
  const djJoinLabel = snapshot.room.ownStatus?.rulesAccepted===false ? t('rail.acceptRules') : snapshot.room.ownStatus?.djSuspendedUntil!==undefined ? t('rail.suspended') : snapshot.room.settings.djJoinLocked || snapshot.room.settings.sessionOverrides?.some(s=>s.kind==="dj-lock"&&s.expiresAt>Date.now()) ? t('rail.joinsLocked') : snapshot.room.settings.djCapacity&&snapshot.room.djQueueUserIds.length>=snapshot.room.settings.djCapacity ? t('rail.lineupFull') : t('rail.djRoleRequired');
  const currentDj = snapshot.djUsers.find((user) => user.id === snapshot.room.djUserId);
  const currentDjLabel = currentDj ? currentDj.id === currentUserId ? t('rail.you') : currentDj.name : snapshot.room.playback.origin === "fallback" && snapshot.room.playback.track ? t('rail.roomFallback') : t('rail.noDj');
  const onAirLabel = snapshot.room.radio?.turn && snapshot.room.radio.turn.limit > 1 ? t('rail.songInTurn', { used: snapshot.room.radio.turn.used, limit: snapshot.room.radio.turn.limit }) : t('rail.onAir');
  const upcomingDjs = snapshot.room.djQueueUserIds.filter((id) => id !== snapshot.room.djUserId);
  const detectedProvider = detectMusicProvider(url);
  const filteredHistory = useMemo(() => {
    const filter = historyFilter.trim().toLocaleLowerCase();
    return snapshot.room.history.filter((track) => !filter || `${track.title} ${track.artist || ""}`.toLocaleLowerCase().includes(filter));
  }, [historyFilter, snapshot.room.history]);

  const beginOperation = (operation: PendingOperation) => {
    if (!activeRef.current || pendingRef.current || !connected) return false;
    pendingRef.current = operation;
    setPending(operation);
    setActionError("");
    setStatus("");
    return true;
  };
  const finishOperation = (operation: PendingOperation) => {
    if (pendingRef.current === operation) {
      pendingRef.current = null;
      if (activeRef.current) setPending(null);
    }
  };
  const sendAction = (event: MusicRailActionName, payload?: unknown): Promise<SocketReply> => new Promise((resolve) => {
    try { requestAction(event, payload, resolve); }
    catch { resolve({ ok: false, error: t('rail.sendActionError') }); }
  });
  const showActionError = (message: string) => {
    if (activeRef.current) setActionError(message);
  };

  const enqueueTrack = async (track: TrackInput, origin: "search" | "history" | "link") => {
    if (!roomAllowsProvider(snapshotRef.current.room.settings, track.provider)) return showActionError(t('rail.serviceDisabled', { provider: providerLabel(track.provider) }));
    const operation: PendingOperation = { kind: "add", key: resultKey(track.provider, track.providerId) };
    if (!beginOperation(operation)) return;
    try {
      const response = await sendAction("queue:add", track);
      if (!activeRef.current) return;
      if (!response.ok) return showActionError(response.error || t('rail.addTrackError'));
      const message = response.started ? t('rail.trackNowPlaying', { title: track.title }) : t(response.position ? 'rail.trackAddedAtPosition' : 'rail.trackAdded', { title: track.title, position: response.position });
      setStatus(message, !response.started);
      setNotice(message);
      setAddAcknowledgements((current) => ({ ...current, [operation.key!]: response }));
      if (origin === "link") {
        setResolvedTrack(null);
        setUrl("");
        setCustomTitle("");
      }
    } finally { finishOperation(operation); }
  };

  const toggleDjQueue = async (override=false) => {
    const operation: PendingOperation = { kind: "dj" };
    if (!beginOperation(operation)) return;
    const origin = document.activeElement;
    const leaving = snapshotRef.current.room.djQueueUserIds.includes(currentUserId);
    try {
      const response = await sendAction(leaving ? "dj:leave" : "dj:join",override?{override:true}:{});
      if (!activeRef.current) return;
      if (!response.ok) return showActionError(response.error || t('rail.updateRotationError'));
      const message = leaving ? t('rail.leftRotation') : t('rail.joinedRotation');
      setStatus(message);
      setNotice(message);
      requestAnimationFrame(() => {
        if (!activeRef.current || !(origin instanceof HTMLElement) || origin.dataset.djMembership !== "true") return;
        if (document.activeElement !== origin && document.activeElement !== document.body) return;
        const button = djActionButtonRef.current;
        if (button?.getClientRects().length) button.focus({ preventScroll: true });
        else lineupButtonRef.current?.focus({ preventScroll: true });
      });
    } finally { finishOperation(operation); }
  };

  const changeProvider = (value: string | null) => {
    const next = searchableProviders.find((candidate) => candidate === value);
    if (!next) return;
    searchRequestRef.current?.abort();
    setSearching(false);
    setResults([]);
    setCompletedQuery(null);
    setSearchError("");
    setProvider(next);
    storeValue(SEARCH_PROVIDER_STORAGE_KEY, next);
  };

  const search = async (value = query) => {
    if (provider === "apple" || !roomAllowsProvider(snapshotRef.current.room.settings, provider)) return setSearchError(t('rail.chooseAllowedService'));
    const searchQuery = value.trim();
    if (searchQuery.length < 2) return setSearchError(t('rail.searchMinimum'));
    if (!connected) return setSearchError(t('rail.offlineSearch'));
    searchRequestRef.current?.abort();
    const request = new AbortController();
    searchRequestRef.current = request;
    setSearching(true);
    setRequestedQuery(searchQuery);
    setSearchError("");
    try {
      const response = await fetch(`/api/${provider}/search?q=${encodeURIComponent(searchQuery)}`, {
        headers: { ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), "x-soundspin-room": snapshot.room.id },
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)])
      });
      const payload = await response.json() as { results?: Array<ProviderSearchResult & { channel?: string }>; error?: string };
      if (!response.ok) throw new Error(payload.error || t('rail.searchError', { provider: providerLabel(provider) }));
      if (!activeRef.current || request.signal.aborted || searchRequestRef.current !== request || !roomAllowsProvider(snapshotRef.current.room.settings, provider)) return;
      setResults((payload.results || []).map((result) => ({ ...result, provider, artist: result.artist || result.channel || providerLabel(provider) })));
      setCompletedQuery(searchQuery);
    } catch (error) {
      if (!activeRef.current || request.signal.aborted || searchRequestRef.current !== request) return;
      setSearchError(error instanceof Error && error.name === "TimeoutError" ? t('rail.searchTimeout') : error instanceof Error ? error.message : t('rail.searchError', { provider: providerLabel(provider) }));
    } finally {
      if (activeRef.current && !request.signal.aborted && searchRequestRef.current === request) setSearching(false);
    }
  };

  const clearSearch = () => {
    searchRequestRef.current?.abort();
    setSearching(false);
    setQuery("");
    setResults([]);
    setCompletedQuery(null);
    setSearchError("");
    searchInputRef.current?.focus();
  };

  const resolveLink = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseMusicLink(url, provider);
    if ("error" in parsed) return showActionError(parsed.error);
    if (!roomAllowsProvider(snapshotRef.current.room.settings, parsed.provider)) return showActionError(t('rail.serviceDisabled', { provider: providerLabel(parsed.provider) }));
    const operation: PendingOperation = { kind: "resolve" };
    if (!beginOperation(operation)) return;
    const request = new AbortController();
    resolveRequestRef.current = request;
    try {
      let track: TrackInput;
      if (parsed.provider === "youtube") {
        let title = customTitle.trim();
        let artist: string | undefined;
        if (!title) {
          try {
            const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(parsed.url)}&format=json`, {
              signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)])
            });
            if (response.ok) {
              const metadata = await response.json() as { title?: string; author_name?: string };
              title = metadata.title || "";
              artist = metadata.author_name;
            }
          } catch {
            // The video ID still provides a valid, explicit preview if metadata is unavailable.
          }
        }
        track = { provider: "youtube", providerId: parsed.providerId!, title: title || t('rail.youtubeTrack'), artist, permalinkUrl: parsed.url };
      } else {
        const response = await fetch(`/api/${parsed.provider}/resolve?url=${encodeURIComponent(parsed.url)}`, {
          headers: { ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), "x-soundspin-room": snapshot.room.id },
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)])
        });
        const payload = await response.json() as { result?: ProviderSearchResult; error?: string };
        if (!response.ok || !payload.result) throw new Error(payload.error || t('rail.serviceTrackLookupError', { provider: providerLabel(parsed.provider) }));
        track = asTrackInput({ ...payload.result, provider: parsed.provider });
        if (customTitle.trim()) track.title = customTitle.trim();
      }
      if (!activeRef.current || request.signal.aborted || !roomAllowsProvider(snapshotRef.current.room.settings, track.provider)) return;
      setResolvedTrack(track);
      setStatus(t('rail.trackFound', { title: track.title, provider: providerLabel(track.provider) }));
    } catch (error) {
      if (activeRef.current && !request.signal.aborted) showActionError(error instanceof Error && error.name === "TimeoutError" ? t('rail.lookupTimeout') : error instanceof Error ? error.message : t('rail.lookupError'));
    } finally { finishOperation(operation); }
  };

  const queueAction = async (event: "queue:remove" | "queue:move" | "queue:play-next", track: Track, toIndex?: number) => {
    if (event === "queue:play-next" && !roomAllowsProvider(snapshotRef.current.room.settings, track.provider)) return showActionError(t('rail.serviceDisabled', { provider: providerLabel(track.provider) }));
    const operation: PendingOperation = { kind: "queue", trackId: track.id };
    if (!beginOperation(operation)) return;
    const currentIndex = snapshotRef.current.room.queue.findIndex((item) => item.id === track.id);
    try {
      const response = await sendAction(event, { trackId: track.id, ...(toIndex !== undefined ? { toIndex } : {}) });
      if (!activeRef.current) return;
      if (!response.ok) return showActionError(response.error || t('rail.updateQueueError'));
      const message = event === "queue:remove" ? t('rail.trackRemoved', { title: track.title }) : t('rail.trackMoved', { title: track.title, position: (event === "queue:play-next" ? 0 : toIndex!) + 1 });
      setStatus(message);
      setNotice(message);
      if (event === "queue:remove") { setUndoReceipt(response.undo); setUndoExpired(false); }
      requestAnimationFrame(() => {
        if (!activeRef.current || tabRef.current !== "queue") return;
        const focus = document.activeElement;
        if (focus !== document.body && !(focus instanceof HTMLElement && (focus.dataset.queueActionId === track.id || focus.closest('[role="menu"]')))) return;
        const nextId = event === "queue:remove" ? snapshotRef.current.room.queue[Math.min(currentIndex, snapshotRef.current.room.queue.length - 1)]?.id : track.id;
        queueButtonRefs.current.get(nextId || "")?.focus({ preventScroll: true });
      });
    } finally { finishOperation(operation); }
  };

  const undoRemove = async () => {
    if (!undoReceipt || undoExpired) return;
    const operation: PendingOperation = { kind: "queue" };
    if (!beginOperation(operation)) return;
    try {
      const response = await sendAction("queue:undo", { token: undoReceipt.token });
      if (!activeRef.current) return;
      if (!response.ok) return showActionError(response.error || t('rail.restoreTrackError'));
      setStatus(t('rail.trackRestored', { title: undoReceipt.title }));
      setUndoReceipt(undefined); setUndoExpired(false);
    } finally { finishOperation(operation); }
  };
  const requestException=async(track:Track)=>{
    const operation:PendingOperation={kind:"queue",trackId:track.id};if(!beginOperation(operation))return;
    try{const result=await sendAction(snapshot.room.capabilities?.djsPlayback?"queue:exception":"queue:exception-request",{trackId:track.id});if(!result.ok)showActionError(result.error??t('rail.requestExceptionError'));else setNotice(snapshot.room.capabilities?.djsPlayback?t('rail.exceptionGranted'):t('rail.exceptionRequested'));}finally{finishOperation(operation);}
  };
  const appendSavedSet = async (set: SavedSet) => {
    if (!set.tracks.some((track) => roomAllowsProvider(snapshotRef.current.room.settings, track.provider))) return showActionError(t('rail.setProvidersDisabled'));
    const operation: PendingOperation = { kind: "queue" };
    if (!beginOperation(operation)) return;
    setImportSkipped([]);
    try {
      const requestId = setImportIntentRef.current.get(set.id) || crypto.randomUUID();
      setImportIntentRef.current.set(set.id, requestId);
      const response = await sendAction("queue:set-add", { setId: set.id, requestId });
      if (!activeRef.current) return;
      if (!response.ok) return showActionError(response.error || t('rail.appendSetError'));
      setImportIntentRef.current.delete(set.id);
      const skipped = response.skipped || [];
      setImportSkipped(skipped);
      setStatus(t('rail.setAppended', { count: response.added || 0, name: set.name, skipped: skipped.length, context: response.started ? 'started' : undefined }));
    } finally { finishOperation(operation); }
  };

  const rowStatus = (result: ProviderSearchResult) => {
    if (matchesResult(snapshot.room.playback.track, result)) return t('rail.nowPlaying');
    const index = snapshot.room.queue.findIndex((track) => matchesResult(track, result));
    if (index >= 0) return t('rail.queuedAtPosition', { position: index + 1 });
    const ack = addAcknowledgements[resultKey(result.provider, result.id)];
    return ack ? ack.started ? t('rail.nowPlaying') : t(ack.position ? 'rail.addedAtPosition' : 'rail.trackAddedShort', { position: ack.position }) : "";
  };

  const djAction = <Button ref={djActionButtonRef} data-dj-membership="true" size="sm" variant={joinedDjQueue ? "ghost" : "outline"} className="music-dj-action"
    disabled={!connected || Boolean(pending) || (!joinedDjQueue && !canJoinDjQueue)} onClick={() => void toggleDjQueue()}>
    {pending?.kind === "dj" ? t('rail.updating') : joinedDjQueue ? t('rail.leaveRotation') : canJoinDjQueue ? t('rail.joinRotation') : djJoinLabel}
  </Button>;
  const readiness = joinedDjQueue ? <p className="music-own-readiness">
    {t('rail.readiness', { context: `${snapshot.room.djUserId === currentUserId ? 'onAir' : upcomingDjs.indexOf(currentUserId) === 0 ? 'next' : 'waiting'}${snapshot.room.queue.some((track) => roomAllowsProvider(snapshot.room.settings, track.provider)) ? 'Ready' : 'Empty'}`, position: upcomingDjs.indexOf(currentUserId) + 1 })}
  </p> : !canJoinDjQueue ? <p className="music-own-readiness">{t('rail.askForRole')}</p> : null;

  const linkForm = <div className={`manual-add music-link-add ${manualOpen ? "open" : ""}`}>
    <button className="manual-add-heading" type="button" aria-expanded={manualOpen} aria-controls={linkFormId} onClick={() => setManualOpen((open) => !open)}>
      <span>{t('rail.addByLink')}</span><ChevronDown size={16} />
    </button>
    {manualOpen && <form id={linkFormId} className="rail-manual-add" onSubmit={(event) => void resolveLink(event)}>
      <label className="music-link-field"><span>{t('rail.trackLink')}</span><Input value={url} maxLength={2048} placeholder={t('rail.linkPlaceholder')} disabled={Boolean(pending)} onChange={(event) => { setUrl(event.target.value); setResolvedTrack(null); setActionError(""); }} /></label>
      <label className="music-link-field"><span>{t('rail.optionalTitle')}</span><Input value={customTitle} maxLength={180} disabled={Boolean(pending)} onChange={(event) => { setCustomTitle(event.target.value); setResolvedTrack(null); }} placeholder={t('rail.titlePlaceholder')} /></label>
      <p className="music-link-hint">{detectedProvider ? t(!roomAllowsProvider(snapshot.room.settings, detectedProvider) ? 'rail.linkServiceDisabled' : detectedProvider === "mixcloud" ? 'rail.linkShowsOnly' : 'rail.linkTracksOnly', { provider: providerLabel(detectedProvider) }) : roomProviders.length ? t('rail.linkAllowedServices', { providers: new Intl.ListFormat(i18n.resolvedLanguage, { style: 'short', type: 'disjunction' }).format(roomProviders.map(providerLabel)) }) : t('rail.noAllowedServices')}</p>
      <Button type="submit" variant="outline" disabled={!connected || Boolean(pending) || !url.trim() || Boolean(detectedProvider && !roomAllowsProvider(snapshot.room.settings, detectedProvider))}>{pending?.kind === "resolve" ? t('rail.findingTrack') : t('rail.findTrack')}</Button>
      {resolvedTrack && <div className="music-link-preview">
        <TrackArtwork track={resolvedTrack} compact />
        <span><strong>{resolvedTrack.title}</strong><small>{[resolvedTrack.artist, providerLabel(resolvedTrack.provider), formatTrackDuration(resolvedTrack.durationMs)].filter(Boolean).join(" · ")}</small></span>
        <Button type="button" size="sm" disabled={!connected || Boolean(pending) || !roomAllowsProvider(snapshot.room.settings, resolvedTrack.provider)} onClick={() => void enqueueTrack(resolvedTrack, "link")}>{pending?.kind === "add" ? t('rail.adding') : t('rail.addToQueue')}</Button>
      </div>}
    </form>}
  </div>;

  const queueActions = accessToken && tab === "queue" && snapshot.room.queue.length > 0 ? (
    <DropdownMenu onOpenChange={(open) => { if (open) queueSaveFocusRef.current = false; }}><DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={t('rail.queueActions')} />}><MoreHorizontal size={16} /></DropdownMenuTrigger><DropdownMenuContent align="end" className="music-track-menu" finalFocus={() => queueSaveFocusRef.current ? saveSetInputRef.current || libraryTabRef.current || true : true}><DropdownMenuItem disabled={libraryBusy || Boolean(pending)} onClick={() => { queueSaveFocusRef.current = true; setSaveSetOpen(true); setTab("library"); }}><Bookmark />{t('rail.saveQueueAsSet')}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
  ) : null;

  const feedback = (
      <div className="music-feedback">
        {!connected && <p className="music-offline">{t('rail.disconnected')}</p>}
        {actionError && <p className="music-action-error" role="alert">{actionError}</p>}
        <div className="music-action-status" role="status" aria-live="polite">{status}{pending && <span>{pending.kind === "add" ? t('rail.addingTrack') : pending.kind === "queue" ? t('rail.updatingQueue') : pending.kind === "resolve" ? t('rail.findingDetails') : t('rail.updatingRotation')}</span>}</div>
        {showQueueLink && addMusicOpen && <Button size="sm" variant="ghost" onClick={openQueue}>{t('rail.viewQueue')}</Button>}
        {undoReceipt && <div className="music-undo"><span>{undoExpired ? t('rail.undoExpired') : t('rail.undoAvailable')}</span>{!undoExpired && <Button variant="outline" size="sm" disabled={!connected || Boolean(pending)} onClick={() => void undoRemove()}>{t('rail.undoRemoval')}</Button>}</div>}
        {importSkipped.length > 0 && <details><summary>{t('rail.importSkipped', { count: importSkipped.length })}</summary><ul className="music-import-summary">{importSkipped.map((item, index) => <li key={index}>{t('rail.skippedTrackReason', { title: item.title, reason: item.reason })}</li>)}</ul></details>}
      </div>
  );

  return <aside className="music-rail music-rail-qol music-rail-minimal panel" aria-label={t('rail.panelLabel')}>
    <div className="music-rail-heading">
      <div><h2>{t('rail.music')}</h2>{tab !== "history" && <span className="music-privacy" title={t('rail.privacy')}><LockKeyhole size={12} aria-hidden="true" /><span className="sr-only">{t('rail.privacy')}</span></span>}</div>
      <div className="music-header-actions"><Button ref={addMusicButtonRef} variant="ghost" size="sm" className="music-add-trigger" aria-label={t('rail.addMusic')} title={t('rail.addMusic')} onClick={openAddMusic}><Plus size={16} />{t('rail.add')}</Button>{queueActions}</div>
    </div>

    <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)} className="music-tool-tabs">
      <TabsList className="music-tabs" aria-label={t('rail.tools')}>
        <TabsTrigger ref={queueTabRef} value="queue">{t('rail.queue')} {snapshot.room.queue.length > 0 && <i>{snapshot.room.queue.length}</i>}</TabsTrigger>
        <TabsTrigger ref={libraryTabRef} value="library">{t('rail.favorites')}</TabsTrigger>
        <TabsTrigger value="history">{t('rail.history')}</TabsTrigger>
      </TabsList>

      <TabsContent value="history" keepMounted className="rail-pane music-history-pane">
        {snapshot.room.history.length > 0 && <div className="music-history-filter"><Input value={historyFilter} onChange={(event) => setHistoryFilter(event.target.value)} aria-label={t('rail.historyFilterLabel')} placeholder={t('rail.historyFilterPlaceholder')} />{historyFilter && <Button size="icon" variant="ghost" aria-label={t('rail.clearHistoryFilter')} onClick={() => setHistoryFilter("")}><X /></Button>}</div>}
        <div className="rail-track-list">
          {filteredHistory.map((track, index) => {
            const sourceUrl = trackSourceUrl(track);
            const existing = rowStatus({ provider: track.provider, id: track.providerId, title: track.title, artist: track.artist || "" });
            const providerDisabled = !roomAllowsProvider(snapshot.room.settings, track.provider);
            return <div className="rail-track-row music-history-row" key={`${track.id}-${index}`}>
              <TrackArtwork track={track} compact active={tab === "history"} />
              <span className="rail-track-copy"><strong title={track.title}>{track.title}</strong><small title={[track.artist, providerLabel(track.provider), formatTrackDuration(track.durationMs)].filter(Boolean).join(" · ")}>{[track.artist, providerLabel(track.provider), formatTrackDuration(track.durationMs)].filter(Boolean).join(" · ")}</small>{providerDisabled && <small>{t('rail.providerDisabled')}</small>}{existing && <small className="music-result-confirmation">{existing}</small>}</span>
              <DropdownMenu><DropdownMenuTrigger ref={(button) => { if (button) historyButtonRefs.current.set(track.id, button); else historyButtonRefs.current.delete(track.id); }} render={<Button variant="ghost" size="icon" aria-label={t('rail.historyTrackActions', { title: track.title })} />}><MoreHorizontal size={16} /></DropdownMenuTrigger><DropdownMenuContent align="end" className="music-track-menu">
                <DropdownMenuItem disabled={!connected || Boolean(pending) || Boolean(existing) || providerDisabled} onClick={() => void enqueueTrack({ provider: track.provider, providerId: track.providerId, title: track.title, artist: track.artist, artworkUrl: track.artworkUrl, permalinkUrl: track.permalinkUrl, durationMs: track.durationMs }, "history")}><Plus />{t('rail.addToQueue')}</DropdownMenuItem>
                <DropdownMenuItem disabled={!accessToken || libraryBusy || isSaved(track)} onClick={() => savePick(track)}><Bookmark />{isSaved(track) ? t('rail.savedFavorite') : t('rail.saveFavorite')}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => openTrackDetails(track, historyButtonRefs.current.get(track.id) || queueButtonRefs.current.get(track.id))}><Info />{t('rail.trackDetails')}</DropdownMenuItem>
                {sourceUrl && <DropdownMenuItem render={<a href={sourceUrl} target="_blank" rel="noreferrer" />}><ExternalLink />{t('rail.openOnProvider', { provider: providerLabel(track.provider) })}</DropdownMenuItem>}
              </DropdownMenuContent></DropdownMenu>
            </div>;
          })}
          {snapshot.room.history.length === 0 && <div className="rail-empty"><Clock3 size={22} /><p>{t('rail.emptyHistory')}</p></div>}
          {snapshot.room.history.length > 0 && filteredHistory.length === 0 && <div className="rail-empty"><Search size={22} /><p>{t('rail.noMatchingHistory', { query: historyFilter })}</p><Button size="sm" variant="outline" onClick={() => setHistoryFilter("")}>{t('rail.clearFilter')}</Button></div>}
        </div>
      </TabsContent>

      <TabsContent value="queue" keepMounted className="rail-pane music-queue-pane">

        <div className="rail-track-list">
          {snapshot.room.queue.map((track, index) => <div className={`rail-track-row queue-track ${draggedTrackId === track.id ? "dragging" : ""}`} key={track.id} data-track-id={track.id} draggable={!pending && connected}
            onDragStart={(event) => { if (pendingRef.current || !connected) return event.preventDefault(); setDraggedTrackId(track.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", track.id); }} onDragEnd={() => setDraggedTrackId("")} onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => { event.preventDefault(); if (draggedTrackId && draggedTrackId !== track.id && !pendingRef.current) { const source = snapshotRef.current.room.queue.find((item) => item.id === draggedTrackId); if (source) void queueAction("queue:move", source, index); } setDraggedTrackId(""); }}>
            <span className="queue-drag-handle" title={t('rail.reorderHint')} aria-hidden="true"><span className="queue-position">{index + 1}</span><GripVertical size={14} /></span>
            <TrackArtwork track={track} compact active={tab === "queue"} />
            <span className="rail-track-copy"><strong title={track.title}>{track.title}</strong><small><span className="sr-only">{t('rail.queuePosition', { position: index + 1 })}</span>{track.artist || providerLabel(track.provider)}</small>{snapshot.room.radio?.ineligibleTracks[track.id] ? <small>{snapshot.room.radio.ineligibleTracks[track.id]}</small> : !roomAllowsProvider(snapshot.room.settings, track.provider) && <small>{t('rail.disabledTrackSkipped')}</small>}</span>
            <span className="queue-track-actions"><DropdownMenu><DropdownMenuTrigger ref={(button) => { if (button) queueButtonRefs.current.set(track.id, button); else queueButtonRefs.current.delete(track.id); }} data-queue-action-id={track.id} render={<Button variant="ghost" size="icon" aria-label={t('rail.trackActions', { title: track.title })} disabled={!connected || Boolean(pending)} />}><MoreHorizontal size={16} /></DropdownMenuTrigger><DropdownMenuContent align="end" className="music-track-menu">
              <DropdownMenuItem disabled={index === 0 || Boolean(pending) || !roomAllowsProvider(snapshot.room.settings, track.provider)} onClick={() => void queueAction("queue:play-next", track)}><ListMusic />{t('rail.firstInQueue')}</DropdownMenuItem>
              <DropdownMenuItem disabled={index === 0 || Boolean(pending)} onClick={() => void queueAction("queue:move", track, index - 1)}><ArrowUp />{t('rail.moveUp')}</DropdownMenuItem>
              <DropdownMenuItem disabled={index === snapshot.room.queue.length - 1 || Boolean(pending)} onClick={() => void queueAction("queue:move", track, index + 1)}><ArrowDown />{t('rail.moveDown')}</DropdownMenuItem>
              <DropdownMenuItem disabled={!accessToken || libraryBusy || isSaved(track)} onClick={() => savePick(track)}><Bookmark />{isSaved(track) ? t('rail.savedFavorite') : t('rail.saveFavorite')}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => openTrackDetails(track, historyButtonRefs.current.get(track.id) || queueButtonRefs.current.get(track.id))}><Info />{t('rail.trackDetails')}</DropdownMenuItem>
              {/Duration|minute limit/.test(snapshot.room.radio?.ineligibleTracks[track.id]??"") && <DropdownMenuItem disabled={Boolean(pending)} onClick={()=>void requestException(track)}>{snapshot.room.capabilities?.djsPlayback?t('rail.allowLengthException'):t('rail.requestLengthException')}</DropdownMenuItem>}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" disabled={Boolean(pending)} onClick={() => void queueAction("queue:remove", track)}><Trash2 />{t('rail.removeFromQueue')}</DropdownMenuItem>
            </DropdownMenuContent></DropdownMenu></span>
          </div>)}
          {snapshot.room.queue.length === 0 && <Empty className="rail-empty rail-empty-action"><EmptyHeader><EmptyTitle>{t('rail.emptyQueue')}</EmptyTitle></EmptyHeader><EmptyContent><Button size="sm" variant="outline" onClick={openAddMusic}><Search />{t('rail.findMusic')}</Button></EmptyContent></Empty>}
        </div>
      </TabsContent>
      <TabsContent value="library" keepMounted className="rail-pane music-library-pane"><MusicLibraryPanel active={tab === "library"} saveSetInputRef={saveSetInputRef} saveSetOpen={saveSetOpen} onSaveSetOpenChange={setSaveSetOpen} library={privateLibrary} loading={libraryLoading} error={libraryError} busy={libraryBusy || Boolean(pending)} signedIn={Boolean(accessToken)} canEnqueue={connected} allowsProvider={(candidate) => roomAllowsProvider(snapshot.room.settings, candidate)} queue={snapshot.room.queue} refresh={() => void refreshLibrary()} mutate={mutateLibrary} enqueue={(track) => void enqueueTrack(track, "history")} addSet={(set) => void appendSavedSet(set)} details={openTrackDetails} isQueued={(track) => Boolean(rowStatus({ ...track, id: track.providerId, artist: track.artist || "" }))} /></TabsContent>
      {!addMusicOpen && feedback}
    </Tabs>

    <section className="dj-lineup" aria-label={t('rail.djStatus')}>
      <Button ref={lineupButtonRef} variant="ghost" className={`dj-lineup-toggle${turnAccent ? " music-turn-accent" : ""}`} aria-label={t('rail.currentDjRotation', { name: currentDjLabel })} aria-describedby={djStatusId} aria-expanded={lineupOpen} aria-controls={lineupId} onClick={() => setLineupOpen((open) => !open)}>
        <span className="dj-lineup-current">{currentDj && <Avatar user={currentDj} size={24} />}<span id={djStatusId} className="music-dj-copy"><strong title={currentDj?.name}>{currentDjLabel}</strong>{joinedDjQueue && snapshot.room.djUserId !== currentUserId ? <small>{upcomingDjs.indexOf(currentUserId) === 0 ? t('rail.youAreNext') : t('rail.yourTurn', { position: upcomingDjs.indexOf(currentUserId) + 1 })}</small> : !joinedDjQueue && !canJoinDjQueue ? <small>{djJoinLabel}</small> : currentDj && <small>{onAirLabel}</small>}</span></span>
        <span className="music-lineup-label">{t('rail.rotation')}<ChevronDown size={14} /></span>
      </Button>
      <div id={lineupId} className="music-lineup-details" hidden={!lineupOpen}>
        <ol className="music-lineup-list" aria-label={t('rail.rotationLabel')}>
          {[...(currentDj ? [currentDj.id] : []), ...upcomingDjs].map((id) => {
            const user = snapshot.djUsers.find((candidate) => candidate.id === id);
            const position = upcomingDjs.indexOf(id) + 1;
            return user ? <li key={id}><Avatar user={user} size={24} /><span><strong>{user.id === currentUserId ? t('rail.you') : user.name}</strong><small>{id === snapshot.room.djUserId ? t('rail.onAir') : t('rail.rotationPosition', { position })}</small></span>{accessToken&&<ParticipantActions snapshot={snapshot} currentUserId={currentUserId} user={user} accessToken={accessToken} connected={connected} onNotice={setNotice}/>}</li> : null;
          })}
        </ol>
        {!currentDj && upcomingDjs.length === 0 && <p>{t('rail.emptyRotation')}</p>}
        {joinedDjQueue && snapshot.room.queue.length === 0 && <p>{t('rail.addTrackPrompt')}</p>}
        {!canJoinDjQueue && !joinedDjQueue && <p>{djJoinMessage}</p>}
        {!canJoinDjQueue&&!joinedDjQueue&&snapshot.room.capabilities?.djsPlayback&&snapshot.room.ownStatus?.djSuspendedUntil===undefined&&snapshot.room.ownStatus?.rulesAccepted!==false&&<Button size="sm" variant="outline" disabled={!connected||Boolean(pending)} onClick={()=>void toggleDjQueue(true)}>{t('rail.joinWithOverride')}</Button>}
        {(joinedDjQueue || !canJoinDjQueue) && !addMusicOpen && <div className="music-dj-membership">{djAction}</div>}
      </div>
      {!joinedDjQueue && canJoinDjQueue && !addMusicOpen && <div className="music-dj-membership">{djAction}</div>}
    </section>
    <Sheet open={addMusicOpen} onOpenChange={setAddMusicOpen}>
      <SheetContent side={narrow ? "bottom" : "left"} className="music-add-sheet music-rail-qol" initialFocus={searchInputRef} finalFocus={() => {
        const target = addMusicReturnFocusRef.current;
        return target?.isConnected && target.getClientRects().length > 0 ? target : addMusicButtonRef.current || true;
      }}>
        <SheetHeader className="music-add-header"><SheetTitle>{t('rail.addMusic')}</SheetTitle><span className="music-privacy"><LockKeyhole size={12} aria-hidden="true" />{t('rail.privateQueue')}</span></SheetHeader>
        {feedback}
        {!joinedDjQueue && <div className="music-join-prompt"><p>{canJoinDjQueue ? t('rail.joinToPlay') : t('rail.askForRole')}</p>{djAction}</div>}
        {joinedDjQueue && <div className="music-join-prompt">{readiness}{djAction}</div>}
      <div className="rail-pane search-pane">
        <form className="provider-search-form" onSubmit={(event) => { event.preventDefault(); void search(); }}>
          <InputGroup className="provider-search-group">
            <InputGroupInput ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchableProviders.length ? t('rail.searchProvider', { provider: providerLabel(provider) }) : t('rail.noSearchableServices')} disabled={!searchableProviders.length} aria-label={t('rail.searchMusic')} maxLength={120} />
            <InputGroupAddon align="inline-start"><Search /></InputGroupAddon>
            <InputGroupAddon align="inline-end" className="provider-search-actions">
              {query && <InputGroupButton size="icon-xs" aria-label={t('rail.clearSearch')} onClick={clearSearch}><X /></InputGroupButton>}
              <span className="provider-divider" />
              <Select value={searchableProviders.length ? provider : null} onValueChange={changeProvider} disabled={!searchableProviders.length}>
                <SelectTrigger size="sm" className="provider-select" aria-label={t('rail.provider')}><SelectValue>{searchableProviders.length ? providerLabel(provider) : t('rail.unavailable')}</SelectValue></SelectTrigger>
                <SelectContent><SelectGroup>{roomProviders.map((candidate) => <SelectItem key={candidate} disabled={candidate === "apple"} value={candidate}>{candidate === "apple" ? t('rail.providerComingSoon', { provider: providerLabel(candidate) }) : providerLabel(candidate)}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
              <InputGroupButton type="submit" size="sm" variant="default" className="search-submit" disabled={!connected || !searchableProviders.length}>{t('rail.search')}</InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </form>
        {searchError && <div className="music-search-error" role="alert"><p>{searchError}</p><Button variant="outline" size="sm" disabled={!connected || searching} onClick={() => void search(requestedQuery || query)}>{t('rail.retrySearch')}</Button></div>}
        {searching && results.length > 0 && <p className="music-search-context" role="status">{t('rail.searchingWithPreviousResults', { query: requestedQuery })}</p>}
        {!searching && results.length > 0 && completedQuery && <p className="music-search-context">{t('rail.searchResultCount', { query: completedQuery, count: results.length })}</p>}
        <div className="search-result-list" aria-busy={searching} aria-label={t('rail.searchResultsLabel')}>
          {searching && results.length === 0 && <div className="music-search-skeleton" role="status" aria-label={t('rail.searchingProviderLabel', { provider: providerLabel(provider) })}><span>{t('rail.searchingProvider', { provider: providerLabel(provider) })}</span>{[0, 1, 2].map((id) => <div className="music-skeleton-row" key={id}><Skeleton className="size-10 rounded-lg" /><span><Skeleton className="h-3 w-4/5" /><Skeleton className="h-2 w-1/2" /></span></div>)}</div>}
          {results.map((result) => {
            const key = resultKey(result.provider, result.id);
            const existing = rowStatus(result);
            const adding = pending?.kind === "add" && pending.key === key;
            const providerDisabled = !roomAllowsProvider(snapshot.room.settings, result.provider);
            return <div className="search-result-row" key={key}>
              <span className={`search-provider-mark ${result.provider}`} aria-hidden="true">{result.provider === "soundcloud" ? "SC" : result.provider === "spotify" ? "S" : result.provider === "mixcloud" ? "M" : "▶"}</span>
              <TrackArtwork track={{ provider: result.provider, providerId: result.id, artworkUrl: result.thumbnail }} compact />
              <span className="search-result-copy"><strong>{result.title}</strong><small>{[result.artist, result.duration || formatTrackDuration(result.durationMs)].filter(Boolean).join(" · ")}</small>{(existing || adding || providerDisabled) && <small className="music-result-confirmation">{providerDisabled ? t('rail.providerDisabled') : adding ? t('rail.adding') : existing}</small>}</span>
              <button type="button" className={existing ? "added" : ""} aria-label={existing ? t('rail.resultStatus', { title: result.title, status: existing }) : t('rail.addResult', { title: result.title })} title={providerDisabled ? t('rail.providerDisabled') : existing || (searching ? t('rail.waitForResults') : pending ? t('rail.waitForAction') : t('rail.addToPrivateQueue'))} disabled={!connected || Boolean(existing) || Boolean(pending) || searching || providerDisabled} onClick={() => void enqueueTrack(asTrackInput(result), "search")}>
                {existing ? <Check size={15} /> : adding ? <Loader2 size={15} className="music-busy-icon" /> : <Plus size={15} />}
              </button>
            </div>;
          })}
          {!searching && !searchError && results.length === 0 && <div className="rail-search-state"><Search size={22} /><span>{!searchableProviders.length ? t('rail.searchUnavailable') : completedQuery === null ? t(provider === "mixcloud" ? 'rail.searchShowsHint' : 'rail.searchSongsHint', { provider: providerLabel(provider) }) : t('rail.noSearchResults', { query: completedQuery, provider: providerLabel(provider) })}</span>{completedQuery !== null && <small>{t('rail.searchRecovery')}</small>}</div>}
        </div>
        {linkForm}
      </div>

      </SheetContent>
    </Sheet>
    <TrackDetailsDialog returnFocusRef={detailsReturnFocusRef} track={detailsTrack} open={Boolean(detailsTrack)} onOpenChange={(open) => { if (!open) setDetailsTrack(null); }} />
  </aside>;
}
