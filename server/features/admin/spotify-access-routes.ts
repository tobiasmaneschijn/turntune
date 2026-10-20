import express from "express";
import { z } from "zod";
import { serverT } from "../../lib/i18n.js";
import { RoomCommandError } from "../../realtime/socket-handler.js";
import { securityEvent } from "../../security/security-events.js";
import type { Store } from "../../persistence/store.js";
import type { PlatformSecurity } from "../../security/platform-security.js";
import type { Room } from "../../types.js";
import type { AdminAuthorization } from "./admin-routes.js";

export interface SpotifyAccessRouteOptions {
  store: Pick<Store, "setRoomSpotifyEnabled">;
  platform: Pick<PlatformSecurity, "activeRoom">;
  getApiAdminUserId: (request: express.Request) => Promise<AdminAuthorization>;
  broadcast: (room: Room) => void;
}

export function mountSpotifyAccessRoutes(app: express.Express, { store, platform, getApiAdminUserId, broadcast }: SpotifyAccessRouteOptions) {
  app.put("/api/admin/rooms/:slug/spotify",express.json({limit:"1kb"}),async(request,response)=>{
    try {
      const admin=await getApiAdminUserId(request);
      if(!admin.ok)return response.status(admin.status).json({error:admin.error});
      const slug=z.string().regex(/^[a-z0-9-]{3,48}$/).safeParse(request.params.slug);
      const body=z.object({enabled:z.boolean()}).strict().safeParse(request.body);
      if(!slug.success||!body.success)return response.status(400).json({error:serverT("invalid_spotify_setting")});
      const room=await store.setRoomSpotifyEnabled(slug.data,admin.userId,body.data.enabled,async()=>{
        const current=await getApiAdminUserId(request);
        if(!current.ok||!await platform.activeRoom(slug.data))throw new RoomCommandError(serverT("administrator_access_required"));
      });
      broadcast(room);
      securityEvent("admin_change","success",{actorId:admin.userId,requestId:response.locals.requestId});
      response.json({enabled:room.settings.spotifyEnabled===true});
    }catch{response.status(503).json({error:serverT("could_not_change_spotify_access_try_again")});}
  });
}
