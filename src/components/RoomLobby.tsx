import { FormEvent, useEffect, useMemo, useState } from "react";
import { Globe2, Heart, LockKeyhole, Plus, Radio, Users, X } from "lucide-react";
import { Avatar } from "./Avatar";
import type { RoomDirectoryEntry, User } from "../types";

interface RoomLobbyProps {
  accessToken: string;
  currentUser: User;
  onOpenRoom: (slug: string, password?: string) => void;
  onOpenProfile: () => void;
  onSignOut: () => void;
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

export function RoomLobby({
  accessToken,
  currentUser,
  onOpenRoom,
  onOpenProfile,
  onSignOut
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
      <div className="lobby-glow lobby-glow-one" />
      <div className="lobby-glow lobby-glow-two" />
      <header className="lobby-header">
        <div className="logo">
          <span className="logo-mark"><i /><i /><i /></span>
          <span>SoundSpin</span>
        </div>
        <div className="lobby-header-actions">
          <button className="lobby-profile" onClick={onOpenProfile}>
            <Avatar user={currentUser} size={38} />
            <span><strong>{currentUser.name}</strong><small>View profile</small></span>
          </button>
          <button className="sign-out" onClick={onSignOut}>Sign out</button>
        </div>
      </header>

      <div className="lobby-shell">
        <section className="lobby-hero">
          <div>
            <span className="section-kicker">YOUR SHARED RADIOS</span>
            <h1>Where are we<br /><em>listening today?</em></h1>
            <p>Jump back into a favorite or discover a room that is live right now.</p>
          </div>
          <button className="create-room-button" onClick={() => setCreating(true)}>
            <Plus size={18} /> Create a room
          </button>
        </section>

        {error && <div className="lobby-error">{error}<button onClick={() => setError("")}><X size={14} /></button></div>}

        {loading ? (
          <div className="lobby-loading"><div className="equalizer"><i /><i /><i /><i /></div><span>Finding rooms…</span></div>
        ) : (
          <div className="lobby-sections">
            <RoomSection
              title="Favorites"
              subtitle="Your rooms, one click away"
              rooms={favorites}
              empty="Favorite a room and it will stay close at hand."
              onEnter={enter}
              onFavorite={toggleFavorite}
            />
            <RoomSection
              title="Public rooms"
              subtitle={`${publicRooms.length} room${publicRooms.length === 1 ? "" : "s"} open to everyone`}
              rooms={publicRooms}
              empty="No public rooms yet. Create the first one."
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
        <Radio size={18} />
      </div>
      {rooms.length ? (
        <div className="room-card-grid">
          {rooms.map((room) => (
            <article className="room-card" key={room.slug}>
              <button
                className={`favorite-room ${room.isFavorite ? "active" : ""}`}
                onClick={() => void onFavorite(room)}
                title={room.isFavorite ? "Remove from favorites" : "Add to favorites"}
              >
                <Heart size={16} fill={room.isFavorite ? "currentColor" : "none"} />
              </button>
              <button className="room-card-main" onClick={() => onEnter(room)}>
                <span className="room-card-art"><Radio size={25} /></span>
                <span className="room-card-copy">
                  <span className="room-card-badges">
                    {room.passwordProtected && <i><LockKeyhole size={10} /> Protected</i>}
                    {room.role === "owner" && <i className="role-badge">Owner</i>}
                    {room.role === "moderator" && <i className="role-badge">Moderator</i>}
                  </span>
                  <strong>{room.name}</strong>
                  <small><Users size={12} /> {room.listenerCount} listening</small>
                </span>
                <span className="enter-room">Join <b>→</b></span>
              </button>
            </article>
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
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <form className="room-dialog" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="dialog-close" onClick={onClose}><X size={17} /></button>
        <span className="section-kicker">NEW ROOM</span>
        <h2>Start a shared radio</h2>
        <p>You will be the owner. You can rename it and appoint moderators later.</p>
        <label>Room name<input autoFocus required maxLength={48} value={name} onChange={(event) => setName(event.target.value)} placeholder="Vinterradio" /></label>
        <label>Password <small>Optional</small><input type="password" maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Leave empty for no password" /></label>
        <label className="switch-row">
          <span><Globe2 size={16} /><span><strong>Public room</strong><small>Show this room in the public directory</small></span></span>
          <input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} />
        </label>
        {error && <div className="dialog-error">{error}</div>}
        <button className="dialog-submit" disabled={saving || !name.trim()}>{saving ? "Creating…" : "Create room"}</button>
      </form>
    </div>
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
    <div className="dialog-backdrop">
      <form className="room-dialog password-dialog" onSubmit={(event) => { event.preventDefault(); onSubmit(password); }}>
        <button type="button" className="dialog-close" onClick={onClose}><X size={17} /></button>
        <span className="password-dialog-icon"><LockKeyhole size={24} /></span>
        <span className="section-kicker">PROTECTED ROOM</span>
        <h2>{roomName}</h2>
        <p>Enter the room password to join the listening session.</p>
        <label>Password<input autoFocus required type="password" maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error && <div className="dialog-error">{error}</div>}
        <button className="dialog-submit" disabled={!password}>Unlock room</button>
      </form>
    </div>
  );
}
