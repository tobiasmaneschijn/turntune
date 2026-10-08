import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useAppAuth } from "./hooks/use-app-auth";
import { clearUserChatDrafts } from "./chat/drafts";
import { readUserSettings, saveUserSettings, type SoundSpinUserSettings } from "./playback-settings";
import { takeAuthDestination } from "./lib/auth-destination";
import { PublicEntry, PasswordRecoveryScreen } from "./components/PublicEntry";
import { LoadingScreen } from "./components/LoadingScreen";
import { Brand } from "./components/app-primitives";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";

const RoomApplication = lazy(() => import("./RoomApplication").then(module => ({ default: module.RoomApplication })));

export function App() {
  const { auth, setAuth, retryAuth } = useAppAuth();
  const [userSettings, setUserSettings] = useState<SoundSpinUserSettings>(readUserSettings);
  const draftOwnerRef = useRef(auth.session?.user.id);
  const focusOnEntry = useRef(false);
  useEffect(() => {
    const nextOwner = auth.session?.user.id;
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

  if (auth.error) return <main className="room-access-screen"><Card className="room-access-error">
    <CardHeader><Brand /><CardTitle>Could not connect</CardTitle><CardDescription>{auth.error}</CardDescription></CardHeader>
    <CardContent><Button onClick={retryAuth}>Try again</Button></CardContent>
  </Card></main>;
  if (auth.loading) return <LoadingScreen label="Restoring your session…" />;
  if (auth.enabled && !auth.session) {
    focusOnEntry.current = true;
    return <PublicEntry client={auth.client!} />;
  }
  if (auth.enabled && auth.session && auth.recovery) return <PasswordRecoveryScreen client={auth.client!} onComplete={() => {
    focusOnEntry.current = true;
    history.replaceState({}, "", takeAuthDestination());
    setAuth(current => ({ ...current, recovery: false }));
  }} />;

  return <Suspense fallback={<LoadingScreen label="Loading your rooms…" />}>
    <RoomApplication auth={auth} userSettings={userSettings} changeUserSettings={changeUserSettings} focusOnEntry={focusOnEntry.current} />
  </Suspense>;
}
