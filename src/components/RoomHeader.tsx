import { useEffect, useRef, useState, type ReactNode } from "react";
import { Copy, Keyboard, MoreHorizontal, PanelsTopLeft, RotateCcw, Shield, Users } from "lucide-react";
import type { User } from "../types";
import type { FeedbackDiagnosticContext } from "../feedback-diagnostics";
import { AppHeader } from "./AppHeader";
import { RoomPeopleDialog } from "./RoomPeopleDialog";
import { RoomCommandMenu, type RoomCommand } from "./RoomCommandMenu";
import { useKeyboardShortcuts } from "../hooks/use-keyboard-shortcuts";
import type { RoomLayoutPreset } from "../hooks/use-room-layout-presets";
import { readStoredValue, storeValue } from "../lib/browser-storage";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Switch } from "./ui/switch";
import "../styles/layout-completion.css";

export function RoomHeader({ roomName, roomSlug, listenerCount, currentUser, diagnosticContext,
  onHome, onSettings, onRoomSettings, onModeration, moderationCount = 0, onRules, participantActions, onAdmin, onProfile, onSignOut, onResetLayout, onNotice, connected = true, onReconnect,
  participants, ownerUserId, moderatorUserIds, djUserId, onOpenProfile, onFriends, onThemeNight, onFocusSearch, onOpenQueue, onOpenPlayer, onToggleMute, onFocusChat, muted = false, layoutPreset = "balanced", onLayoutPresetChange }: {
  roomName: string;
  roomSlug: string;
  listenerCount: number;
  currentUser: User;
  diagnosticContext?: FeedbackDiagnosticContext;
  onHome: () => void;
  onSettings: () => void;
  onRoomSettings?: () => void;
  onModeration?: () => void;
  moderationCount?: number;
  onRules?: () => void;
  participantActions?: (user: User) => ReactNode;
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
      onNotice("Room link copied");
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
    { id: "invite", label: "Copy room link", key: "I", run: () => void copyInvite() },
    ...(onRoomSettings ? [{ id: "room-settings", label: "Room settings", run: onRoomSettings }] : []),
    ...(onModeration ? [{ id: "moderation", label: moderationCount ? `Moderation (${moderationCount} open reports)` : "Moderation", run: onModeration }] : []),
    ...(onRules ? [{ id: "rules", label: "Room rules", run: onRules }] : []),
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
    <AppHeader currentUser={currentUser} page="room" roomSlug={roomSlug} onHome={onHome} onProfile={onProfile} onAdmin={onAdmin}
      onSettings={onSettings} onSignOut={onSignOut} diagnosticContext={diagnosticContext} skipTo="#room-workspace" />
    <section className="room-context-toolbar" aria-label="Room controls">
      <div className="room-context-heading">
        <h1 title={roomName} tabIndex={-1}>{roomName}</h1>
        {participants && onOpenProfile ? <Button ref={listenersRef} variant="ghost" size="sm" className="room-listener-count" data-navigation-focus="room-listeners" aria-label={`Room listeners, ${listenerCount} ${listenerCount === 1 ? "listener" : "listeners"}`} onClick={() => { peopleReturnRef.current = listenersRef.current; setPeopleOpen(true); }}><Users aria-hidden="true" /> {listenerCount} {listenerCount === 1 ? "listener" : "listeners"}</Button> : <small><Users size={14} aria-hidden="true" /> {listenerCount} {listenerCount === 1 ? "listener" : "listeners"}</small>}
      </div>
      <div className="room-context-actions">
        <Button variant="outline" size="sm" className="invite-button" aria-label={copied ? "Copied — room link" : "Copy room link"} onClick={() => void copyInvite()}><Copy size={17} /><span>{copied ? "Copied" : "Room link"}</span></Button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button ref={moreRef} variant="ghost" size="icon" className="room-more-actions" data-navigation-focus="room-actions" aria-label="More room actions" />}><MoreHorizontal /></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="room-actions-menu">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Room</DropdownMenuLabel>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger><PanelsTopLeft /> Room layout</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="room-layout-menu">
                  {onLayoutPresetChange && <DropdownMenuRadioGroup value={layoutPreset} onValueChange={(value) => { if (value === "balanced" || value === "player" || value === "chat") onLayoutPresetChange(value); }} aria-label="Room layout preset">
                    <DropdownMenuRadioItem value="balanced" closeOnClick>Balanced layout</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="player" closeOnClick>Player focus layout</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="chat" closeOnClick>Chat focus layout</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>}
                  {onLayoutPresetChange && <DropdownMenuSeparator />}
                  <DropdownMenuItem onClick={onResetLayout}><RotateCcw /> Reset room layout</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem onClick={() => setCommandsOpen(true)}><Keyboard /> Room commands <kbd>Ctrl / ⌘ K</kbd></DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>People</DropdownMenuLabel>
              {onFriends && <DropdownMenuItem onClick={onFriends}><Users /> Friends</DropdownMenuItem>}
              {participants && onOpenProfile && <DropdownMenuItem onClick={() => { peopleReturnRef.current = moreRef.current; setPeopleOpen(true); }}><Users /> Room listeners</DropdownMenuItem>}
              {onRules && <DropdownMenuItem onClick={onRules}>Room rules</DropdownMenuItem>}
            </DropdownMenuGroup>
            {(onRoomSettings || onModeration || onThemeNight) && <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Room management</DropdownMenuLabel>
                {onRoomSettings && <DropdownMenuItem onClick={onRoomSettings}><Shield /> Room settings</DropdownMenuItem>}
                {onModeration && <DropdownMenuItem onClick={onModeration}><Shield /> Moderation{moderationCount > 0 && <span className="room-moderation-count" aria-label={`${moderationCount} open reports`}>{moderationCount}</span>}</DropdownMenuItem>}
                {onThemeNight && <DropdownMenuItem onClick={onThemeNight}>Theme night</DropdownMenuItem>}
              </DropdownMenuGroup>
            </>}
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => setHelpOpen(true)}><Keyboard /> Keyboard help</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </section>
    {!connected && <div className="room-connection-banner" role="status"><span>Connection lost · reconnecting…</span>{onReconnect && <Button size="sm" variant="outline" onClick={onReconnect}>Retry connection</Button>}</div>}
    {participants && onOpenProfile && <RoomPeopleDialog open={peopleOpen} onOpenChange={setPeopleOpen} users={participants} currentUserId={currentUser.id} ownerUserId={ownerUserId} moderatorUserIds={moderatorUserIds} djUserId={djUserId} onOpenProfile={onOpenProfile} participantActions={participantActions} finalFocus={peopleReturnRef} anchor={listenersRef} />}
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
