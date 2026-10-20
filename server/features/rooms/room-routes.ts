import crypto from "node:crypto";
import express from "express";
import { z } from "zod";
import { serverT } from "../../lib/i18n.js";
import { PublicRequestError } from "../../lib/public-request-error.js";
import { SecurityLimitError, type SecurityBudget } from "../../security/security-budget.js";
import { trustedClientIp } from "../../security/security-http.js";
import type { PlatformSecurity } from "../../security/platform-security.js";
import type { Store } from "../../persistence/store.js";
import { RoomCommandError } from "../../realtime/socket-handler.js";
import type { ResourcePolicyStore } from "../../resources/resource-policy.js";
import type { Room, User } from "../../types.js";
import { createRoom } from "./create-room.js";
import { hashRoomPassword } from "./room-password.js";
import { roomSettingsPatchSchema } from "./room-settings.js";
import { uniqueUsers } from "./presence.js";
import { withPublicRoomPreview } from "./directory-preview.js";

export interface RoomRouteOptions {
  store: Pick<Store, "listRooms" | "getRoom" | "createRoom" | "setFavorite" | "getRoomAccess" | "updateRoomSettings">;
  platform: Pick<PlatformSecurity, "checkAccess">;
  securityBudget: SecurityBudget;
  resourcePolicies: Pick<ResourcePolicyStore, "get">;
  getApiUserId: (request: express.Request) => Promise<string | null>;
  roomUsers: ReadonlyMap<string, ReadonlyMap<string, User>>;
  watchIdleRoom: (roomId: string) => void;
  cancelDjEviction: (roomId: string, userId: string) => void;
  forgetDjUser: (roomId: string, userId: string) => void;
  broadcast: (room: Room) => void;
}

const roomCreateSchema = z.object({
  name: z.string().trim().min(1).max(48),
  isPublic: z.boolean().default(true),
  accessMode:z.enum(["public","unlisted","members"]).optional(),
  password: z.string().max(128).optional()
});

const roomSettingsSchema = roomSettingsPatchSchema;

const favoriteSchema = z.object({ favorite: z.boolean() });

function roomSlug(name: string) {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 38) || "room";
  return `${base}-${crypto.randomBytes(3).toString("hex")}`;
}

export function mountRoomRoutes(app: express.Express, options: RoomRouteOptions) {
  const { store, platform, securityBudget, resourcePolicies, getApiUserId, roomUsers, watchIdleRoom, cancelDjEviction, forgetDjUser, broadcast } = options;
  app.get("/api/rooms", async (request, response) => {
    const userId = await getApiUserId(request);
    if (!userId) return response.status(401).json({ error: serverT("authentication_required") });
    try {
      const listenerCounts = Object.fromEntries(
        [...roomUsers.entries()].map(([slug, users]) => [slug, uniqueUsers(users.values()).length])
      );
      const rooms = await store.listRooms(userId, listenerCounts);
      const q=typeof request.query.q==="string"?request.query.q.trim().toLowerCase().slice(0,100):"",tag=typeof request.query.tag==="string"?request.query.tag.trim().toLowerCase():"",language=typeof request.query.language==="string"?request.query.language.trim().toLowerCase():"";
      response.json({ rooms: rooms.filter(room=>(!q||`${room.name} ${room.description??""} ${(room.tags??[]).join(" ")}`.toLowerCase().includes(q))&&(!tag||room.tags?.some(t=>t.toLowerCase()===tag))&&(!language||room.language?.toLowerCase()===language)).map(room => withPublicRoomPreview(room, store.getRoom(room.slug))) });
    } catch (error) {
      response.status(500).json({ error: serverT("could_not_load_rooms") });
    }
  });

  app.post("/api/rooms", express.json(), async (request, response) => {
    const userId = await getApiUserId(request);
    if (!userId) return response.status(401).json({ error: serverT("authentication_required") });
    const parsed = roomCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({ error: parsed.error.issues[0]?.message || serverT("invalid_room") });
    }
    try {
      const {limits}=await resourcePolicies.get(userId);
      if(!securityBudget.consume([{key:`room-create:${userId}`,maximum:limits.roomCreatesPerHour,windowMs:3600_000},{key:`room-create-peer:${trustedClientIp(request)}`,maximum:Math.max(20,limits.roomCreatesPerHour*2),windowMs:3600_000}]))return response.set("Retry-After","3600").status(429).json({error:serverT("too_many_room_creation_attempts_try_again_later")});
      const room = createRoom(roomSlug(parsed.data.name), userId, parsed.data.name);
      room.settings.accessMode=parsed.data.accessMode??(parsed.data.isPublic?"public":"members");
      room.isPublic = room.settings.accessMode!=="members";
      room.passwordProtected = Boolean(parsed.data.password?.trim());
      await store.createRoom(room, await securityBudget.run("room-crypto",4,()=>hashRoomPassword(parsed.data.password)));
      watchIdleRoom(room.id);
      // A full favorites list must not turn a completed creation into a failed
      // request that the user might retry and duplicate.
      try { await store.setFavorite(room.id, userId, true); } catch { /* Room is created. */ }
      response.status(201).json({ room: { slug: room.id, name: room.name } });
    } catch (error) {
      response.status(error instanceof PublicRequestError?error.status:error instanceof SecurityLimitError?429:error instanceof RoomCommandError?400:503).json({ error: error instanceof RoomCommandError ? error.message : serverT("could_not_create_room_your_room_limit_may_have_been_reached") });
    }
  });

  app.put("/api/rooms/:slug/favorite", express.json(), async (request, response) => {
    const userId = await getApiUserId(request);
    if (!userId) return response.status(401).json({ error: serverT("authentication_required") });
    const slug = z.string().regex(/^[a-z0-9-]{3,48}$/).safeParse(request.params.slug);
    const parsed = favoriteSchema.safeParse(request.body);
    if (!slug.success || !parsed.success) return response.status(400).json({ error: serverT("invalid_favorite") });
    try {
      const access = await store.getRoomAccess(slug.data, userId);
      if (!access.exists || access.banned || (!access.isPublic && !access.role)) {
        return response.status(404).json({ error: serverT("room_not_found") });
      }
      await store.setFavorite(slug.data, userId, parsed.data.favorite);
      response.json({ favorite: parsed.data.favorite });
    } catch (error) {
      response.status(error instanceof PublicRequestError?error.status:400).json({ error: error instanceof RoomCommandError?error.message:serverT("could_not_update_favorite") });
    }
  });

  app.patch("/api/rooms/:slug", express.json(), async (request, response) => {
    const userId = await getApiUserId(request);
    if (!userId) return response.status(401).json({ error: serverT("authentication_required") });
    const slug = z.string().regex(/^[a-z0-9-]{3,48}$/).safeParse(request.params.slug);
    const parsed = roomSettingsSchema.safeParse(request.body);
    if (!slug.success || !parsed.success) {
      return response.status(400).json({ error: parsed.success ? serverT("invalid_room") : parsed.error.issues[0]?.message });
    }
    try {
      const previousDjs = [...(store.getRoom(slug.data)?.djQueueUserIds || [])];
      const access=await store.getRoomAccess(slug.data,userId);
      if(access.banned||(access.role!=="owner"&&access.role!=="moderator"))throw new RoomCommandError(serverT("only_the_owner_or_a_moderator_can_change_room_settings"));
      const {password,...settings}=parsed.data;
      const room = await store.updateRoomSettings(slug.data, userId, {
        ...settings,
        passwordHash: parsed.data.password === undefined ? undefined : await securityBudget.run("room-crypto",4,()=>hashRoomPassword(parsed.data.password)),
      },async()=>{
        const access = await platform.checkAccess([userId], [slug.data]);
        if(!access.accounts.get(userId)||!access.rooms.get(slug.data))throw new RoomCommandError(serverT("room_access_is_unavailable"));
      });
      if (room) {
        for (const id of previousDjs.filter(id => !room.djQueueUserIds.includes(id))) {
          cancelDjEviction(room.id, id); forgetDjUser(room.id, id);
        }
        broadcast(room);
      }
      response.json({ room: room ? { id: room.id, name: room.name } : null });
    } catch (error) {
      response.status(error instanceof SecurityLimitError?429:error instanceof RoomCommandError?403:503).json({ error: error instanceof RoomCommandError ? error.message : serverT("could_not_update_room") });
    } finally {
      watchIdleRoom(slug.data);
    }
  });
}
