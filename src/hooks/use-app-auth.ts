import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { useEffect, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "../supabase";
import { recoveryAfterAuthEvent } from "../auth-state";

export interface AppAuth {
  loading: boolean;
  client: SupabaseClient | null;
  session: Session | null;
  enabled: boolean;
  recovery: boolean;
  error: string;
}

export function useAppAuth() {
  useTranslation();
  const [attempt, setAttempt] = useState(0);
  const [auth, setAuth] = useState<AppAuth>({
    loading: true, client: null, session: null, enabled: false, recovery: false, error: ""
  });

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    // Capture the recovery marker before Supabase consumes the callback URL.
    const authType = new URLSearchParams(location.hash.slice(1)).get("type");
    const recovery = authType === "recovery" || authType === "invite" || location.pathname === "/update-password";
    let recoveryPending = recovery;
    setAuth((current) => ({ ...current, loading: true, error: "" }));

    void getSupabaseClient().then(async (client) => {
      if (!active) return;
      if (!client) {
        setAuth({ loading: false, client: null, session: null, enabled: false, recovery: false, error: "" });
        return;
      }

      let receivedAuthEvent = false;
      // Subscribe before reading the session so initialization/recovery events are retained.
      const { data: listener } = client.auth.onAuthStateChange((event, session) => {
        receivedAuthEvent = true;
        if (!active) return;
        const initializingRecovery = recoveryPending;
        recoveryPending = false;
        setAuth((current) => ({
          loading: false, client, session, enabled: true, error: "",
          recovery: recoveryAfterAuthEvent(event, current.recovery, initializingRecovery)
        }));
      });
      unsubscribe = () => listener.subscription.unsubscribe();

      const { data, error } = await client.auth.getSession();
      if (!active) return;
      if (error) throw error;
      if (!receivedAuthEvent) {
        setAuth({ loading: false, client, session: data.session, enabled: true, recovery, error: "" });
      }
    }).catch((error: unknown) => {
      if (!active) return;
      unsubscribe?.();
      setAuth((current) => ({
        ...current, loading: false,
        error: error instanceof Error ? error.message : i18n.t("common:use_app_auth_could_not_restore_your_session_try_again")
      }));
    });

    return () => { active = false; unsubscribe?.(); };
  }, [attempt]);

  return { auth, setAuth, retryAuth: () => setAttempt((current) => current + 1) };
}
