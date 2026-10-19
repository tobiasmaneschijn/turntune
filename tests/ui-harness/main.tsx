import { createRoot } from "react-dom/client";
import { useState } from "react";
import "@fontsource-variable/geist";
import "../../src/shadcn.css";
import "../../src/styles.css";
import "./harness.css";
import { AdminDashboard } from "../../src/components/AdminDashboard";
import { AppErrorBoundary } from "../../src/components/AppErrorBoundary";
import { AsyncState } from "../../src/components/app-primitives";
import { FeedbackButton } from "../../src/components/FeedbackDialog";
import { ProfilePage } from "../../src/components/ProfilePage";
import { RoomLobby } from "../../src/components/RoomLobby";
import { RoomHeader } from "../../src/components/RoomHeader";
import { RoomWorkspace } from "../../src/components/RoomWorkspace";
import type { RoomPane } from "../../src/components/RoomPaneTabs";
import { ThemeProvider } from "../../src/components/theme-provider";
import { UserSettingsDialog } from "../../src/components/UserSettingsDialog";
import { Button } from "../../src/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../src/components/ui/card";
import { Input } from "../../src/components/ui/input";
import { LoginForm } from "../../src/components/login-form";
import { Toaster } from "../../src/components/ui/sonner";
import { TooltipProvider } from "../../src/components/ui/tooltip";
import { readUserSettings } from "../../src/playback-settings";

const scenario = new URLSearchParams(location.search).get("scenario") || "lobby";
const user = { id: "qa-admin", name: "QA Admin", avatarSeed: "qa-admin", avatarKey: "pulse", isAppAdmin: true };
const profile = { user_id: user.id, display_name: user.name, is_app_admin: true, bio: "Weekend DJ.", handle: "qa_admin", status_text: "One more song.",
  favorite_tracks: [{ provider: "youtube", providerId: "aaaaaaaaaaa", title: "Sunset Signal", artist: "Mira" }],
  avatar_key: "pulse", avatar_url: null, avatar_path: null, theme_key: "afterglow", created_at: "2026-01-15T12:00:00Z", updated_at: "2026-07-31T12:00:00Z" };
const adminData = { metrics: { users: 1284, rooms: 42, feedback: 86, openFeedback: 12, messages: 18420 }, activity: [{ date: "2026-07-25", users: 84, feedback: 4, messages: 920 }, { date: "2026-07-31", users: 126, feedback: 7, messages: 1430 }], feedback: [{ id: "feedback-0001", userId: "listener-1", userName: "Mira", userAvatarUrl: null, message: "The compact player should remember its size on tablet.", roomSlug: "sunset-radio", pagePath: "/room/sunset-radio", viewport: { width: 1024, height: 768 }, category: "idea", impact: "minor", diagnostics: { browser: "Chromium", theme: "dark" }, status: "new", adminNote: "", createdAt: "2026-07-31T17:20:00Z", updatedAt: "2026-07-31T17:20:00Z", screenshots: [] }], rooms: [{ slug: "sunset-radio", name: "Sunset Radio", isPublic: true, listenerCount: 18, createdAt: "2026-06-01T10:00:00Z", updatedAt: "2026-07-31T18:20:00Z" }] };
const feedbackFixtureMessages = [
  "The compact player should remember its size on tablet.",
  "Playback briefly pauses when another listener joins the room.",
  "Let hosts pin an announcement above the room chat.",
  "The queue order is difficult to scan during a busy session.",
  "Add a keyboard shortcut to open the track search.",
  "Profile avatars sometimes appear stale after uploading a new image."
];
const feedbackFixtureStatuses = ["new", "new", "new", "new", "new", "new", "new", "reviewing", "reviewing", "reviewing", "planned", "planned", "resolved", "resolved", "closed"] as const;
const adminFeedbackData = {
  ...adminData,
  feedback: feedbackFixtureStatuses.map((status, index) => ({
    ...adminData.feedback[0],
    id: `feedback-${String(index + 1).padStart(4, "0")}`,
    userId: `listener-${index + 1}`,
    userName: ["Mira", "Jonas", "Sofia", "Noah", "Lea"][index % 5],
    message: feedbackFixtureMessages[index % feedbackFixtureMessages.length],
    category: (["idea", "playback", "chat", "bug", "account"] as const)[index % 5],
    impact: (["minor", "blocking", "minor", "unusable"] as const)[index % 4],
    status,
    createdAt: new Date(Date.parse("2026-07-31T17:20:00Z") - index * 3_600_000).toISOString(),
    updatedAt: new Date(Date.parse("2026-07-31T17:20:00Z") - index * 3_600_000).toISOString()
  }))
};
let boundaryShouldThrow = true;
const rejectedAuthClient = { auth: { signInWithPassword: async () => ({ error: new Error("Email or password is incorrect.") }) } };

let directoryRequests = 0;
globalThis.fetch = async (input) => {
  const url = String(input);
  if (url === "/api/social") return Response.json({ people: [], invitations: [], shareActivity: false });
  if (url === "/api/library") return Response.json({ library: { picks: [], sets: [] } });
  if (url.includes("/api/admin/dashboard")) return Response.json(scenario === "admin-feedback" ? adminFeedbackData : adminData);
  if (url.includes("/api/profiles/")) return Response.json({ profile, options: [
    { key: "pulse", kind: "avatar", name: "Pulse", metadata: {} }, { key: "orbit", kind: "avatar", name: "Orbit", metadata: {} },
    { key: "afterglow", kind: "theme", name: "Afterglow", metadata: { description: "Warm neon accents" } }, { key: "deep-space", kind: "theme", name: "Deep Space", metadata: { description: "A cooler cosmic profile" } }
  ] });
  if (url.endsWith("/api/rooms")) {
    directoryRequests += 1;
    if (scenario === "lobby-membership") return Response.json({ rooms: [
      { slug: "private-room", name: "Private Studio", ownerId: "host-2", isPublic: false, passwordProtected: false, isFavorite: true, role: "member", listenerCount: directoryRequests > 1 ? 4 : 0, createdAt: "2026-07-01", updatedAt: "2026-07-31" },
      { slug: "public-room", name: "Public Radio", ownerId: "host-3", isPublic: true, passwordProtected: true, isFavorite: false, role: null, listenerCount: 7, createdAt: "2026-07-02", updatedAt: "2026-07-31" }
    ] });
    return Response.json({ rooms: scenario === "lobby-empty" ? [] : [
    { slug: "sunset-radio", name: "Sunset Radio", ownerId: user.id, isPublic: true, passwordProtected: false, isFavorite: true, role: "owner", listenerCount: 18, createdAt: "2026-07-01", updatedAt: "2026-07-31" },
    { slug: "deep-focus", name: "Deep Focus", ownerId: "host-2", isPublic: true, passwordProtected: false, isFavorite: false, role: null, listenerCount: 7, createdAt: "2026-07-02", updatedAt: "2026-07-31" }
    ] });
  }
  return Response.json({ profile, ...adminData });
};

function RecoverableFixture() {
  if (boundaryShouldThrow) {
    throw new Error("Deterministic fixture failure");
  }
  return <div className="fixture-state"><AsyncState state="empty" title="Interface recovered" description="The error boundary remounted the surface." /></div>;
}

function WorkspaceControlsFixture() {
  const [pane, setPane] = useState<RoomPane>("player");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [action, setAction] = useState("");
  const listener = new URLSearchParams(location.search).get("role") === "listener";
  const settings = readUserSettings();
  return <main className="app-shell">
    <RoomHeader roomName="A room with a longer name for testing mobile access" roomSlug="qa-room" listenerCount={18} currentUser={user}
      onHome={() => setAction("Rooms opened")} onSettings={() => setSettingsOpen(true)}
      onRoomSettings={listener ? undefined : () => setAction("Room settings opened")}
      onAdmin={listener ? undefined : () => setAction("Admin opened")} onProfile={() => setAction("Profile opened")}
      onSignOut={() => setAction("Signed out")} onResetLayout={() => setAction("Layout reset")} onNotice={setAction}
      participants={[user, ...Array.from({ length: 8 }, (_, index) => ({ id: `listener-${index + 1}`, name: `Listener ${index + 1}`, avatarSeed: `listener-${index + 1}` }))]}
      ownerUserId={user.id} djUserId="listener-8" onOpenProfile={(id) => setAction(`Profile opened: ${id}`)} />
    <RoomWorkspace value={pane} onValueChange={setPane} unreadCount={3} defaultLayout={{ radio: 20, player: 40, chat: 40 }}
      radio={<aside className="music-rail panel"><h2 className="music-rail-heading">Radio</h2><Input aria-label="Radio search" placeholder="Find music" /></aside>}
      player={<div className="player-column"><section className="now-playing panel"><h2 className="now-playing-heading">Player</h2><div className="now-playing-main"><div className="track-stage">Artwork</div><div className="player-details">{Array.from({ length: 10 }, (_, index) => <p key={index}>Player context line {index + 1}</p>)}<Button onClick={() => setAction("Bottom control reached")}>Bottom player control</Button></div></div></section></div>}
      chat={<aside className="chat panel"><h2 className="chat-header">Room chat</h2><Input aria-label="Draft message" placeholder="Message room" /></aside>} />
    {settingsOpen && <UserSettingsDialog settings={settings} connections={{ loaded: true, spotifyConfigured: false, spotifyConnected: false, appleConfigured: false }} onSettingsChange={() => {}} onConnectSpotify={() => {}} onDisconnectSpotify={() => {}} onClose={() => setSettingsOpen(false)} />}
    {action && <p className="sr-only" role="status">{action}</p>}
  </main>;
}

function Harness() {
  const [settings, setSettings] = useState(readUserSettings);
  if (scenario === "workspace-controls") return <WorkspaceControlsFixture />;
  if (scenario.startsWith("lobby")) return <RoomLobby accessToken="fixture" currentUser={user} onOpenRoom={() => {}} onOpenProfile={() => {}} onSignOut={() => {}} userSettings={settings} onSettingsChange={setSettings} onAdmin={() => {}} />;
  if (scenario === "profile") return <ProfilePage profileId={user.id} accessToken="fixture" currentUser={user} onBack={() => {}} onOwnProfileUpdated={() => {}} onOpenAdmin={() => {}} />;
  if (scenario === "admin" || scenario === "admin-feedback") return <AdminDashboard accessToken="fixture" currentUser={user} onBack={() => {}} onOpenRoom={() => {}} />;
  if (scenario === "settings") return <div className="fixture-page"><UserSettingsDialog settings={readUserSettings()} connections={{ loaded: true, spotifyConfigured: true, spotifyConnected: true, appleConfigured: true }} accessToken="fixture" onSettingsChange={() => {}} onConnectSpotify={() => {}} onDisconnectSpotify={() => {}} onClose={() => {}} /></div>;
  if (scenario === "feedback") return <div className="fixture-state"><Card><CardHeader><CardTitle>Feedback fixture</CardTitle><CardDescription>Open the production feedback dialog.</CardDescription></CardHeader><CardContent><FeedbackButton userId={user.id} /></CardContent></Card></div>;
  if (scenario === "login-error") return <div className="fixture-state"><LoginForm client={rejectedAuthClient as never} onNavigate={() => {}} /></div>;
  if (scenario === "boundary") return <AppErrorBoundary onRetry={() => { boundaryShouldThrow = false; }}><RecoverableFixture /></AppErrorBoundary>;
  throw new Error(`Unknown fixture scenario: ${scenario}`);
}

createRoot(document.getElementById("root")!).render(<ThemeProvider><TooltipProvider><Harness /><Toaster /></TooltipProvider></ThemeProvider>);
