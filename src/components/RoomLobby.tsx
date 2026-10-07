import { FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowRight, Globe2, Heart, LockKeyhole, LogOut, MoreHorizontal, Plus, Radio, RefreshCw, Users, X } from "lucide-react";
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
import { Switch } from "./ui/switch";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./ui/alert";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { Skeleton } from "./ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import type { RoomDirectoryEntry, User } from "../types";
import { readStoredValue, storeValue } from "../lib/browser-storage";
import { TrackArtwork } from "./TrackArtwork";
import { readRecentRoomVisits } from "../lib/room-visits";
import "../styles/layout-completion.css";
import { requestJson } from "../lib/authenticated-http";

const directoryCache = new Map<string, RoomDirectoryEntry[]>();
function readDirectoryPreferences(userId: string) {
  try {
    const value: unknown = JSON.parse(readStoredValue(`soundspin:room-directory:${userId}`) || "{}");
    return value && typeof value === "object" ? value as { query?: string; filter?: string; sort?: string } : {};
  }
  catch { return {}; }
}

interface RoomLobbyProps {
  accessToken: string;
  currentUser: User;
  onOpenRoom: (slug: string, password?: string) => void;
  onOpenProfile: () => void;
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
  onSignOut,
  feedbackButton,
  adminButton
}: RoomLobbyProps) {
  const [rooms, setRooms] = useState<RoomDirectoryEntry[]>(() => directoryCache.get(currentUser.id) || []);
  const [loading, setLoading] = useState(() => !directoryCache.has(currentUser.id));
  const [directoryLoaded, setDirectoryLoaded] = useState(() => directoryCache.has(currentUser.id));
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState(() => { const value = readDirectoryPreferences(currentUser.id).query; return typeof value === "string" ? value : ""; });
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
  useEffect(() => { if (preferencesUserRef.current === currentUser.id) storeValue(`soundspin:room-directory:${currentUser.id}`, JSON.stringify({ query, filter, sort })); }, [currentUser.id, query, filter, sort]);
  const [favoritePending, setFavoritePending] = useState<Set<string>>(new Set());
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
      setFilter(preferences.filter === "active" || preferences.filter === "protected" ? preferences.filter : "all");
      setSort(preferences.sort === "favorite" || preferences.sort === "alphabetical" ? preferences.sort : "active");
      preferencesUserRef.current = currentUser.id;
    }
    setRooms(directoryCache.get(currentUser.id) || []);
    setFavoritePending(new Set());
    setLoading(!directoryCache.has(currentUser.id));
    setDirectoryLoaded(directoryCache.has(currentUser.id));
    const controller = new AbortController();
    void loadRooms(controller.signal);
    return () => { requestRef.current += 1; accountRef.current += 1; controller.abort(); };
  }, [loadRooms]);

  const visibleRooms = useMemo(() => rooms.filter((room) =>
    room.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) &&
    (filter !== "active" || room.listenerCount > 0) && (filter !== "protected" || room.passwordProtected)
  ).sort((left, right) => (sort === "active" ? right.listenerCount - left.listenerCount : sort === "favorite" ? Number(right.isFavorite) - Number(left.isFavorite) : 0) || left.name.localeCompare(right.name)), [rooms, query, filter, sort]);
  const favorites = visibleRooms.filter((room) => room.isFavorite);
  const memberRooms = visibleRooms.filter((room) => room.role !== null);
  const publicRooms = visibleRooms.filter((room) => room.isPublic);
  const accessibleRecentRooms = recentVisits.map(visit => rooms.find(room => room.slug === visit.slug)).filter((room): room is RoomDirectoryEntry => Boolean(room));
  const recentRooms = accessibleRecentRooms.filter(room => visibleRooms.some(visible => visible.slug === room.slug));
  const lastRoom = accessibleRecentRooms[0] && visibleRooms.some(room => room.slug === accessibleRecentRooms[0].slug) ? accessibleRecentRooms[0] : null;
  const filtering = Boolean(query.trim()) || filter !== "all";

  const enter = (room: RoomDirectoryEntry) => {
    if (room.passwordProtected) setProtectedRoom(room);
    else onOpenRoom(room.slug);
  };

  const toggleFavorite = async (room: RoomDirectoryEntry) => {
    if (favoritePending.has(room.slug)) return;
    const next = !room.isFavorite;
    const accountRequest = accountRef.current;
    setFavoritePending((current) => new Set(current).add(room.slug));
    setRooms((current) => { const updated = current.map((item) => item.slug === room.slug ? { ...item, isFavorite: next } : item); directoryCache.set(currentUser.id, updated); return updated; });
    try {
      await api(`/api/rooms/${room.slug}/favorite`, accessToken, {
        method: "PUT",
        body: JSON.stringify({ favorite: next })
      });
    } catch (favoriteError) {
      if (accountRequest === accountRef.current) {
        setRooms((current) => { const updated = current.map((item) => item.slug === room.slug ? { ...item, isFavorite: !next } : item); directoryCache.set(currentUser.id, updated); return updated; });
        setError(favoriteError instanceof Error ? favoriteError.message : "Could not update favorite.");
      }
    } finally {
      if (accountRequest === accountRef.current) setFavoritePending((current) => { const pending = new Set(current); pending.delete(room.slug); return pending; });
    }
  };

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
            <span><strong>{currentUser.name}</strong><small>Profile</small></span>
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
            <AlertTitle>Couldn't update rooms</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
            <AlertAction><Button variant="ghost" size="sm" onClick={() => void loadRooms()} disabled={refreshing || favoritePending.size > 0}>Retry</Button><Button variant="ghost" size="icon-xs" onClick={() => setError("")} aria-label="Dismiss error"><X /></Button></AlertAction>
          </Alert>
        )}

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
        <div className="lobby-filter-summary"><p role="status">{!loading && directoryLoaded && `${visibleRooms.length} ${visibleRooms.length === 1 ? "room" : "rooms"}${filtering ? " match your filters" : " available"}${refreshing ? " · refreshing previews" : ""}`}</p>{(filtering || sort !== "active") && <Button variant="ghost" size="sm" onClick={() => { setQuery(""); setFilter("all"); setSort("active"); }}>Reset room filters</Button>}</div>
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
            {rooms.some((room) => room.role !== null) && <RoomSection
              title="Your rooms" rooms={memberRooms}
              onEnter={enter} onFavorite={toggleFavorite} favoritePending={favoritePending} filtering={filtering} now={now}
            />}
            {rooms.length > 0 && <RoomSection
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
      </div>

      {creating && (
        <CreateRoomDialog
          accessToken={accessToken}
          onClose={() => setCreating(false)}
          onCreated={(slug, password) => onOpenRoom(slug, password)}
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
                  <div><small>{now - room.preview.observedAt > 90_000 ? "Older preview · refresh to update" : room.preview.playing ? "Playing now" : "Room paused"}</small><strong title={room.preview.title}>{room.preview.title}</strong>{room.preview.artist && <span>{room.preview.artist}</span>}</div>
                </div>}
              </div>}
              <CardContent className="room-card-content">
                <div className="room-card-badges">
                  {room.passwordProtected && <Badge variant="outline"><LockKeyhole /> Protected</Badge>}
                  {room.role === "owner" && <Badge variant="secondary">Owner</Badge>}
                  {room.role === "moderator" && <Badge variant="secondary">Moderator</Badge>}
                  {room.role === "dj" && <Badge variant="secondary">DJ role</Badge>}
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
            {filtering && <EmptyDescription>Try another name or filter.</EmptyDescription>}
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
  const [isPublic, setIsPublic] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = await api<{ room: { slug: string } }>("/api/rooms", accessToken, {
        method: "POST",
        body: JSON.stringify({ name, isPublic, password: password || undefined })
      });
      onCreated(payload.room.slug, password || undefined);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create room.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <form className="grid gap-5" autoComplete="off" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Create a room</DialogTitle>
            <DialogDescription>DJ queues are private. Each DJ plays one track per turn.</DialogDescription>
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
                autoComplete="new-password"
                data-1p-ignore
                data-lpignore="true"
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="No password"
              />
            </div>
            <div className="switch-row">
              <span><Globe2 /><span><strong>Public room</strong><small>Show in the room directory</small></span></span>
              <Switch checked={isPublic} onCheckedChange={setIsPublic} aria-label="Public room" />
            </div>
          </div>
          {error && <div className="dialog-error" role="alert">{error}</div>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
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
            <DialogDescription>Enter the room password to join.</DialogDescription>
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
