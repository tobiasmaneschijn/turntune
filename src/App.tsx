import { NowPlaying, type NowPlayingControls, type NowPlayingLocalState } from "./components/NowPlaying";
import { FormEvent, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { LayoutDashboard } from "lucide-react";
import { MusicRail, type MusicRailControls } from "./components/MusicRail";
import { LandingPage } from "./components/LandingPage";
import { ThemeToggle } from "./components/ThemeToggle";
import { PasswordDialog, RoomLobby } from "./components/RoomLobby";
import { PanelErrorBoundary } from "./components/AppErrorBoundary";
import { Brand } from "./components/app-primitives";
import { AppVersion } from "./components/AppVersion";
import { RoomHeader } from "./components/RoomHeader";
import { RoomWorkspace } from "./components/RoomWorkspace";
import { RoomMiniPlayer } from "./components/RoomMiniPlayer";
import { ListeningChecklist } from "./components/ListeningChecklist";
import { RoomAnnouncementBanner } from "./components/RoomAnnouncementBanner";
import { RoomThemeBanner } from "./components/RoomThemeBanner";
import { RoomPeopleDialog } from "./components/RoomPeopleDialog";
import { DeferredDialog } from "./components/DeferredDialog";
import { RoomProfileDialog } from "./components/RoomProfileDialog";
import { FriendsPanel } from "./components/FriendsPanel";
import { ThemeNightDialog } from "./components/ThemeNightDialog";
import { Dialog, DialogContent, DialogTitle } from "./components/ui/dialog";
import { requestJson } from "./lib/authenticated-http";
import { rememberAuthDestination, takeAuthDestination } from "./lib/auth-destination";
import { MessageIcon, UsersIcon } from "./components/Icons";
import { ForgotPasswordForm } from "./components/forgot-password-form";
import { LoginForm } from "./components/login-form";
import { SignUpForm } from "./components/sign-up-form";
import { UpdatePasswordForm } from "./components/update-password-form";
import { RealtimeChat, type RealtimeChatHandle } from "./components/realtime-chat";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { useGroupRef } from "./components/ui/resizable";
import type { ChatMessage } from "./chat/model";
import { createChatHistorySource } from "./chat/history-reader";
import { createSocketChatSessionFactory } from "./chat/socket-transport";
import { clearUserChatDrafts } from "./chat/drafts";
import { useRoomLayoutPresets } from "./hooks/use-room-layout-presets";
import { useRouteFocus } from "./hooks/use-route-focus";
import { useRoomNotificationMuted } from "./hooks/use-room-notifications";
import { notifyWithAttention } from "./notifications";
import { socket } from "./socket";
import { useAppAuth } from "./hooks/use-app-auth";
import { useRoomSession } from "./hooks/use-room-session";
import { useAppProfile } from "./hooks/use-app-profile";
import { useMediaQuery } from "./hooks/use-media-query";
import { storeValue } from "./lib/browser-storage";
import { recordRoomVisit } from "./lib/room-visits";
import { readUserSettings, saveUserSettings, type SoundSpinUserSettings } from "./playback-settings";
import type { RoomSnapshot, SoundSpinProfile, User } from "./types";

const AdminDashboard = lazy(() => import("./components/AdminDashboard").then((module) => ({ default: module.AdminDashboard })));
const FeedbackButton = lazy(() => import("./components/FeedbackDialog").then((module) => ({ default: module.FeedbackButton })));
const ProfilePage = lazy(() => import("./components/ProfilePage").then((module) => ({ default: module.ProfilePage })));
const loadRoomSettings = () => import("./components/RoomSettingsDialog").then((module) => ({ default: module.RoomSettingsDialog }));
function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export function App() {
  const [userSettings, setUserSettings] = useState<SoundSpinUserSettings>(readUserSettings);
  const compactPlayer = userSettings.playback.compactPlayer;
  const roomPanelGroupRef = useGroupRef();
  const roomLayouts = useRoomLayoutPresets(roomPanelGroupRef);
  const musicControls = useRef<MusicRailControls>(null);
  const playerControls = useRef<NowPlayingControls>(null);
  const chatControls = useRef<RealtimeChatHandle>(null);
  const [localPlayback, setLocalPlayback] = useState<NowPlayingLocalState>({ providerName: "Player", providerState: "loading", audioState: "loading", statusText: "Preparing local playback…", statusTone: "pending", muted: false });
  const [mobileRoomPane, setMobileRoomPane] = useState<"radio" | "player" | "chat">("player");
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  const isNarrowRoomLayout = useMediaQuery("(max-width: 1024px)");
  const isTabletDualRoomLayout = useMediaQuery("(min-width: 900px) and (max-width: 1024px) and (min-height: 560px)");
  const [roomSettingsOpen, setRoomSettingsOpen] = useState(false);
  const [userSettingsOpen, setUserSettingsOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [themeNightOpen, setThemeNightOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const previousDjUserIdRef = useRef<string | null>(null);
  const djBaselineRef = useRef("");
  const { auth, setAuth, retryAuth } = useAppAuth();
  const { profile, setProfile, profileReady } = useAppProfile(auth);
  const { roomId, profilePageId, adminPage, navigationContext, snapshot, connected, roomPasswordRequired, roomJoinError,
    setRoomPassword, setRoomPasswordRequired, setRoomJoinError, retryRoom, openRoom, openProfile, openAdmin,
    goHome: leaveRoom, backFromProfile } = useRoomSession({ auth, profile, profileReady, onNotice: setNotice });
  const draftOwnerRef = useRef(auth.session?.user.id);
  const [roomNotificationsMuted] = useRoomNotificationMuted(profile.id, roomId || "");
  useRouteFocus(navigationContext, navigationContext, Boolean(roomId && profilePageId));
  const recordedVisitRef = useRef<string | null>(null);
  const invitationRequests = useRef(new Map<string, AbortController>());
  useEffect(() => () => {
    invitationRequests.current.forEach(controller => controller.abort());
    invitationRequests.current.clear();
  }, [auth.session?.user.id, roomId]);
  useEffect(() => {
    setFriendsOpen(false); setThemeNightOpen(false); setRoomSettingsOpen(false); setUserSettingsOpen(false);
  }, [auth.session?.user.id, roomId]);
  useEffect(() => {
    if (!roomId) { recordedVisitRef.current = null; return; }
    const userId = auth.session?.user.id;
    const key = `${userId}:${roomId}`;
    if (connected && snapshot?.room.id === roomId && userId === profile.id && recordedVisitRef.current !== key) {
      recordRoomVisit(userId, roomId);
      recordedVisitRef.current = key;
    }
  }, [roomId, connected, snapshot?.room.id, auth.session?.user.id, profile.id]);
  const focusMusicSearch = () => { setMobileRoomPane("radio"); requestAnimationFrame(() => requestAnimationFrame(() => musicControls.current?.focusSearch())); };
  const openMusicQueue = () => { setMobileRoomPane("radio"); requestAnimationFrame(() => requestAnimationFrame(() => musicControls.current?.openQueue())); };
  const focusChat = () => { setMobileRoomPane("chat"); requestAnimationFrame(() => requestAnimationFrame(() => chatControls.current?.focusComposer())); };

  useEffect(() => {
    const nextOwner = auth.session?.user.id;
    if (draftOwnerRef.current && draftOwnerRef.current !== nextOwner) clearUserChatDrafts(draftOwnerRef.current);
    draftOwnerRef.current = nextOwner;
  }, [auth.session?.user.id]);

  const changeUserSettings = useCallback((next: SoundSpinUserSettings) => {
    setUserSettings(next);
    saveUserSettings(next);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("reduced-motion", userSettings.appearance.reducedMotion);
    document.documentElement.style.setProperty("--artwork-blur", `${userSettings.appearance.artworkBlur}px`);
  }, [userSettings.appearance.artworkBlur, userSettings.appearance.reducedMotion]);

  useEffect(() => {
    const syncTheme = () => setUserSettings(readUserSettings());
    window.addEventListener("soundspin:theme-change", syncTheme);
    return () => window.removeEventListener("soundspin:theme-change", syncTheme);
  }, []);

  const resetRoomLayout = () => {
    roomLayouts.resetLayout();
    setNotice("Room layout reset");
  };

  useEffect(() => {
    setChatUnreadCount(0);
  }, [roomId]);

  useEffect(() => {
    const djUserId = snapshot?.room.djUserId || null;
    const context = `${profile.id}:${roomId || ""}`;
    if (!snapshot || djBaselineRef.current !== context) {
      djBaselineRef.current = snapshot ? context : "";
      previousDjUserIdRef.current = djUserId;
      return;
    }
    if (
      djUserId === profile.id &&
      previousDjUserIdRef.current !== profile.id &&
      userSettings.notifications.djTurn
    ) {
      notifyWithAttention({ key: `${context}:dj-turn:${snapshot.room.playback.track?.id || snapshot.room.playback.updatedAt}`, title: "You’re on air", body: "Your DJ turn has started.", backgroundOnly: userSettings.notifications.backgroundOnly, muted: roomNotificationsMuted, onInApp: () => setNotice("You’re on air") });
    }
    previousDjUserIdRef.current = djUserId;
  }, [snapshot?.room.djUserId, profile.id, roomId, userSettings.notifications.djTurn, userSettings.notifications.backgroundOnly, roomNotificationsMuted]);

  useEffect(() => {
    if (!notice) return;
    const options = { id: `lydman-notice:${notice}`, duration: 5000 };
    if (/could not|unable|failed|error|unavailable|not allowed|denied/i.test(notice)) toast.error(notice, options);
    else if (/copied|reset|saved|added|removed|left|joined|updated/i.test(notice)) toast.success(notice, options);
    else toast.info(notice, options);
    const timer = window.setTimeout(() => setNotice(""), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const enterRoom = (name: string, roomName?: string) => {
    const nextProfile = { ...profile, name: name.trim() };
    storeValue("soundspin-profile", JSON.stringify(nextProfile));
    setProfile(nextProfile);
    if (auth.client && auth.session) {
      void auth.client.auth.updateUser({ data: { display_name: nextProfile.name } });
    }
    const id = roomId || `${slugify(roomName || "room")}-${Math.random().toString(36).slice(2, 7)}`;
    openRoom(id, undefined, roomId ? undefined : roomName?.trim());
  };

  const goHome = () => {
    setRoomSettingsOpen(false);
    setUserSettingsOpen(false);
    setFriendsOpen(false);
    setThemeNightOpen(false);
    leaveRoom();
  };

  const updateOwnProfile = (updated: SoundSpinProfile) => {
    const nextProfile = { id: updated.user_id, name: updated.display_name, avatarSeed: updated.user_id,
      avatarKey: updated.avatar_key, avatarUrl: updated.avatar_url || undefined, isAppAdmin: updated.is_app_admin };
    storeValue("soundspin-profile", JSON.stringify(nextProfile));
    setProfile(nextProfile);
  };
  const inviteFriend = async (userId: string) => {
    if (!auth.session || !roomId || invitationRequests.current.has(userId)) return;
    const controller = new AbortController();
    invitationRequests.current.set(userId, controller);
    try {
      await requestJson("/api/room-invitations", { accessToken: auth.session.access_token, method: "POST", signal: controller.signal, body: JSON.stringify({ userId, roomSlug: roomId }) });
      if (!controller.signal.aborted) setNotice("Invitation sent");
    } catch (error) { if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "Could not invite. Try again."); }
    finally { if (invitationRequests.current.get(userId) === controller) invitationRequests.current.delete(userId); }
  };

  if (auth.error) {
    return (
      <main className="room-access-screen">
        <Card className="room-access-error">
          <CardHeader><Brand /><CardTitle>Could not connect</CardTitle>
            <CardDescription>{auth.error}</CardDescription></CardHeader>
          <CardContent><Button onClick={retryAuth}>Try again</Button></CardContent>
        </Card>
      </main>
    );
  }

  if (auth.loading || (auth.enabled && auth.session && (profile.id !== auth.session.user.id || !profileReady))) {
    return <LoadingScreen label="Restoring your session…" />;
  }

  if (auth.enabled && !auth.session) {
    return <PublicEntry client={auth.client!} />;
  }

  if (auth.enabled && auth.session && auth.recovery) {
    return (
      <PasswordRecoveryScreen
        client={auth.client!}
        onComplete={() => {
          history.replaceState({}, "", takeAuthDestination());
          setAuth((current) => ({ ...current, recovery: false }));
        }}
      />
    );
  }

  if (adminPage && auth.session && profile.isAppAdmin) {
    return (
      <Suspense fallback={<LoadingScreen label="Loading admin console…" />}>
        <AdminDashboard
          accessToken={auth.session.access_token}
          currentUser={profile}
          onBack={goHome}
          onOpenRoom={openRoom}
        />
      </Suspense>
    );
  }

  if (adminPage && auth.session && !profile.isAppAdmin) {
    return (
      <main className="room-access-screen">
        <Card className="room-access-error">
          <CardHeader>
            <Brand />
            <CardTitle role="heading" aria-level={1}>Admin access required</CardTitle>
          </CardHeader>
          <CardContent><Button onClick={goHome}>Back to rooms</Button></CardContent>
        </Card>
      </main>
    );
  }

  if (profilePageId && auth.session && !roomId) {
    return (
      <Suspense fallback={<LoadingScreen label="Loading profile…" />}>
        <ProfilePage
          key={profilePageId}
          profileId={profilePageId}
          accessToken={auth.session.access_token}
          currentUser={profile}
          onBack={backFromProfile}
          onOwnProfileUpdated={updateOwnProfile}
          onOpenAdmin={profile.isAppAdmin ? openAdmin : undefined}
        />
      </Suspense>
    );
  }

  if (!roomId && auth.session) {
    return (
      <RoomLobby
        accessToken={auth.session.access_token}
        currentUser={profile}
        onOpenRoom={openRoom}
        onOpenProfile={() => openProfile(profile.id)}
        onOpenPerson={openProfile}
        onSignOut={() => void auth.client?.auth.signOut()}
        feedbackButton={<Suspense fallback={null}><FeedbackButton userId={profile.id} diagnosticContext={{ surface: "room-directory" }} /></Suspense>}
        adminButton={profile.isAppAdmin ? <Button variant="ghost" size="icon" onClick={openAdmin} title="Admin dashboard" aria-label="Admin dashboard"><LayoutDashboard /></Button> : null}
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

  if (roomJoinError) {
    return (
      <main className="room-access-screen">
        <Card className="room-access-error">
          <CardHeader>
            <Brand />
            <CardTitle>Couldn’t join this room</CardTitle>
            <CardDescription>{roomJoinError}</CardDescription>
          </CardHeader>
          <CardContent><Button onClick={() => { setRoomJoinError(""); retryRoom(); }}>Try again</Button> <Button variant="ghost" onClick={goHome}>Back to rooms</Button></CardContent>
        </Card>
      </main>
    );
  }

  if (!snapshot) {
    return <LoadingScreen label={notice || (connected ? "Loading room…" : "Connecting…")} />;
  }

  // Being allowed to DJ, joining the lineup, and currently being on air are
  // separate states. Only the on-air browser reports a natural track end.
  const isDj = snapshot.room.djUserId === profile.id;
  const canControlPlayback = isDj ||
    snapshot.room.ownerUserId === profile.id ||
    snapshot.room.moderatorUserIds.includes(profile.id);

  return (
    <main className={`app-shell ${connected ? "" : "room-is-reconnecting"}`}>
      <RoomHeader roomName={snapshot.room.name} roomSlug={snapshot.room.id} listenerCount={snapshot.users.length}
        currentUser={profile} onHome={goHome} onSettings={() => setUserSettingsOpen(true)}
        onRoomSettings={snapshot.room.ownerUserId === profile.id || snapshot.room.moderatorUserIds.includes(profile.id) ? () => setRoomSettingsOpen(true) : undefined}
        onAdmin={profile.isAppAdmin ? openAdmin : undefined} onProfile={() => openProfile(profile.id)}
        onFriends={() => setFriendsOpen(true)}
        onThemeNight={snapshot.room.ownerUserId === profile.id || snapshot.room.moderatorUserIds.includes(profile.id) ? () => setThemeNightOpen(true) : undefined}
        onSignOut={auth.enabled ? () => { void auth.client?.auth.signOut(); } : undefined}
        onResetLayout={resetRoomLayout} onNotice={setNotice}
        layoutPreset={roomLayouts.layoutPreset} onLayoutPresetChange={roomLayouts.onLayoutPresetChange}
        onFocusSearch={focusMusicSearch} onOpenQueue={openMusicQueue} onOpenPlayer={() => setMobileRoomPane("player")}
        onToggleMute={() => playerControls.current?.toggleMute()} muted={userSettings.playback.defaultVolume === 0} onFocusChat={focusChat}
        connected={connected} onReconnect={retryRoom}
        participants={snapshot.users} ownerUserId={snapshot.room.ownerUserId} moderatorUserIds={snapshot.room.moderatorUserIds} djUserId={snapshot.room.djUserId} onOpenProfile={openProfile}
        diagnosticContext={{
              surface: "room",
              roomRole: snapshot.room.ownerUserId === profile.id
                ? "owner"
                : snapshot.room.moderatorUserIds.includes(profile.id)
                  ? "moderator"
                  : snapshot.room.djUserId === profile.id || snapshot.room.djRoleUserIds.includes(profile.id)
                    ? "dj"
                    : "listener",
              socketConnected: connected,
              playbackProvider: snapshot.room.playback.track?.provider || null,
              playbackState: snapshot.room.playback.track
                ? snapshot.room.playback.playing ? "playing" : "paused"
                : "idle",
              preferredPlayback: userSettings.playback.preference
        }} />

      <RoomWorkspace compact={compactPlayer} value={mobileRoomPane} onValueChange={setMobileRoomPane} unreadCount={chatUnreadCount}
          defaultLayout={roomLayouts.defaultLayout}
          groupRef={roomPanelGroupRef}
          onLayoutChanged={roomLayouts.onLayoutChanged}
          miniPlayer={<RoomMiniPlayer track={snapshot.room.playback.track} statusText={localPlayback.statusText} statusTone={localPlayback.statusTone} muted={userSettings.playback.defaultVolume === 0} onToggleMute={() => playerControls.current?.toggleMute()} onOpenPlayer={() => setMobileRoomPane("player")} />}
          listeningChecklist={<ListeningChecklist userId={profile.id} providerName={localPlayback.providerName} providerState={localPlayback.providerState} audioState={localPlayback.audioState} statusText={localPlayback.statusText} onOpenSettings={() => setUserSettingsOpen(true)} onEnableAudio={() => { setMobileRoomPane("player"); playerControls.current?.retryPlayback(); }} onChooseMusic={focusMusicSearch} />}
          roomNotice={<>{snapshot.room.settings.themePrompt && <RoomThemeBanner prompt={snapshot.room.settings.themePrompt} />}
            <RoomAnnouncementBanner key={`${snapshot.room.id}:${profile.id}`} roomId={snapshot.room.id} userId={profile.id} announcement={snapshot.room.announcement} serverTime={snapshot.serverTime} canEdit={snapshot.room.ownerUserId === profile.id || snapshot.room.moderatorUserIds.includes(profile.id)} connected={connected} /></>}
          radio={<MusicRail
              key={`${snapshot.room.id}:${profile.id}`}
              snapshot={snapshot}
              currentUserId={profile.id}
              connected={connected}
              accessToken={auth.session?.access_token}
              setNotice={setNotice}
              controlsRef={musicControls}
            />}
          player={<div className="player-column">
              <PanelErrorBoundary key={`${snapshot.room.id}:${profile.id}`} panelName="Player"><NowPlaying
                key={`${snapshot.room.id}:${profile.id}`}
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
                roomConnected={connected}
                onOpenSettings={() => setUserSettingsOpen(true)}
                onAddTrack={focusMusicSearch}
                controlsRef={playerControls} onLocalStateChange={setLocalPlayback}
              /></PanelErrorBoundary>
            </div>}
          chat={<PanelErrorBoundary key={`${snapshot.room.id}:${profile.id}`} panelName="Chat"><RoomChat
              key={`${snapshot.room.id}:${profile.id}`}
              snapshot={snapshot}
              currentUser={profile}
              client={auth.client!}
              accessToken={auth.session!.access_token}
              connected={connected}
              onOpenProfile={openProfile}
              notifications={userSettings.notifications}
              isVisible={!isNarrowRoomLayout || mobileRoomPane === "chat" || (isTabletDualRoomLayout && mobileRoomPane !== "radio")}
              onActivate={() => setMobileRoomPane("chat")}
              onUnreadCountChange={setChatUnreadCount}
              controlsRef={chatControls}
            /></PanelErrorBoundary>}
      />
      {roomSettingsOpen && auth.session && (
        <DeferredDialog title="Room settings" load={loadRoomSettings} componentProps={{ snapshot, currentUserId: profile.id, accessToken: auth.session.access_token, connected, onClose: () => setRoomSettingsOpen(false), onNotice: setNotice }} />
      )}
      {auth.session && <RoomProfileDialog profileId={profilePageId} accessToken={auth.session.access_token}
        currentUser={profile} onClose={backFromProfile} onUpdate={updateOwnProfile} onInvite={userId => { void inviteFriend(userId); }} />}
      {friendsOpen && auth.session && <Dialog open onOpenChange={setFriendsOpen}>
        <DialogContent className="room-friends-dialog"><DialogTitle className="sr-only">Friends</DialogTitle>
          <FriendsPanel accessToken={auth.session.access_token} currentUser={profile}
            currentRoomSlug={roomId} onOpenPerson={id => { setFriendsOpen(false); openProfile(id); }}
            onOpenRoom={id => { setFriendsOpen(false); openRoom(id); }} />
        </DialogContent>
      </Dialog>}
      {themeNightOpen && auth.session && <ThemeNightDialog key={`${snapshot.room.id}:${profile.id}`} roomSlug={snapshot.room.id}
        prompt={snapshot.room.settings.themePrompt} accessToken={auth.session.access_token} connected={connected}
        onClose={() => setThemeNightOpen(false)} onNotice={setNotice} />}
    </main>
  );
}

function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="loading-screen">
      <Brand />
      <div className="equalizer"><i /><i /><i /><i /></div>
      <p>{label}</p>
    </div>
  );
}

function PublicEntry({ client }: { client: SupabaseClient }) {
  const [path, setPath] = useState(location.pathname);

  useEffect(() => { rememberAuthDestination(path); }, [path]);

  useEffect(() => {
    const onPopState = () => setPath(location.pathname);
    addEventListener("popstate", onPopState);
    return () => removeEventListener("popstate", onPopState);
  }, []);

  const navigate = (nextPath: string) => {
    rememberAuthDestination(path);
    if (nextPath === "/") takeAuthDestination();
    history.pushState({}, "", nextPath);
    setPath(nextPath);
  };

  if (path === "/") return <LandingPage onNavigate={navigate} />;

  return <AuthScreen client={client} path={path} onNavigate={navigate} />;
}

function AuthScreen({
  client,
  path,
  onNavigate
}: {
  client: SupabaseClient;
  path: string;
  onNavigate: (path: string) => void;
}) {

  const form = path === "/sign-up"
    ? <SignUpForm client={client} onNavigate={onNavigate} className="w-full" />
    : path === "/forgot-password"
      ? <ForgotPasswordForm client={client} onNavigate={onNavigate} className="w-full" />
      : <LoginForm client={client} onNavigate={onNavigate} className="w-full" />;

  return (
    <main className="welcome auth-welcome">
      <nav>
        <a
          className="auth-home-link"
          href="/"
          onClick={(event) => {
            event.preventDefault();
            onNavigate("/");
          }}
        >
          <Brand />
        </a>
        <div className="welcome-nav-actions"><ThemeToggle compact /></div>
      </nav>
      <section className="auth-content">
        <div className="auth-intro">
          <h1>Listen together.</h1>
        </div>
        {form}
      </section>
      <footer className="app-release-footer"><AppVersion /></footer>
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
      <nav><Brand /><div className="welcome-nav-actions"><ThemeToggle compact /></div></nav>
      <section className="auth-content">
        <div className="auth-intro">
          <h1>Account recovery</h1>
        </div>
        <UpdatePasswordForm client={client} onComplete={onComplete} className="w-full" />
      </section>
      <footer className="app-release-footer"><AppVersion /></footer>
    </main>
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
      <nav><Brand /><div className="welcome-nav-actions"><ThemeToggle compact /></div></nav>
      <section className="welcome-content">
        <div className="welcome-copy">
          <h1>Listen together.</h1>
        </div>
        <Card className="welcome-card">
          <CardHeader><CardTitle>{joining ? "Join room" : "Create room"}</CardTitle></CardHeader>
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
            <Button type="submit" size="lg">{joining ? "Join room" : "Create room"}</Button>
          </form>
          </CardContent>
        </Card>
      </section>
      <footer className="app-release-footer"><AppVersion /></footer>
    </main>
  );
}


function RoomChat({
  snapshot,
  currentUser,
  client,
  accessToken,
  connected,
  onOpenProfile,
  notifications,
  isVisible,
  onActivate,
  onUnreadCountChange,
  controlsRef
}: {
  snapshot: RoomSnapshot;
  currentUser: User;
  client: SupabaseClient;
  accessToken: string;
  connected: boolean;
  onOpenProfile: (userId: string) => void;
  notifications: SoundSpinUserSettings["notifications"];
  isVisible: boolean;
  onActivate: () => void;
  onUnreadCountChange: (count: number) => void;
  controlsRef?: RefObject<RealtimeChatHandle | null>;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const historySource = useMemo(() => createChatHistorySource(accessToken, snapshot.room.id), [accessToken, snapshot.room.id]);
  // RoomChat is keyed by account and room. An original-UUID retry keeps that
  // identity while reading refreshed credentials from this same lifetime.
  const historySourceRef = useRef(historySource);
  historySourceRef.current = historySource;
  const chatTransport = useMemo(() => createSocketChatSessionFactory(socket, snapshot.room.id), [snapshot.room.id]);
  useEffect(() => { chatTransport.setAdmitted(connected); }, [chatTransport, connected]);
  const [error, setError] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const historyRequestRef = useRef(0);
  const activeRef = useRef(true);
  const chatRef = useRef<RealtimeChatHandle>(null);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [chatHeaderActions, setChatHeaderActions] = useState<HTMLDivElement | null>(null);
  const peopleButtonRef = useRef<HTMLButtonElement>(null);
  const adminUserIds = [...new Set(
    snapshot.users
      .filter((user) => user.isAppAdmin)
      .map((user) => user.id)
  )];

  const refreshHistory = useCallback(() => {
    const request = ++historyRequestRef.current;
    setLoadingHistory(true);
    void (async () => {
      try {
        const history = (await historySource.loadPage()).messages;
        if (!activeRef.current || request !== historyRequestRef.current) return;
        setMessages(history);
        setError("");
      } catch {
        if (activeRef.current && request === historyRequestRef.current) {
          setError("Chat history could not be loaded.");
        }
      } finally {
        if (activeRef.current && request === historyRequestRef.current) setLoadingHistory(false);
      }
    })();

  }, [historySource]);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      ++historyRequestRef.current;
    };
  }, [client, snapshot.room.id]);

  const persistMessage = useCallback((message: ChatMessage) => historySourceRef.current.saveMessage(message), []);

  return (
    <aside className="chat panel">
      <div className="chat-header">
        <div>
          <MessageIcon size={20} />
          <h2 style={{ margin: 0, fontSize: "inherit", fontWeight: 700 }}>Room chat</h2>
        </div>
        <div className="chat-presence">
          <Button ref={peopleButtonRef} variant="ghost" size="sm" onClick={() => setPeopleOpen(true)} aria-label={`Show all ${snapshot.users.length} room listeners`}><UsersIcon size={16} /> {snapshot.users.length}</Button>
          <div className="chat-header-actions" ref={setChatHeaderActions} />
        </div>
      </div>
      <div className="supabase-chat-body">
        {error && <div className="chat-error" role="alert">{error} <Button size="sm" variant="ghost" onClick={refreshHistory} disabled={loadingHistory}>{loadingHistory ? "Loading…" : "Retry history"}</Button></div>}
        <RealtimeChat
          ref={controlsRef || chatRef}
          headerActionsContainer={chatHeaderActions}
          client={client}
          transport={chatTransport}
          roomName={`soundspin:${snapshot.room.id}`}
          user={currentUser}
          messages={messages}
          onSend={persistMessage}
          onConnected={refreshHistory}
          onOpenProfile={onOpenProfile}
          adminUserIds={adminUserIds}
          roomUsers={snapshot.users}
          isVisible={isVisible}
          onUnreadCountChange={onUnreadCountChange}
          historyRoomSlug={snapshot.room.id}
          historySource={historySource}
          onPersistReaction={historySource.saveReaction}
          onResolveMediaUrl={historySource.loadMediaUrl}
          historyLoading={loadingHistory}
          notifications={notifications}
          onNotificationActivate={onActivate}
        />
      </div>
      <RoomPeopleDialog open={peopleOpen} onOpenChange={setPeopleOpen} users={snapshot.users} currentUserId={currentUser.id} ownerUserId={snapshot.room.ownerUserId} moderatorUserIds={snapshot.room.moderatorUserIds} djUserId={snapshot.room.djUserId} onOpenProfile={onOpenProfile} finalFocus={peopleButtonRef} />
    </aside>
  );
}
