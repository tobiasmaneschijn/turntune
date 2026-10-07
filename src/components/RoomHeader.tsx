import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Copy, House, Keyboard, LayoutDashboard, Lightbulb, LogOut, MoreHorizontal, RotateCcw, Settings, Shield, UserRound, Users } from "lucide-react";
import type { User } from "../types";
import type { FeedbackDiagnosticContext } from "../feedback-diagnostics";
import { Avatar } from "./Avatar";
import { AppVersion } from "./AppVersion";
import { Brand } from "./app-primitives";
import { ThemeToggle } from "./ThemeToggle";
import { RoomPeopleDialog } from "./RoomPeopleDialog";
import { RoomCommandMenu, type RoomCommand } from "./RoomCommandMenu";
import { useKeyboardShortcuts } from "../hooks/use-keyboard-shortcuts";
import type { RoomLayoutPreset } from "../hooks/use-room-layout-presets";
import { readStoredValue, storeValue } from "../lib/browser-storage";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Switch } from "./ui/switch";
import "../styles/layout-completion.css";

const FeedbackButton = lazy(() => import("./FeedbackDialog").then((module) => ({ default: module.FeedbackButton })));

export function RoomHeader({ roomName, roomSlug, listenerCount, currentUser, diagnosticContext,
  onHome, onSettings, onRoomSettings, onAdmin, onProfile, onSignOut, onResetLayout, onNotice, connected = true, onReconnect,
  participants, ownerUserId, moderatorUserIds, djUserId, onOpenProfile, onFriends, onThemeNight, onFocusSearch, onOpenQueue, onOpenPlayer, onToggleMute, onFocusChat, muted = false, layoutPreset = "balanced", onLayoutPresetChange }: {
  roomName: string;
  roomSlug: string;
  listenerCount: number;
  currentUser: User;
  diagnosticContext?: FeedbackDiagnosticContext;
  onHome: () => void;
  onSettings: () => void;
  onRoomSettings?: () => void;
  onAdmin?: () => void;
  onProfile: () => void;
  onSignOut?: () => void;
  onResetLayout: () => void;
  onNotice: (message: string) => void;
  connected?: boolean;
  onReconnect?: () => void;
  participants?: User[];
  ownerUserId?: string | null;
  moderatorUserIds?: string[];
  djUserId?: string | null;
  onOpenProfile?: (userId: string) => void;
  onFriends?: () => void;
  onThemeNight?: () => void;
  onFocusSearch?: () => void;
  onOpenQueue?: () => void;
  onOpenPlayer?: () => void;
  onToggleMute?: () => void;
  onFocusChat?: () => void;
  muted?: boolean;
  layoutPreset?: RoomLayoutPreset;
  onLayoutPresetChange?: (preset: RoomLayoutPreset) => void;
}) {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const shortcutKey = `soundspin:single-key-shortcuts:${currentUser.id}`;
  const [singleKeys, setSingleKeys] = useState(() => readStoredValue(shortcutKey) !== "false");
  useEffect(() => setSingleKeys(readStoredValue(shortcutKey) !== "false"), [shortcutKey]);
  const moreRef = useRef<HTMLButtonElement>(null);
  const listenersRef = useRef<HTMLButtonElement>(null);
  const peopleReturnRef = useRef<HTMLElement>(null);
  const copiedTimer = useRef<number | null>(null);
  useEffect(() => () => { if (copiedTimer.current !== null) clearTimeout(copiedTimer.current); }, []);
  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(new URL(`/room/${roomSlug}`, location.origin).href);
      setCopied(true);
      onNotice("Invite link copied");
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      onNotice("Could not copy the link. Copy the room address from your browser.");
    }
  };
  const commands: RoomCommand[] = [
    ...(onFocusSearch ? [{ id: "search", label: "Search music", key: "S", run: onFocusSearch }] : []),
    ...(onOpenQueue ? [{ id: "queue", label: "Open my queue", key: "Q", run: onOpenQueue }] : []),
    ...(onOpenPlayer ? [{ id: "player", label: "Open player", key: "P", run: onOpenPlayer }] : []),
    ...(onFocusChat ? [{ id: "chat", label: "Focus room chat", key: "/", run: onFocusChat }] : []),
    ...(onToggleMute ? [{ id: "mute", label: muted ? "Unmute my audio" : "Mute my audio", key: "M", run: onToggleMute }] : []),
    { id: "settings", label: "Open settings", key: "G", run: onSettings },
    { id: "invite", label: "Copy room invite", key: "I", run: () => void copyInvite() },
    { id: "rooms", label: "Open room directory", run: onHome },
    { id: "profile", label: "Open my profile", run: onProfile },
    ...(onFriends ? [{ id: "friends", label: "Friends", run: onFriends }] : []),
    ...(onThemeNight ? [{ id: "theme", label: "Theme night", run: onThemeNight }] : []),
  ];
  useKeyboardShortcuts([
    ...commands.filter(command => command.key).map(command => ({ id: `room-${command.id}`, label: command.label, key: command.key!, enabled: singleKeys, run: command.run })),
    { id: "room-commands-ctrl", label: "Room commands", key: "k", modifiers: { ctrl: true, shift: false }, run: () => setCommandsOpen(true) },
    { id: "room-commands-meta", label: "Room commands", key: "k", modifiers: { meta: true, shift: false }, run: () => setCommandsOpen(true) },
  ]);

  return <>
    <header className="topbar">
      <a className="room-skip-link" href="#room-workspace">Skip to room content</a>
      <div className="app-brand-stack">
        <Button variant="ghost" className="header-home-logo h-10 px-2" onClick={onHome} title="Back to rooms" aria-label="Back to rooms"><Brand /></Button>
        <AppVersion />
      </div>
      <div className="room-heading"><div>
        <h1 title={roomName} tabIndex={-1}>{roomName}</h1>
        {participants && onOpenProfile ? <Button ref={listenersRef} variant="ghost" size="sm" className="room-listener-count" data-navigation-focus="room-listeners" aria-label={`Room listeners, ${listenerCount} ${listenerCount === 1 ? "listener" : "listeners"}`} onClick={() => { peopleReturnRef.current = listenersRef.current; setPeopleOpen(true); }}><span className="live-dot" aria-hidden="true" /> {listenerCount} {listenerCount === 1 ? "listener" : "listeners"}</Button> : <small><span className="live-dot" aria-hidden="true" /> {listenerCount} {listenerCount === 1 ? "listener" : "listeners"}</small>}
      </div></div>
      <div className="header-actions">
        <Button variant="ghost" size="sm" className="header-directory-button" onClick={onHome} title="Room directory" aria-label="Room directory"><House /><span>Rooms</span></Button>
        <div className="header-tool-group">
          {onAdmin && <Button variant="ghost" size="icon" onClick={onAdmin} title="Admin dashboard" aria-label="Admin dashboard"><LayoutDashboard /></Button>}
          <Suspense fallback={null}><FeedbackButton userId={currentUser.id} roomSlug={roomSlug} diagnosticContext={diagnosticContext} /></Suspense>
          <Button variant="ghost" size="icon" onClick={onSettings} title="Settings" aria-label="Settings"><Settings /></Button>
          {onRoomSettings && <Button variant="ghost" size="icon" onClick={onRoomSettings} title="Room settings" aria-label="Room settings"><Shield /></Button>}
        </div>
        <ThemeToggle compact />
        {onFriends && <Button variant="ghost" size="sm" className="header-friends-button" onClick={onFriends}><Users /><span>Friends</span></Button>}
        <Button variant="outline" size="sm" className="invite-button" aria-label={copied ? "Invite link copied" : "Copy room invite link"} onClick={() => void copyInvite()}><Copy size={17} /><span>{copied ? "Copied" : "Invite"}</span></Button>
        <Button variant="ghost" size="icon" className="header-profile-button" data-navigation-focus="room-profile" onClick={onProfile} title="Open your profile" aria-label="Open your profile"><Avatar user={currentUser} size={30} /></Button>
        {onSignOut && <Button variant="ghost" size="icon" className="sign-out" aria-label="Sign out" title="Sign out" onClick={onSignOut}><LogOut /></Button>}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button ref={moreRef} variant="ghost" size="icon" className="room-more-actions" data-navigation-focus="room-actions" aria-label="More room actions" />}><MoreHorizontal /></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="room-actions-menu">
            <div className="room-menu-name">{roomName}</div>
            <DropdownMenuItem onClick={onSettings}><Settings /> Settings</DropdownMenuItem>
            {onRoomSettings && <DropdownMenuItem onClick={onRoomSettings}><Shield /> Room settings</DropdownMenuItem>}
            <DropdownMenuItem onClick={() => setFeedbackOpen(true)}><Lightbulb /> Send feedback</DropdownMenuItem>
            <DropdownMenuItem onClick={onProfile} data-navigation-focus="room-actions"><UserRound /> Your profile</DropdownMenuItem>
            {onFriends && <DropdownMenuItem onClick={onFriends}><Users /> Friends</DropdownMenuItem>}
            {onThemeNight && <DropdownMenuItem onClick={onThemeNight}>Theme night</DropdownMenuItem>}
            {onAdmin && <DropdownMenuItem onClick={onAdmin}><LayoutDashboard /> Admin dashboard</DropdownMenuItem>}
            {participants && onOpenProfile && <DropdownMenuItem onClick={() => { peopleReturnRef.current = moreRef.current; setPeopleOpen(true); }}><Users /> Room listeners</DropdownMenuItem>}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setCommandsOpen(true)}><Keyboard /> Room commands <kbd>Ctrl / ⌘ K</kbd></DropdownMenuItem>
            <DropdownMenuItem onClick={() => setHelpOpen(true)}><Keyboard /> Keyboard help</DropdownMenuItem>
            {onLayoutPresetChange && <DropdownMenuRadioGroup value={layoutPreset} onValueChange={(value) => { if (value === "balanced" || value === "player" || value === "chat") onLayoutPresetChange(value); }} aria-label="Room layout preset">
              <DropdownMenuRadioItem value="balanced" closeOnClick>Balanced layout</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="player" closeOnClick>Player focus layout</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="chat" closeOnClick>Chat focus layout</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>}
            <DropdownMenuItem onClick={onResetLayout}><RotateCcw /> Reset room layout</DropdownMenuItem>
            {onSignOut && <DropdownMenuItem onClick={onSignOut}><LogOut /> Sign out</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
    {!connected && <div className="room-connection-banner" role="status"><span>Connection lost · reconnecting…</span>{onReconnect && <Button size="sm" variant="outline" onClick={onReconnect}>Retry connection</Button>}</div>}
    {feedbackOpen && <Suspense fallback={null}><FeedbackButton userId={currentUser.id} roomSlug={roomSlug} diagnosticContext={diagnosticContext} open={feedbackOpen} onOpenChange={setFeedbackOpen} hideTrigger finalFocus={moreRef} /></Suspense>}
    {participants && onOpenProfile && <RoomPeopleDialog open={peopleOpen} onOpenChange={setPeopleOpen} users={participants} currentUserId={currentUser.id} ownerUserId={ownerUserId} moderatorUserIds={moderatorUserIds} djUserId={djUserId} onOpenProfile={onOpenProfile} finalFocus={peopleReturnRef} anchor={listenersRef} />}
    <RoomCommandMenu open={commandsOpen} onOpenChange={setCommandsOpen} commands={commands} finalFocus={moreRef} />
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}><DialogContent className="room-keyboard-help" finalFocus={moreRef}>
      <DialogHeader><DialogTitle>Keyboard help</DialogTitle><DialogDescription>The chat shortcut is ignored while typing in a field.</DialogDescription></DialogHeader>
      <label className="room-shortcut-preference"><span>Single-character shortcuts</span><Switch checked={singleKeys} onCheckedChange={(enabled) => { setSingleKeys(enabled); storeValue(shortcutKey, String(enabled)); }} aria-label="Single-character shortcuts" /></label>
      <dl>
        {commands.filter(command => command.key && command.id !== "chat").map(command => <div key={command.id}><dt><kbd>{command.key}</kbd></dt><dd>{command.label}{!singleKeys && " (disabled)"}</dd></div>)}
        <div><dt><kbd>/</kbd></dt><dd>Open chat and focus the message field{!singleKeys && " (disabled)"}</dd></div>
        <div><dt><kbd>Ctrl / ⌘</kbd> <kbd>K</kbd></dt><dd>Open room commands</dd></div>
        <div><dt><kbd>Enter</kbd></dt><dd>Send a chat message</dd></div>
        <div><dt><kbd>Shift</kbd> + <kbd>Enter</kbd></dt><dd>Add a new line</dd></div>
        <div><dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>Move between phone room tabs and horizontal settings categories</dd></div>
        <div><dt><kbd>↑</kbd> <kbd>↓</kbd></dt><dd>Move between desktop settings categories</dd></div>
        <div><dt><kbd>Home</kbd> <kbd>End</kbd></dt><dd>Go to the first or last room/settings tab</dd></div>
        <div><dt><kbd>Esc</kbd></dt><dd>Close a menu or dialog</dd></div>
      </dl>
    </DialogContent></Dialog>
  </>;
}
