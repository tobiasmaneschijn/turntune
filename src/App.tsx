import { FormEvent, useEffect, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { Avatar } from "./components/Avatar";
import {
  CopyIcon,
  MessageIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  SkipIcon,
  UsersIcon
} from "./components/Icons";
import { YouTubePlayer } from "./components/YouTubePlayer";
import { ForgotPasswordForm } from "./components/forgot-password-form";
import { LoginForm } from "./components/login-form";
import { SignUpForm } from "./components/sign-up-form";
import { UpdatePasswordForm } from "./components/update-password-form";
import { RealtimeChat } from "./components/realtime-chat";
import type { ChatMessage as RealtimeChatMessage } from "./hooks/use-realtime-chat";
import { socket } from "./socket";
import { getSupabaseClient } from "./supabase";
import type { RoomSnapshot, User } from "./types";

function randomId() {
  return crypto.randomUUID();
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function getRoomId() {
  const match = location.pathname.match(/^\/room\/([a-z0-9-]+)/);
  return match?.[1] || null;
}

function readProfile(): User {
  const stored = localStorage.getItem("soundspin-profile");
  if (stored) {
    try {
      return JSON.parse(stored) as User;
    } catch {
      // Create a fresh profile below.
    }
  }
  return { id: randomId(), name: "", avatarSeed: randomId() };
}

function youtubeId(value: string) {
  try {
    const url = new URL(value);
    if (url.hostname === "youtu.be") return url.pathname.slice(1).split("/")[0];
    if (url.hostname.endsWith("youtube.com")) {
      if (url.pathname.startsWith("/shorts/")) return url.pathname.split("/")[2];
      return url.searchParams.get("v");
    }
  } catch {
    if (/^[a-zA-Z0-9_-]{11}$/.test(value)) return value;
  }
  return null;
}

export function App() {
  const [profile, setProfile] = useState(readProfile);
  const [roomId, setRoomId] = useState(getRoomId);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [notice, setNotice] = useState("");
  const [auth, setAuth] = useState<{
    loading: boolean;
    client: SupabaseClient | null;
    session: Session | null;
    enabled: boolean;
    recovery: boolean;
  }>({ loading: true, client: null, session: null, enabled: false, recovery: false });

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    void getSupabaseClient()
      .then(async (client) => {
        if (!active) return;
        if (!client) {
          setAuth({ loading: false, client: null, session: null, enabled: false, recovery: false });
          return;
        }

        const { data } = await client.auth.getSession();
        if (!active) return;
        const recovery = new URLSearchParams(location.hash.slice(1)).get("type") === "recovery";
        setAuth({ loading: false, client, session: data.session, enabled: true, recovery });

        const { data: listener } = client.auth.onAuthStateChange((event, session) => {
          if (active) {
            setAuth((current) => ({
              loading: false,
              client,
              session,
              enabled: true,
              recovery: event === "PASSWORD_RECOVERY"
                ? true
                : event === "SIGNED_IN" || event === "SIGNED_OUT"
                  ? false
                  : current.recovery
            }));
          }
        });
        unsubscribe = () => listener.subscription.unsubscribe();
      })
      .catch((error) => {
        console.error(error);
        if (active) setAuth({ loading: false, client: null, session: null, enabled: false, recovery: false });
      });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    const authUser = auth.session?.user;
    if (!authUser || profile.id === authUser.id) return;
    const nextProfile = {
      id: authUser.id,
      name: String(authUser.user_metadata.display_name || authUser.email?.split("@")[0] || ""),
      avatarSeed: authUser.id
    };
    localStorage.setItem("soundspin-profile", JSON.stringify(nextProfile));
    setProfile(nextProfile);
  }, [auth.session?.user.id, profile.id]);

  useEffect(() => {
    if (auth.enabled && !auth.session) {
      socket.disconnect();
      setSnapshot(null);
    }
  }, [auth.enabled, auth.session]);

  useEffect(() => {
    const onPopState = () => {
      setRoomId(getRoomId());
      setSnapshot(null);
    };
    addEventListener("popstate", onPopState);
    return () => removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!roomId || !profile.name) return;
    if (auth.loading || (auth.enabled && !auth.session)) return;
    socket.auth = auth.enabled ? { accessToken: auth.session!.access_token } : {};
    socket.connect();
    const onConnect = () => {
      setConnected(true);
      socket.emit("room:join", { roomId, roomName: history.state?.roomName, user: profile }, (result: { ok: boolean; error?: string }) => {
        if (!result.ok) setNotice(result.error || "Could not join the room.");
      });
    };
    const onDisconnect = () => setConnected(false);
    const onConnectError = (error: Error) => setNotice(error.message);
    const onSnapshot = (next: RoomSnapshot) => setSnapshot(next);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("room:snapshot", onSnapshot);
    if (socket.connected) onConnect();
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("room:snapshot", onSnapshot);
    };
  }, [roomId, profile.id, profile.name, profile.avatarSeed, auth.loading, auth.enabled, auth.session?.access_token]);

  const enterRoom = (name: string, roomName?: string) => {
    const nextProfile = { ...profile, name: name.trim() };
    localStorage.setItem("soundspin-profile", JSON.stringify(nextProfile));
    setProfile(nextProfile);
    if (auth.client && auth.session) {
      void auth.client.auth.updateUser({ data: { display_name: nextProfile.name } });
    }
    const id = roomId || `${slugify(roomName || "room")}-${Math.random().toString(36).slice(2, 7)}`;
    history.pushState({ roomName: roomId ? undefined : roomName?.trim() }, "", `/room/${id}`);
    setRoomId(id);
  };

  if (auth.loading || (auth.enabled && auth.session && profile.id !== auth.session.user.id)) {
    return <LoadingScreen label="Restoring your session…" />;
  }

  if (auth.enabled && !auth.session) {
    return <AuthScreen client={auth.client!} />;
  }

  if (auth.enabled && auth.session && auth.recovery) {
    return (
      <PasswordRecoveryScreen
        client={auth.client!}
        onComplete={() => {
          history.replaceState({}, "", "/");
          setAuth((current) => ({ ...current, recovery: false }));
        }}
      />
    );
  }

  if (!roomId || !profile.name) {
    return <Welcome initialName={profile.name} joining={Boolean(roomId)} onEnter={enterRoom} />;
  }

  if (!snapshot) {
    return <LoadingScreen label={notice || (connected ? "Tuning into the room…" : "Connecting…")} />;
  }

  const isDj = snapshot.room.djUserId === profile.id;

  return (
    <main className="app-shell">
      <header className="topbar">
        <Logo />
        <div className="room-heading">
          <span className="live-dot" />
          <div>
            <strong>{snapshot.room.name}</strong>
            <small>{snapshot.users.length} listening now</small>
          </div>
        </div>
        <div className="header-actions">
          <button
            className="icon-button invite-button"
            onClick={() => {
              void navigator.clipboard.writeText(location.href);
              setNotice("Invite link copied");
              window.setTimeout(() => setNotice(""), 1800);
            }}
          >
            <CopyIcon size={17} />
            <span>Invite</span>
          </button>
          <Avatar user={profile} size={38} />
          {auth.enabled && (
            <button className="sign-out" onClick={() => void auth.client?.auth.signOut()}>
              Sign out
            </button>
          )}
        </div>
      </header>

      {notice && <div className="toast">{notice}</div>}

      <section className="room-layout">
        <div className="music-column">
          <NowPlaying snapshot={snapshot} isDj={isDj} />
          <Queue snapshot={snapshot} isDj={isDj} setNotice={setNotice} />
        </div>
        <RoomChat
          snapshot={snapshot}
          currentUser={profile}
          client={auth.client!}
        />
      </section>
    </main>
  );
}

function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="loading-screen">
      <Logo />
      <div className="equalizer"><i /><i /><i /><i /></div>
      <p>{label}</p>
    </div>
  );
}

function AuthScreen({ client }: { client: SupabaseClient }) {
  const [path, setPath] = useState(location.pathname);
  const navigate = (nextPath: string) => {
    history.pushState({}, "", nextPath);
    setPath(nextPath);
  };

  const form = path === "/sign-up"
    ? <SignUpForm client={client} onNavigate={navigate} className="w-full" />
    : path === "/forgot-password"
      ? <ForgotPasswordForm client={client} onNavigate={navigate} className="w-full" />
      : <LoginForm client={client} onNavigate={navigate} className="w-full" />;

  return (
    <main className="welcome auth-welcome">
      <div className="welcome-glow glow-one" />
      <div className="welcome-glow glow-two" />
      <nav><Logo /><span>Your room will be waiting.</span></nav>
      <section className="auth-content">
        <div>
          <div className="eyebrow"><span /> WELCOME TO SOUNDSPIN</div>
          <h1>Sign in.<br /><em>Stay in sync.</em></h1>
          <p>Your rooms, profile, and queue follow you. SoundSpin keeps your session active until you choose to sign out.</p>
        </div>
        {form}
      </section>
    </main>
  );
}

function PasswordRecoveryScreen({
  client,
  onComplete
}: {
  client: SupabaseClient;
  onComplete: () => void;
}) {
  return (
    <main className="welcome auth-welcome">
      <div className="welcome-glow glow-one" />
      <div className="welcome-glow glow-two" />
      <nav><Logo /><span>Secure your account.</span></nav>
      <section className="auth-content">
        <div>
          <div className="eyebrow"><span /> ACCOUNT RECOVERY</div>
          <h1>Fresh start.<br /><em>Same rooms.</em></h1>
          <p>Choose a new password and you'll return to SoundSpin with your rooms and profile intact.</p>
        </div>
        <UpdatePasswordForm client={client} onComplete={onComplete} className="w-full" />
      </section>
    </main>
  );
}

function Logo() {
  return (
    <div className="logo">
      <span className="logo-mark"><i /><i /><i /></span>
      <span>SoundSpin</span>
    </div>
  );
}

function Welcome({
  initialName,
  joining,
  onEnter
}: {
  initialName: string;
  joining: boolean;
  onEnter: (name: string, roomName?: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const [roomName, setRoomName] = useState("Friday Focus");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() && (joining || roomName.trim())) onEnter(name, roomName);
  };

  return (
    <main className="welcome">
      <div className="welcome-glow glow-one" />
      <div className="welcome-glow glow-two" />
      <nav><Logo /><span>Music is better together.</span></nav>
      <section className="welcome-content">
        <div className="eyebrow"><span /> YOUR TEAM'S SHARED RADIO</div>
        <h1>One room.<br /><em>Everyone in sync.</em></h1>
        <p>Drop a track, share the link, and turn the workday into something worth listening to.</p>
        <form className="welcome-card" onSubmit={submit}>
          <label>
            Your display name
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Alex" maxLength={32} autoFocus />
          </label>
          {!joining && (
            <label>
              Name your room
              <input value={roomName} onChange={(event) => setRoomName(event.target.value)} placeholder="Friday Focus" maxLength={48} />
            </label>
          )}
          <button type="submit">{joining ? "Join the room" : "Start listening"} <span>→</span></button>
        </form>
      </section>
      <footer>Built for teams who work better with a soundtrack.</footer>
    </main>
  );
}

function NowPlaying({ snapshot, isDj }: { snapshot: RoomSnapshot; isDj: boolean }) {
  const playback = snapshot.room.playback;
  const track = playback.track;

  const update = (playing: boolean) => {
    const position = playback.position + (playback.playing ? (Date.now() - playback.updatedAt) / 1000 : 0);
    socket.emit("playback:update", { playing, position });
  };

  return (
    <section className="now-playing panel">
      <div className="section-kicker">NOW PLAYING</div>
      {track ? (
        <>
          <div className="track-stage">
            <img src={`https://i.ytimg.com/vi/${track.providerId}/hqdefault.jpg`} alt="" />
            <YouTubePlayer
              playback={playback}
              isDj={isDj}
              onEnded={() => socket.emit("queue:next")}
            />
            <div className="record-ring ring-one" />
            <div className="record-ring ring-two" />
          </div>
          <div className="current-track">
            <div>
              <h2>{track.title}</h2>
              <p>Added by {track.addedBy.name} · YouTube</p>
            </div>
            <div className="player-controls">
              <button disabled={!isDj} className="round-button primary" onClick={() => update(!playback.playing)} aria-label={playback.playing ? "Pause" : "Play"}>
                {playback.playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
              </button>
              <button disabled={!isDj} className="round-button" onClick={() => socket.emit("queue:next")} aria-label="Next track">
                <SkipIcon size={20} />
              </button>
            </div>
          </div>
          <div className="sync-status">
            <span className={playback.playing ? "pulse" : ""} />
            {isDj ? "You're the DJ" : `Synced with the DJ`}
          </div>
        </>
      ) : (
        <div className="empty-player">
          <span className="empty-disc"><PlayIcon size={28} /></span>
          <h2>The room is quiet</h2>
          <p>Add a YouTube track to start the radio.</p>
        </div>
      )}
    </section>
  );
}

function Queue({
  snapshot,
  isDj,
  setNotice
}: {
  snapshot: RoomSnapshot;
  isDj: boolean;
  setNotice: (message: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");

  const add = (event: FormEvent) => {
    event.preventDefault();
    const providerId = youtubeId(url);
    if (!providerId) return setNotice("Please enter a valid YouTube URL");
    socket.emit(
      "queue:add",
      { provider: "youtube", providerId, title: title.trim() || "YouTube track" },
      (result: { ok: boolean; error?: string }) => {
        if (!result.ok) return setNotice(result.error || "Could not add track");
        setUrl("");
        setTitle("");
        setAdding(false);
      }
    );
  };

  return (
    <section className="queue panel">
      <div className="panel-title">
        <div>
          <span>UP NEXT</span>
          <small>{snapshot.room.queue.length} tracks in the queue</small>
        </div>
        <button className="add-track" onClick={() => setAdding(!adding)}><PlusIcon size={17} /> Add track</button>
      </div>
      {adding && (
        <form className="add-form" onSubmit={add}>
          <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Paste a YouTube link" autoFocus />
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Track title (optional)" />
          <button type="submit">Add</button>
        </form>
      )}
      <div className="queue-list">
        {snapshot.room.queue.map((track, index) => (
          <button
            className="queue-row"
            key={track.id}
            disabled={!isDj}
            onClick={() => socket.emit("queue:play", track.id)}
          >
            <span className="queue-number">{String(index + 1).padStart(2, "0")}</span>
            <img src={`https://i.ytimg.com/vi/${track.providerId}/default.jpg`} alt="" />
            <span className="queue-copy">
              <strong>{track.title}</strong>
              <small>Added by {track.addedBy.name}</small>
            </span>
            <Avatar user={track.addedBy} size={28} />
          </button>
        ))}
        {!snapshot.room.queue.length && <p className="empty-list">The queue is wide open. Add something good.</p>}
      </div>
    </section>
  );
}

function RoomChat({
  snapshot,
  currentUser,
  client
}: {
  snapshot: RoomSnapshot;
  currentUser: User;
  client: SupabaseClient;
}) {
  const [messages, setMessages] = useState<RealtimeChatMessage[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void client
      .from("soundspin_messages")
      .select("id, content, user_id, user_name, avatar_seed, created_at")
      .eq("room_slug", snapshot.room.id)
      .order("created_at", { ascending: false })
      .limit(200)
      .then(({ data, error: loadError }) => {
        if (!active) return;
        if (loadError) {
          setError("Chat history is unavailable until the realtime-chat migration is deployed.");
          return;
        }
        setMessages(
          (data || []).reverse().map((message) => ({
            id: message.id,
            content: message.content,
            user: {
              id: message.user_id,
              name: message.user_name,
              avatarSeed: message.avatar_seed
            },
            createdAt: message.created_at
          }))
        );
      });
    return () => {
      active = false;
    };
  }, [client, snapshot.room.id]);

  const persistMessage = async (message: RealtimeChatMessage) => {
    const { error: insertError } = await client.from("soundspin_messages").insert({
      id: message.id,
      room_slug: snapshot.room.id,
      user_id: currentUser.id,
      user_name: currentUser.name,
      avatar_seed: currentUser.avatarSeed,
      content: message.content,
      created_at: message.createdAt
    });
    if (insertError) setError("The message was sent live but could not be saved to history.");
  };

  return (
    <aside className="chat panel">
      <div className="chat-header">
        <div><MessageIcon size={18} /><strong>Room chat</strong></div>
        <span><UsersIcon size={15} /> {snapshot.users.length}</span>
      </div>
      <div className="people-strip">
        {snapshot.users.map((user) => (
          <div className="person" key={user.id}>
            <Avatar user={user} size={34} />
            <span>{user.id === currentUser.id ? "You" : user.name.split(" ")[0]}</span>
            {user.id === snapshot.room.djUserId && <i>DJ</i>}
          </div>
        ))}
      </div>
      <div className="supabase-chat-body">
        {error && <div className="chat-error">{error}</div>}
        <RealtimeChat
          client={client}
          roomName={`soundspin:${snapshot.room.id}`}
          user={currentUser}
          messages={messages}
          onSend={persistMessage}
        />
      </div>
    </aside>
  );
}
