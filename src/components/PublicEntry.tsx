import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LandingPage } from "./LandingPage";
import { AppHeader } from "./AppHeader";
import { ThemeToggle } from "./ThemeToggle";
import { AppVersion } from "./AppVersion";
import { ForgotPasswordForm } from "./forgot-password-form";
import { LoginForm } from "./login-form";
import { SignUpForm } from "./sign-up-form";
import { UpdatePasswordForm } from "./update-password-form";
import { rememberAuthDestination, takeAuthDestination } from "../lib/auth-destination";
import { useRouteFocus } from "../hooks/use-route-focus";

export function PublicEntry({ client }: { client: SupabaseClient }) {
  const [path, setPath] = useState(location.pathname);
  const previousPath = useRef(path);
  useRouteFocus(`public:${path}`);
  useEffect(() => {
    if (previousPath.current !== path) {
      previousPath.current = path;
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }
  }, [path]);

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
      <AppHeader onHome={() => onNavigate("/")} publicActions={<ThemeToggle compact />} />
      <section className="auth-content" id="main-content" tabIndex={-1}>
        <div className="auth-intro">
          <h1>{path === "/sign-up" ? "Create an account" : path === "/forgot-password" ? "Reset password" : "Sign in"}</h1>
        </div>
        {form}
      </section>
      <footer className="app-release-footer"><AppVersion /></footer>
    </main>
  );
}

export function PasswordRecoveryScreen({
  client,
  onComplete
}: {
  client: SupabaseClient;
  onComplete: () => void;
}) {
  return (
    <main className="welcome auth-welcome">
      <AppHeader publicActions={<ThemeToggle compact />} />
      <section className="auth-content" id="main-content" tabIndex={-1}>
        <div className="auth-intro">
          <h1>Account recovery</h1>
        </div>
        <UpdatePasswordForm client={client} onComplete={onComplete} className="w-full" />
      </section>
      <footer className="app-release-footer"><AppVersion /></footer>
    </main>
  );
}
