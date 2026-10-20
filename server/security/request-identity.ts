import type express from "express";
import { verifyCredentials } from "@supabase/server/core";
import { serverT } from "../lib/i18n.js";
import { validUserClaims } from "./security-identity.js";
import type { PlatformSecurity } from "./platform-security.js";
import type { Store } from "../persistence/store.js";
import type { AdminAuthorization } from "../features/admin/admin-routes.js";

export interface RequestIdentityOptions {
  authEnabled: boolean;
  supabaseUrl?: string;
  platform: Pick<PlatformSecurity, "activeAccount" | "verifiedAccount">;
  store: Pick<Store, "getProfile">;
}

/** Verification and active-account results live only as long as the request. */
export function createRequestIdentity({ authEnabled, supabaseUrl, platform, store }: RequestIdentityOptions) {
  const requestIdentities = new WeakMap<express.Request, Promise<{ userId: string; aal: unknown } | null>>();
  const activeRequests = new WeakMap<express.Request, Promise<string | null>>();

  async function getRequestIdentity(request: express.Request) {
    if (!authEnabled) return null;
    const cached = requestIdentities.get(request);
    if (cached) return cached;
    const pending = (async () => {
      const authorization = request.get("authorization");
      const token = authorization?.match(/^Bearer (.+)$/i)?.[1];
      if (!token || token.length > 16_384) return null;
      const { data, error } = await verifyCredentials(
        { token, apikey: null },
        { auth: "user" }
      );
      if (error || !data.userClaims || !validUserClaims(data.jwtClaims, supabaseUrl)) return null;
      return { userId: data.userClaims.id, aal: data.jwtClaims?.aal };
    })();
    requestIdentities.set(request, pending);
    return pending;
  }

  async function getApiUserId(request: express.Request) {
    const cached = activeRequests.get(request);
    if (cached) return cached;
    const pending = (async () => {
      const identity = await getRequestIdentity(request);
      return identity && await platform.activeAccount(identity.userId) ? identity.userId : null;
    })();
    activeRequests.set(request, pending);
    return pending;
  }

  async function getSelfServiceUserId(request: express.Request) {
    const identity = await getRequestIdentity(request);
    return identity && await platform.verifiedAccount(identity.userId) ? identity.userId : null;
  }

  async function getApiAdminUserId(request: express.Request): Promise<AdminAuthorization> {
    const userId = await getApiUserId(request);
    if (!userId) return { ok: false, error: serverT("authentication_required"), status: 401 };
    const profile = await store.getProfile(userId);
    if (!profile?.is_app_admin) return { ok: false, error: serverT("administrator_access_required"), status: 403 };
    if ((await getRequestIdentity(request))?.aal !== "aal2") return { ok: false, error: serverT("verify_a_second_factor_before_using_administrator_tools"), status: 403 };
    return { ok: true, userId };
  }
  return { getApiUserId, getSelfServiceUserId, getApiAdminUserId };
}
