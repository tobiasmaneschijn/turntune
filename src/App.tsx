import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import {
  Check,
  ChevronDown,
  Clock3,
  GripVertical,
  Heart,
  House,
  ListMusic,
  Maximize2,
  Minimize2,
  RefreshCw,
  Search,
  Settings,
  Shield,
  Trash2,
  ThumbsDown,
  Volume2
} from "lucide-react";
import { Avatar } from "./components/Avatar";
import { ProfilePage } from "./components/ProfilePage";
import { PasswordDialog, RoomLobby } from "./components/RoomLobby";
import { RoomSettingsDialog } from "./components/RoomSettingsDialog";
import { UserSettingsDialog } from "./components/UserSettingsDialog";
import { FeedbackButton } from "./components/FeedbackDialog";
import {
  CopyIcon,
  MessageIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  SkipIcon,
  UsersIcon
} from "./components/Icons";
import { SoundCloudPlayer } from "./components/SoundCloudPlayer";
import { SpotifyPlayer } from "./components/SpotifyPlayer";
import { AppleMusicPlayer } from "./components/AppleMusicPlayer";
import { YouTubePlayer, type PlayerStatus } from "./components/YouTubePlayer";
import { ForgotPasswordForm } from "./components/forgot-password-form";
import { LoginForm } from "./components/login-form";
import { SignUpForm } from "./components/sign-up-form";
import { UpdatePasswordForm } from "./components/update-password-form";
import { RealtimeChat } from "./components/realtime-chat";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import type { ChatMessage } from "./chat/model";
import { loadChatHistory, saveChatMessage } from "./chat/persistence";
import { socket } from "./socket";
import { getSupabaseClient } from "./supabase";
import { readUserSettings, saveUserSettings, type SoundSpinUserSettings } from "./playback-settings";
import type { Provider, RoomSnapshot, SoundSpinProfile, Track, User } from "./types";

type SearchProvider = Provider;

const SEARCH_PROVIDER_STORAGE_KEY = "soundspin-search-provider";

function randomId() {
  return crypto.randomUUID();
}

function showSystemNotification(title: string, body: string) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const notification = new Notification(title, { body });
  window.setTimeout(() => notification.close(), 7_000);
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
      return { avatarKey: "pulse", isAppAdmin: false, ...(JSON.parse(stored) as User) };
    } catch {
      // Create a fresh profile below.
    }
  }
  return { id: randomId(), name: "", avatarSeed: randomId(), avatarKey: "pulse", isAppAdmin: false };
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

function providerLabel(provider: Provider) {
  if (provider === "soundcloud") return "SoundCloud";
  if (provider === "spotify") return "Spotify";
  if (provider === "apple") return "Apple Music";
  return "YouTube";
}

function readSearchProvider(): SearchProvider {
  const provider = localStorage.getItem(SEARCH_PROVIDER_STORAGE_KEY);
  return provider === "soundcloud" || provider === "spotify" || provider === "apple"
    ? provider
    : "youtube";
}

function trackArtworkUrl(track: Pick<Track, "provider" | "providerId" | "artworkUrl">) {
  return track.provider === "youtube"
    ? `https://i.ytimg.com/vi/${track.providerId}/hqdefault.jpg`
    : track.artworkUrl;
}

function TrackArtwork({ track, compact = false }: { track: Track; compact?: boolean }) {
  const artwork = trackArtworkUrl(track);
  return artwork
    ? <img src={compact && track.provider === "youtube" ? artwork.replace("hqdefault", "default") : artwork} alt="" />
    : <span className={`provider-artwork ${track.provider}`}>{track.provider === "soundcloud" ? "SC" : "♪"}</span>;
}

export function App() {
  const [userSettings, setUserSettings] = useState<SoundSpinUserSettings>(readUserSettings);
  const compactPlayer = userSettings.playback.compactPlayer;
  const [profile, setProfile] = useState(readProfile);
  const [roomId, setRoomId] = useState(getRoomId);
  const [profilePageId, setProfilePageId] = useState(getProfilePageId);
  const [profileReady, setProfileReady] = useState(false);
  const [profileRefresh, setProfileRefresh] = useState(0);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [roomPassword, setRoomPassword] = useState("");
  const [roomPasswordRequired, setRoomPasswordRequired] = useState(false);
  const [roomJoinError, setRoomJoinError] = useState("");
  const [roomSettingsOpen, setRoomSettingsOpen] = useState(false);
  const [userSettingsOpen, setUserSettingsOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const previousDjUserIdRef = useRef<string | null>(null);
  const [auth, setAuth] = useState<{
    loading: boolean;
    client: SupabaseClient | null;
    session: Session | null;
    enabled: boolean;
    recovery: boolean;
  }>({ loading: true, client: null, session: null, enabled: false, recovery: false });

  const changeUserSettings = useCallback((next: SoundSpinUserSettings) => {
    setUserSettings(next);
    saveUserSettings(next);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("reduced-motion", userSettings.appearance.reducedMotion);
    document.documentElement.style.setProperty("--artwork-blur", `${userSettings.appearance.artworkBlur}px`);
  }, [userSettings.appearance.artworkBlur, userSettings.appearance.reducedMotion]);

  useEffect(() => {
    const djUserId = snapshot?.room.djUserId || null;
    if (
      djUserId === profile.id &&
      previousDjUserIdRef.current !== profile.id &&
      userSettings.notifications.djTurn
    ) {
      showSystemNotification("You’re on deck", "Your SoundSpin DJ turn has started.");
    }
    previousDjUserIdRef.current = djUserId;
  }, [snapshot?.room.djUserId, profile.id, userSettings.notifications.djTurn]);

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
      avatarKey: "pulse",
      isAppAdmin: false
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
          avatarKey: payload.profile.avatar_key,
          avatarUrl: payload.profile.avatar_url || undefined,
          isAppAdmin: payload.profile.is_app_admin
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
        if (currentRoomId !== nextRoomId) {
          setSnapshot(null);
          setRoomPassword("");
          setRoomPasswordRequired(false);
          setRoomJoinError("");
        }
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
      socket.emit("room:join", { roomId, roomName: history.state?.roomName, password: roomPassword || undefined, user: profile }, (result: { ok: boolean; error?: string; requiresPassword?: boolean }) => {
        if (result.ok) {
          setRoomPasswordRequired(false);
          setRoomJoinError("");
          return;
        }
        if (result.requiresPassword) {
          setRoomPasswordRequired(true);
          setRoomJoinError(result.error || "Enter the room password.");
        } else {
          setRoomJoinError(result.error || "Could not join the room.");
        }
      });
    };
    const onDisconnect = () => setConnected(false);
    const onConnectError = (error: Error) => setNotice(error.message);
    // Snapshots are personalized by the server: next.room.queue is ours only.
    // Never infer or cache another DJ's upcoming tracks in the client.
    const onSnapshot = (next: RoomSnapshot) => {
      // A failed cross-room join leaves the previous server membership intact.
      // Ignore any late snapshot from that room while this page targets another.
      if (next.room.id === roomId) setSnapshot(next);
    };
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
  }, [roomId, roomPassword, profile.id, profile.name, profile.avatarSeed, profile.avatarKey, profile.avatarUrl, profile.isAppAdmin, auth.loading, auth.enabled, auth.session?.access_token]);

  const openRoom = (id: string, password?: string) => {
    setSnapshot(null);
    setRoomPassword(password || "");
    setRoomPasswordRequired(false);
    setRoomJoinError("");
    history.pushState({}, "", `/room/${id}`);
    setRoomId(id);
  };

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

  const goHome = () => {
    socket.disconnect();
    setSnapshot(null);
    setRoomPassword("");
    setRoomPasswordRequired(false);
    setRoomJoinError("");
    setRoomSettingsOpen(false);
    setUserSettingsOpen(false);
    history.pushState({}, "", "/");
    setRoomId(null);
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
            avatarKey: updated.avatar_key,
            avatarUrl: updated.avatar_url || undefined,
            isAppAdmin: updated.is_app_admin
          };
          localStorage.setItem("soundspin-profile", JSON.stringify(nextProfile));
          setProfile(nextProfile);
        }}
      />
    );
  }

  if (!roomId && auth.session) {
    return (
      <RoomLobby
        accessToken={auth.session.access_token}
        currentUser={profile}
        onOpenRoom={openRoom}
        onOpenProfile={() => openProfile(profile.id)}
        onSignOut={() => void auth.client?.auth.signOut()}
        feedbackButton={<FeedbackButton userId={profile.id} />}
      />
    );
  }

  if (!roomId || !profile.name) {
    return <Welcome initialName={profile.name} joining={Boolean(roomId)} onEnter={enterRoom} />;
  }

  if (roomPasswordRequired) {
    return (
      <main className="room-access-screen">
        <PasswordDialog
          roomName={roomId.replaceAll("-", " ")}
          error={roomJoinError}
          onClose={goHome}
          onSubmit={(password) => {
            setRoomJoinError("");
            setRoomPasswordRequired(false);
            setRoomPassword(password);
          }}
        />
      </main>
    );
  }

  if (roomJoinError && !snapshot) {
    return (
      <main className="room-access-screen">
        <Card className="room-access-error">
          <CardHeader>
            <Logo />
            <CardTitle>Couldn’t join this room</CardTitle>
            <CardDescription>{roomJoinError}</CardDescription>
          </CardHeader>
          <CardContent><Button onClick={goHome}>Back to rooms</Button></CardContent>
        </Card>
      </main>
    );
  }

  if (!snapshot) {
    return <LoadingScreen label={notice || (connected ? "Tuning into the room…" : "Connecting…")} />;
  }

  // Being allowed to DJ, joining the lineup, and currently being on air are
  // separate states. Only the on-air browser reports a natural track end.
  const isDj = snapshot.room.djUserId === profile.id;
  const canControlPlayback = isDj ||
    snapshot.room.ownerUserId === profile.id ||
    snapshot.room.moderatorUserIds.includes(profile.id);

  return (
    <main className="app-shell">
      <header className="topbar">
        <Button variant="ghost" className="header-home-logo h-10 px-2" onClick={goHome} title="Back to rooms"><Logo /></Button>
        <div className="room-heading">
          <div>
            <strong>{snapshot.room.name}</strong>
            <small><span className="live-dot" /> {snapshot.users.length} listening</small>
          </div>
        </div>
        <div className="header-actions">
          <Button variant="ghost" size="sm" onClick={goHome} title="Room directory"><House /><span>Rooms</span></Button>
          <FeedbackButton userId={profile.id} roomSlug={snapshot.room.id} />
          <Button variant="ghost" size="icon" onClick={() => setUserSettingsOpen(true)} title="Settings"><Settings /></Button>
          {(snapshot.room.ownerUserId === profile.id || snapshot.room.moderatorUserIds.includes(profile.id)) && (
            <Button variant="ghost" size="icon" onClick={() => setRoomSettingsOpen(true)} title="Room settings"><Shield /></Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="invite-button"
            onClick={() => {
              void navigator.clipboard.writeText(location.href);
              setNotice("Invite link copied");
              window.setTimeout(() => setNotice(""), 1800);
            }}
          >
            <CopyIcon size={17} />
            <span>Invite</span>
          </Button>
          <Button variant="ghost" size="icon" className="header-profile-button" onClick={() => openProfile(profile.id)} title="Open your profile">
            <Avatar user={profile} size={30} />
          </Button>
          {auth.enabled && (
            <Button variant="ghost" size="sm" className="sign-out" onClick={() => void auth.client?.auth.signOut()}>
              Sign out
            </Button>
          )}
        </div>
      </header>

      {notice && <div className="toast">{notice}</div>}

      <section className={`room-layout ${compactPlayer ? "compact-player-layout" : ""}`}>
        <MusicRail
          snapshot={snapshot}
          currentUserId={profile.id}
          accessToken={auth.session?.access_token}
          setNotice={setNotice}
        />
        <div className="player-column">
          <NowPlaying
            snapshot={snapshot}
            isDj={isDj}
            canControlPlayback={canControlPlayback}
            currentUserId={profile.id}
            accessToken={auth.session?.access_token}
            compact={compactPlayer}
            onToggleCompact={() => changeUserSettings({
              ...userSettings,
              playback: { ...userSettings.playback, compactPlayer: !compactPlayer }
            })}
            settingsOpen={userSettingsOpen}
            onCloseSettings={() => setUserSettingsOpen(false)}
            userSettings={userSettings}
            onUserSettingsChange={changeUserSettings}
          />
        </div>
        <RoomChat
          snapshot={snapshot}
          currentUser={profile}
          client={auth.client!}
          onOpenProfile={openProfile}
          notifications={userSettings.notifications}
        />
      </section>
      {roomSettingsOpen && auth.session && (
        <RoomSettingsDialog
          snapshot={snapshot}
          currentUserId={profile.id}
          accessToken={auth.session.access_token}
          onClose={() => setRoomSettingsOpen(false)}
          onNotice={setNotice}
        />
      )}
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
    ? <SignUpForm onNavigate={navigate} className="w-full" />
    : path === "/forgot-password"
      ? <ForgotPasswordForm client={client} onNavigate={navigate} className="w-full" />
      : <LoginForm client={client} onNavigate={navigate} className="w-full" />;

  return (
    <main className="welcome auth-welcome">
      <nav><Logo /><span>Shared listening, kept simple.</span></nav>
      <section className="auth-content">
        <div className="auth-intro">
          <Badge variant="outline">SOUNDSPIN</Badge>
          <h1>Listen together,<br />wherever you are.</h1>
          <p>Shared rooms, one queue, and playback that stays in sync.</p>
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
      <nav><Logo /><span>Secure your account.</span></nav>
      <section className="auth-content">
        <div className="auth-intro">
          <Badge variant="outline">ACCOUNT RECOVERY</Badge>
          <h1>Choose a new password.</h1>
          <p>Your rooms and profile will be ready when you return.</p>
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
      <nav><Logo /><span>Music is better together.</span></nav>
      <section className="welcome-content">
        <div className="welcome-copy">
          <Badge variant="outline">SHARED LISTENING</Badge>
          <h1>One room.<br />One shared queue.</h1>
          <p>Add a track, invite your people, and stay in sync.</p>
        </div>
        <Card className="welcome-card">
          <CardHeader><CardTitle>{joining ? "Join the room" : "Start a room"}</CardTitle><CardDescription>{joining ? "Choose the name others will see." : "Set up a place to listen together."}</CardDescription></CardHeader>
          <CardContent>
          <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-2">
            <Label htmlFor="welcome-name">Display name</Label>
            <Input id="welcome-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Alex" maxLength={32} autoFocus />
          </div>
          {!joining && (
            <div className="grid gap-2">
              <Label htmlFor="welcome-room">Room name</Label>
              <Input id="welcome-room" value={roomName} onChange={(event) => setRoomName(event.target.value)} placeholder="Friday focus" maxLength={48} />
            </div>
          )}
            <Button type="submit" size="lg">{joining ? "Join room" : "Start listening"}</Button>
          </form>
          </CardContent>
        </Card>
      </section>
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
        <div className="vibe-summary">
          <strong>{label}</strong>
          <div className="vibe-score" aria-hidden="true">
            <i style={{ width: `${Math.max(4, ((score + 1) / 2) * 100)}%` }} />
          </div>
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
  canControlPlayback,
  currentUserId,
  accessToken,
  compact,
  onToggleCompact,
  settingsOpen,
  onCloseSettings,
  userSettings,
  onUserSettingsChange
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
}) {
  const playback = snapshot.room.playback;
  const track = playback.track;
  const volume = userSettings.playback.defaultVolume;
  const playbackPreference = userSettings.playback.preference;
  const [spotifyWebStarted, setSpotifyWebStarted] = useState(false);
  const [fallbackApprovedTrackId, setFallbackApprovedTrackId] = useState("");
  const unavailableNotifiedTrackRef = useRef("");
  const playbackErrorNotifiedRef = useRef("");
  const [connections, setConnections] = useState({
    loaded: false,
    spotifyConfigured: false,
    spotifyConnected: false,
    spotifyProfile: null as { displayName: string; product?: string } | null,
    appleConfigured: false
  });
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const [playerStatus, setPlayerStatus] = useState<PlayerStatus>({
    ready: false,
    buffering: false,
    currentTime: 0,
    duration: 0
  });
  const [syncRevision, setSyncRevision] = useState(0);
  const [playbackError, setPlaybackError] = useState("");

  useEffect(() => {
    setSeekPreview(null);
  }, [playback.updatedAt, playback.track?.id]);

  useEffect(() => {
    setFallbackApprovedTrackId("");
    setPlaybackError("");
    playbackErrorNotifiedRef.current = "";
  }, [playback.track?.id]);

  const loadConnections = useCallback(() => {
    if (!accessToken) return;
    void fetch("/api/music/connections", { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(async (response) => {
        const payload = await response.json() as {
          spotify?: { configured?: boolean; connected?: boolean; profile?: { displayName: string; product?: string } | null };
          apple?: { configured?: boolean };
        };
        if (!response.ok) throw new Error("Could not load music connections.");
        setConnections({
          loaded: true,
          spotifyConfigured: Boolean(payload.spotify?.configured),
          spotifyConnected: Boolean(payload.spotify?.connected),
          spotifyProfile: payload.spotify?.profile || null,
          appleConfigured: Boolean(payload.apple?.configured)
        });
      })
      .catch(() => setConnections((current) => ({ ...current, loaded: true })));
  }, [accessToken]);

  useEffect(loadConnections, [loadConnections]);

  const handleSpotifyConnectionLost = useCallback((message: string) => {
    loadConnections();
    setPlaybackError(message);
  }, [loadConnections]);

  const connectSpotify = useCallback(() => {
    if (!accessToken) return;
    void fetch(`/api/spotify/connect?returnTo=${encodeURIComponent(location.pathname)}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    }).then(async (response) => {
      const payload = await response.json() as { url?: string; error?: string };
      if (!response.ok || !payload.url) throw new Error(payload.error || "Could not connect Spotify.");
      location.assign(payload.url);
    }).catch((error) => setPlaybackError(error instanceof Error ? error.message : "Could not connect Spotify."));
  }, [accessToken]);

  const disconnectSpotify = useCallback(() => {
    if (!accessToken) return;
    void fetch("/api/spotify/connection", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` }
    }).then((response) => {
      if (!response.ok) throw new Error("Could not disconnect Spotify.");
      setConnections((current) => ({ ...current, spotifyConnected: false, spotifyProfile: null }));
    }).catch((error) => {
      setPlaybackError(error instanceof Error ? error.message : "Could not disconnect Spotify.");
    });
  }, [accessToken]);

  const update = (playing: boolean) => {
    const position = playback.position + (playback.playing ? (Date.now() - playback.updatedAt) / 1000 : 0);
    socket.emit("playback:update", { playing, position });
  };

  const commitSeek = () => {
    if (!canControlPlayback || seekPreview === null) return;
    socket.emit("playback:update", { playing: playback.playing, position: seekPreview });
  };

  const syncPlayback = () => {
    window.dispatchEvent(new Event("soundspin:playback-sync"));
    setSyncRevision((revision) => revision + 1);
  };

  const handleEnded = useCallback(() => {
    if (track) socket.emit("queue:next", { trackId: track.id });
  }, [track?.id]);

  const shownPosition = seekPreview ?? playerStatus.currentTime;
  const preferredProvider: Provider = playbackPreference.startsWith("spotify")
    ? "spotify"
    : playbackPreference === "apple"
      ? "apple"
      : track?.provider || "youtube";
  const mappedPreferredTrack = track?.mappings?.[preferredProvider];
  const trustedPreferredMapping = mappedPreferredTrack && (
    preferredProvider !== "spotify" ||
    track?.provider === "spotify" ||
    mappedPreferredTrack.matchMethod === "isrc" ||
    mappedPreferredTrack.matchMethod === "exact-metadata"
  )
    ? mappedPreferredTrack
    : undefined;
  const preferredMapping = trustedPreferredMapping || (track?.provider === preferredProvider
    ? { providerId: track.providerId, permalinkUrl: track.permalinkUrl }
    : undefined);
  const effectiveProvider = preferredMapping ? preferredProvider : track?.provider;
  const effectiveMapping = preferredMapping || (track
    ? { providerId: track.providerId, permalinkUrl: track.permalinkUrl, artworkUrl: track.artworkUrl }
    : undefined);
  const previewArtwork = effectiveMapping?.artworkUrl || (track ? trackArtworkUrl(track) : undefined);
  const providerFallback = Boolean(track && preferredProvider !== effectiveProvider);
  const fallbackNeedsApproval = providerFallback && userSettings.playback.fallback === "ask" && fallbackApprovedTrackId !== track?.id;
  const fallbackIsSilent = providerFallback && userSettings.playback.fallback === "silent";
  const spotifyReady = Boolean(accessToken && connections.spotifyConnected);
  const webPlaybackAllowed = playbackPreference !== "spotify-desktop" && playbackPreference !== "apple";
  const keepSpotifyWebMounted = spotifyReady && webPlaybackAllowed && (
    effectiveProvider === "spotify" ||
    (!track && spotifyWebStarted)
  );

  useEffect(() => {
    if (!webPlaybackAllowed) setSpotifyWebStarted(false);
    else if (effectiveProvider === "spotify") setSpotifyWebStarted(true);
    else if (track && playbackPreference !== "spotify-web") setSpotifyWebStarted(false);
  }, [effectiveProvider, playbackPreference, track?.id, webPlaybackAllowed]);

  useEffect(() => {
    if (!providerFallback || !track || !userSettings.notifications.unavailableTrack || unavailableNotifiedTrackRef.current === track.id) return;
    unavailableNotifiedTrackRef.current = track.id;
    showSystemNotification("Playback fallback needed", `${track.title} is not available on ${providerLabel(preferredProvider)}.`);
  }, [providerFallback, preferredProvider, track?.id, track?.title, userSettings.notifications.unavailableTrack]);

  useEffect(() => {
    const message = playbackError;
    if (!message || !userSettings.notifications.playbackErrors || playbackErrorNotifiedRef.current === message) return;
    playbackErrorNotifiedRef.current = message;
    showSystemNotification("SoundSpin playback error", message);
  }, [playbackError, userSettings.notifications.playbackErrors]);

  return (
    <>
      <section className={`now-playing panel ${compact ? "compact" : ""}`}>
      <div className="now-playing-heading">
        <div className="section-kicker">NOW PLAYING</div>
        <button type="button" onClick={onToggleCompact} title={compact ? "Expand player" : "Use compact player"}>
          {compact ? <Maximize2 size={15} /> : <Minimize2 size={15} />}
          <span>{compact ? "Expand" : "Compact"}</span>
        </button>
      </div>
      {keepSpotifyWebMounted && (
        <SpotifyPlayer
          playback={playback}
          mapping={effectiveProvider === "spotify" ? effectiveMapping : undefined}
          mode="web"
          isDj={isDj}
          volume={volume}
          accessToken={accessToken!}
          preferredDeviceId={userSettings.playback.spotifyDeviceId}
          resumeAfterReconnect={userSettings.playback.resumeAfterReconnect}
          onEnded={handleEnded}
          onStatus={setPlayerStatus}
          onConnectionLost={handleSpotifyConnectionLost}
          onError={setPlaybackError}
        />
      )}
      {track ? (
        <>
          <div className="track-stage">
            <TrackArtwork track={track} />
            {effectiveProvider === "spotify" && previewArtwork && (
              <img className="album-art-preview" src={previewArtwork} alt={`${track.title} album artwork`} />
            )}
            {fallbackNeedsApproval ? (
              <div className="provider-player-shell fallback-player-shell">
                <strong>Use the room source?</strong>
                <small>No {providerLabel(preferredProvider)} match was found for this track.</small>
                <button type="button" onClick={() => setFallbackApprovedTrackId(track.id)}>Play with {providerLabel(effectiveProvider!)}</button>
              </div>
            ) : fallbackIsSilent ? (
              <div className="provider-player-shell fallback-player-shell">
                <strong>Track unavailable</strong>
                <small>No {providerLabel(preferredProvider)} match was found. Local playback is paused for this track.</small>
              </div>
            ) : effectiveProvider === "spotify" && effectiveMapping ? (
              spotifyReady ? (
                keepSpotifyWebMounted ? null : (
                  <SpotifyPlayer
                    playback={playback}
                    mapping={effectiveMapping}
                    mode={playbackPreference === "spotify-desktop" ? "desktop" : "web"}
                    isDj={isDj}
                    volume={volume}
                    accessToken={accessToken!}
                    preferredDeviceId={userSettings.playback.spotifyDeviceId}
                    resumeAfterReconnect={userSettings.playback.resumeAfterReconnect}
                    onEnded={handleEnded}
                    onStatus={setPlayerStatus}
                    onConnectionLost={handleSpotifyConnectionLost}
                    onError={setPlaybackError}
                  />
                )
              ) : (
                <div className="provider-player-shell spotify-player-shell">
                  <strong>Connect Spotify to listen</strong>
                  <button type="button" onClick={connectSpotify} disabled={!connections.spotifyConfigured}>Connect Spotify</button>
                </div>
              )
            ) : effectiveProvider === "apple" && effectiveMapping && accessToken ? (
              <AppleMusicPlayer
                playback={playback}
                syncRevision={syncRevision}
                mapping={effectiveMapping}
                isDj={isDj}
                volume={volume}
                accessToken={accessToken}
                onEnded={handleEnded}
                onStatus={setPlayerStatus}
                onError={setPlaybackError}
              />
            ) : effectiveProvider === "soundcloud" ? (
              <SoundCloudPlayer
                playback={playback}
                syncRevision={syncRevision}
                isDj={isDj}
                volume={volume}
                onEnded={handleEnded}
                onStatus={setPlayerStatus}
              />
            ) : effectiveProvider === "youtube" ? (
              <YouTubePlayer
                playback={playback}
                syncRevision={syncRevision}
                isDj={isDj}
                volume={volume}
                // The track ID lets the server reject duplicate/stale ended events.
                onEnded={handleEnded}
                onStatus={setPlayerStatus}
              />
            ) : (
              <div className="provider-player-shell">
                <strong>No playable version is available</strong>
                <small>Choose another playback provider.</small>
              </div>
            )}
            <div className="record-ring ring-one" />
            <div className="record-ring ring-two" />
          </div>
          <div className="current-track">
            <div>
              <h2>{track.title}</h2>
              <p>
                {track.artist ? `${track.artist} · ` : ""}Added by {track.addedBy.name} · {track.permalinkUrl ? (
                  <a href={track.permalinkUrl} target="_blank" rel="noreferrer">{providerLabel(track.provider)}</a>
                ) : providerLabel(track.provider)}
              </p>
            </div>
            <div className="player-controls">
              <button disabled={!canControlPlayback} className="round-button primary" onClick={() => update(!playback.playing)} aria-label={playback.playing ? "Pause" : "Play"}>
                {playback.playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
              </button>
              <button className="round-button" onClick={syncPlayback} aria-label="Sync playback with room" title="Sync playback with room">
                <RefreshCw size={19} />
              </button>
              <button disabled={!canControlPlayback} className="round-button" onClick={() => socket.emit("queue:next", { trackId: track.id })} aria-label="Next track">
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
              disabled={!canControlPlayback || !playerStatus.duration}
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
                  ? "Your turn on the decks"
                  : canControlPlayback
                    ? "Moderator controls available"
                    : "Synced with the current DJ"}
            </div>
            {providerFallback && <small className="provider-fallback">No {providerLabel(preferredProvider)} match · using {providerLabel(effectiveProvider!)}</small>}
            <label className="volume-control">
              <Volume2 size={14} />
              <input
                type="range"
                min={0}
                max={100}
                value={volume}
                aria-label="Volume"
                onChange={(event) => onUserSettingsChange({
                  ...userSettings,
                  playback: { ...userSettings.playback, defaultVolume: Number(event.target.value) }
                })}
              />
            </label>
          </div>
          <VibeMeter snapshot={snapshot} currentUserId={currentUserId} />
        </>
      ) : (
        <div className="empty-player">
          <span className="empty-disc"><PlayIcon size={28} /></span>
          <h2>The room is quiet</h2>
          <p>Add a track from any configured provider to start the radio.</p>
        </div>
      )}
      </section>
      {settingsOpen && (
        <UserSettingsDialog
          settings={userSettings}
          connections={connections}
          accessToken={accessToken}
          onSettingsChange={onUserSettingsChange}
          onConnectSpotify={connectSpotify}
          onDisconnectSpotify={disconnectSpotify}
          onClose={onCloseSettings}
        />
      )}
    </>
  );
}

interface ProviderSearchResult {
  provider: SearchProvider;
  id: string;
  title: string;
  artist: string;
  thumbnail?: string;
  duration?: string;
  durationMs?: number;
  permalinkUrl?: string;
}

function MusicRail({
  snapshot,
  currentUserId,
  accessToken,
  setNotice
}: {
  snapshot: RoomSnapshot;
  currentUserId: string;
  accessToken?: string;
  setNotice: (message: string) => void;
}) {
  const [tab, setTab] = useState<"history" | "search" | "queue">("queue");
  const [provider, setProvider] = useState<SearchProvider>(readSearchProvider);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ProviderSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [addingResultId, setAddingResultId] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [draggedTrackId, setDraggedTrackId] = useState("");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [resolvingUrl, setResolvingUrl] = useState(false);
  const joinedDjQueue = snapshot.room.djQueueUserIds.includes(currentUserId);
  const canJoinDjQueue = snapshot.room.settings.djAccess !== "roles" ||
    snapshot.room.ownerUserId === currentUserId ||
    snapshot.room.moderatorUserIds.includes(currentUserId) ||
    snapshot.room.djRoleUserIds.includes(currentUserId);
  const currentDj = snapshot.djUsers.find((user) => user.id === snapshot.room.djUserId);
  const upcomingDjs = snapshot.room.djQueueUserIds.filter((userId) => userId !== snapshot.room.djUserId);

  const enqueueTrack = (track: {
    provider: Provider;
    providerId: string;
    title: string;
    artist?: string;
    artworkUrl?: string;
    permalinkUrl?: string;
    durationMs?: number;
  }) => {
    socket.emit(
      "queue:add",
      track,
      (result: { ok: boolean; error?: string; started?: boolean; position?: number }) => {
        setAddingResultId("");
        if (!result.ok) return setNotice(result.error || "Could not add track");
        setNotice(
          result.started
            ? "Started playing"
            : `Added to your private queue${result.position ? ` · #${result.position}` : ""}`
        );
        setUrl("");
        setTitle("");
        setAdding(false);
        setManualOpen(false);
        setTab("queue");
      }
    );
  };

  const toggleDjQueue = () => {
    socket.emit(joinedDjQueue ? "dj:leave" : "dj:join", undefined, (result: { ok: boolean; error?: string }) => {
      setNotice(result.ok
        ? joinedDjQueue ? "Left the DJ queue" : "Joined the DJ queue"
        : result.error || "Could not update the DJ queue.");
    });
  };

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

    enqueueTrack({ provider: "youtube", providerId, title: resolvedTitle || "YouTube track" });
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (provider === "youtube") {
      await addTrack(url, title);
      return;
    }

    const trackUrl = url.trim();
    if (!trackUrl) return setNotice(`Please enter a ${providerLabel(provider)} track URL`);
    setResolvingUrl(true);
    try {
      const response = await fetch(`/api/${provider}/resolve?url=${encodeURIComponent(trackUrl)}`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined
      });
      const payload = await response.json() as {
        result?: ProviderSearchResult;
        error?: string;
      };
      if (!response.ok || !payload.result) {
        throw new Error(payload.error || `Could not resolve that ${providerLabel(provider)} URL.`);
      }
      enqueueTrack({
        provider,
        providerId: payload.result.id,
        title: title.trim() || payload.result.title,
        artist: payload.result.artist,
        artworkUrl: payload.result.thumbnail,
        permalinkUrl: payload.result.permalinkUrl,
        durationMs: payload.result.durationMs
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `Could not resolve that ${providerLabel(provider)} URL.`);
    } finally {
      setResolvingUrl(false);
    }
  };

  const addAgain = (track: RoomSnapshot["room"]["history"][number]) => {
    enqueueTrack({
      provider: track.provider,
      providerId: track.providerId,
      title: track.title,
      artist: track.artist,
      artworkUrl: track.artworkUrl,
      permalinkUrl: track.permalinkUrl,
      durationMs: track.durationMs
    });
  };

  const searchProvider = async (event: FormEvent) => {
    event.preventDefault();
    const searchQuery = query.trim();
    if (searchQuery.length < 2) return setSearchError("Enter at least 2 characters.");

    setSearching(true);
    setSearchError("");
    try {
      const response = await fetch(`/api/${provider}/search?q=${encodeURIComponent(searchQuery)}`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined
      });
      const payload = await response.json() as {
        results?: Array<ProviderSearchResult & { channel?: string }>;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || `Could not search ${providerLabel(provider)}.`);
      setSearchResults((payload.results || []).map((result) => ({
        ...result,
        provider,
        artist: result.artist || result.channel || providerLabel(provider)
      })));
    } catch (error) {
      setSearchResults([]);
      setSearchError(error instanceof Error ? error.message : `Could not search ${providerLabel(provider)}.`);
    } finally {
      setSearching(false);
    }
  };

  const addSearchResult = (result: ProviderSearchResult) => {
    setAddingResultId(result.id);
    enqueueTrack({
      provider: result.provider,
      providerId: result.id,
      title: result.title,
      artist: result.artist,
      artworkUrl: result.thumbnail,
      permalinkUrl: result.permalinkUrl,
      durationMs: result.durationMs
    });
  };

  const queueAction = (
    event: "queue:remove",
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
        <span>RADIO</span>
        <strong>One song per DJ</strong>
      </div>

      <section className="dj-lineup" aria-label="DJ queue">
        <div className="dj-lineup-heading">
          <div><span>DJ QUEUE</span><small>{snapshot.room.settings.djAccess === "roles" ? "Role restricted" : "Open to everyone"}</small></div>
          <button type="button" className={joinedDjQueue ? "joined" : ""} disabled={!joinedDjQueue && !canJoinDjQueue} onClick={toggleDjQueue}>
            {joinedDjQueue ? "Leave" : canJoinDjQueue ? "Join as DJ" : "DJ role required"}
          </button>
        </div>
        <div className="dj-lineup-current">
          {currentDj ? <><Avatar user={currentDj} size={30} /><span><small>ON AIR</small><strong>{currentDj.id === currentUserId ? "You" : currentDj.name}</strong></span></> : <span><small>ON AIR</small><strong>Waiting for a queued song</strong></span>}
        </div>
        {!!upcomingDjs.length && (
          <div className="dj-lineup-next">
            <small>UP NEXT</small>
            {upcomingDjs.map((userId, index) => {
              const user = snapshot.djUsers.find((candidate) => candidate.id === userId);
              return user ? <span key={userId} title={`${index + 1}. ${user.name}`}><i>{index + 1}</i><Avatar user={user} size={24} /></span> : null;
            })}
          </div>
        )}
      </section>

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
            <small>{joinedDjQueue ? "Add results to your private queue" : "Join the DJ queue to add music"}</small>
          </div>
          <form className="provider-search-form" onSubmit={searchProvider}>
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${providerLabel(provider)}`}
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
              onChange={(event) => {
                const value = event.target.value;
                const nextProvider: SearchProvider = value === "soundcloud" || value === "spotify" || value === "apple"
                  ? value
                  : "youtube";
                setProvider(nextProvider);
                localStorage.setItem(SEARCH_PROVIDER_STORAGE_KEY, nextProvider);
                setSearchResults([]);
                setSearchError("");
              }}
              aria-label="Music provider"
            >
              <option value="youtube">YouTube</option>
              <option value="spotify">Spotify</option>
              <option disabled value="apple">Apple Music (Coming Soon)</option>
              <option value="soundcloud">SoundCloud</option>
            </select>
            <button type="submit" className="search-submit" disabled={searching}>
              {searching ? "…" : "Go"}
            </button>
          </form>

          <div className="search-result-list">
            {searchError && <div className="rail-search-state error">{searchError}</div>}
            {!searchError && searching && (
              <div className="rail-search-state"><div className="equalizer"><i /><i /><i /><i /></div><span>Searching {providerLabel(provider)}…</span></div>
            )}
            {!searchError && !searching && searchResults.map((result) => (
              (() => {
                const queued =
                  (snapshot.room.playback.track?.provider === result.provider && snapshot.room.playback.track.providerId === result.id) ||
                  snapshot.room.queue.some((track) => track.provider === result.provider && track.providerId === result.id);
                return (
                  <div className="search-result-row" key={result.id}>
                    <span className={`search-provider-mark ${result.provider}`}>{result.provider === "soundcloud" ? "SC" : result.provider === "spotify" ? "S" : result.provider === "apple" ? "A" : "▶"}</span>
                    {result.thumbnail
                      ? <img src={result.thumbnail} alt="" />
                      : <span className={`provider-artwork search-artwork ${result.provider}`}>{result.provider === "soundcloud" ? "SC" : providerLabel(result.provider).slice(0, 1)}</span>}
                    <span className="search-result-copy">
                      <strong>{result.title}</strong>
                      <small>{result.artist}{result.duration ? ` · ${result.duration}` : ""}</small>
                    </span>
                    <button
                      type="button"
                      className={queued ? "added" : ""}
                      title={queued ? "Already in your queue or playing" : joinedDjQueue ? "Add to your queue" : "Join the DJ queue first"}
                      disabled={!joinedDjQueue || queued || addingResultId === result.id}
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
                <span>Search {providerLabel(provider)} for a song or artist.</span>
              </div>
            )}
          </div>

          <div className={`manual-add ${manualOpen ? "open" : ""}`}>
            <button className="manual-add-heading" type="button" onClick={() => setManualOpen((open) => !open)}>
              <span>ADD BY URL</span>
              <small>{provider === "youtube" ? "YouTube URL or video ID" : `${providerLabel(provider)} track URL`} <ChevronDown size={13} /></small>
            </button>
            {manualOpen && (
              <form className="rail-manual-add" onSubmit={add}>
                <input
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder={provider === "youtube"
                    ? "youtube.com/watch?v=…"
                    : provider === "spotify"
                      ? "open.spotify.com/track/…"
                      : provider === "apple"
                        ? "music.apple.com/…"
                        : "soundcloud.com/artist/track"}
                  autoFocus
                />
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Title (optional)"
                />
                <button type="submit" disabled={resolvingUrl}><PlusIcon size={14} /> {resolvingUrl ? "Resolving…" : "Add manually"}</button>
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
                <TrackArtwork track={track} compact />
                <span className="rail-track-copy">
                  <strong>{track.title}</strong>
                  <small>Added by {track.addedBy.name}</small>
                </span>
                <button disabled={!joinedDjQueue} title={joinedDjQueue ? "Add to your queue again" : "Join the DJ queue first"} onClick={() => addAgain(track)}>
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
              <span>MY QUEUE</span>
              <small>Private · other listeners cannot see these tracks</small>
            </div>
            <button className="rail-add-button" disabled={!joinedDjQueue} title={joinedDjQueue ? "Add a track" : "Join the DJ queue first"} onClick={() => { setAdding(!adding); setTab("queue"); }}>
              <PlusIcon size={14} /> Add
            </button>
          </div>
          {adding && (
            <form className="rail-quick-add" onSubmit={add}>
              <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder={`Paste ${providerLabel(provider)} link`} autoFocus />
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title (optional)" />
              <button type="submit" disabled={resolvingUrl}>{resolvingUrl ? "Resolving…" : `Add ${providerLabel(provider)} to queue`}</button>
            </form>
          )}
          <div className="rail-track-list">
            {snapshot.room.queue.map((track, index) => {
              return (
              <div
                className={`rail-track-row queue-track ${draggedTrackId === track.id ? "dragging" : ""}`}
                key={track.id}
                draggable
                title={`Your queue position ${index + 1}`}
                onDragStart={() => setDraggedTrackId(track.id)}
                onDragEnd={() => setDraggedTrackId("")}
                onDragOver={(event) => {
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggedTrackId && draggedTrackId !== track.id) {
                    moveQueueTrack(draggedTrackId, index);
                  }
                  setDraggedTrackId("");
                }}
              >
                <span className="queue-drag-handle" title="Drag to reorder your queue">
                  <GripVertical size={14} />
                </span>
                <TrackArtwork track={track} compact />
                <span className="rail-track-copy">
                  <strong>{track.title}</strong>
                  <small>#{index + 1} · only visible to you</small>
                </span>
                <span className="queue-track-actions">
                  <button
                    type="button"
                    title="Remove from your queue"
                    onClick={(event) => {
                      event.stopPropagation();
                      queueAction("queue:remove", track.id, "Removed from your queue");
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </span>
              </div>
            )})}
            {!snapshot.room.queue.length && (
              <div className="rail-empty"><ListMusic size={22} /><p>{joinedDjQueue ? "Your queue is empty. Add a song for your next turn." : "Join the DJ queue to line up your own music."}</p></div>
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
  onOpenProfile,
  notifications
}: {
  snapshot: RoomSnapshot;
  currentUser: User;
  client: SupabaseClient;
  onOpenProfile: (userId: string) => void;
  notifications: SoundSpinUserSettings["notifications"];
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState("");
  const seenMentionIdsRef = useRef(new Set<string>());
  const adminUserIds = [...new Set(
    snapshot.users
      .filter((user) => user.isAppAdmin)
      .map((user) => user.id)
  )];

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const history = await loadChatHistory(client, snapshot.room.id);
        if (!active) return;
        history.forEach((message) => seenMentionIdsRef.current.add(message.id));
        setMessages(history);
        setError("");
      } catch {
        if (active) {
          setError("Chat history could not be loaded. Please refresh and try again.");
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [client, snapshot.room.id]);

  const persistMessage = async (message: ChatMessage) => {
    try {
      await saveChatMessage(client, snapshot.room.id, currentUser, message);
      setError("");
    } catch {
      setError("The message was sent live but could not be saved to history.");
    }
  };

  const handleMessages = useCallback((nextMessages: ChatMessage[]) => {
    for (const message of nextMessages) {
      if (seenMentionIdsRef.current.has(message.id)) continue;
      seenMentionIdsRef.current.add(message.id);
      if (
        notifications.chatMentions &&
        message.user.id !== currentUser.id &&
        currentUser.name &&
        message.content.toLocaleLowerCase().includes(`@${currentUser.name.toLocaleLowerCase()}`)
      ) {
        showSystemNotification(`${message.user.name} mentioned you`, message.content || "New room chat mention");
      }
    }
  }, [currentUser.id, currentUser.name, notifications.chatMentions]);

  return (
    <aside className="chat panel">
      <div className="chat-header">
        <div><MessageIcon size={20} /><strong>Room chat</strong></div>
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
                <Avatar user={user} size={32} />
              </span>
            ))}
            {snapshot.users.length > 5 && <i>+{snapshot.users.length - 5}</i>}
          </div>
          <span><UsersIcon size={16} /> {snapshot.users.length}</span>
        </div>
      </div>
      <div className="supabase-chat-body">
        {error && <div className="chat-error">{error}</div>}
        <RealtimeChat
          client={client}
          roomName={`soundspin:${snapshot.room.id}`}
          user={currentUser}
          messages={messages}
          onMessage={handleMessages}
          onSend={persistMessage}
          onOpenProfile={onOpenProfile}
          adminUserIds={adminUserIds}
          roomUsers={snapshot.users}
        />
      </div>
    </aside>
  );
}
