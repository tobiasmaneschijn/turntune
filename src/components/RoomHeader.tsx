import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("rooms");
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
      onNotice(t("roomHeader.roomLinkCopied"));
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      onNotice(t("roomHeader.couldNotCopyTheLinkCopyTheRoom"));
    }
  };
  const commands: RoomCommand[] = [
    ...(onFocusSearch ? [{ id: "search", label: t("roomHeader.searchMusic"), key: "S", run: onFocusSearch }] : []),
    ...(onOpenQueue ? [{ id: "queue", label: t("roomHeader.openMyQueue"), key: "Q", run: onOpenQueue }] : []),
    ...(onOpenPlayer ? [{ id: "player", label: t("roomHeader.openPlayer"), key: "P", run: onOpenPlayer }] : []),
    ...(onFocusChat ? [{ id: "chat", label: t("roomHeader.focusRoomChat"), key: "/", run: onFocusChat }] : []),
    ...(onToggleMute ? [{ id: "mute", label: muted ? t("roomHeader.unmuteMyAudio") : t("roomHeader.muteMyAudio"), key: "M", run: onToggleMute }] : []),
    { id: "settings", label: t("roomHeader.openSettings"), key: "G", run: onSettings },
    { id: "invite", label: t("roomHeader.copyRoomLink"), key: "I", run: () => void copyInvite() },
    ...(onRoomSettings ? [{ id: "room-settings", label: t("roomHeader.roomSettings"), run: onRoomSettings }] : []),
    ...(onModeration ? [{ id: "moderation", label: moderationCount ? t("roomHeader.moderationReports", { count: moderationCount }) : t("roomHeader.moderation"), run: onModeration }] : []),
    ...(onRules ? [{ id: "rules", label: t("roomHeader.roomRules"), run: onRules }] : []),
    { id: "rooms", label: t("roomHeader.openRoomDirectory"), run: onHome },
    { id: "profile", label: t("roomHeader.openMyProfile"), run: onProfile },
    ...(onFriends ? [{ id: "friends", label: t("roomHeader.friends"), run: onFriends }] : []),
    ...(onThemeNight ? [{ id: "theme", label: t("roomHeader.themeNight"), run: onThemeNight }] : []),
  ];
  useKeyboardShortcuts([
    ...commands.filter(command => command.key).map(command => ({ id: `room-${command.id}`, label: command.label, key: command.key!, enabled: singleKeys, run: command.run })),
    { id: "room-commands-ctrl", label: t("roomHeader.roomCommands"), key: "k", modifiers: { ctrl: true, shift: false }, run: () => setCommandsOpen(true) },
    { id: "room-commands-meta", label: t("roomHeader.roomCommands"), key: "k", modifiers: { meta: true, shift: false }, run: () => setCommandsOpen(true) },
  ]);

  return <>
    <AppHeader currentUser={currentUser} page="room" roomSlug={roomSlug} onHome={onHome} onProfile={onProfile} onAdmin={onAdmin}
      onSettings={onSettings} onSignOut={onSignOut} diagnosticContext={diagnosticContext} skipTo="#room-workspace" />
    <section className="room-context-toolbar" aria-label={t("roomHeader.roomControls")}>
      <div className="room-context-heading">
        <h1 title={roomName} tabIndex={-1}>{roomName}</h1>
        {participants && onOpenProfile ? <Button ref={listenersRef} variant="ghost" size="sm" className="room-listener-count" data-navigation-focus="room-listeners" aria-label={t("roomHeader.listenerCountLabel", { count: listenerCount })} onClick={() => { peopleReturnRef.current = listenersRef.current; setPeopleOpen(true); }}><Users aria-hidden="true" /> {t("roomHeader.listenerCount", { count: listenerCount })}</Button> : <small><Users size={14} aria-hidden="true" /> {t("roomHeader.listenerCount", { count: listenerCount })}</small>}
      </div>
      <div className="room-context-actions">
        <Button variant="outline" size="sm" className="invite-button" aria-label={copied ? t("roomHeader.copiedRoomLink") : t("roomHeader.copyRoomLink")} onClick={() => void copyInvite()}><Copy size={17} /><span>{copied ? t("roomHeader.copied") : t("roomHeader.roomLink")}</span></Button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button ref={moreRef} variant="ghost" size="icon" className="room-more-actions" data-navigation-focus="room-actions" aria-label={t("roomHeader.moreRoomActions")} />}><MoreHorizontal /></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="room-actions-menu">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t("roomHeader.room")}</DropdownMenuLabel>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger><PanelsTopLeft />{t("roomHeader.roomLayout")}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="room-layout-menu">
                  {onLayoutPresetChange && <DropdownMenuRadioGroup value={layoutPreset} onValueChange={(value) => { if (value === "balanced" || value === "player" || value === "chat") onLayoutPresetChange(value); }} aria-label={t("roomHeader.roomLayoutPreset")}>
                    <DropdownMenuRadioItem value="balanced" closeOnClick>{t("roomHeader.balancedLayout")}</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="player" closeOnClick>{t("roomHeader.playerFocusLayout")}</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="chat" closeOnClick>{t("roomHeader.chatFocusLayout")}</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>}
                  {onLayoutPresetChange && <DropdownMenuSeparator />}
                  <DropdownMenuItem onClick={onResetLayout}><RotateCcw />{t("roomHeader.resetRoomLayout")}</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem onClick={() => setCommandsOpen(true)}><Keyboard />{t("roomHeader.roomCommands")}{" "}<kbd>{t("roomHeader.ctrlK")}</kbd></DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t("roomHeader.people")}</DropdownMenuLabel>
              {onFriends && <DropdownMenuItem onClick={onFriends}><Users />{t("roomHeader.friends")}</DropdownMenuItem>}
              {participants && onOpenProfile && <DropdownMenuItem onClick={() => { peopleReturnRef.current = moreRef.current; setPeopleOpen(true); }}><Users />{t("roomHeader.roomListeners")}</DropdownMenuItem>}
              {onRules && <DropdownMenuItem onClick={onRules}>{t("roomHeader.roomRules")}</DropdownMenuItem>}
            </DropdownMenuGroup>
            {(onRoomSettings || onModeration || onThemeNight) && <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t("roomHeader.roomManagement")}</DropdownMenuLabel>
                {onRoomSettings && <DropdownMenuItem onClick={onRoomSettings}><Shield />{t("roomHeader.roomSettings")}</DropdownMenuItem>}
                {onModeration && <DropdownMenuItem onClick={onModeration}><Shield />{t("roomHeader.moderation")}{moderationCount > 0 && <span className="room-moderation-count" aria-label={t("roomHeader.openReports", { count: moderationCount })}>{moderationCount}</span>}</DropdownMenuItem>}
                {onThemeNight && <DropdownMenuItem onClick={onThemeNight}>{t("roomHeader.themeNight")}</DropdownMenuItem>}
              </DropdownMenuGroup>
            </>}
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => setHelpOpen(true)}><Keyboard />{t("roomHeader.keyboardHelp")}</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </section>
    {!connected && <div className="room-connection-banner" role="status"><span>{t("roomHeader.connectionLostReconnecting")}</span>{onReconnect && <Button size="sm" variant="outline" onClick={onReconnect}>{t("roomHeader.retryConnection")}</Button>}</div>}
    {participants && onOpenProfile && <RoomPeopleDialog open={peopleOpen} onOpenChange={setPeopleOpen} users={participants} currentUserId={currentUser.id} ownerUserId={ownerUserId} moderatorUserIds={moderatorUserIds} djUserId={djUserId} onOpenProfile={onOpenProfile} participantActions={participantActions} finalFocus={peopleReturnRef} anchor={listenersRef} />}
    <RoomCommandMenu open={commandsOpen} onOpenChange={setCommandsOpen} commands={commands} finalFocus={moreRef} />
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}><DialogContent className="room-keyboard-help" finalFocus={moreRef}>
      <DialogHeader><DialogTitle>{t("roomHeader.keyboardHelp")}</DialogTitle><DialogDescription>{t("roomHeader.theChatShortcutIsIgnoredWhileTypingIn")}</DialogDescription></DialogHeader>
      <label className="room-shortcut-preference"><span>{t("roomHeader.singleCharacterShortcuts")}</span><Switch checked={singleKeys} onCheckedChange={(enabled) => { setSingleKeys(enabled); storeValue(shortcutKey, String(enabled)); }} aria-label={t("roomHeader.singleCharacterShortcuts")} /></label>
      <dl>
        {commands.filter(command => command.key && command.id !== "chat").map(command => <div key={command.id}><dt><kbd>{command.key}</kbd></dt><dd>{singleKeys ? command.label : t("roomHeader.shortcutDisabled", { label: command.label })}</dd></div>)}
        <div><dt><kbd>/</kbd></dt><dd>{singleKeys ? t("roomHeader.openChatMessageField") : t("roomHeader.shortcutDisabled", { label: t("roomHeader.openChatMessageField") })}</dd></div>
        <div><dt><kbd>{t("roomHeader.ctrl")}</kbd> <kbd>{t("roomHeader.k")}</kbd></dt><dd>{t("roomHeader.openRoomCommands")}</dd></div>
        <div><dt><kbd>{t("roomHeader.enter")}</kbd></dt><dd>{t("roomHeader.sendAChatMessage")}</dd></div>
        <div><dt><kbd>{t("roomHeader.shift")}</kbd> + <kbd>{t("roomHeader.enter")}</kbd></dt><dd>{t("roomHeader.addANewLine")}</dd></div>
        <div><dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>{t("roomHeader.moveBetweenPhoneRoomTabsAndHorizontalSettings")}</dd></div>
        <div><dt><kbd>↑</kbd> <kbd>↓</kbd></dt><dd>{t("roomHeader.moveBetweenDesktopSettingsCategories")}</dd></div>
        <div><dt><kbd>{t("roomHeader.home")}</kbd> <kbd>{t("roomHeader.end")}</kbd></dt><dd>{t("roomHeader.goToTheFirstOrLastRoomSettings")}</dd></div>
        <div><dt><kbd>{t("roomHeader.esc")}</kbd></dt><dd>{t("roomHeader.closeAMenuOrDialog")}</dd></div>
      </dl>
    </DialogContent></Dialog>
  </>;
}
