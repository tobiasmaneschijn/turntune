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
      if (requestId === requestRef.current) setError(loadError instanceof Error ? loadError.message : "Could not load rooms.");
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
          message: favoriteError instanceof Error ? favoriteError.message : "Try again." } }));
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
            <h1 tabIndex={-1}>Rooms</h1>
          </div>
          <Button onClick={() => setCreating(true)}>
            <Plus /> New room
          </Button>
        </div>

        {error && (
          <Alert variant="destructive" className="lobby-error">
            <AlertCircle />
            <AlertTitle>Couldn't load rooms</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
            <AlertAction><Button variant="ghost" size="sm" onClick={() => void loadRooms()} disabled={refreshing || favoritePending.size > 0}>Retry</Button><Button variant="ghost" size="icon-xs" onClick={() => setError("")} aria-label="Dismiss error"><X /></Button></AlertAction>
          </Alert>
        )}
        {Object.values(favoriteFailures).map(failure => <Alert key={failure.slug} variant="destructive" className="lobby-error lobby-favorite-error">
          <AlertCircle />
          <AlertTitle>Couldn't {failure.favorite ? "add" : "remove"} {failure.name} {failure.favorite ? "to" : "from"} favorites</AlertTitle>
          <AlertDescription>{failure.message}</AlertDescription>
          <AlertAction><Button variant="ghost" size="sm" aria-label={`${favoritePending.has(failure.slug) ? "Retrying…" : "Retry"} favorite change for ${failure.name}`} disabled={favoritePending.has(failure.slug)} onClick={() => void updateFavorite(failure, failure.favorite)}>{favoritePending.has(failure.slug) ? "Retrying…" : "Retry"}</Button><Button variant="ghost" size="icon-xs" aria-label={`Dismiss favorite error for ${failure.name}`} onClick={() => setFavoriteFailures(current => { const updated = { ...current }; delete updated[failure.slug]; return updated; })}><X /></Button></AlertAction>
        </Alert>)}

        <div className="lobby-directory-bar">
          <div className="lobby-scopes" role="group" aria-label="Room views">
            {([['all', 'All rooms'], ['favorite', 'Favorites'], ['member', 'Your rooms']] as const).map(([value, label]) =>
              <Button key={value} variant="ghost" aria-pressed={scope === value} onClick={() => setScope(value)}>{label}</Button>
            )}
          </div>
          <div className="lobby-directory-tools">
            <div className="lobby-search"><Search aria-hidden="true" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a room" aria-label="Find a room" /></div>
            <Popover.Root open={filtersOpen} onOpenChange={setFiltersOpen}>
              <Popover.Trigger render={<Button variant="outline" className="lobby-filter-trigger" aria-label="Filter & sort" />}>
                <SlidersHorizontal /><span>Filter & sort</span>{filterCount > 0 && <span className="lobby-filter-count" aria-hidden="true">{filterCount}</span>}
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Positioner side="bottom" align="end" sideOffset={8} collisionPadding={12} className="lobby-filter-positioner">
                  <Popover.Popup className="lobby-filter-popover">
                    <div className="lobby-filter-heading"><Popover.Title>Filter & sort</Popover.Title><Popover.Close render={<Button variant="ghost" size="icon-sm" aria-label="Close filters" />}><X /></Popover.Close></div>
                    <div className="lobby-filter-field"><Label htmlFor="directory-filter">Show</Label><Select value={filter} onValueChange={value => setFilter(value as typeof filter)}>
                      <SelectTrigger id="directory-filter" aria-label="Filter rooms"><SelectValue>{filter === "active" ? "Listening now" : filter === "protected" ? "Protected rooms" : "All rooms"}</SelectValue></SelectTrigger>
                      <SelectContent><SelectItem value="all">All rooms</SelectItem><SelectItem value="active">Listening now</SelectItem><SelectItem value="protected">Protected rooms</SelectItem></SelectContent>
                    </Select></div>
                    <div className="lobby-filter-field"><Label htmlFor="directory-sort">Sort by</Label><Select value={sort} onValueChange={value => setSort(value as typeof sort)}>
                      <SelectTrigger id="directory-sort" aria-label="Sort rooms"><SelectValue>{sort === "favorite" ? "Favorites first" : sort === "alphabetical" ? "Alphabetical" : "Recent & active"}</SelectValue></SelectTrigger>
                      <SelectContent><SelectItem value="active">Recent & active</SelectItem><SelectItem value="favorite">Favorites first</SelectItem><SelectItem value="alphabetical">Alphabetical</SelectItem></SelectContent>
                    </Select></div>
                    {(availableTags.length > 0 || tag) && <div className="lobby-filter-field"><Label htmlFor="directory-tag">Tag</Label><Select value={tag} onValueChange={value => setTag(String(value))}><SelectTrigger id="directory-tag" aria-label="Room tag"><SelectValue>{tag || "All tags"}</SelectValue></SelectTrigger><SelectContent><SelectItem value="">All tags</SelectItem>{[...new Set([...availableTags, ...(tag ? [tag] : [])])].map(value => <SelectItem value={value} key={value}>{value}</SelectItem>)}</SelectContent></Select></div>}
                    {(availableLanguages.length > 0 || language) && <div className="lobby-filter-field"><Label htmlFor="directory-language">Language</Label><Select value={language} onValueChange={value => setLanguage(String(value))}><SelectTrigger id="directory-language" aria-label="Room language"><SelectValue>{language || "All languages"}</SelectValue></SelectTrigger><SelectContent><SelectItem value="">All languages</SelectItem>{[...new Set([...availableLanguages, ...(language ? [language] : [])])].map(value => <SelectItem value={value} key={value}>{value}</SelectItem>)}</SelectContent></Select></div>}
                    <div className="lobby-filter-footer"><Button variant="ghost" size="sm" aria-label="Reset filter options" disabled={filterCount === 0} onClick={resetOptions}>Reset</Button><Popover.Close render={<Button size="sm" variant="secondary" />}>Done</Popover.Close></div>
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
            <Button variant="ghost" size="icon" onClick={() => void loadRooms()} disabled={refreshing || favoritePending.size > 0} aria-label={refreshing ? "Refreshing rooms" : "Refresh rooms"} title="Refresh rooms"><RefreshCw className={refreshing ? "spin" : undefined} /></Button>
          </div>
        </div>
        <div className="lobby-filter-summary">
          <p role="status">{loading ? "Loading rooms…" : directoryLoaded ? `${visibleRooms.length} ${visibleRooms.length === 1 ? "room" : "rooms"}` : ""}</p>
          <div className="lobby-applied-filters">
            {filter !== "all" && <span>{filter === "active" ? "Listening now" : "Protected rooms"}</span>}
            {sort !== "active" && <span>{sort === "favorite" ? "Favorites first" : "Alphabetical"}</span>}
            {tag && <span>{tag}</span>}{language && <span>{language}</span>}
            {(filtering || sort !== "active") && <Button variant="ghost" size="sm" onClick={resetDirectory}>Reset filters</Button>}
          </div>
        </div>
        {loading ? (
          <div className="lobby-loading" aria-label="Loading rooms" aria-busy="true">
            {[0, 1, 2].map(item => <Skeleton key={item} className="h-24 rounded-lg" />)}
          </div>
        ) : (
          <div className="lobby-directory-results">
            {!rooms.length && directoryLoaded && <Empty><EmptyHeader><EmptyMedia variant="icon"><Radio /></EmptyMedia><EmptyTitle>No rooms available</EmptyTitle><EmptyDescription>Open an invite to join a private room.</EmptyDescription></EmptyHeader><Button variant="outline" onClick={() => setCreating(true)}>Create room</Button></Empty>}
            {visibleRooms.length > 0 && <ul className="room-directory-list" aria-label="Rooms">{visibleRooms.map(room => <li key={room.slug}><RoomRow room={room} lastVisited={room.slug === lastVisitedSlug} onEnter={enter} onFavorite={toggleFavorite} favoritePending={favoritePending.has(room.slug)} now={now} /></li>)}</ul>}
            {rooms.length > 0 && visibleRooms.length === 0 && <Empty className="lobby-empty"><EmptyHeader><EmptyMedia variant="icon"><Radio /></EmptyMedia><EmptyTitle>{filtering ? "No matching rooms" : scope === "favorite" ? "No favorite rooms" : "You haven't joined any rooms"}</EmptyTitle></EmptyHeader><Button variant="outline" onClick={resetDirectory}>Browse all rooms</Button></Empty>}
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
  const preview = room.isPublic && !room.passwordProtected ? room.preview : undefined;
  const previewStale = preview && now - preview.observedAt > 90_000;
  const roleLabel = room.role === "dj" ? "DJ role" : room.role ? room.role[0].toUpperCase() + room.role.slice(1) : null;
  return <article className="room-directory-row" aria-label={room.name}>
    <div className="directory-room-art" aria-hidden="true">
      {preview?.artworkUrl ? <TrackArtwork track={{ provider: preview.provider || "youtube", providerId: "" }} src={preview.artworkUrl} compact /> : <Radio />}
    </div>
    <div className="directory-room-copy">
      <div className="directory-room-title"><h2 title={room.name}>{room.name}</h2>{lastVisited && <span className="directory-last-visited">Last visited</span>}</div>
      <div className="directory-room-meta">
        <span className="directory-listeners"><Users aria-hidden="true" />{room.listenerCount} listening</span>
        {roleLabel && <span>{roleLabel}</span>}
        {room.passwordProtected && <Badge variant="outline"><LockKeyhole />Protected</Badge>}
        {(room.accessMode === "members" || !room.isPublic) && <Badge variant="outline">Members only</Badge>}
        {room.accessMode === "unlisted" && <Badge variant="outline">Unlisted</Badge>}
        {room.language && <span>{room.language}</span>}
        {room.tags?.map(tag => <span key={tag}>{tag}</span>)}
      </div>
      {room.description && <p className="directory-room-description">{room.description}</p>}
    </div>
    {preview && <div className="directory-track">
      <span className={preview.playing && !previewStale ? "directory-track-playing" : undefined}>{previewStale ? "Preview is out of date" : preview.playing ? "Playing" : "Paused"}</span>
      <strong title={preview.title}>{preview.title}</strong>
      {preview.artist && <span className="directory-track-artist" title={preview.artist}>{preview.artist}</span>}
    </div>}
    <div className="directory-room-actions">
      <Button variant="ghost" size="icon" className={room.isFavorite ? "text-primary" : "text-muted-foreground"}
        onClick={() => onFavorite(room)} aria-label={`${room.isFavorite ? "Remove" : "Add"} ${room.name} ${room.isFavorite ? "from" : "to"} favorites`}
        aria-pressed={room.isFavorite} disabled={favoritePending} title={room.isFavorite ? "Remove from favorites" : "Add to favorites"}>
        <Heart fill={room.isFavorite ? "currentColor" : "none"} />
      </Button>
      <Button variant="secondary" className="directory-join" data-navigation-focus={`room:${room.slug}`} onClick={() => onEnter(room)} aria-label={`Join ${room.name}`}>Join <ArrowRight /></Button>
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
        && createError.message !== "The request timed out. Try again." && createError.message !== "The server returned an invalid response. Try again."
        ? createError.message : "Creation wasn't confirmed. Refresh rooms before creating another.");
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
            <DialogTitle>Create a room</DialogTitle>
            <DialogDescription className="sr-only">Name and access settings.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="room-name">Room name</Label>
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
                placeholder="Friday focus"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="room-password">Password <span className="font-normal text-muted-foreground">Optional</span></Label>
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
                placeholder="No password"
              />
            </div>
            <div className="grid gap-2"><Label htmlFor="new-room-access">Room access</Label><Select value={roomAccess} onValueChange={value => setRoomAccess(value as typeof roomAccess)}><SelectTrigger id="new-room-access" disabled={saving}><SelectValue>{roomAccess === "public" ? "Public" : roomAccess === "unlisted" ? "Unlisted" : "Members only"}</SelectValue></SelectTrigger><SelectContent><SelectItem value="public">Public</SelectItem><SelectItem value="unlisted">Unlisted</SelectItem><SelectItem value="members">Members only</SelectItem></SelectContent></Select>{roomAccess === "unlisted" && <p className="room-setting-help">Anyone with the room address can join. Hidden from discovery.</p>}</div>
          </div>
          {error && <div className="dialog-error" role="alert">{error}</div>}
          {saving && <p className="text-sm text-muted-foreground" role="status">Wait for room creation to finish.</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving || !name.trim()}>{saving ? "Creating…" : "Create room"}</Button>
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
  const [password, setPassword] = useState("");
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <form className="grid gap-5" onSubmit={(event) => { event.preventDefault(); onSubmit(password); }}>
          <DialogHeader>
            <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-secondary text-muted-foreground"><LockKeyhole className="size-4" /></div>
            <DialogTitle>{roomName}</DialogTitle>
            <DialogDescription className="sr-only">Enter the room password to join.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="join-password">Password</Label>
            <Input id="join-password" autoFocus required type="password" maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} />
          </div>
          {error && <div className="dialog-error" role="alert">{error}</div>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!password}>Join room</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
