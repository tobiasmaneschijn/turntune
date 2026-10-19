import { useTranslation } from "react-i18next";
import { lazy, Suspense, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { ChevronDown, History, LayoutDashboard, LogOut, MessageSquare, Palette, Settings, UserRound } from "lucide-react";
import type { User } from "../types";
import type { SoundSpinUserSettings } from "../playback-settings";
import type { FeedbackDiagnosticContext } from "../feedback-diagnostics";
import { Brand } from "./app-primitives";
import { Avatar } from "./Avatar";
import { AppVersion } from "./AppVersion";
import { DeferredDialog } from "./DeferredDialog";
import { ThemeMenuItems, ThemeToggle } from "./ThemeToggle";
import { Button, buttonVariants } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "./ui/dropdown-menu";
import "../styles/shared-header.css";

const FeedbackButton = lazy(() => import("./FeedbackDialog").then(module => ({ default: module.FeedbackButton })));
const loadDirectorySettings = () => import("./DirectorySettingsDialog").then(module => ({ default: module.DirectorySettingsDialog }));

interface AppHeaderProps {
  currentUser?: User;
  page?: "rooms" | "room" | "profile" | "admin";
  onHome?: () => void;
  homeHref?: string;
  onProfile?: () => void;
  onAdmin?: () => void;
  onSignOut?: () => void;
  onSettings?: () => void;
  settings?: { accessToken: string; userSettings: SoundSpinUserSettings; onSettingsChange: (settings: SoundSpinUserSettings) => void };
  beforeNavigate?: (action: () => void) => void;
  navigationDisabled?: boolean;
  roomSlug?: string;
  diagnosticContext?: FeedbackDiagnosticContext;
  skipTo?: string;
  navigation?: ReactNode;
  publicActions?: ReactNode;
}

/** Global navigation stays in the same place; page and room actions live below it. */
export function AppHeader({ currentUser, page, onHome, homeHref = "/", onProfile, onAdmin, onSignOut,
  onSettings, settings, beforeNavigate, navigationDisabled = false, roomSlug, diagnosticContext,
  skipTo = "#main-content", navigation, publicActions }: AppHeaderProps) {
  const { t } = useTranslation("public");
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackMounted, setFeedbackMounted] = useState(false);
  const accountRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setMenuOpen(false); setSettingsOpen(false); setChangelogOpen(false); setFeedbackOpen(false); setFeedbackMounted(false);
  }, [currentUser?.id, roomSlug]);

  const navigate = (action: (() => void) | undefined) => {
    if (navigationDisabled || !action) return;
    if (beforeNavigate) beforeNavigate(action);
    else action();
  };
  const home = (event: MouseEvent<HTMLAnchorElement>) => {
    if (navigationDisabled) { event.preventDefault(); return; }
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (onHome) { event.preventDefault(); navigate(onHome); }
  };
  const closeSettings = () => {
    setSettingsOpen(false);
    requestAnimationFrame(() => accountRef.current?.focus());
  };

  return <>
    <header className="shared-app-header">
      <a className="shared-skip-link" href={skipTo}>{t("skipToContent")}</a>
      <nav className="shared-header-navigation" aria-label={t("mainNavigation")}>
        <a className="shared-header-brand" href={homeHref} onClick={home} aria-label={t("brandHome")} aria-disabled={navigationDisabled || undefined}><Brand /></a>
        {currentUser ? <a className="shared-header-rooms" href={homeHref} onClick={home} aria-current={page === "rooms" ? "page" : undefined} aria-disabled={navigationDisabled || undefined}>{t("rooms")}</a>
          : navigation && <div className="shared-header-links">{navigation}</div>}
      </nav>
      <div className="shared-header-actions">
        {currentUser ? <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger render={<Button ref={accountRef} variant="ghost" className="shared-account-trigger" aria-label={t("accountMenu")} data-navigation-focus={roomSlug ? "room-profile" : "lobby-profile"} />}>
            <Avatar user={currentUser} size={30} /><ChevronDown className="shared-account-chevron" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="shared-account-menu">
            <DropdownMenuGroup><DropdownMenuLabel className="shared-account-name">{currentUser.name}</DropdownMenuLabel></DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={navigationDisabled || !onProfile} onClick={() => { accountRef.current?.focus(); navigate(onProfile); }}><UserRound /> {t("yourProfile")}</DropdownMenuItem>
            <DropdownMenuItem disabled={!onSettings && !settings} onClick={() => { if (onSettings) onSettings(); else setSettingsOpen(true); }}><Settings /> {t("settings")}</DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger><Palette /> {t("appearance")}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="shared-appearance-menu"><ThemeMenuItems /></DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setChangelogOpen(true)}><History /> {t("changelog")}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => { setFeedbackMounted(true); setFeedbackOpen(true); }}><MessageSquare /> {t("sendFeedback")}</DropdownMenuItem>
            {onAdmin && <DropdownMenuItem disabled={navigationDisabled} onClick={() => navigate(onAdmin)}><LayoutDashboard /> {t("adminDashboard")}</DropdownMenuItem>}
            {onSignOut && <><DropdownMenuSeparator /><DropdownMenuItem disabled={navigationDisabled} onClick={() => navigate(onSignOut)}><LogOut /> {t("signOut")}</DropdownMenuItem></>}
          </DropdownMenuContent>
        </DropdownMenu> : publicActions !== undefined ? publicActions : <><ThemeToggle compact /><a href="/login" className={buttonVariants({ variant: "outline", size: "sm" })}>{t("signIn")}</a></>}
      </div>
    </header>
    <AppVersion open={changelogOpen} onOpenChange={setChangelogOpen} hideTrigger finalFocus={accountRef} />
    {currentUser && settingsOpen && settings && <DeferredDialog key={currentUser.id} title={t("settings")} load={loadDirectorySettings} componentProps={{ accessToken: settings.accessToken, settings: settings.userSettings, onSettingsChange: settings.onSettingsChange, onClose: closeSettings }} />}
    {currentUser && feedbackMounted && <Suspense fallback={null}><FeedbackButton key={currentUser.id} userId={currentUser.id} roomSlug={roomSlug} diagnosticContext={diagnosticContext} open={feedbackOpen} onOpenChange={setFeedbackOpen} hideTrigger finalFocus={accountRef} /></Suspense>}
  </>;
}
