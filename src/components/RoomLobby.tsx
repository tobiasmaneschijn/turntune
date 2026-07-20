import { FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { ArrowRight, Globe2, Heart, LockKeyhole, LogOut, Plus, Radio, Users, X } from "lucide-react";
import { Avatar } from "./Avatar";
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
import type { RoomDirectoryEntry, User } from "../types";

interface RoomLobbyProps {
  accessToken: string;
  currentUser: User;
  onOpenRoom: (slug: string, password?: string) => void;
  onOpenProfile: () => void;
  onSignOut: () => void;
  feedbackButton: ReactNode;
}

async function api<T>(path: string, accessToken: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers
    }
  });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Something went wrong.");
  return payload;
}

function Brand() {
  return (
    <div className="logo" aria-label="SoundSpin">
      <span className="logo-mark"><i /><i /><i /></span>
      <span>SoundSpin</span>
    </div>
  );
}

export function RoomLobby({
  accessToken,
  currentUser,
  onOpenRoom,
  onOpenProfile,
  onSignOut,
  feedbackButton
}: RoomLobbyProps) {
  const [rooms, setRooms] = useState<RoomDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [protectedRoom, setProtectedRoom] = useState<RoomDirectoryEntry | null>(null);

  const loadRooms = async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await api<{ rooms: RoomDirectoryEntry[] }>("/api/rooms", accessToken);
      setRooms(payload.rooms);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load rooms.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadRooms(); }, [accessToken]);

  const favorites = useMemo(() => rooms.filter((room) => room.isFavorite), [rooms]);
  const publicRooms = useMemo(() => rooms.filter((room) => room.isPublic), [rooms]);

  const enter = (room: RoomDirectoryEntry) => {
    if (room.passwordProtected) setProtectedRoom(room);
    else onOpenRoom(room.slug);
  };

  const toggleFavorite = async (room: RoomDirectoryEntry) => {
    const next = !room.isFavorite;
    setRooms((current) => current.map((item) => item.slug === room.slug ? { ...item, isFavorite: next } : item));
    try {
      await api(`/api/rooms/${room.slug}/favorite`, accessToken, {
        method: "PUT",
        body: JSON.stringify({ favorite: next })
      });
    } catch (favoriteError) {
      setRooms((current) => current.map((item) => item.slug === room.slug ? { ...item, isFavorite: !next } : item));
      setError(favoriteError instanceof Error ? favoriteError.message : "Could not update favorite.");
    }
  };

  return (
    <main className="room-lobby">
      <header className="lobby-header">
        <Brand />
        <div className="lobby-header-actions">
          {feedbackButton}
          <Button variant="ghost" className="lobby-profile h-10 px-2" onClick={onOpenProfile}>
            <Avatar user={currentUser} size={28} />
            <span><strong>{currentUser.name}</strong><small>Profile</small></span>
          </Button>
          <Button variant="ghost" size="sm" onClick={onSignOut} className="text-muted-foreground">
            <LogOut /> Sign out
          </Button>
        </div>
      </header>

      <div className="lobby-shell">
        <section className="lobby-hero">
          <div>
            <p className="section-kicker">ROOMS</p>
            <h1>Listen together.</h1>
            <p>Rejoin a favorite room or see what is playing now.</p>
          </div>
          <Button size="lg" onClick={() => setCreating(true)}>
            <Plus /> New room
          </Button>
        </section>

        {error && (
          <div className="lobby-error" role="alert">
            <span>{error}</span>
            <Button variant="ghost" size="icon-xs" onClick={() => setError("")}><X /></Button>
          </div>
        )}

        {loading ? (
          <div className="lobby-loading"><div className="equalizer"><i /><i /><i /><i /></div><span>Loading rooms…</span></div>
        ) : (
          <div className="lobby-sections">
            {favorites.length > 0 && (
              <RoomSection
                title="Favorites"
                subtitle="Your saved rooms"
                rooms={favorites}
                empty=""
                onEnter={enter}
                onFavorite={toggleFavorite}
              />
            )}
            <RoomSection
              title="Public rooms"
              subtitle={`${publicRooms.length} available`}
              rooms={publicRooms}
              empty="No public rooms yet. Create one to get started."
              onEnter={enter}
              onFavorite={toggleFavorite}
            />
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
  subtitle,
  rooms,
  empty,
  onEnter,
  onFavorite
}: {
  title: string;
  subtitle: string;
  rooms: RoomDirectoryEntry[];
  empty: string;
  onEnter: (room: RoomDirectoryEntry) => void;
  onFavorite: (room: RoomDirectoryEntry) => void;
}) {
  return (
    <section className="room-directory-section">
      <div className="directory-heading">
        <div><h2>{title}</h2><p>{subtitle}</p></div>
      </div>
      {rooms.length ? (
        <div className="room-card-grid">
          {rooms.map((room) => (
            <Card className="room-card" size="sm" key={room.slug}>
              <CardHeader className="room-card-header">
                <span className="room-card-art"><Radio /></span>
                <div className="min-w-0">
                  <CardTitle className="truncate">{room.name}</CardTitle>
                  <CardDescription className="mt-1 flex items-center gap-1.5">
                    <Users className="size-3.5" /> {room.listenerCount} listening
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={room.isFavorite ? "text-primary" : "text-muted-foreground"}
                  onClick={() => void onFavorite(room)}
                  title={room.isFavorite ? "Remove from favorites" : "Add to favorites"}
                >
                  <Heart fill={room.isFavorite ? "currentColor" : "none"} />
                </Button>
              </CardHeader>
              <CardContent className="room-card-content">
                <div className="room-card-badges">
                  {room.passwordProtected && <Badge variant="outline"><LockKeyhole /> Protected</Badge>}
                  {room.role === "owner" && <Badge variant="secondary">Owner</Badge>}
                  {room.role === "moderator" && <Badge variant="secondary">Moderator</Badge>}
                  {room.role === "dj" && <Badge variant="secondary">DJ role</Badge>}
                </div>
                <Button variant="secondary" size="sm" onClick={() => onEnter(room)}>
                  Join <ArrowRight />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : <div className="empty-room-section">{empty}</div>}
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
            <DialogDescription>Start a shared queue. You can change access and moderators later.</DialogDescription>
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
            <DialogDescription>This room is protected. Enter its password to join.</DialogDescription>
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
