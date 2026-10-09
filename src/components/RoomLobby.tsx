import { FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowRight, Heart, LockKeyhole, LogOut, MoreHorizontal, Plus, Radio, RefreshCw, Users, X } from "lucide-react";
import { Avatar } from "./Avatar";
import { Brand } from "./app-primitives";
import { AppVersion } from "./AppVersion";
import { ThemeToggle } from "./ThemeToggle";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import type { RoomDirectoryEntry, User } from "../types";
import { readStoredValue, storeValue } from "../lib/browser-storage";
import { TrackArtwork } from "./TrackArtwork";
import { FriendsPanel } from "./FriendsPanel";
import { readRecentRoomVisits } from "../lib/room-visits";
import "../styles/layout-completion.css";
import { requestJson } from "../lib/authenticated-http";

const directoryCache = new Map<string, RoomDirectoryEntry[]>();
interface FavoriteFailure {
  slug: string;
  name: string;
  favorite: boolean;
  message: string;
}
function readDirectoryPreferences(userId: string) {
  try {
    const value: unknown = JSON.parse(readStoredValue(`soundspin:room-directory:${userId}`) || "{}");
    return value && typeof value === "object" ? value as { query?: string; filter?: string; sort?: string; tag?: string; language?: string } : {};
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
  feedbackButton: ReactNode;
  adminButton?: ReactNode;
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
  feedbackButton,
  adminButton
}: RoomLobbyProps) {
  const [rooms, setRooms] = useState<RoomDirectoryEntry[]>(() => directoryCache.get(currentUser.id) || []);
  const [loading, setLoading] = useState(() => !directoryCache.has(currentUser.id));
  const [directoryLoaded, setDirectoryLoaded] = useState(() => directoryCache.has(currentUser.id));
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState(() => { const value = readDirectoryPreferences(currentUser.id).query; return typeof value === "string" ? value : ""; });
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
  useEffect(() => { if (preferencesUserRef.current === currentUser.id) storeValue(`soundspin:room-directory:${currentUser.id}`, JSON.stringify({ query, filter, sort, tag, language })); }, [currentUser.id, query, filter, sort, tag, language]);
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

  const visibleRooms = useMemo(() => rooms.filter((room) =>
    [room.name, room.description, ...(room.tags ?? []), room.language].filter(Boolean).join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) &&
    (!tag || room.tags?.includes(tag)) && (!language || room.language === language) &&
    (filter !== "active" || room.listenerCount > 0) && (filter !== "protected" || room.passwordProtected)
  ).sort((left, right) => (sort === "active" ? right.listenerCount - left.listenerCount : sort === "favorite" ? Number(right.isFavorite) - Number(left.isFavorite) : 0) || left.name.localeCompare(right.name)), [rooms, query, filter, sort, tag, language]);
  const availableTags = [...new Set(rooms.flatMap(room => room.tags ?? []))].sort();
  const availableLanguages = [...new Set(rooms.map(room => room.language).filter((value): value is string => Boolean(value)))].sort();
  const accessibleRecentRooms = recentVisits.map(visit => rooms.find(room => room.slug === visit.slug)).filter((room): room is RoomDirectoryEntry => Boolean(room));
  // A room belongs to one section. Recent access and membership take precedence
  // so changing its favorite state does not move those familiar cards.
  const recentSlugs = new Set(accessibleRecentRooms.map(room => room.slug));
  const favorites = visibleRooms.filter(room => room.isFavorite && room.role === null && !recentSlugs.has(room.slug));
  const memberRooms = visibleRooms.filter(room => room.role !== null && !recentSlugs.has(room.slug));
  const isOtherPublicRoom = (room: RoomDirectoryEntry) => (room.accessMode ?? (room.isPublic ? "public" : "members")) === "public" && room.role === null && !room.isFavorite && !recentSlugs.has(room.slug);
  const publicRooms = visibleRooms.filter(isOtherPublicRoom);
  const recentRooms = accessibleRecentRooms.filter(room => visibleRooms.some(visible => visible.slug === room.slug));
  const lastRoom = accessibleRecentRooms[0] && visibleRooms.some(room => room.slug === accessibleRecentRooms[0].slug) ? accessibleRecentRooms[0] : null;
  const filtering = Boolean(query.trim() || tag || language) || filter !== "all";

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
      <header className="lobby-header">
        <div className="app-brand-stack"><Brand /><AppVersion /></div>
        <div className="lobby-header-actions">
          {adminButton}
          {feedbackButton}
          <ThemeToggle compact />
          <Button variant="ghost" className="lobby-profile h-10 px-2" data-navigation-focus="lobby-profile" onClick={onOpenProfile} aria-label="Open your profile">
            <Avatar user={currentUser} size={28} />
            <span><strong>{currentUser.name}</strong></span>
          </Button>
          <Button variant="ghost" size="sm" onClick={onSignOut} className="lobby-sign-out text-muted-foreground">
            <LogOut /> Sign out
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="lobby-more-actions" aria-label="More account actions" />}><MoreHorizontal /></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="room-actions-menu">
              <DropdownMenuItem onClick={onOpenProfile}>Your profile</DropdownMenuItem>
              <DropdownMenuItem onClick={onSignOut}><LogOut /> Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="lobby-shell">
        <section className="lobby-hero">
          <div>
            <h1 tabIndex={-1}>Rooms</h1>
          </div>
          <Button size="lg" onClick={() => setCreating(true)}>
            <Plus /> New room
          </Button>
        </section>

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

        <div className="lobby-directory-tools">
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a room" aria-label="Find a room" />
          <Select value={filter} onValueChange={(value) => setFilter(value as typeof filter)}>
            <SelectTrigger aria-label="Filter rooms"><SelectValue>{filter === "active" ? "Listening now" : filter === "protected" ? "Protected rooms" : "All rooms"}</SelectValue></SelectTrigger>
            <SelectContent><SelectItem value="all">All rooms</SelectItem><SelectItem value="active">Listening now</SelectItem><SelectItem value="protected">Protected rooms</SelectItem></SelectContent>
          </Select>
          <Select value={sort} onValueChange={(value) => setSort(value as typeof sort)}>
            <SelectTrigger aria-label="Sort rooms"><SelectValue>{sort === "favorite" ? "Favorites first" : sort === "alphabetical" ? "Alphabetical" : "Active first"}</SelectValue></SelectTrigger>
            <SelectContent><SelectItem value="active">Active first</SelectItem><SelectItem value="favorite">Favorites first</SelectItem><SelectItem value="alphabetical">Alphabetical</SelectItem></SelectContent>
          </Select>
          <Button variant="outline" onClick={() => void loadRooms()} disabled={refreshing || favoritePending.size > 0} aria-label="Refresh rooms"><RefreshCw className={refreshing ? "spin" : undefined} /><span>{refreshing ? "Refreshing…" : "Refresh"}</span></Button>
        </div>
        {(availableTags.length > 0 || availableLanguages.length > 0) && <div className="lobby-discovery-filters">
          {availableTags.length > 0 && <Select value={tag} onValueChange={value => setTag(String(value))}><SelectTrigger aria-label="Room tag"><SelectValue>{tag || "All tags"}</SelectValue></SelectTrigger><SelectContent><SelectItem value="">All tags</SelectItem>{availableTags.map(value => <SelectItem value={value} key={value}>{value}</SelectItem>)}</SelectContent></Select>}
          {availableLanguages.length > 0 && <Select value={language} onValueChange={value => setLanguage(String(value))}><SelectTrigger aria-label="Room language"><SelectValue>{language || "All languages"}</SelectValue></SelectTrigger><SelectContent><SelectItem value="">All languages</SelectItem>{availableLanguages.map(value => <SelectItem value={value} key={value}>{value}</SelectItem>)}</SelectContent></Select>}
        </div>}
        <div className="lobby-filter-summary"><p role="status">{!loading && directoryLoaded && `${visibleRooms.length} ${visibleRooms.length === 1 ? "room" : "rooms"}`}</p>{(filtering || sort !== "active") && <Button variant="ghost" size="sm" onClick={() => { setQuery(""); setFilter("all"); setSort("active"); setTag(""); setLanguage(""); }}>Reset filters</Button>}</div>
        {loading ? (
          <div className="room-card-grid" aria-label="Loading rooms">
            {[0, 1, 2].map((item) => <Skeleton key={item} className="h-36 rounded-xl" />)}
          </div>
        ) : (
          <div className="lobby-sections">
            {!rooms.length && directoryLoaded && <Empty><EmptyHeader><EmptyMedia variant="icon"><Radio /></EmptyMedia><EmptyTitle>No rooms available</EmptyTitle><EmptyDescription>Open an invite to join a private room.</EmptyDescription></EmptyHeader><Button variant="outline" onClick={() => setCreating(true)}>Create room</Button></Empty>}
            {lastRoom && <section className="lobby-return-room" aria-label="Return to last room"><div><h2>Return to last room</h2><p>{lastRoom.name}</p></div><Button variant="outline" aria-label={`Return to ${lastRoom.name}`} data-navigation-focus={`room:${lastRoom.slug}`} onClick={() => enter(lastRoom)}>Return <ArrowRight /></Button></section>}
            {accessibleRecentRooms.length > 0 && <RoomSection title="Recently visited" rooms={recentRooms} onEnter={enter} onFavorite={toggleFavorite} favoritePending={favoritePending} filtering={filtering} now={now} />}
            {favorites.length > 0 && (
              <RoomSection
                title="Favorites"
                rooms={favorites}
                onEnter={enter}
                onFavorite={toggleFavorite}
                favoritePending={favoritePending}
                now={now}
              />
            )}
            {rooms.some((room) => room.role !== null && !recentSlugs.has(room.slug)) && <RoomSection
              title="Your rooms" rooms={memberRooms}
              onEnter={enter} onFavorite={toggleFavorite} favoritePending={favoritePending} filtering={filtering} now={now}
            />}
            {rooms.some(isOtherPublicRoom) && <RoomSection
              title="Public rooms"
              rooms={publicRooms}
              onEnter={enter}
              onFavorite={toggleFavorite}
              favoritePending={favoritePending}
              filtering={filtering}
              now={now}
            />}
          </div>
        )}
        <FriendsPanel accessToken={accessToken} currentUser={currentUser} onOpenRoom={onOpenRoom} onOpenPerson={onOpenPerson} />
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

function RoomSection({
  title,
  rooms,
  onEnter,
  onFavorite,
  favoritePending,
  filtering = false,
  now
}: {
  title: string;
  rooms: RoomDirectoryEntry[];
  onEnter: (room: RoomDirectoryEntry) => void;
  onFavorite: (room: RoomDirectoryEntry) => void;
  favoritePending: Set<string>;
  filtering?: boolean;
  now: number;
}) {
  return (
    <section className="room-directory-section">
      <div className="directory-heading">
        <div><h2>{title}</h2></div>
      </div>
      {rooms.length ? (
        <div className="room-card-grid">
          {rooms.map((room) => (
            <Card className="room-card" size="sm" key={room.slug}>
              <CardHeader className="room-card-header">
                <span className="room-card-art"><Radio /></span>
                <div className="min-w-0">
                  <CardTitle className="truncate" title={room.name}>{room.name}</CardTitle>
                  <CardDescription className="mt-1 flex items-center gap-1.5">
                    <Users className="size-3.5" /> {room.listenerCount} listening
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={room.isFavorite ? "text-primary" : "text-muted-foreground"}
                   onClick={() => void onFavorite(room)}
                   aria-label={`${room.isFavorite ? "Remove" : "Add"} ${room.name} ${room.isFavorite ? "from" : "to"} favorites`}
                   aria-pressed={room.isFavorite}
                   disabled={favoritePending.has(room.slug)}
                  title={room.isFavorite ? "Remove from favorites" : "Add to favorites"}
                >
                  <Heart fill={room.isFavorite ? "currentColor" : "none"} />
                </Button>
              </CardHeader>
              {(room.description || room.isPublic && !room.passwordProtected && room.preview) && <div className="room-card-preview">
                {room.description && <p className="room-card-description">{room.description}</p>}
                {room.isPublic && !room.passwordProtected && room.preview && <div className="room-preview-track">
                  <TrackArtwork track={{ provider: room.preview.provider || "youtube", providerId: "" }} src={room.preview.artworkUrl || null} compact className="room-preview-art" />
                  <div><small>{now - room.preview.observedAt > 90_000 ? "Preview is out of date" : room.preview.playing ? "Playing" : "Paused"}</small><strong title={room.preview.title}>{room.preview.title}</strong>{room.preview.artist && <span>{room.preview.artist}</span>}</div>
                </div>}
              </div>}
              <CardContent className="room-card-content">
                <div className="room-card-badges">
                  {room.passwordProtected && <Badge variant="outline"><LockKeyhole /> Protected</Badge>}
                  {(room.accessMode === "members" || !room.isPublic) && <Badge variant="outline">Members only</Badge>}
                  {room.accessMode === "unlisted" && <Badge variant="outline">Unlisted</Badge>}
                  {room.role === "member" && <Badge variant="secondary">Member</Badge>}
                  {room.role === "owner" && <Badge variant="secondary">Owner</Badge>}
                  {room.role === "moderator" && <Badge variant="secondary">Moderator</Badge>}
                  {room.role === "dj" && <Badge variant="secondary">DJ role</Badge>}
                  {room.language && <span className="room-card-language">{room.language}</span>}
                  {room.tags?.map(tag => <span className="room-card-tag" key={tag}>{tag}</span>)}
                </div>
                <Button variant="secondary" size="sm" data-navigation-focus={`room:${room.slug}`} onClick={() => onEnter(room)} aria-label={`Join ${room.name}`}>
                  Join <ArrowRight />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Empty className="empty-room-section">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Radio /></EmptyMedia>
            <EmptyTitle>{filtering ? "No matching rooms" : "No rooms yet"}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      )}
    </section>
  );
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
