import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useAppAuth } from "../features/auth/hooks/use-app-auth";
import { clearUserChatDrafts } from "../features/chat/drafts";
import { setProviderAccount } from "../features/playback/provider-session";
import { readUserSettings, saveUserSettings, type SoundSpinUserSettings } from "../features/settings/user-settings";
import { takeAuthDestination } from "../features/auth/auth-destination";
import { PublicEntry, PasswordRecoveryScreen } from "../features/auth/components/PublicEntry";
import { LoadingScreen } from "../components/LoadingScreen";
import { AppHeader } from "./components/AppHeader";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";

const RoomApplication = lazy(() => import("./RoomApplication").then(module => ({ default: module.RoomApplication })));

export function App() {
  useTranslation();
  const { auth, setAuth, retryAuth } = useAppAuth();
  const [userSettings, setUserSettings] = useState<SoundSpinUserSettings>(readUserSettings);
  const draftOwnerRef = useRef(auth.session?.user.id);
  const focusOnEntry = useRef(false);
  useEffect(() => {
    const nextOwner = auth.session?.user.id;
    setProviderAccount(nextOwner || null);
    if (draftOwnerRef.current && draftOwnerRef.current !== nextOwner) clearUserChatDrafts(draftOwnerRef.current);
    if (draftOwnerRef.current !== nextOwner) window.dispatchEvent(new CustomEvent("soundspin:account-change", { detail: { userId: nextOwner || null } }));
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

  if (auth.error) return <><AppHeader publicActions={null} /><main className="room-access-screen" id="main-content" tabIndex={-1}><Card className="room-access-error">
    <CardHeader><CardTitle>{i18n.t("common:App_could_not_connect")}</CardTitle><CardDescription>{auth.error}</CardDescription></CardHeader>
    <CardContent><Button onClick={retryAuth}>{i18n.t("common:App_try_again")}</Button></CardContent>
  </Card></main></>;
  if (auth.loading) return <LoadingScreen label={i18n.t("common:App_restoring_your_session")} />;
  if (auth.enabled && !auth.session) {
    focusOnEntry.current = true;
    return <PublicEntry client={auth.client!} />;
  }
  if (auth.enabled && auth.session && auth.recovery) return <PasswordRecoveryScreen client={auth.client!} onComplete={() => {
    focusOnEntry.current = true;
    history.replaceState({}, "", takeAuthDestination());
    setAuth(current => ({ ...current, recovery: false }));
  }} />;

  return <Suspense fallback={<LoadingScreen label={i18n.t("common:App_loading_your_rooms")} />}>
    <RoomApplication auth={auth} userSettings={userSettings} changeUserSettings={changeUserSettings} focusOnEntry={focusOnEntry.current} />
  </Suspense>;
}
