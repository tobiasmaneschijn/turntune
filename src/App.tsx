import { FormEvent, useEffect, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import {
  Check,
  ChevronDown,
  ChevronsUp,
  Clock3,
  GripVertical,
  Heart,
  ListMusic,
  Maximize2,
  Minimize2,
  Search,
  Trash2,
  ThumbsDown,
  Volume2
} from "lucide-react";
import { Avatar } from "./components/Avatar";
import { ProfilePage } from "./components/ProfilePage";
import {
  CopyIcon,
  MessageIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  SkipIcon,
  UsersIcon
} from "./components/Icons";
import { YouTubePlayer, type YouTubePlayerStatus } from "./components/YouTubePlayer";
import { ForgotPasswordForm } from "./components/forgot-password-form";
import { LoginForm } from "./components/login-form";
import { SignUpForm } from "./components/sign-up-form";
import { UpdatePasswordForm } from "./components/update-password-form";
import { RealtimeChat } from "./components/realtime-chat";
import type { ChatMessage as RealtimeChatMessage } from "./hooks/use-realtime-chat";
import { socket } from "./socket";
import { getSupabaseClient } from "./supabase";
import type { RoomSnapshot, SoundSpinProfile, User } from "./types";

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

function getProfilePageId() {
  const match = location.pathname.match(/^\/profile\/([0-9a-f-]{36})$/i);
  return match?.[1] || null;
}

function readProfile(): User {
  const stored = localStorage.getItem("soundspin-profile");
  if (stored) {
    try {
      return { avatarKey: "pulse", ...(JSON.parse(stored) as User) };
    } catch {
      // Create a fresh profile below.
    }
  }
  return { id: randomId(), name: "", avatarSeed: randomId(), avatarKey: "pulse" };
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
  const [profilePageId, setProfilePageId] = useState(getProfilePageId);
  const [profileReady, setProfileReady] = useState(false);
  const [profileRefresh, setProfileRefresh] = useState(0);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [compactPlayer, setCompactPlayer] = useState(false);
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
          setProfileReady(true);
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
      avatarSeed: authUser.id,
      avatarKey: "pulse"
    };
    localStorage.setItem("soundspin-profile", JSON.stringify(nextProfile));
    setProfile(nextProfile);
  }, [auth.session?.user.id, profile.id]);

  useEffect(() => {
    const session = auth.session;
    if (!auth.enabled) {
      setProfileReady(true);
      return;
    }
    if (!session || !auth.client) {
      setProfileReady(false);
      return;
    }

    let active = true;
    setProfileReady(false);
    void fetch(`/api/profiles/${session.user.id}`, {
      headers: { Authorization: `Bearer ${session.access_token}` }
    })
      .then(async (response) => {
        const payload = await response.json() as { profile?: SoundSpinProfile };
        if (!response.ok || !payload.profile) return;
        const nextProfile: User = {
          id: payload.profile.user_id,
          name: payload.profile.display_name,
          avatarSeed: payload.profile.user_id,
          avatarKey: payload.profile.avatar_key
        };
        if (active) {
          localStorage.setItem("soundspin-profile", JSON.stringify(nextProfile));
          setProfile(nextProfile);
        }
      })
      .catch(() => {
        // The room join path will create a missing profile after migrations deploy.
      })
      .finally(() => {
        if (active) setProfileReady(true);
      });
    return () => { active = false; };
  }, [auth.enabled, auth.client, auth.session?.user.id, auth.session?.access_token]);

  useEffect(() => {
    if (auth.enabled && !auth.session) {
      socket.disconnect();
      setSnapshot(null);
    }
  }, [auth.enabled, auth.session]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const onPopState = () => {
      const nextRoomId = getRoomId();
      setRoomId((currentRoomId) => {
        if (currentRoomId !== nextRoomId) setSnapshot(null);
        return nextRoomId;
      });
      setProfilePageId(getProfilePageId());
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
    const onXp = (event: { amount: number; message: string }) => {
      setNotice(`+${event.amount} XP · ${event.message}`);
      setProfileRefresh((revision) => revision + 1);
    };
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("room:snapshot", onSnapshot);
    socket.on("profile:xp", onXp);
    if (socket.connected) onConnect();
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("room:snapshot", onSnapshot);
      socket.off("profile:xp", onXp);
    };
  }, [roomId, profile.id, profile.name, profile.avatarSeed, profile.avatarKey, auth.loading, auth.enabled, auth.session?.access_token]);

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

  if (auth.loading || (auth.enabled && auth.session && (profile.id !== auth.session.user.id || !profileReady))) {
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

  const openProfile = (userId: string) => {
    history.pushState({ from: location.pathname }, "", `/profile/${userId}`);
    setProfilePageId(userId);
  };

  if (profilePageId && auth.session) {
    return (
      <ProfilePage
        key={`${profilePageId}:${profileRefresh}`}
        profileId={profilePageId}
        accessToken={auth.session.access_token}
        currentUser={profile}
        onBack={() => {
          if (history.state?.from) history.back();
          else {
            history.pushState({}, "", "/");
            setProfilePageId(null);
          }
        }}
        onOwnProfileUpdated={(updated) => {
          const nextProfile = {
            id: updated.user_id,
            name: updated.display_name,
            avatarSeed: updated.user_id,
            avatarKey: updated.avatar_key
          };
          localStorage.setItem("soundspin-profile", JSON.stringify(nextProfile));
          setProfile(nextProfile);
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
          <button className="header-profile-button" onClick={() => openProfile(profile.id)} title="Open your profile">
            <Avatar user={profile} size={38} />
          </button>
          {auth.enabled && (
            <button className="sign-out" onClick={() => void auth.client?.auth.signOut()}>
              Sign out
            </button>
          )}
        </div>
      </header>

      {notice && <div className="toast">{notice}</div>}

      <section className={`room-layout ${compactPlayer ? "compact-player-layout" : ""}`}>
        <MusicRail
          snapshot={snapshot}
          isDj={isDj}
          currentUserId={profile.id}
          accessToken={auth.session?.access_token}
          setNotice={setNotice}
        />
        <div className="player-column">
          <NowPlaying
            snapshot={snapshot}
            isDj={isDj}
            currentUserId={profile.id}
            compact={compactPlayer}
            onToggleCompact={() => setCompactPlayer((compact) => !compact)}
          />
        </div>
        <RoomChat
          snapshot={snapshot}
          currentUser={profile}
          client={auth.client!}
          onOpenProfile={openProfile}
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

function VibeMeter({
  snapshot,
  currentUserId
}: {
  snapshot: RoomSnapshot;
  currentUserId: string;
}) {
  const track = snapshot.room.playback.track;
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
  const score = eligibleListenerCount
    ? votes.reduce<number>((total, vote) => total + vote, 0) / eligibleListenerCount
    : 0;
  const currentVote = vibe?.votes[currentUserId];
  const addedByCurrentUser = track?.addedBy.id === currentUserId;
  const litMarkers = votes.length ? Math.round(((score + 1) / 2) * 8) : 4;
  const label =
    !votes.length ? "Be the first" :
    score >= .55 ? "Electric" :
    score >= .15 ? "Feeling it" :
    score <= -.55 ? "Not landing" :
    score <= -.15 ? "Cooling off" :
    "Mixed vibes";

  const vote = (value: -1 | 1) => {
    if (addedByCurrentUser) return;
    socket.emit("vibe:vote", { value: currentVote === value ? 0 : value });
  };

  return (
    <section className="vibe-meter" aria-label="Vibe meter for the current track">
      <div className="vibe-meter-heading">
        <span>VIBE METER</span>
        <small>
          {addedByCurrentUser
            ? "You added this track"
            : `${votes.length} / ${eligibleListenerCount} voted`}
        </small>
      </div>
      <div className="vibe-meter-body">
        <button
          type="button"
          className={currentVote === -1 ? "active negative" : ""}
          aria-pressed={currentVote === -1}
          disabled={addedByCurrentUser}
          title={addedByCurrentUser ? "You cannot vote on a track you added" : undefined}
          onClick={() => vote(-1)}
        >
          <ThumbsDown size={16} />
          <span>Not my vibe</span>
        </button>
        <div className="vibe-dial">
          <div className="vibe-lights" aria-hidden="true">
            {Array.from({ length: 9 }, (_, index) => {
              const radians = Math.PI + (index / 8) * Math.PI;
              return (
                <i
                  key={index}
                  className={index <= litMarkers ? "lit" : ""}
                  style={{
                    left: `${50 + Math.cos(radians) * 43}%`,
                    top: `${91 + Math.sin(radians) * 75}%`
                  }}
                />
              );
            })}
          </div>
          <div className="vibe-arc" />
          <span className="vibe-low">LOW</span>
          <span className="vibe-high">HIGH</span>
          <div
            className="vibe-needle"
            style={{ transform: `translateX(-50%) rotate(${score * 68}deg)` }}
          />
          <div className="vibe-hub" />
          <strong>{label}</strong>
        </div>
        <button
          type="button"
          className={currentVote === 1 ? "active positive" : ""}
          aria-pressed={currentVote === 1}
          disabled={addedByCurrentUser}
          title={addedByCurrentUser ? "You cannot vote on a track you added" : undefined}
          onClick={() => vote(1)}
        >
          <Heart size={16} />
          <span>Love it</span>
        </button>
      </div>
    </section>
  );
}

function NowPlaying({
  snapshot,
  isDj,
  currentUserId,
  compact,
  onToggleCompact
}: {
  snapshot: RoomSnapshot;
  isDj: boolean;
  currentUserId: string;
  compact: boolean;
  onToggleCompact: () => void;
}) {
  const playback = snapshot.room.playback;
  const track = playback.track;
  const [volume, setVolume] = useState(80);
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const [playerStatus, setPlayerStatus] = useState<YouTubePlayerStatus>({
    ready: false,
    buffering: false,
    currentTime: 0,
    duration: 0
  });

  useEffect(() => {
    setSeekPreview(null);
  }, [playback.updatedAt, playback.track?.id]);

  const update = (playing: boolean) => {
    const position = playback.position + (playback.playing ? (Date.now() - playback.updatedAt) / 1000 : 0);
    socket.emit("playback:update", { playing, position });
  };

  const commitSeek = () => {
    if (!isDj || seekPreview === null) return;
    socket.emit("playback:update", { playing: playback.playing, position: seekPreview });
  };

  const shownPosition = seekPreview ?? playerStatus.currentTime;

  return (
    <section className={`now-playing panel ${compact ? "compact" : ""}`}>
      <div className="now-playing-heading">
        <div className="section-kicker">NOW PLAYING</div>
        <button type="button" onClick={onToggleCompact} title={compact ? "Expand player" : "Use compact player"}>
          {compact ? <Maximize2 size={15} /> : <Minimize2 size={15} />}
          <span>{compact ? "Expand" : "Compact"}</span>
        </button>
      </div>
      {track ? (
        <>
          <div className="track-stage">
            <img src={`https://i.ytimg.com/vi/${track.providerId}/hqdefault.jpg`} alt="" />
            <YouTubePlayer
              playback={playback}
              isDj={isDj}
              volume={volume}
              onEnded={() => socket.emit("queue:next")}
              onStatus={setPlayerStatus}
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
          <div className="playback-progress">
            <span>{formatPlaybackTime(shownPosition)}</span>
            <input
              type="range"
              min={0}
              max={Math.max(playerStatus.duration, 1)}
              step={1}
              value={Math.min(shownPosition, Math.max(playerStatus.duration, 1))}
              disabled={!isDj || !playerStatus.duration}
              aria-label="Playback position"
              onChange={(event) => setSeekPreview(Number(event.target.value))}
              onPointerUp={commitSeek}
              onKeyUp={commitSeek}
            />
            <span>{formatPlaybackTime(playerStatus.duration)}</span>
          </div>
          <div className="player-footer">
            <div className="sync-status">
              <span className={playback.playing ? "pulse" : ""} />
              {playerStatus.buffering
                ? "Buffering…"
                : isDj
                  ? "You're the DJ"
                  : "Synced with the DJ"}
            </div>
            <label className="volume-control">
              <Volume2 size={14} />
              <input
                type="range"
                min={0}
                max={100}
                value={volume}
                aria-label="Volume"
                onChange={(event) => setVolume(Number(event.target.value))}
              />
            </label>
          </div>
          <VibeMeter snapshot={snapshot} currentUserId={currentUserId} />
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

interface YouTubeSearchResult {
  id: string;
  title: string;
  channel: string;
  thumbnail: string;
  duration?: string;
}

function MusicRail({
  snapshot,
  isDj,
  currentUserId,
  accessToken,
  setNotice
}: {
  snapshot: RoomSnapshot;
  isDj: boolean;
  currentUserId: string;
  accessToken?: string;
  setNotice: (message: string) => void;
}) {
  const [tab, setTab] = useState<"history" | "search" | "queue">("queue");
  const [provider, setProvider] = useState<"youtube" | "spotify" | "apple" | "soundcloud">("youtube");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<YouTubeSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [addingResultId, setAddingResultId] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [draggedTrackId, setDraggedTrackId] = useState("");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);

  const addTrack = async (trackUrl: string, trackTitle?: string) => {
    const providerId = youtubeId(trackUrl);
    if (!providerId) return setNotice("Please enter a valid YouTube URL");

    let resolvedTitle = trackTitle?.trim();
    if (!resolvedTitle) {
      try {
        const response = await fetch(
          `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${providerId}`)}&format=json`
        );
        if (response.ok) {
          const metadata = await response.json() as { title?: string };
          resolvedTitle = metadata.title;
        }
      } catch {
        // Fall back to a generic title if YouTube metadata is unavailable.
      }
    }

    socket.emit(
      "queue:add",
      { provider: "youtube", providerId, title: resolvedTitle || "YouTube track" },
      (result: { ok: boolean; error?: string; started?: boolean; position?: number }) => {
        setAddingResultId("");
        if (!result.ok) return setNotice(result.error || "Could not add track");
        setNotice(
          result.started
            ? "Started playing"
            : `Added to the shared queue${result.position ? ` · #${result.position}` : ""}`
        );
        setUrl("");
        setTitle("");
        setAdding(false);
        setManualOpen(false);
        setTab("queue");
      }
    );
  };

  const add = (event: FormEvent) => {
    event.preventDefault();
    void addTrack(url, title);
  };

  const addAgain = (track: RoomSnapshot["room"]["history"][number]) => {
    void addTrack(track.providerId, track.title);
  };

  const searchYouTube = async (event: FormEvent) => {
    event.preventDefault();
    const searchQuery = query.trim();
    if (searchQuery.length < 2) return setSearchError("Enter at least 2 characters.");

    setSearching(true);
    setSearchError("");
    try {
      const response = await fetch(`/api/youtube/search?q=${encodeURIComponent(searchQuery)}`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined
      });
      const payload = await response.json() as {
        results?: YouTubeSearchResult[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "Could not search YouTube.");
      setSearchResults(payload.results || []);
    } catch (error) {
      setSearchResults([]);
      setSearchError(error instanceof Error ? error.message : "Could not search YouTube.");
    } finally {
      setSearching(false);
    }
  };

  const addSearchResult = (result: YouTubeSearchResult) => {
    setAddingResultId(result.id);
    void addTrack(result.id, result.title);
  };

  const queueAction = (
    event: "queue:remove" | "queue:play-next",
    trackId: string,
    successMessage: string
  ) => {
    socket.emit(event, { trackId }, (result: { ok: boolean; error?: string }) => {
      setNotice(result.ok ? successMessage : result.error || "Could not update the queue.");
    });
  };

  const moveQueueTrack = (trackId: string, toIndex: number) => {
    socket.emit("queue:move", { trackId, toIndex }, (result: { ok: boolean; error?: string }) => {
      if (!result.ok) setNotice(result.error || "Could not reorder the queue.");
    });
  };

  return (
    <aside className="music-rail panel">
      <div className="music-rail-heading">
        <span>MUSIC</span>
        <strong>Shared by everyone</strong>
      </div>

      <div className="music-tabs" role="tablist" aria-label="Music tools">
        <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>
          <Clock3 size={14} /> History
        </button>
        <button className={tab === "search" ? "active" : ""} onClick={() => setTab("search")}>
          <Search size={14} /> Search
        </button>
        <button className={tab === "queue" ? "active" : ""} onClick={() => setTab("queue")}>
          <ListMusic size={14} /> Queue
          {snapshot.room.queue.length > 0 && <i>{snapshot.room.queue.length}</i>}
        </button>
      </div>

      {tab === "search" && (
        <div className="rail-pane search-pane">
          <div className="rail-pane-title">
            <span>SEARCH MUSIC</span>
            <small>Add results to the shared queue</small>
          </div>
          <form className="provider-search-form" onSubmit={searchYouTube}>
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search YouTube"
              autoFocus
            />
            {query && (
              <button
                type="button"
                className="clear-search"
                aria-label="Clear search"
                onClick={() => {
                  setQuery("");
                  setSearchResults([]);
                  setSearchError("");
                }}
              >
                ×
              </button>
            )}
            <span className="provider-divider" />
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value as typeof provider)}
              aria-label="Music provider"
            >
              <option value="youtube">YouTube</option>
              <option value="spotify" disabled>Spotify · Soon</option>
              <option value="apple" disabled>Apple Music · Soon</option>
              <option value="soundcloud" disabled>SoundCloud · Soon</option>
            </select>
            <button type="submit" className="search-submit" disabled={searching || provider !== "youtube"}>
              {searching ? "…" : "Go"}
            </button>
          </form>

          <div className="search-result-list">
            {searchError && <div className="rail-search-state error">{searchError}</div>}
            {!searchError && searching && (
              <div className="rail-search-state"><div className="equalizer"><i /><i /><i /><i /></div><span>Searching YouTube…</span></div>
            )}
            {!searchError && !searching && searchResults.map((result) => (
              (() => {
                const queued =
                  snapshot.room.playback.track?.providerId === result.id ||
                  snapshot.room.queue.some((track) => track.providerId === result.id);
                return (
                  <div className="search-result-row" key={result.id}>
                    <span className="search-provider-mark">▶</span>
                    <img src={result.thumbnail} alt="" />
                    <span className="search-result-copy">
                      <strong>{result.title}</strong>
                      <small>{result.channel}{result.duration ? ` · ${result.duration}` : ""}</small>
                    </span>
                    <button
                      type="button"
                      className={queued ? "added" : ""}
                      title={queued ? "Already in the room" : "Add to shared queue"}
                      disabled={queued || addingResultId === result.id}
                      onClick={() => addSearchResult(result)}
                    >
                      {queued ? <Check size={15} /> : addingResultId === result.id ? "…" : <PlusIcon size={15} />}
                    </button>
                  </div>
                );
              })()
            ))}
            {!searchError && !searching && !searchResults.length && (
              <div className="rail-search-state">
                <Search size={22} />
                <span>Search YouTube for a song, artist, or video.</span>
              </div>
            )}
          </div>

          <div className={`manual-add ${manualOpen ? "open" : ""}`}>
            <button className="manual-add-heading" type="button" onClick={() => setManualOpen((open) => !open)}>
              <span>ADD BY URL</span>
              <small>YouTube URL or video ID <ChevronDown size={13} /></small>
            </button>
            {manualOpen && (
              <form className="rail-manual-add" onSubmit={add}>
                <input
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="youtube.com/watch?v=…"
                  autoFocus
                />
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Title (optional)"
                />
                <button type="submit"><PlusIcon size={14} /> Add manually</button>
              </form>
            )}
          </div>
        </div>
      )}

      {tab === "history" && (
        <div className="rail-pane">
          <div className="rail-pane-title">
            <span>RECENTLY PLAYED</span>
            <small>{snapshot.room.history.length} tracks</small>
          </div>
          <div className="rail-track-list">
            {snapshot.room.history.map((track, index) => (
              <div className="rail-track-row" key={`${track.id}-${index}`}>
                <img src={`https://i.ytimg.com/vi/${track.providerId}/default.jpg`} alt="" />
                <span className="rail-track-copy">
                  <strong>{track.title}</strong>
                  <small>Added by {track.addedBy.name}</small>
                </span>
                <button title="Add to queue again" onClick={() => addAgain(track)}>
                  <PlusIcon size={14} />
                </button>
              </div>
            ))}
            {!snapshot.room.history.length && (
              <div className="rail-empty"><Clock3 size={22} /><p>Played tracks will appear here.</p></div>
            )}
          </div>
        </div>
      )}

      {tab === "queue" && (
        <div className="rail-pane">
          <div className="rail-pane-title queue-title">
            <div>
              <span>SHARED QUEUE</span>
              <small>Anyone can add tracks</small>
            </div>
            <button className="rail-add-button" onClick={() => { setAdding(!adding); setTab("queue"); }}>
              <PlusIcon size={14} /> Add
            </button>
          </div>
          {adding && (
            <form className="rail-quick-add" onSubmit={add}>
              <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Paste YouTube link" autoFocus />
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title (optional)" />
              <button type="submit">Add to queue</button>
            </form>
          )}
          <div className="rail-track-list">
            {snapshot.room.queue.map((track, index) => {
              const canRemove = isDj || track.addedBy.id === currentUserId;
              return (
              <div
                className={`rail-track-row queue-track ${draggedTrackId === track.id ? "dragging" : ""}`}
                key={track.id}
                draggable={isDj}
                role={isDj ? "button" : undefined}
                tabIndex={isDj ? 0 : undefined}
                title={isDj ? "Play this track now" : `Queue position ${index + 1}`}
                onClick={() => {
                  if (isDj) socket.emit("queue:play", track.id);
                }}
                onKeyDown={(event) => {
                  if (isDj && (event.key === "Enter" || event.key === " ")) {
                    event.preventDefault();
                    socket.emit("queue:play", track.id);
                  }
                }}
                onDragStart={() => setDraggedTrackId(track.id)}
                onDragEnd={() => setDraggedTrackId("")}
                onDragOver={(event) => {
                  if (isDj) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (isDj && draggedTrackId && draggedTrackId !== track.id) {
                    moveQueueTrack(draggedTrackId, index);
                  }
                  setDraggedTrackId("");
                }}
              >
                <span className="queue-drag-handle" title={isDj ? "Drag to reorder" : `Queue position ${index + 1}`}>
                  {isDj ? <GripVertical size={14} /> : String(index + 1).padStart(2, "0")}
                </span>
                <img src={`https://i.ytimg.com/vi/${track.providerId}/default.jpg`} alt="" />
                <span className="rail-track-copy">
                  <strong>{track.title}</strong>
                  <small>#{index + 1} · {track.addedBy.name}</small>
                </span>
                <span className="queue-track-actions">
                  {isDj && index > 0 && (
                    <button
                      type="button"
                      title="Play next"
                      onClick={(event) => {
                        event.stopPropagation();
                        queueAction("queue:play-next", track.id, "Moved to play next");
                      }}
                    >
                      <ChevronsUp size={14} />
                    </button>
                  )}
                  {canRemove && (
                    <button
                      type="button"
                      title="Remove from queue"
                      onClick={(event) => {
                        event.stopPropagation();
                        queueAction("queue:remove", track.id, "Removed from queue");
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </span>
              </div>
            )})}
            {!snapshot.room.queue.length && (
              <div className="rail-empty"><ListMusic size={22} /><p>The shared queue is empty.</p></div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}

function RoomChat({
  snapshot,
  currentUser,
  client,
  onOpenProfile
}: {
  snapshot: RoomSnapshot;
  currentUser: User;
  client: SupabaseClient;
  onOpenProfile: (userId: string) => void;
}) {
  const [messages, setMessages] = useState<RealtimeChatMessage[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void client
      .from("soundspin_messages")
      .select("id, content, message_type, media_url, storage_path, user_id, user_name, avatar_seed, created_at")
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
            type: message.message_type,
            mediaUrl: message.media_url || undefined,
            storagePath: message.storage_path || undefined,
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
      message_type: message.type,
      media_url: message.mediaUrl || null,
      storage_path: message.storagePath || null,
      created_at: message.createdAt
    });
    if (insertError) setError("The message was sent live but could not be saved to history.");
  };

  return (
    <aside className="chat panel">
      <div className="chat-header">
        <div><MessageIcon size={18} /><strong>Room chat</strong></div>
        <div className="chat-presence">
          <div className="chat-presence-avatars">
            {snapshot.users.slice(0, 5).map((user) => (
              <span
                key={user.id}
                className={user.id === snapshot.room.djUserId ? "chat-presence-dj" : undefined}
                title={`${user.id === currentUser.id ? "You" : user.name}${user.id === snapshot.room.djUserId ? " · DJ" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => onOpenProfile(user.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") onOpenProfile(user.id);
                }}
              >
                <Avatar user={user} size={26} />
              </span>
            ))}
            {snapshot.users.length > 5 && <i>+{snapshot.users.length - 5}</i>}
          </div>
          <span><UsersIcon size={14} /> {snapshot.users.length}</span>
        </div>
      </div>
      <div className="supabase-chat-body">
        {error && <div className="chat-error">{error}</div>}
        <RealtimeChat
          client={client}
          roomName={`soundspin:${snapshot.room.id}`}
          user={currentUser}
          messages={messages}
          onSend={persistMessage}
          onOpenProfile={onOpenProfile}
        />
      </div>
    </aside>
  );
}
