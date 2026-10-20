import express from "express";
import { z } from "zod";
import { serverT } from "../../lib/i18n.js";
import { RoomCommandError } from "../../realtime/socket-handler.js";
import type { Store } from "../../persistence/store.js";
import type { PlatformSecurity } from "../../security/platform-security.js";
import { profileUpdateSchema } from "./profile-fields.js";

export interface ProfileRouteOptions {
  store: Pick<Store, "getProfile" | "getProfileOptions" | "updateProfile">;
  platform: Pick<PlatformSecurity, "activeAccount">;
  getApiUserId: (request: express.Request) => Promise<string | null>;
}

export function mountProfileRoutes(app: express.Express, { store, platform, getApiUserId }: ProfileRouteOptions) {
  app.get("/api/profiles/:userId", async (request, response) => {
    if (!(await getApiUserId(request))) {
      return response.status(401).json({ error: serverT("authentication_required") });
    }
    const userId = z.string().uuid().safeParse(request.params.userId);
    if (!userId.success) return response.status(400).json({ error: serverT("invalid_profile") });
    try {
      if(!await platform.activeAccount(userId.data))return response.status(404).json({error:serverT("profile_not_found")});
      const [profile, options] = await Promise.all([
        store.getProfile(userId.data),
        store.getProfileOptions()
      ]);
      if (!profile) return response.status(404).json({ error: serverT("profile_not_found") });
      response.json({ profile, options });
    } catch (error) {
      response.status(500).json({
        error: serverT("could_not_load_profile")
      });
    }
  });

  app.patch("/api/profile", express.json(), async (request, response) => {
    const userId = await getApiUserId(request);
    if (!userId) return response.status(401).json({ error: serverT("authentication_required") });
    const parsed = profileUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({ error: parsed.error.issues[0]?.message || serverT("invalid_profile") });
    }
    try {
      const profile = await store.updateProfile(userId, parsed.data);
      response.json({ profile });
    } catch (error) {
      response.status(400).json({
        error: error instanceof RoomCommandError ? error.message : serverT("could_not_update_profile")
      });
    }
  });
}
