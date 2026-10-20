import type express from "express";
import { serverT } from "../lib/i18n.js";
import type { ResourcePolicyStore } from "../resources/resource-policy.js";
import type { GiphyApi } from "../integrations/giphy.js";
import type { AppleMusicApi } from "../integrations/apple-music.js";
import type { SpotifyAccounts } from "../integrations/spotify/spotify-accounts.js";

export interface ConfigRouteOptions {
  authEnabled: boolean;
  supabaseUrl?: string;
  supabasePublishableKey?: string;
  giphyApi: Pick<GiphyApi, "configured">;
  appleMusicApi: Pick<AppleMusicApi, "configured">;
  spotifyAccounts: Pick<SpotifyAccounts, "configured">;
  getApiUserId: (request: express.Request) => Promise<string | null>;
  canUseSpotify: (request: express.Request, userId: string) => Promise<boolean>;
}

export function mountConfigRoutes(app: express.Express, options: ConfigRouteOptions) {
  const { authEnabled, supabaseUrl, supabasePublishableKey, getApiUserId, canUseSpotify } = options;
  app.get("/api/config", async(request, response) => {
    let spotifyConfigured=false;
    try {const actor=await getApiUserId(request);spotifyConfigured=Boolean(actor&&options.spotifyAccounts.configured&&await canUseSpotify(request,actor));}catch{/* Public configuration does not expose disabled capabilities. */}
    response.json({
      giphyConfigured: options.giphyApi.configured,
      music: {
        spotifyConfigured,
        appleMusicConfigured: options.appleMusicApi.configured
      },
      supabase: authEnabled
        ? { url: supabaseUrl, anonKey: supabasePublishableKey }
        : null
    });
  });
}

export function mountResourcePolicyRoute(app: express.Express, { getApiUserId, resourcePolicies }: {
  getApiUserId: (request: express.Request) => Promise<string | null>;
  resourcePolicies: Pick<ResourcePolicyStore, "get">;
}) {
  app.get("/api/resource-policy",async(request,response)=>{
    try {
      const actor=await getApiUserId(request);
      if(!actor)return response.status(401).json({error:serverT("authentication_required")});
      response.json(await resourcePolicies.get(actor));
    }catch{response.status(503).json({error:serverT("resource_limits_are_unavailable_try_again_shortly")});}
  });
}
