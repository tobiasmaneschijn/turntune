import { NowPlaying, type NowPlayingControls, type NowPlayingLocalState } from "./components/NowPlaying";
import { FormEvent, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { LayoutDashboard } from "lucide-react";
import { MusicRail, type MusicRailControls } from "./components/MusicRail";
import { ThemeToggle } from "./components/ThemeToggle";
import { PasswordDialog, RoomLobby } from "./components/RoomLobby";
import { PanelErrorBoundary } from "./components/AppErrorBoundary";
import { Brand } from "./components/app-primitives";
import { AppVersion } from "./components/AppVersion";
import { RoomHeader } from "./components/RoomHeader";
import { ParticipantActions } from "./components/ParticipantActions";
import { RoomModerationDialog } from "./components/RoomModerationDialog";
import { RoomRulesDialog, RoomSessionNotices } from "./components/RoomRulesDialog";
import { effectiveRoomPolicy, roomCapabilities } from "../shared/room-policy";
import { roomManagementRequest, roomModerationAction } from "./room-management";
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
import { MessageIcon, UsersIcon } from "./components/Icons";
import { RealtimeChat, type RealtimeChatHandle } from "./components/realtime-chat";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { useGroupRef } from "./components/ui/resizable";
import type { ChatMessage } from "./chat/model";
import { createChatHistorySource } from "./chat/history-reader";
import { createSocketChatSessionFactory } from "./chat/socket-transport";
import { useRoomLayoutPresets } from "./hooks/use-room-layout-presets";
import { useRouteFocus } from "./hooks/use-route-focus";
import { useRoomNotificationMuted } from "./hooks/use-room-notifications";
import { notifyWithAttention } from "./notifications";
import { socket } from "./socket";
import type { AppAuth } from "./hooks/use-app-auth";
import { LoadingScreen } from "./components/LoadingScreen";
import { useRoomSession } from "./hooks/use-room-session";
import { useAppProfile } from "./hooks/use-app-profile";
import { useMediaQuery } from "./hooks/use-media-query";
import { storeValue } from "./lib/browser-storage";
import { recordRoomVisit } from "./lib/room-visits";
import type { SoundSpinUserSettings } from "./playback-settings";
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

export function RoomApplication({ auth, userSettings, changeUserSettings, focusOnEntry = false }: { auth: AppAuth; userSettings: SoundSpinUserSettings; changeUserSettings: (next: SoundSpinUserSettings) => void; focusOnEntry?: boolean }) {
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
  const [moderationOpen, setModerationOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [userSettingsOpen, setUserSettingsOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [themeNightOpen, setThemeNightOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const previousDjUserIdRef = useRef<string | null>(null);
  const djBaselineRef = useRef("");
  const { profile, setProfile, profileReady } = useAppProfile(auth);
  const { roomId, profilePageId, adminPage, navigationContext, snapshot, connected, roomPasswordRequired, roomJoinError,
    setRoomPassword, setRoomPasswordRequired, setRoomJoinError, retryRoom, openRoom, openProfile, openAdmin,
    goHome: leaveRoom, backFromProfile } = useRoomSession({ auth, profile, profileReady, onNotice: setNotice });
  const [roomNotificationsMuted] = useRoomNotificationMuted(profile.id, roomId || "");
  useRouteFocus(navigationContext, navigationContext, Boolean(roomId && profilePageId), focusOnEntry);
  const recordedVisitRef = useRef<string | null>(null);
  const invitationRequests = useRef(new Map<string, AbortController>());
  useEffect(() => () => {
    invitationRequests.current.forEach(controller => controller.abort());
    invitationRequests.current.clear();
  }, [auth.session?.user.id, roomId]);
  useEffect(() => {
    setFriendsOpen(false); setThemeNightOpen(false); setRoomSettingsOpen(false); setUserSettingsOpen(false); setModerationOpen(false); setRulesOpen(false);
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

  if (auth.enabled && auth.session && (profile.id !== auth.session.user.id || !profileReady)) {
    return <LoadingScreen label="Restoring your session…" />;
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
  const canControlPlayback = snapshot.room.capabilities?.playback ?? (isDj ||
    snapshot.room.ownerUserId === profile.id ||
    snapshot.room.moderatorUserIds.includes(profile.id));
  const capabilities = snapshot.room.capabilities ?? roomCapabilities(snapshot.room, profile.id, snapshot.serverTime);
  const participantActions = auth.session ? (user: User) => <ParticipantActions snapshot={snapshot} currentUserId={profile.id} user={user} accessToken={auth.session!.access_token} connected={connected} onNotice={setNotice} /> : undefined;

  return (
    <main className={`app-shell ${connected ? "" : "room-is-reconnecting"}`}>
      <RoomHeader roomName={snapshot.room.name} roomSlug={snapshot.room.id} listenerCount={snapshot.users.length}
        currentUser={profile} onHome={goHome} onSettings={() => setUserSettingsOpen(true)}
        onRoomSettings={capabilities.staff ? () => setRoomSettingsOpen(true) : undefined}
        onModeration={capabilities.staff ? () => setModerationOpen(true) : undefined}
        moderationCount={snapshot.room.ownStatus?.openReports ?? 0}
        onRules={snapshot.room.settings.rulesText || snapshot.room.settings.requireRulesAcceptance ? () => setRulesOpen(true) : undefined}
        participantActions={participantActions}
        onAdmin={profile.isAppAdmin ? openAdmin : undefined} onProfile={() => openProfile(profile.id)}
        onFriends={() => setFriendsOpen(true)}
        onThemeNight={capabilities.roomDetailsMusic ? () => setThemeNightOpen(true) : undefined}
        onSignOut={auth.enabled ? () => { void auth.client?.auth.signOut(); } : undefined}
        onResetLayout={resetRoomLayout} onNotice={setNotice}
        layoutPreset={roomLayouts.layoutPreset} onLayoutPresetChange={roomLayouts.onLayoutPresetChange}
        onFocusSearch={focusMusicSearch} onOpenQueue={openMusicQueue} onOpenPlayer={() => setMobileRoomPane("player")}
        onToggleMute={localPlayback.localVolumeSupported === false ? undefined : () => playerControls.current?.toggleMute()} muted={localPlayback.muted} onFocusChat={focusChat}
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
          miniPlayer={<RoomMiniPlayer track={snapshot.room.playback.track} statusText={localPlayback.statusText} statusTone={localPlayback.statusTone} muted={localPlayback.muted} localVolumeSupported={localPlayback.localVolumeSupported} onToggleMute={() => playerControls.current?.toggleMute()} onOpenPlayer={() => setMobileRoomPane("player")} />}
          listeningChecklist={<ListeningChecklist userId={profile.id} providerName={localPlayback.providerName} providerState={localPlayback.providerState} audioState={localPlayback.audioState} statusText={localPlayback.statusText} onOpenSettings={() => setUserSettingsOpen(true)} onEnableAudio={() => { setMobileRoomPane("player"); playerControls.current?.retryPlayback(); }} onChooseMusic={focusMusicSearch} />}
          roomNotice={<>{(snapshot.room.activeTheme ?? snapshot.room.settings.themePrompt) && <RoomThemeBanner prompt={(snapshot.room.activeTheme ?? snapshot.room.settings.themePrompt)!} />}
            <RoomAnnouncementBanner key={`${snapshot.room.id}:${profile.id}`} roomId={snapshot.room.id} userId={profile.id} announcement={snapshot.room.announcement} serverTime={snapshot.serverTime} canEdit={capabilities.roomDetailsMusic} connected={connected} />{auth.session && <RoomSessionNotices key={`${snapshot.room.id}:${profile.id}`} snapshot={snapshot} accessToken={auth.session.access_token} connected={connected} onRules={() => setRulesOpen(true)} />}</>}
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
              onOpenQueue={openMusicQueue}
              controlsRef={chatControls}
            /></PanelErrorBoundary>}
      />
      {roomSettingsOpen && auth.session && (
        <DeferredDialog title="Room settings" load={loadRoomSettings} componentProps={{ snapshot, currentUserId: profile.id, accessToken: auth.session.access_token, connected, onClose: () => setRoomSettingsOpen(false), onNotice: setNotice }} />
      )}
      {moderationOpen && auth.session && <RoomModerationDialog key={`${snapshot.room.id}:${profile.id}`} snapshot={snapshot} currentUserId={profile.id} accessToken={auth.session.access_token} connected={connected} onClose={() => setModerationOpen(false)} onNotice={setNotice} onOpenProfile={id => { setModerationOpen(false); openProfile(id); }} />}
      {rulesOpen && auth.session && <RoomRulesDialog key={`${snapshot.room.id}:${profile.id}`} snapshot={snapshot} accessToken={auth.session.access_token} connected={connected} onClose={() => setRulesOpen(false)} onNotice={setNotice} />}
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
  onOpenQueue,
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
  onOpenQueue: () => void;
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
  const managementRequestIds = useRef(new Map<string, string>());
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
  const capabilities = snapshot.room.capabilities ?? roomCapabilities(snapshot.room, currentUser.id, snapshot.serverTime);
  const effectivePolicy = effectiveRoomPolicy(snapshot.room, snapshot.serverTime);
  const requestIdFor = (key: string) => { if (!managementRequestIds.current.has(key)) managementRequestIds.current.set(key, crypto.randomUUID()); return managementRequestIds.current.get(key)!; };
  const removeMessage = async (message: ChatMessage, reason: string) => { const key = `remove:${message.id}:${reason}`; await roomModerationAction(snapshot.room.id, accessToken, { action: "remove-message", messageId: message.id, reason }, requestIdFor(key)); managementRequestIds.current.delete(key); };
  const reportMessage = async (message: ChatMessage, reason: string) => { const key = `report:${message.id}:${reason}`; await roomManagementRequest(snapshot.room.id, "reports", accessToken, { method: "POST", body: JSON.stringify({ requestId: requestIdFor(key), messageId: message.id, targetUserId: message.user.id, reason }) }); managementRequestIds.current.delete(key); };
  const restrictionMessage = capabilities.chat ? undefined : snapshot.room.ownStatus?.chatTimeoutUntil !== undefined ? `Chat timeout${snapshot.room.ownStatus.chatTimeoutUntil ? ` until ${new Date(snapshot.room.ownStatus.chatTimeoutUntil).toLocaleString()}` : ""}.` : snapshot.room.settings.requireRulesAcceptance && !snapshot.room.ownStatus?.rulesAccepted ? "Accept the room rules before participating." : "Chat is limited to room staff.";

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
          capabilities={capabilities}
          slowModeSeconds={capabilities.staff ? 0 : effectivePolicy.slowModeSeconds ?? 0}
          restrictionMessage={restrictionMessage}
          onRemoveMessage={capabilities.chatParticipants ? removeMessage : undefined}
          canRemoveMessage={message => capabilities.owner || (message.user.id !== snapshot.room.ownerUserId && !snapshot.room.moderatorUserIds.includes(message.user.id))}
          onReportMessage={reportMessage}
          messages={messages}
          onSend={persistMessage}
          onConnected={refreshHistory}
          onOpenProfile={onOpenProfile}
          adminUserIds={adminUserIds}
          roomUsers={snapshot.users}
          isVisible={isVisible}
          onUnreadCountChange={onUnreadCountChange}
          onOpenQueue={onOpenQueue}
          historyRoomSlug={snapshot.room.id}
          historySource={historySource}
          onPersistReaction={historySource.saveReaction}
          onResolveMediaUrl={historySource.loadMediaUrl}
          historyLoading={loadingHistory}
          historyUnavailable={Boolean(error)}
          notifications={notifications}
          onNotificationActivate={onActivate}
        />
      </div>
      <RoomPeopleDialog open={peopleOpen} onOpenChange={setPeopleOpen} users={snapshot.users} currentUserId={currentUser.id} ownerUserId={snapshot.room.ownerUserId} moderatorUserIds={snapshot.room.moderatorUserIds} djUserId={snapshot.room.djUserId} onOpenProfile={onOpenProfile} participantActions={user => <ParticipantActions snapshot={snapshot} currentUserId={currentUser.id} user={user} accessToken={accessToken} connected={connected} onNotice={text => toast.info(text)} />} finalFocus={peopleButtonRef} />
    </aside>
  );
}
