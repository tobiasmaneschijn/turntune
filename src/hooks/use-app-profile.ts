import { useEffect, useRef, useState } from "react";
import type { AppAuth } from "./use-app-auth";
import type { User } from "../types";
import { readStoredValue, storeValue } from "../lib/browser-storage";
import { requestJson } from "../lib/authenticated-http";
import { isProfileResponse, type ProfileResponse } from "../lib/profile-response";

function readProfile(): User {
  try {
    const value = JSON.parse(readStoredValue("soundspin-profile") || "null") as Partial<User> | null;
    if (value && typeof value.id === "string" && value.id && typeof value.name === "string" && typeof value.avatarSeed === "string") {
      return { avatarKey: "pulse", ...value, isAppAdmin: false } as User;
    }
  } catch { /* Invalid cached identity does not block session restoration. */ }
  return { id: crypto.randomUUID(), name: "", avatarSeed: crypto.randomUUID(), avatarKey: "pulse", isAppAdmin: false };
}

/** Profile identity survives token rotation; asynchronous responses belong to one account lifetime. */
export function useAppProfile(auth: AppAuth) {
  const [profile, setProfile] = useState(readProfile);
  const [profileReady, setProfileReady] = useState(false);
  const authRef = useRef(auth);
  authRef.current = auth;
  useEffect(() => {
    const user = auth.session?.user;
    if (!user || profile.id === user.id) return;
    const next: User = { id: user.id, name: String(user.user_metadata.display_name || user.email?.split("@")[0] || ""), avatarSeed: user.id, avatarKey: "pulse", isAppAdmin: false };
    storeValue("soundspin-profile", JSON.stringify(next));
    setProfile(next);
  }, [auth.session?.user.id, profile.id]);
  useEffect(() => {
    if (!auth.enabled) { setProfileReady(true); return; }
    const userId = auth.session?.user.id;
    if (!userId || !auth.client) { setProfileReady(false); return; }
    let active = true;
    const controller = new AbortController();
    if (profile.id !== userId) setProfileReady(false);
    void requestJson<ProfileResponse>(`/api/profiles/${userId}`, { accessToken: authRef.current.session?.access_token,
      signal: controller.signal, timeoutMs: 10_000, validate: isProfileResponse })
      .then(({ profile: loaded }) => {
        if (!active) return;
        const next: User = { id: loaded.user_id, name: loaded.display_name, avatarSeed: loaded.user_id, avatarKey: loaded.avatar_key,
          avatarUrl: loaded.avatar_url || undefined, isAppAdmin: loaded.is_app_admin };
        storeValue("soundspin-profile", JSON.stringify(next)); setProfile(next);
      }).catch(() => { /* Room admission can create a missing migrated profile. */ })
      .finally(() => { if (active) setProfileReady(true); });
    return () => { active = false; controller.abort(); };
    // Credentials refresh independently of identity and must not unmount room providers.
  }, [auth.enabled, auth.client, auth.session?.user.id]);
  return { profile, setProfile, profileReady };
}
