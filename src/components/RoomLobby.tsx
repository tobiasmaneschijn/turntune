import { useTranslation } from "react-i18next";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { AlertCircle, ArrowRight, Heart, LockKeyhole, Plus, Radio, RefreshCw, Search, SlidersHorizontal, Users, X } from "lucide-react";
import { AppHeader } from "./AppHeader";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./ui/alert";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { Skeleton } from "./ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import type { RoomDirectoryEntry, User } from "../types";
import { readStoredValue, storeValue } from "../lib/browser-storage";
import { TrackArtwork } from "./TrackArtwork";
import { FriendsPanel } from "./FriendsPanel";
import { readRecentRoomVisits } from "../lib/room-visits";
import "../styles/layout-completion.css";
import { requestJson } from "../lib/authenticated-http";
import type { SoundSpinUserSettings } from "../playback-settings";

const directoryCache = new Map<string, RoomDirectoryEntry[]>();
interface FavoriteFailure {
  slug: string;
  name: string;
  favorite: boolean;
  message: string;
}
type RoomScope = "all" | "favorite" | "member";
function readDirectoryPreferences(userId: string) {
  try {
    const value: unknown = JSON.parse(readStoredValue(`soundspin:room-directory:${userId}`) || "{}");
    return value && typeof value === "object" ? value as { query?: string; scope?: string; filter?: string; sort?: string; tag?: string; language?: string } : {};
  }
  catch { return {}; }
}

interface RoomLobbyProps {
  accessToken: string;
  currentUser: User;
  onOpenRoom: (slug: string, password?: string) => void;
  onOpenProfile: () => void;
  onOpenPerson?: (id: string) => void;
  onSignOut: () => void;
  userSettings: SoundSpinUserSettings;
  onSettingsChange: (settings: SoundSpinUserSettings) => void;
  onAdmin?: () => void;
}

async function api<T>(path: string, accessToken: string, init?: RequestInit) {
  return requestJson<T>(path, { ...init, accessToken });
}

export function RoomLobby({
  accessToken,
  currentUser,
  onOpenRoom,
  onOpenProfile,
  onOpenPerson,
  onSignOut,
  userSettings,
  onSettingsChange,
  onAdmin
}: RoomLobbyProps) {
  const { t } = useTranslation("rooms");
  const [rooms, setRooms] = useState<RoomDirectoryEntry[]>(() => directoryCache.get(currentUser.id) || []);
  const [loading, setLoading] = useState(() => !directoryCache.has(currentUser.id));
  const [directoryLoaded, setDirectoryLoaded] = useState(() => directoryCache.has(currentUser.id));
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState(() => { const value = readDirectoryPreferences(currentUser.id).query; return typeof value === "string" ? value : ""; });
  const [scope, setScope] = useState<RoomScope>(() => {
    const saved = readDirectoryPreferences(currentUser.id).scope;
    return saved === "favorite" || saved === "member" ? saved : "all";
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [tag, setTag] = useState(() => { const value = readDirectoryPreferences(currentUser.id).tag; return typeof value === "string" ? value : ""; });
  const [language, setLanguage] = useState(() => { const value = readDirectoryPreferences(currentUser.id).language; return typeof value === "string" ? value : ""; });
  const [filter, setFilter] = useState<"all" | "active" | "protected">(() => {
    const saved = readDirectoryPreferences(currentUser.id).filter;
    return saved === "active" || saved === "protected" ? saved : "all";
  });
  const [sort, setSort] = useState<"active" | "favorite" | "alphabetical">(() => {
    const saved = readDirectoryPreferences(currentUser.id).sort;
    return saved === "favorite" || saved === "alphabetical" ? saved : "active";
  });
  const [now, setNow] = useState(Date.now);
  const [recentVisits, setRecentVisits] = useState(() => readRecentRoomVisits(currentUser.id));
  useEffect(() => {
    const update = () => setRecentVisits(readRecentRoomVisits(currentUser.id));
    const onVisit = (event: Event) => { if ((event as CustomEvent<{ userId: string }>).detail?.userId === currentUser.id) update(); };
    update();
    window.addEventListener("soundspin:room-visit", onVisit);
    return () => window.removeEventListener("soundspin:room-visit", onVisit);
  }, [currentUser.id]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const preferencesUserRef = useRef(currentUser.id);
  useEffect(() => { if (preferencesUserRef.current === currentUser.id) storeValue(`soundspin:room-directory:${currentUser.id}`, JSON.stringify({ query, scope, filter, sort, tag, language })); }, [currentUser.id, query, scope, filter, sort, tag, language]);
  const [favoritePending, setFavoritePending] = useState<Set<string>>(new Set());
  const favoritePendingRef = useRef(new Set<string>());
  const [favoriteFailures, setFavoriteFailures] = useState<Record<string, FavoriteFailure>>({});
  const requestRef = useRef(0);
  const accountRef = useRef(0);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [protectedRoom, setProtectedRoom] = useState<RoomDirectoryEntry | null>(null);

  const loadRooms = useCallback(async (signal?: AbortSignal) => {
    const requestId = ++requestRef.current;
    setRefreshing(true);
    setError("");
    try {
      const payload = await requestJson<{ rooms: RoomDirectoryEntry[] }>("/api/rooms", { accessToken, signal,
        validate: (value): value is { rooms: RoomDirectoryEntry[] } => Boolean(value && typeof value === "object" && "rooms" in value && Array.isArray(value.rooms)) });
      if (requestId === requestRef.current) { setRooms(payload.rooms); directoryCache.set(currentUser.id, payload.rooms); setDirectoryLoaded(true); setNow(Date.now()); }
    } catch (loadError) {
      if (requestId === requestRef.current) setError(loadError instanceof Error ? loadError.message : t("roomLobby.couldNotLoadRooms"));
    } finally {
      if (requestId === requestRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, [accessToken, currentUser.id]);

  useEffect(() => {
    accountRef.current += 1;
    if (preferencesUserRef.current !== currentUser.id) {
      const preferences = readDirectoryPreferences(currentUser.id);
      setQuery(typeof preferences.query === "string" ? preferences.query : "");
      setScope(preferences.scope === "favorite" || preferences.scope === "member" ? preferences.scope : "all");
      setFiltersOpen(false);
      setTag(typeof preferences.tag === "string" ? preferences.tag : "");
      setLanguage(typeof preferences.language === "string" ? preferences.language : "");
      setFilter(preferences.filter === "active" || preferences.filter === "protected" ? preferences.filter : "all");
      setSort(preferences.sort === "favorite" || preferences.sort === "alphabetical" ? preferences.sort : "active");
      preferencesUserRef.current = currentUser.id;
      setCreating(false);
      setProtectedRoom(null);
    }
    setRooms(directoryCache.get(currentUser.id) || []);
    favoritePendingRef.current.clear();
    setFavoritePending(new Set());
    setFavoriteFailures({});
    setLoading(!directoryCache.has(currentUser.id));
    setDirectoryLoaded(directoryCache.has(currentUser.id));
    const controller = new AbortController();
    void loadRooms(controller.signal);
    return () => { requestRef.current += 1; accountRef.current += 1; controller.abort(); };
  }, [loadRooms]);

  // Local history only reorders rooms already returned by the authorized directory.
  const lastVisitedSlug = recentVisits.find(visit => rooms.some(room => room.slug === visit.slug))?.slug;
  const visibleRooms = useMemo(() => rooms.filter((room) =>
    (scope !== "favorite" || room.isFavorite) && (scope !== "member" || room.role !== null) &&
    [room.name, room.description, ...(room.tags ?? []), room.language].filter(Boolean).join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) &&
    (!tag || room.tags?.includes(tag)) && (!language || room.language === language) &&
    (filter !== "active" || room.listenerCount > 0) && (filter !== "protected" || room.passwordProtected)
  ).sort((left, right) => (sort === "active" ? Number(right.slug === lastVisitedSlug) - Number(left.slug === lastVisitedSlug) || right.listenerCount - left.listenerCount : sort === "favorite" ? Number(right.isFavorite) - Number(left.isFavorite) : 0) || left.name.localeCompare(right.name)), [rooms, query, scope, filter, sort, tag, language, lastVisitedSlug]);
  const availableTags = [...new Set(rooms.flatMap(room => room.tags ?? []))].sort();
  const availableLanguages = [...new Set(rooms.map(room => room.language).filter((value): value is string => Boolean(value)))].sort();
  const filtering = Boolean(query.trim() || tag || language) || filter !== "all";
  const filterCount = Number(filter !== "all") + Number(sort !== "active") + Number(Boolean(tag)) + Number(Boolean(language));
  const resetOptions = () => { setFilter("all"); setSort("active"); setTag(""); setLanguage(""); };
  const resetDirectory = () => { setQuery(""); setScope("all"); resetOptions(); };

  const enter = (room: RoomDirectoryEntry) => {
    if (room.passwordProtected) setProtectedRoom(room);
    else onOpenRoom(room.slug);
  };

  const updateFavorite = async (room: Pick<RoomDirectoryEntry, "slug" | "name">, next: boolean) => {
    if (favoritePendingRef.current.has(room.slug)) return;
    const previous = rooms.find(item => item.slug === room.slug)?.isFavorite ?? !next;
    const accountRequest = accountRef.current;
    favoritePendingRef.current.add(room.slug);
    setFavoritePending(new Set(favoritePendingRef.current));
    setRooms((current) => { const updated = current.map((item) => item.slug === room.slug ? { ...item, isFavorite: next } : item); directoryCache.set(currentUser.id, updated); return updated; });
    try {
      await api(`/api/rooms/${room.slug}/favorite`, accessToken, {
        method: "PUT",
        body: JSON.stringify({ favorite: next })
      });
      if (accountRequest === accountRef.current) setFavoriteFailures(current => {
        const updated = { ...current }; delete updated[room.slug]; return updated;
      });
    } catch (favoriteError) {
      if (accountRequest === accountRef.current) {
        setRooms((current) => { const updated = current.map((item) => item.slug === room.slug ? { ...item, isFavorite: previous } : item); directoryCache.set(currentUser.id, updated); return updated; });
        setFavoriteFailures(current => ({ ...current, [room.slug]: { slug: room.slug, name: room.name, favorite: next,
          message: favoriteError instanceof Error ? favoriteError.message : t("roomLobby.tryAgain") } }));
      }
    } finally {
      if (accountRequest === accountRef.current) {
        favoritePendingRef.current.delete(room.slug);
        setFavoritePending(new Set(favoritePendingRef.current));
      }
    }
  };
  const toggleFavorite = (room: RoomDirectoryEntry) => updateFavorite(room, !room.isFavorite);

  return (
    <main className="room-lobby">
      <AppHeader currentUser={currentUser} page="rooms" onProfile={onOpenProfile} onAdmin={onAdmin} onSignOut={onSignOut}
        onHome={() => { resetDirectory(); document.querySelector<HTMLElement>(".lobby-page-heading h1")?.focus(); }}
        settings={{ accessToken, userSettings, onSettingsChange }} diagnosticContext={{ surface: "room-directory" }} />
      <div className="lobby-shell" id="main-content" tabIndex={-1}>
        <div className="lobby-page-heading">
          <div>
            <h1 tabIndex={-1}>{t("roomLobby.rooms")}</h1>
          </div>
          <Button onClick={() => setCreating(true)}>
            <Plus />{t("roomLobby.newRoom")}{" "}</Button>
        </div>

        {error && (
          <Alert variant="destructive" className="lobby-error">
            <AlertCircle />
            <AlertTitle>{t("roomLobby.couldnTLoadRooms")}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
            <AlertAction><Button variant="ghost" size="sm" onClick={() => void loadRooms()} disabled={refreshing || favoritePending.size > 0}>{t("roomLobby.retry")}</Button><Button variant="ghost" size="icon-xs" onClick={() => setError("")} aria-label={t("roomLobby.dismissError")}><X /></Button></AlertAction>
          </Alert>
        )}
        {Object.values(favoriteFailures).map(failure => <Alert key={failure.slug} variant="destructive" className="lobby-error lobby-favorite-error">
          <AlertCircle />
          <AlertTitle>{t(failure.favorite ? "roomLobby.addFavoriteFailed" : "roomLobby.removeFavoriteFailed", { name: failure.name })}</AlertTitle>
          <AlertDescription>{failure.message}</AlertDescription>
          <AlertAction><Button variant="ghost" size="sm" aria-label={t(favoritePending.has(failure.slug) ? "roomLobby.retryingFavorite" : "roomLobby.retryFavorite", { name: failure.name })} disabled={favoritePending.has(failure.slug)} onClick={() => void updateFavorite(failure, failure.favorite)}>{favoritePending.has(failure.slug) ? t("roomLobby.retrying") : t("roomLobby.retry")}</Button><Button variant="ghost" size="icon-xs" aria-label={t("roomLobby.dismissFavoriteErrorForName", { name: failure.name })} onClick={() => setFavoriteFailures(current => { const updated = { ...current }; delete updated[failure.slug]; return updated; })}><X /></Button></AlertAction>
        </Alert>)}

        <div className="lobby-directory-bar">
          <div className="lobby-scopes" role="group" aria-label={t("roomLobby.roomViews")}>
            {([['all', t("roomLobby.allRooms")], ['favorite', t("roomLobby.favorites2")], ['member', t("roomLobby.yourRooms")]] as const).map(([value, label]) =>
              <Button key={value} variant="ghost" aria-pressed={scope === value} onClick={() => setScope(value)}>{label}</Button>
            )}
          </div>
          <div className="lobby-directory-tools">
            <div className="lobby-search"><Search aria-hidden="true" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("roomLobby.findARoom")} aria-label={t("roomLobby.findARoom")} /></div>
            <Popover.Root open={filtersOpen} onOpenChange={setFiltersOpen}>
              <Popover.Trigger render={<Button variant="outline" className="lobby-filter-trigger" aria-label={t("roomLobby.filterSort")} />}>
                <SlidersHorizontal /><span>{t("roomLobby.filterSort")}</span>{filterCount > 0 && <span className="lobby-filter-count" aria-hidden="true">{filterCount}</span>}
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Positioner side="bottom" align="end" sideOffset={8} collisionPadding={12} className="lobby-filter-positioner">
                  <Popover.Popup className="lobby-filter-popover">
                    <div className="lobby-filter-heading"><Popover.Title>{t("roomLobby.filterSort")}</Popover.Title><Popover.Close render={<Button variant="ghost" size="icon-sm" aria-label={t("roomLobby.closeFilters")} />}><X /></Popover.Close></div>
                    <div className="lobby-filter-field"><Label htmlFor="directory-filter">{t("roomLobby.show")}</Label><Select value={filter} onValueChange={value => setFilter(value as typeof filter)}>
                      <SelectTrigger id="directory-filter" aria-label={t("roomLobby.filterRooms")}><SelectValue>{filter === "active" ? t("roomLobby.listeningNow") : filter === "protected" ? t("roomLobby.protectedRooms") : t("roomLobby.allRooms")}</SelectValue></SelectTrigger>
                      <SelectContent><SelectItem value="all">{t("roomLobby.allRooms")}</SelectItem><SelectItem value="active">{t("roomLobby.listeningNow")}</SelectItem><SelectItem value="protected">{t("roomLobby.protectedRooms")}</SelectItem></SelectContent>
                    </Select></div>
                    <div className="lobby-filter-field"><Label htmlFor="directory-sort">{t("roomLobby.sortBy")}</Label><Select value={sort} onValueChange={value => setSort(value as typeof sort)}>
                      <SelectTrigger id="directory-sort" aria-label={t("roomLobby.sortRooms")}><SelectValue>{sort === "favorite" ? t("roomLobby.favoritesFirst") : sort === "alphabetical" ? t("roomLobby.alphabetical") : t("roomLobby.recentActive")}</SelectValue></SelectTrigger>
                      <SelectContent><SelectItem value="active">{t("roomLobby.recentActive")}</SelectItem><SelectItem value="favorite">{t("roomLobby.favoritesFirst")}</SelectItem><SelectItem value="alphabetical">{t("roomLobby.alphabetical")}</SelectItem></SelectContent>
                    </Select></div>
                    {(availableTags.length > 0 || tag) && <div className="lobby-filter-field"><Label htmlFor="directory-tag">{t("roomLobby.tag")}</Label><Select value={tag} onValueChange={value => setTag(String(value))}><SelectTrigger id="directory-tag" aria-label={t("roomLobby.roomTag")}><SelectValue>{tag || t("roomLobby.allTags")}</SelectValue></SelectTrigger><SelectContent><SelectItem value="">{t("roomLobby.allTags")}</SelectItem>{[...new Set([...availableTags, ...(tag ? [tag] : [])])].map(value => <SelectItem value={value} key={value}>{value}</SelectItem>)}</SelectContent></Select></div>}
                    {(availableLanguages.length > 0 || language) && <div className="lobby-filter-field"><Label htmlFor="directory-language">{t("roomLobby.language")}</Label><Select value={language} onValueChange={value => setLanguage(String(value))}><SelectTrigger id="directory-language" aria-label={t("roomLobby.roomLanguage")}><SelectValue>{language || t("roomLobby.allLanguages")}</SelectValue></SelectTrigger><SelectContent><SelectItem value="">{t("roomLobby.allLanguages")}</SelectItem>{[...new Set([...availableLanguages, ...(language ? [language] : [])])].map(value => <SelectItem value={value} key={value}>{value}</SelectItem>)}</SelectContent></Select></div>}
                    <div className="lobby-filter-footer"><Button variant="ghost" size="sm" aria-label={t("roomLobby.resetFilterOptions")} disabled={filterCount === 0} onClick={resetOptions}>{t("roomLobby.reset")}</Button><Popover.Close render={<Button size="sm" variant="secondary" />}>{t("roomLobby.done")}</Popover.Close></div>
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
            <Button variant="ghost" size="icon" onClick={() => void loadRooms()} disabled={refreshing || favoritePending.size > 0} aria-label={refreshing ? t("roomLobby.refreshingRooms") : t("roomLobby.refreshRooms")} title={t("roomLobby.refreshRooms")}><RefreshCw className={refreshing ? "spin" : undefined} /></Button>
          </div>
        </div>
        <div className="lobby-filter-summary">
          <p role="status">{loading ? t("roomLobby.loadingRooms") : directoryLoaded ? t("roomLobby.roomCount", { count: visibleRooms.length }) : ""}</p>
          <div className="lobby-applied-filters">
            {filter !== "all" && <span>{filter === "active" ? t("roomLobby.listeningNow") : t("roomLobby.protectedRooms")}</span>}
            {sort !== "active" && <span>{sort === "favorite" ? t("roomLobby.favoritesFirst") : t("roomLobby.alphabetical")}</span>}
            {tag && <span>{tag}</span>}{language && <span>{language}</span>}
            {(filtering || sort !== "active") && <Button variant="ghost" size="sm" onClick={resetDirectory}>{t("roomLobby.resetFilters")}</Button>}
          </div>
        </div>
        {loading ? (
          <div className="lobby-loading" aria-label={t("roomLobby.loadingRooms2")} aria-busy="true">
            {[0, 1, 2].map(item => <Skeleton key={item} className="h-24 rounded-lg" />)}
          </div>
        ) : (
          <div className="lobby-directory-results">
            {!rooms.length && directoryLoaded && <Empty><EmptyHeader><EmptyMedia variant="icon"><Radio /></EmptyMedia><EmptyTitle>{t("roomLobby.noRoomsAvailable")}</EmptyTitle><EmptyDescription>{t("roomLobby.openAnInviteToJoinAPrivateRoom")}</EmptyDescription></EmptyHeader><Button variant="outline" onClick={() => setCreating(true)}>{t("roomLobby.createRoom")}</Button></Empty>}
            {visibleRooms.length > 0 && <ul className="room-directory-list" aria-label={t("roomLobby.rooms")}>{visibleRooms.map(room => <li key={room.slug}><RoomRow room={room} lastVisited={room.slug === lastVisitedSlug} onEnter={enter} onFavorite={toggleFavorite} favoritePending={favoritePending.has(room.slug)} now={now} /></li>)}</ul>}
            {rooms.length > 0 && visibleRooms.length === 0 && <Empty className="lobby-empty"><EmptyHeader><EmptyMedia variant="icon"><Radio /></EmptyMedia><EmptyTitle>{filtering ? t("roomLobby.noMatchingRooms") : scope === "favorite" ? t("roomLobby.noFavoriteRooms") : t("roomLobby.youHavenTJoinedAnyRooms")}</EmptyTitle></EmptyHeader><Button variant="outline" onClick={resetDirectory}>{t("roomLobby.browseAllRooms")}</Button></Empty>}
          </div>
        )}
        <FriendsPanel compact accessToken={accessToken} currentUser={currentUser} onOpenRoom={onOpenRoom} onOpenPerson={onOpenPerson} />
      </div>

      {creating && (
        <CreateRoomDialog
          accessToken={accessToken}
          onClose={() => setCreating(false)}
          onCreated={(slug, password) => { setCreating(false); onOpenRoom(slug, password); }}
        />
      )}
      {protectedRoom && (
        <PasswordDialog
          roomName={protectedRoom.name}
          onClose={() => setProtectedRoom(null)}
          onSubmit={(password) => onOpenRoom(protectedRoom.slug, password)}
        />
      )}
    </main>
  );
}

function RoomRow({ room, lastVisited, onEnter, onFavorite, favoritePending, now }: {
  room: RoomDirectoryEntry;
  lastVisited: boolean;
  onEnter: (room: RoomDirectoryEntry) => void;
  onFavorite: (room: RoomDirectoryEntry) => void;
  favoritePending: boolean;
  now: number;
}) {
  const { t } = useTranslation("rooms");
  const preview = room.isPublic && !room.passwordProtected ? room.preview : undefined;
  const previewStale = preview && now - preview.observedAt > 90_000;
  const roleLabel = room.role ? t(`roles.${room.role}`) : null;
  return <article className="room-directory-row" aria-label={room.name}>
    <div className="directory-room-art" aria-hidden="true">
      {preview?.artworkUrl ? <TrackArtwork track={{ provider: preview.provider || "youtube", providerId: "" }} src={preview.artworkUrl} compact /> : <Radio />}
    </div>
    <div className="directory-room-copy">
      <div className="directory-room-title"><h2 title={room.name}>{room.name}</h2>{lastVisited && <span className="directory-last-visited">{t("roomLobby.lastVisited")}</span>}</div>
      <div className="directory-room-meta">
        <span className="directory-listeners"><Users aria-hidden="true" />{t("roomLobby.listeningCount", { count: room.listenerCount })}</span>
        {roleLabel && <span>{roleLabel}</span>}
        {room.passwordProtected && <Badge variant="outline"><LockKeyhole />{t("roomLobby.protected")}</Badge>}
        {(room.accessMode === "members" || !room.isPublic) && <Badge variant="outline">{t("roomLobby.membersOnly")}</Badge>}
        {room.accessMode === "unlisted" && <Badge variant="outline">{t("roomLobby.unlisted")}</Badge>}
        {room.language && <span>{room.language}</span>}
        {room.tags?.map(tag => <span key={tag}>{tag}</span>)}
      </div>
      {room.description && <p className="directory-room-description">{room.description}</p>}
    </div>
    {preview && <div className="directory-track">
      <span className={preview.playing && !previewStale ? "directory-track-playing" : undefined}>{previewStale ? t("roomLobby.previewIsOutOfDate") : preview.playing ? t("roomLobby.playing") : t("roomLobby.paused")}</span>
      <strong title={preview.title}>{preview.title}</strong>
      {preview.artist && <span className="directory-track-artist" title={preview.artist}>{preview.artist}</span>}
    </div>}
    <div className="directory-room-actions">
      <Button variant="ghost" size="icon" className={room.isFavorite ? "text-primary" : "text-muted-foreground"}
        onClick={() => onFavorite(room)} aria-label={t(room.isFavorite ? "roomLobby.removeRoomFavorite" : "roomLobby.addRoomFavorite", { name: room.name })}
        aria-pressed={room.isFavorite} disabled={favoritePending} title={room.isFavorite ? t("roomLobby.removeFromFavorites") : t("roomLobby.addToFavorites")}>
        <Heart fill={room.isFavorite ? "currentColor" : "none"} />
      </Button>
      <Button variant="secondary" className="directory-join" data-navigation-focus={`room:${room.slug}`} onClick={() => onEnter(room)} aria-label={t("roomLobby.joinName", { name: room.name })}>{t("roomLobby.join")}{" "}<ArrowRight /></Button>
    </div>
  </article>;
}
function CreateRoomDialog({
  accessToken,
  onClose,
  onCreated
}: {
  accessToken: string;
  onClose: () => void;
  onCreated: (slug: string, password?: string) => void;
}) {
  const { t } = useTranslation("rooms");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [roomAccess, setRoomAccess] = useState<"public" | "unlisted" | "members">("public");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const activeRef = useRef(true);
  const savingRef = useRef(false);
  useEffect(() => { activeRef.current = true; return () => { activeRef.current = false; }; }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    const submittedPassword = password || undefined;
    try {
      const payload = await requestJson<{ room: { slug: string } }>("/api/rooms", {
        accessToken,
        method: "POST",
        body: JSON.stringify({ name: name.trim(), isPublic: roomAccess !== "members", accessMode: roomAccess, password: submittedPassword }),
        validate: (value): value is { room: { slug: string } } => Boolean(value && typeof value === "object" && "room" in value && value.room && typeof value.room === "object" && "slug" in value.room && typeof value.room.slug === "string" && value.room.slug.length > 0)
      });
      if (activeRef.current) onCreated(payload.room.slug, submittedPassword);
    } catch (createError) {
      if (activeRef.current) setError(createError instanceof Error && !(createError instanceof TypeError)
        && createError.message !== t("common:authenticated_http_the_request_timed_out_try_again") && createError.message !== t("common:authenticated_http_the_server_returned_an_invalid_response_try_again")
        ? createError.message : t("roomLobby.creationWasnTConfirmedRefreshRoomsBeforeCreating"));
    } finally {
      savingRef.current = false;
      if (activeRef.current) setSaving(false);
    }
  };

  return (
    <Dialog open disablePointerDismissal={saving} onOpenChange={(open) => { if (!open && !savingRef.current) onClose(); }}>
      <DialogContent showCloseButton={!saving}>
        <form className="grid gap-5" autoComplete="off" onSubmit={submit} aria-busy={saving}>
          <DialogHeader>
            <DialogTitle>{t("roomLobby.createARoom")}</DialogTitle>
            <DialogDescription className="sr-only">{t("roomLobby.nameAndAccessSettings")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="room-name">{t("roomLobby.roomName")}</Label>
              <Input
                id="room-name"
                name="soundspin-room-name"
                autoFocus
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                required
                disabled={saving}
                maxLength={48}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("roomLobby.fridayFocus")}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="room-password">{t("roomLobby.password")}{" "}<span className="font-normal text-muted-foreground">{t("roomLobby.optional")}</span></Label>
              <Input
                id="room-password"
                name="soundspin-new-room-password"
                type="password"
                disabled={saving}
                autoComplete="new-password"
                data-1p-ignore
                data-lpignore="true"
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={t("roomLobby.noPassword")}
              />
            </div>
            <div className="grid gap-2"><Label htmlFor="new-room-access">{t("roomLobby.roomAccess")}</Label><Select value={roomAccess} onValueChange={value => setRoomAccess(value as typeof roomAccess)}><SelectTrigger id="new-room-access" disabled={saving}><SelectValue>{roomAccess === "public" ? t("roomLobby.public") : roomAccess === "unlisted" ? t("roomLobby.unlisted") : t("roomLobby.membersOnly")}</SelectValue></SelectTrigger><SelectContent><SelectItem value="public">{t("roomLobby.public")}</SelectItem><SelectItem value="unlisted">{t("roomLobby.unlisted")}</SelectItem><SelectItem value="members">{t("roomLobby.membersOnly")}</SelectItem></SelectContent></Select>{roomAccess === "unlisted" && <p className="room-setting-help">{t("roomLobby.anyoneWithTheRoomAddressCanJoinHidden")}</p>}</div>
          </div>
          {error && <div className="dialog-error" role="alert">{error}</div>}
          {saving && <p className="text-sm text-muted-foreground" role="status">{t("roomLobby.waitForRoomCreationToFinish")}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>{t("roomLobby.cancel")}</Button>
            <Button type="submit" disabled={saving || !name.trim()}>{saving ? t("roomLobby.creating") : t("roomLobby.createRoom")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PasswordDialog({
  roomName,
  error,
  onClose,
  onSubmit
}: {
  roomName: string;
  error?: string;
  onClose: () => void;
  onSubmit: (password: string) => void;
}) {
  const { t } = useTranslation("rooms");
  const [password, setPassword] = useState("");
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <form className="grid gap-5" onSubmit={(event) => { event.preventDefault(); onSubmit(password); }}>
          <DialogHeader>
            <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-secondary text-muted-foreground"><LockKeyhole className="size-4" /></div>
            <DialogTitle>{roomName}</DialogTitle>
            <DialogDescription className="sr-only">{t("roomLobby.enterTheRoomPasswordToJoin")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="join-password">{t("roomLobby.password")}</Label>
            <Input id="join-password" autoFocus required type="password" maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} />
          </div>
          {error && <div className="dialog-error" role="alert">{error}</div>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t("roomLobby.cancel")}</Button>
            <Button type="submit" disabled={!password}>{t("roomLobby.joinRoom")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
