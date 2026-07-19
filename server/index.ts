import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServer } from "node:http";
import { verifyCredentials } from "@supabase/server/core";
import { Server } from "socket.io";
import { z } from "zod";
import { Store } from "./store.js";
import { TRACK_LIKED_XP } from "./progression.js";
import { uniqueUsers } from "./presence.js";
import { SoundCloudApi, type SoundCloudSearchResult } from "./soundcloud.js";
import {
  advanceRadio,
  canJoinDjQueue,
  GracePeriodRegistry,
  normalizeRadioState,
  privateQueue,
  removeDj,
  roomForListener
} from "./radio.js";
import type { Room, RoomSnapshot, Track, User } from "./types.js";

const port = Number(process.env.PORT || 3000);
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: true } });
const store = new Store();
const supabaseUrl = process.env.SUPABASE_URL;
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const supabaseJwksUrl = process.env.SUPABASE_JWKS_URL;
const youtubeApiKey = process.env.YOUTUBE_API_KEY;
const soundCloudApi = new SoundCloudApi(
  process.env.SOUNDCLOUD_CLIENT_ID,
  process.env.SOUNDCLOUD_CLIENT_SECRET
);
const authEnabled = Boolean(
  supabaseUrl &&
  supabasePublishableKey &&
  supabaseSecretKey &&
  supabaseJwksUrl &&
  store.usesSupabase
);

// Live coordination is process-local. `roomUsers` is socket presence, while
// `roomDjUsers` also keeps a disconnected DJ's display data during the grace
// period. Durable room/radio state lives in Store/Supabase.
const roomUsers = new Map<string, Map<string, User>>();
const roomDjUsers = new Map<string, Map<string, User>>();
const socketRooms = new Map<string, string>();
const DJ_DISCONNECT_GRACE_MS = 60_000;
const djEvictions = new GracePeriodRegistry(DJ_DISCONNECT_GRACE_MS);
const youtubeSearchCache = new Map<string, {
  expiresAt: number;
  results: YouTubeSearchResult[];
}>();
const youtubeSearchLimits = new Map<string, { count: number; resetAt: number }>();
const soundCloudSearchCache = new Map<string, {
  expiresAt: number;
  results: SoundCloudSearchResult[];
}>();
const soundCloudSearchLimits = new Map<string, { count: number; resetAt: number }>();

interface YouTubeSearchResult {
  id: string;
  title: string;
  channel: string;
  thumbnail: string;
  duration?: string;
}

const userSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(32),
  avatarSeed: z.string().min(1).max(100)
});

const joinSchema = z.object({
  roomId: z.string().regex(/^[a-z0-9-]{3,48}$/),
  roomName: z.string().trim().min(1).max(48).optional(),
  password: z.string().max(128).optional(),
  user: userSchema
});

const trackSchema = z.object({
  provider: z.enum(["youtube", "spotify", "apple", "soundcloud"]),
  providerId: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(120),
  artist: z.string().trim().min(1).max(120).optional(),
  artworkUrl: z.string().url().max(2048).optional(),
  permalinkUrl: z.string().url().max(2048).optional(),
  durationMs: z.number().int().positive().max(60 * 60 * 24 * 1000).optional()
}).superRefine((track, context) => {
  if (track.artworkUrl && !track.artworkUrl.startsWith("https://")) {
    context.addIssue({ code: "custom", path: ["artworkUrl"], message: "Artwork must use HTTPS." });
  }
  if (track.provider !== "soundcloud") return;
  if (!/^soundcloud:tracks:\d+$/.test(track.providerId)) {
    context.addIssue({ code: "custom", path: ["providerId"], message: "Invalid SoundCloud track URN." });
  }
  if (!track.permalinkUrl) {
    context.addIssue({ code: "custom", path: ["permalinkUrl"], message: "A SoundCloud permalink is required." });
    return;
  }
  const hostname = new URL(track.permalinkUrl).hostname.toLowerCase();
  if (hostname !== "soundcloud.com" && !hostname.endsWith(".soundcloud.com")) {
    context.addIssue({ code: "custom", path: ["permalinkUrl"], message: "Invalid SoundCloud permalink." });
  }
});

const playbackSchema = z.object({
  playing: z.boolean(),
  position: z.number().min(0).max(60 * 60 * 24)
});

const queueTrackSchema = z.object({
  trackId: z.string().uuid()
});

const queueMoveSchema = queueTrackSchema.extend({
  toIndex: z.number().int().min(0).max(999)
});

const queueNextSchema = z.object({
  trackId: z.string().uuid()
});

const vibeVoteSchema = z.object({
  value: z.union([z.literal(-1), z.literal(0), z.literal(1)])
});

const youtubeSearchSchema = z.object({
  q: z.string().trim().min(2).max(100)
});

const soundCloudSearchSchema = youtubeSearchSchema;

const soundCloudResolveSchema = z.object({
  url: z.string().trim().url().max(2048)
}).superRefine((value, context) => {
  const hostname = new URL(value.url).hostname.toLowerCase();
  if (hostname !== "soundcloud.com" && !hostname.endsWith(".soundcloud.com")) {
    context.addIssue({ code: "custom", path: ["url"], message: "Enter a valid SoundCloud track URL." });
  }
});

const profileUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(32).optional(),
  bio: z.string().trim().max(160).optional(),
  avatarKey: z.string().regex(/^[a-z0-9-]{2,40}$/).optional()
}).refine((value) => Object.keys(value).length > 0, "No profile changes supplied.");

const roomCreateSchema = z.object({
  name: z.string().trim().min(1).max(48),
  isPublic: z.boolean().default(true),
  password: z.string().max(128).optional()
});

const roomSettingsSchema = z.object({
  name: z.string().trim().min(1).max(48).optional(),
  isPublic: z.boolean().optional(),
  password: z.union([z.string().max(128), z.null()]).optional(),
  djAccess: z.enum(["everyone", "roles"]).optional()
}).refine((value) => Object.keys(value).length > 0, "No room changes supplied.");

const favoriteSchema = z.object({ favorite: z.boolean() });

const moderatorSchema = z.object({
  userId: z.string().uuid(),
  moderator: z.boolean()
});

const djRoleSchema = z.object({
  userId: z.string().uuid(),
  dj: z.boolean()
});

function roomSlug(name: string) {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 38) || "room";
  return `${base}-${crypto.randomBytes(3).toString("hex")}`;
}

function hashRoomPassword(password?: string | null) {
  if (!password?.trim()) return null;
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

function passwordMatches(password: string | undefined, encoded: string | null) {
  if (!encoded) return true;
  if (!password) return false;
  const [algorithm, saltValue, hashValue] = encoded.split("$");
  if (algorithm !== "scrypt" || !saltValue || !hashValue) return false;
  try {
    const expected = Buffer.from(hashValue, "base64");
    const actual = crypto.scryptSync(password, Buffer.from(saltValue, "base64"), expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function decodeYouTubeText(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function formatYouTubeDuration(value?: string) {
  if (!value) return undefined;
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return undefined;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

async function getApiUserId(request: express.Request) {
  if (!authEnabled) return null;
  const authorization = request.get("authorization");
  const token = authorization?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return null;
  const { data, error } = await verifyCredentials(
    { token, apikey: null },
    { auth: "user" }
  );
  return error ? null : data.userClaims?.id || null;
}

function createRoom(id: string, ownerUserId: string, name?: string): Room {
  return {
    id,
    name: name || id.replaceAll("-", " "),
    ownerUserId,
    moderatorUserIds: [],
    djRoleUserIds: [],
    isPublic: true,
    passwordProtected: false,
    settings: { djAccess: "everyone" },
    djUserId: null,
    djQueueUserIds: [],
    djQueues: {},
    history: [],
    playback: { track: null, playing: false, position: 0, updatedAt: Date.now() },
    vibe: null,
    createdAt: Date.now()
  };
}

/** Build the personalized state sent to one listener. */
function snapshot(room: Room, userId: string): RoomSnapshot {
  return {
    room: roomForListener(room, userId),
    // Presence is socket-based internally, but listeners are unique accounts.
    users: uniqueUsers(roomUsers.get(room.id)?.values() || []),
    djUsers: [...(roomDjUsers.get(room.id)?.values() || [])]
      .filter((user) => room.djQueueUserIds.includes(user.id)),
    serverTime: Date.now()
  };
}

function broadcast(room: Room) {
  // Do not replace this with io.to(room.id).emit(...). Queue privacy requires a
  // separate snapshot for every recipient.
  for (const [socketId, user] of roomUsers.get(room.id) || []) {
    io.to(socketId).emit("room:snapshot", snapshot(room, user.id));
  }
}

function canControlPlayback(room: Room, userId: string) {
  return room.djUserId === userId ||
    room.ownerUserId === userId ||
    room.moderatorUserIds.includes(userId);
}

function djEvictionKey(roomId: string, userId: string) {
  return `${roomId}:${userId}`;
}

function rememberDjUser(roomId: string, user: User) {
  if (!roomDjUsers.has(roomId)) roomDjUsers.set(roomId, new Map());
  roomDjUsers.get(roomId)!.set(user.id, user);
}

function forgetDjUser(roomId: string, userId: string) {
  const users = roomDjUsers.get(roomId);
  users?.delete(userId);
  if (users?.size === 0) roomDjUsers.delete(roomId);
}

function cancelDjEviction(roomId: string, userId: string) {
  djEvictions.cancel(djEvictionKey(roomId, userId));
}

function hasPendingDjEviction(roomId: string, userId: string) {
  return djEvictions.has(djEvictionKey(roomId, userId));
}

function scheduleDjEviction(room: Room, user: User) {
  if (!room.djQueueUserIds.includes(user.id)) return;
  const key = djEvictionKey(room.id, user.id);
  if (djEvictions.has(key)) return;
  rememberDjUser(room.id, user);

  djEvictions.schedule(key, () => {
    void (async () => {
      const currentRoom = store.getRoom(room.id);
      // Re-check presence at expiry. A reconnect cancels the usual timer, but
      // this guard also protects against races between socket events.
      const reconnected = [...(roomUsers.get(room.id)?.values() || [])]
        .some((roomUser) => roomUser.id === user.id);
      if (!currentRoom || reconnected) return;

      const wasCurrentDj = currentRoom.djUserId === user.id;
      removeDj(currentRoom, user.id);
      forgetDjUser(currentRoom.id, user.id);
      if (wasCurrentDj) advanceRadio(currentRoom);
      await store.saveRoom(currentRoom);
      broadcast(currentRoom);
    })().catch(console.error);
  });
}

function getMembership(socketId: string) {
  const roomId = socketRooms.get(socketId);
  if (!roomId) return null;
  const room = store.getRoom(roomId);
  const user = roomUsers.get(roomId)?.get(socketId);
  return room && user ? { room, user } : null;
}

async function leaveCurrentRoom(socketId: string) {
  const roomId = socketRooms.get(socketId);
  if (!roomId) return;
  socketRooms.delete(socketId);
  const users = roomUsers.get(roomId);
  const leavingUser = users?.get(socketId);
  users?.delete(socketId);
  const room = store.getRoom(roomId);
  if (!room) return;
  // Multiple tabs count as one listener. Start the one-minute DJ grace only
  // after this account's final socket leaves; explicit `dj:leave` is immediate.
  const stillConnected = leavingUser && [...(users?.values() || [])].some((user) => user.id === leavingUser.id);
  if (leavingUser && !stillConnected) {
    scheduleDjEviction(room, leavingUser);
  }
  if (users?.size === 0) roomUsers.delete(roomId);
  broadcast(room);
}

io.use(async (socket, next) => {
  if (!authEnabled) return next();
  const accessToken = z.string().min(1).safeParse(socket.handshake.auth?.accessToken);
  if (!accessToken.success) return next(new Error("Authentication required."));

  const { data, error } = await verifyCredentials(
    { token: accessToken.data, apikey: null },
    { auth: "user" }
  );
  if (error || !data.userClaims) return next(new Error("Your session has expired."));
  socket.data.authUserId = data.userClaims.id;
  next();
});

io.on("connection", (socket) => {
  socket.on("room:join", async (payload, reply) => {
    const parsed = joinSchema.safeParse(payload);
    if (!parsed.success) return reply?.({ ok: false, error: "Invalid room or profile." });

    const { roomId, roomName, password } = parsed.data;
    let user: User = {
      ...parsed.data.user,
      id: authEnabled ? socket.data.authUserId : parsed.data.user.id
    };
    const previousRoomId = socketRooms.get(socket.id);

    // Auth refreshes and profile updates can cause the browser to re-emit join
    // on an already connected socket. Do not turn that harmless refresh into a
    // disconnect grace period. Keeping the existing presence until validation
    // succeeds also prevents a transient Supabase error from evicting an active
    // DJ one minute later.
    if (previousRoomId === roomId) cancelDjEviction(roomId, user.id);

    try {
      if (authEnabled) {
        const soundspinProfile = await store.loadOrCreateProfile(user.id, user.name);
        if (soundspinProfile) {
          user = {
            ...user,
            name: soundspinProfile.display_name,
            avatarKey: soundspinProfile.avatar_key
          };
        }
      }
      const access = await store.getRoomAccess(roomId, user.id);
      if (authEnabled && !access.exists) {
        return reply?.({ ok: false, error: "That room does not exist." });
      }
      if (access.passwordHash && !passwordMatches(password, access.passwordHash)) {
        return reply?.({
          ok: false,
          error: password ? "That room password is incorrect." : "This room needs a password.",
          requiresPassword: true
        });
      }

      const room = await store.loadRoom(roomId) || createRoom(roomId, user.id, roomName);
      if (!room.ownerUserId) room.ownerUserId = user.id;
      if (!room.moderatorUserIds) room.moderatorUserIds = [];
      normalizeRadioState(room);
      if (room.isPublic === undefined) room.isPublic = true;
      if (room.passwordProtected === undefined) room.passwordProtected = Boolean(access.passwordHash);
      if (!room.history) room.history = [];
      if (room.vibe === undefined) room.vibe = null;
      if (room.vibe && room.playback.track && room.vibe.trackId === room.playback.track.id) {
        delete room.vibe.votes[room.playback.track.addedBy.id];
      }
      await store.recordRoomMember(roomId, user.id);

      // Switch rooms only after the destination has been authorized and loaded.
      // A same-room join is an idempotent presence/profile refresh.
      if (previousRoomId && previousRoomId !== roomId) {
        await leaveCurrentRoom(socket.id);
      }
      for (const joinedRoom of socket.rooms) {
        if (joinedRoom !== socket.id && joinedRoom !== roomId) await socket.leave(joinedRoom);
      }

      if (!roomUsers.has(roomId)) roomUsers.set(roomId, new Map());
      roomUsers.get(roomId)!.set(socket.id, user);
      cancelDjEviction(roomId, user.id);
      // Grace timers are intentionally process-local. After a server restart,
      // persisted lineup entries have no timer, so remove them unless online.
      const onlineUserIds = new Set([...roomUsers.get(roomId)!.values()].map((roomUser) => roomUser.id));
      room.djQueueUserIds = room.djQueueUserIds.filter((djUserId) =>
        onlineUserIds.has(djUserId) || hasPendingDjEviction(roomId, djUserId)
      );
      if (room.djQueueUserIds.includes(user.id)) rememberDjUser(roomId, user);
      if (room.djUserId && !room.djQueueUserIds.includes(room.djUserId)) advanceRadio(room);
      await store.saveRoom(room);
      socketRooms.set(socket.id, roomId);
      await socket.join(roomId);
      broadcast(room);
      reply?.({ ok: true });
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "Could not load this room.";
      reply?.({
        ok: false,
        error: message.startsWith("SoundSpin database is not initialized")
          ? message
          : "Could not load this room."
      });
    }
  });

  socket.on("room:moderator:set", async (payload, reply) => {
    const membership = getMembership(socket.id);
    const parsed = moderatorSchema.safeParse(payload);
    if (!membership || !parsed.success) {
      return reply?.({ ok: false, error: "Invalid moderator change." });
    }
    try {
      await store.setModerator(
        membership.room.id,
        membership.user.id,
        parsed.data.userId,
        parsed.data.moderator
      );
      if (membership.room.settings.djAccess === "roles" && !canJoinDjQueue(membership.room, parsed.data.userId)) {
        const wasCurrentDj = membership.room.djUserId === parsed.data.userId;
        cancelDjEviction(membership.room.id, parsed.data.userId);
        removeDj(membership.room, parsed.data.userId);
        forgetDjUser(membership.room.id, parsed.data.userId);
        if (wasCurrentDj) advanceRadio(membership.room);
        await store.saveRoom(membership.room);
      }
      broadcast(membership.room);
      reply?.({ ok: true });
    } catch (error) {
      reply?.({ ok: false, error: error instanceof Error ? error.message : "Could not update moderator." });
    }
  });

  socket.on("room:dj-role:set", async (payload, reply) => {
    const membership = getMembership(socket.id);
    const parsed = djRoleSchema.safeParse(payload);
    if (!membership || !parsed.success) {
      return reply?.({ ok: false, error: "Invalid DJ role change." });
    }
    try {
      await store.setDjRole(
        membership.room.id,
        membership.user.id,
        parsed.data.userId,
        parsed.data.dj
      );
      if (membership.room.settings.djAccess === "roles" && !canJoinDjQueue(membership.room, parsed.data.userId)) {
        const wasCurrentDj = membership.room.djUserId === parsed.data.userId;
        cancelDjEviction(membership.room.id, parsed.data.userId);
        removeDj(membership.room, parsed.data.userId);
        forgetDjUser(membership.room.id, parsed.data.userId);
        if (wasCurrentDj) advanceRadio(membership.room);
        await store.saveRoom(membership.room);
      }
      broadcast(membership.room);
      reply?.({ ok: true });
    } catch (error) {
      reply?.({ ok: false, error: error instanceof Error ? error.message : "Could not update DJ role." });
    }
  });

  socket.on("dj:join", async (_payload, reply) => {
    const membership = getMembership(socket.id);
    if (!membership) return reply?.({ ok: false, error: "Join a room first." });
    if (!canJoinDjQueue(membership.room, membership.user.id)) {
      return reply?.({ ok: false, error: "This room requires a DJ role or moderator access." });
    }
    if (!membership.room.djQueueUserIds.includes(membership.user.id)) {
      // advanceRadio leaves the current DJ at the back of the ring. Inserting
      // before them gives a newcomer a turn after the already-waiting DJs,
      // rather than making the current DJ play again first.
      const currentDjIndex = membership.room.djUserId
        ? membership.room.djQueueUserIds.indexOf(membership.room.djUserId)
        : -1;
      if (currentDjIndex >= 0) membership.room.djQueueUserIds.splice(currentDjIndex, 0, membership.user.id);
      else membership.room.djQueueUserIds.push(membership.user.id);
    }
    rememberDjUser(membership.room.id, membership.user);
    privateQueue(membership.room, membership.user.id);
    if (!membership.room.playback.track) advanceRadio(membership.room);
    await store.saveRoom(membership.room);
    broadcast(membership.room);
    reply?.({ ok: true });
  });

  socket.on("dj:leave", async (_payload, reply) => {
    const membership = getMembership(socket.id);
    if (!membership) return reply?.({ ok: false, error: "Join a room first." });
    const wasCurrentDj = membership.room.djUserId === membership.user.id;
    cancelDjEviction(membership.room.id, membership.user.id);
    removeDj(membership.room, membership.user.id);
    forgetDjUser(membership.room.id, membership.user.id);
    if (wasCurrentDj) advanceRadio(membership.room);
    await store.saveRoom(membership.room);
    broadcast(membership.room);
    reply?.({ ok: true });
  });

  socket.on("queue:add", async (payload, reply) => {
    const membership = getMembership(socket.id);
    const parsed = trackSchema.safeParse(payload);
    if (!membership || !parsed.success) return reply?.({ ok: false, error: "Invalid track." });
    if (!membership.room.djQueueUserIds.includes(membership.user.id)) {
      return reply?.({ ok: false, error: "Join the DJ queue before adding tracks." });
    }
    if (!(["youtube", "soundcloud"] as const).includes(parsed.data.provider as "youtube" | "soundcloud")) {
      return reply?.({ ok: false, error: "That provider is not enabled yet." });
    }
    if (
      membership.room.playback.track?.provider === parsed.data.provider &&
      membership.room.playback.track.providerId === parsed.data.providerId
    ) {
      return reply?.({ ok: false, error: "That track is already playing." });
    }
    const queue = privateQueue(membership.room, membership.user.id);
    const duplicateIndex = queue.findIndex(
      (track) =>
        track.provider === parsed.data.provider &&
        track.providerId === parsed.data.providerId
    );
    if (duplicateIndex >= 0) {
      return reply?.({
        ok: false,
        error: `That track is already #${duplicateIndex + 1} in the queue.`
      });
    }
    const track: Track = {
      id: crypto.randomUUID(),
      ...parsed.data,
      addedBy: membership.user,
      addedAt: Date.now()
    };
    queue.push(track);
    const startedPlaying = !membership.room.playback.track;
    if (startedPlaying) advanceRadio(membership.room);
    await store.saveRoom(membership.room);
    broadcast(membership.room);
    reply?.({
      ok: true,
      started: startedPlaying,
      position: startedPlaying ? 0 : queue.length
    });
  });

  socket.on("queue:remove", async (payload, reply) => {
    const membership = getMembership(socket.id);
    const parsed = queueTrackSchema.safeParse(payload);
    if (!membership || !parsed.success) {
      return reply?.({ ok: false, error: "Invalid queue item." });
    }
    const queue = privateQueue(membership.room, membership.user.id);
    const index = queue.findIndex((track) => track.id === parsed.data.trackId);
    if (index < 0) return reply?.({ ok: false, error: "Track not found." });
    queue.splice(index, 1);
    await store.saveRoom(membership.room);
    broadcast(membership.room);
    reply?.({ ok: true });
  });

  socket.on("queue:play-next", async (payload, reply) => {
    const membership = getMembership(socket.id);
    const parsed = queueTrackSchema.safeParse(payload);
    if (!membership) return reply?.({ ok: false, error: "Join a room first." });
    if (!parsed.success) return reply?.({ ok: false, error: "Invalid queue item." });
    const queue = privateQueue(membership.room, membership.user.id);
    const index = queue.findIndex((track) => track.id === parsed.data.trackId);
    if (index < 0) return reply?.({ ok: false, error: "Track not found." });
    const [track] = queue.splice(index, 1);
    queue.unshift(track);
    await store.saveRoom(membership.room);
    broadcast(membership.room);
    reply?.({ ok: true });
  });

  socket.on("queue:move", async (payload, reply) => {
    const membership = getMembership(socket.id);
    const parsed = queueMoveSchema.safeParse(payload);
    if (!membership) return reply?.({ ok: false, error: "Join a room first." });
    if (!parsed.success) return reply?.({ ok: false, error: "Invalid queue move." });
    const queue = privateQueue(membership.room, membership.user.id);
    const fromIndex = queue.findIndex((track) => track.id === parsed.data.trackId);
    if (fromIndex < 0) return reply?.({ ok: false, error: "Track not found." });
    const [track] = queue.splice(fromIndex, 1);
    const toIndex = Math.min(parsed.data.toIndex, queue.length);
    queue.splice(toIndex, 0, track);
    await store.saveRoom(membership.room);
    broadcast(membership.room);
    reply?.({ ok: true });
  });

  socket.on("queue:next", async (payload, reply) => {
    const membership = getMembership(socket.id);
    const parsed = queueNextSchema.safeParse(payload);
    if (!membership || !canControlPlayback(membership.room, membership.user.id)) {
      return reply?.({ ok: false, error: "Only the current DJ or a room moderator can skip tracks." });
    }
    // Track IDs make "ended" idempotent across retries and multiple tabs. A
    // stale event must not advance the newly started song as well.
    if (!parsed.success || membership.room.playback.track?.id !== parsed.data.trackId) {
      return reply?.({ ok: false, error: "That track has already ended." });
    }
    advanceRadio(membership.room);
    await store.saveRoom(membership.room);
    broadcast(membership.room);
    reply?.({ ok: true });
  });

  socket.on("playback:update", async (payload, reply) => {
    const membership = getMembership(socket.id);
    const parsed = playbackSchema.safeParse(payload);
    if (!membership || !canControlPlayback(membership.room, membership.user.id)) {
      return reply?.({ ok: false, error: "Only the current DJ or a room moderator controls playback." });
    }
    if (!parsed.success || !membership.room.playback.track) {
      return reply?.({ ok: false, error: "Invalid playback update." });
    }
    membership.room.playback = {
      ...membership.room.playback,
      ...parsed.data,
      updatedAt: Date.now()
    };
    await store.saveRoom(membership.room);
    broadcast(membership.room);
    reply?.({ ok: true });
  });

  socket.on("vibe:vote", async (payload, reply) => {
    const membership = getMembership(socket.id);
    const parsed = vibeVoteSchema.safeParse(payload);
    const track = membership?.room.playback.track;
    if (!membership || !track || !parsed.success) {
      return reply?.({ ok: false, error: "There is no track to vote on." });
    }
    if (track.addedBy.id === membership.user.id) {
      return reply?.({ ok: false, error: "You cannot vote on a track you added." });
    }
    if (!membership.room.vibe || membership.room.vibe.trackId !== track.id) {
      membership.room.vibe = { trackId: track.id, votes: {} };
    }
    if (parsed.data.value === 0) {
      delete membership.room.vibe.votes[membership.user.id];
    } else {
      membership.room.vibe.votes[membership.user.id] = parsed.data.value;
    }
    let awardedXp = false;
    if (parsed.data.value === 1) {
      try {
        awardedXp = await store.awardTrackLikedXp(
          track.addedBy.id,
          membership.room.id,
          track.id
        );
      } catch (error) {
        console.error(error);
      }
    }
    await store.saveRoom(membership.room);
    broadcast(membership.room);
    if (awardedXp) {
      for (const [socketId, roomUser] of roomUsers.get(membership.room.id) || []) {
        if (roomUser.id === track.addedBy.id) {
          io.to(socketId).emit("profile:xp", {
            amount: TRACK_LIKED_XP,
            message: `${membership.user.name} liked your track`
          });
        }
      }
    }
    reply?.({ ok: true });
  });

  socket.on("disconnect", () => { void leaveCurrentRoom(socket.id); });
});

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.get("/api/profiles/:userId", async (request, response) => {
  if (!(await getApiUserId(request))) {
    return response.status(401).json({ error: "Authentication required." });
  }
  const userId = z.string().uuid().safeParse(request.params.userId);
  if (!userId.success) return response.status(400).json({ error: "Invalid profile." });
  try {
    const [profile, unlocks] = await Promise.all([
      store.getProfile(userId.data),
      store.getUnlocks()
    ]);
    if (!profile) return response.status(404).json({ error: "Profile not found." });
    response.json({ profile, unlocks });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Could not load profile."
    });
  }
});

app.get("/api/rooms", async (request, response) => {
  const userId = await getApiUserId(request);
  if (!userId) return response.status(401).json({ error: "Authentication required." });
  try {
    const listenerCounts = Object.fromEntries(
      [...roomUsers.entries()].map(([slug, users]) => [slug, uniqueUsers(users.values()).length])
    );
    const rooms = await store.listRooms(userId, listenerCounts);
    response.json({ rooms });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Could not load rooms." });
  }
});

app.post("/api/rooms", express.json(), async (request, response) => {
  const userId = await getApiUserId(request);
  if (!userId) return response.status(401).json({ error: "Authentication required." });
  const parsed = roomCreateSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid room." });
  }
  try {
    const room = createRoom(roomSlug(parsed.data.name), userId, parsed.data.name);
    room.isPublic = parsed.data.isPublic;
    room.passwordProtected = Boolean(parsed.data.password?.trim());
    await store.createRoom(room, hashRoomPassword(parsed.data.password));
    await store.setFavorite(room.id, userId, true);
    response.status(201).json({ room: { slug: room.id, name: room.name } });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Could not create room." });
  }
});

app.put("/api/rooms/:slug/favorite", express.json(), async (request, response) => {
  const userId = await getApiUserId(request);
  if (!userId) return response.status(401).json({ error: "Authentication required." });
  const slug = z.string().regex(/^[a-z0-9-]{3,48}$/).safeParse(request.params.slug);
  const parsed = favoriteSchema.safeParse(request.body);
  if (!slug.success || !parsed.success) return response.status(400).json({ error: "Invalid favorite." });
  try {
    const access = await store.getRoomAccess(slug.data, userId);
    if (!access.exists || (!access.isPublic && !access.role)) {
      return response.status(404).json({ error: "Room not found." });
    }
    await store.setFavorite(slug.data, userId, parsed.data.favorite);
    response.json({ favorite: parsed.data.favorite });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Could not update favorite." });
  }
});

app.patch("/api/rooms/:slug", express.json(), async (request, response) => {
  const userId = await getApiUserId(request);
  if (!userId) return response.status(401).json({ error: "Authentication required." });
  const slug = z.string().regex(/^[a-z0-9-]{3,48}$/).safeParse(request.params.slug);
  const parsed = roomSettingsSchema.safeParse(request.body);
  if (!slug.success || !parsed.success) {
    return response.status(400).json({ error: parsed.success ? "Invalid room." : parsed.error.issues[0]?.message });
  }
  try {
    const room = await store.updateRoomSettings(slug.data, userId, {
      name: parsed.data.name,
      isPublic: parsed.data.isPublic,
      passwordHash: parsed.data.password === undefined ? undefined : hashRoomPassword(parsed.data.password),
      djAccess: parsed.data.djAccess
    });
    if (room) {
      if (room.settings.djAccess === "roles") {
        const previousDj = room.djUserId;
        const previousDjQueue = [...room.djQueueUserIds];
        room.djQueueUserIds = room.djQueueUserIds.filter((djUserId) => canJoinDjQueue(room, djUserId));
        for (const removedUserId of previousDjQueue.filter((djUserId) => !room.djQueueUserIds.includes(djUserId))) {
          cancelDjEviction(room.id, removedUserId);
          forgetDjUser(room.id, removedUserId);
        }
        if (previousDj && !room.djQueueUserIds.includes(previousDj)) advanceRadio(room);
        await store.saveRoom(room);
      }
      broadcast(room);
    }
    response.json({ room: room ? { id: room.id, name: room.name } : null });
  } catch (error) {
    response.status(403).json({ error: error instanceof Error ? error.message : "Could not update room." });
  }
});

app.patch("/api/profile", express.json(), async (request, response) => {
  const userId = await getApiUserId(request);
  if (!userId) return response.status(401).json({ error: "Authentication required." });
  const parsed = profileUpdateSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid profile." });
  }
  try {
    const profile = await store.updateProfile(userId, parsed.data);
    response.json({ profile });
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Could not update profile."
    });
  }
});

app.get("/api/youtube/search", async (request, response) => {
  if (authEnabled && !(await getApiUserId(request))) {
    return response.status(401).json({ error: "Authentication required." });
  }
  if (!youtubeApiKey) {
    return response.status(503).json({ error: "YouTube search is not configured yet." });
  }

  const parsed = youtubeSearchSchema.safeParse(request.query);
  if (!parsed.success) {
    return response.status(400).json({ error: "Enter at least 2 characters to search." });
  }

  const now = Date.now();
  const rateKey = request.ip || request.socket.remoteAddress || "unknown";
  const currentLimit = youtubeSearchLimits.get(rateKey);
  const limit = !currentLimit || currentLimit.resetAt <= now
    ? { count: 0, resetAt: now + 10 * 60 * 1000 }
    : currentLimit;
  if (limit.count >= 30) {
    return response.status(429).json({ error: "Too many searches. Please try again in a few minutes." });
  }
  limit.count += 1;
  youtubeSearchLimits.set(rateKey, limit);

  const cacheKey = parsed.data.q.toLocaleLowerCase();
  const cached = youtubeSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return response.json({ results: cached.results });
  }

  try {
    const searchParams = new URLSearchParams({
      key: youtubeApiKey,
      part: "snippet",
      type: "video",
      videoEmbeddable: "true",
      safeSearch: "moderate",
      maxResults: "12",
      q: parsed.data.q
    });
    const searchResponse = await fetch(`https://www.googleapis.com/youtube/v3/search?${searchParams}`);
    const searchPayload = await searchResponse.json() as {
      error?: { message?: string };
      items?: Array<{
        id: { videoId?: string };
        snippet: {
          title: string;
          channelTitle: string;
          thumbnails: {
            medium?: { url: string };
            default?: { url: string };
          };
        };
      }>;
    };
    if (!searchResponse.ok) {
      throw new Error(searchPayload.error?.message || "YouTube search failed.");
    }

    const items = (searchPayload.items || []).filter((item) => item.id.videoId);
    const ids = items.map((item) => item.id.videoId!).join(",");
    const durations = new Map<string, string>();
    if (ids) {
      const videoParams = new URLSearchParams({
        key: youtubeApiKey,
        part: "contentDetails",
        id: ids
      });
      const videoResponse = await fetch(`https://www.googleapis.com/youtube/v3/videos?${videoParams}`);
      if (videoResponse.ok) {
        const videoPayload = await videoResponse.json() as {
          items?: Array<{ id: string; contentDetails?: { duration?: string } }>;
        };
        for (const video of videoPayload.items || []) {
          const duration = formatYouTubeDuration(video.contentDetails?.duration);
          if (duration) durations.set(video.id, duration);
        }
      }
    }

    const results: YouTubeSearchResult[] = items.map((item) => ({
      id: item.id.videoId!,
      title: decodeYouTubeText(item.snippet.title),
      channel: decodeYouTubeText(item.snippet.channelTitle),
      thumbnail:
        item.snippet.thumbnails.medium?.url ||
        item.snippet.thumbnails.default?.url ||
        `https://i.ytimg.com/vi/${item.id.videoId}/mqdefault.jpg`,
      duration: durations.get(item.id.videoId!)
    }));
    youtubeSearchCache.set(cacheKey, {
      expiresAt: now + 5 * 60 * 1000,
      results
    });
    response.json({ results });
  } catch (error) {
    console.error("YouTube search failed", error);
    response.status(502).json({
      error: error instanceof Error ? error.message : "YouTube search failed."
    });
  }
});

app.get("/api/soundcloud/search", async (request, response) => {
  if (authEnabled && !(await getApiUserId(request))) {
    return response.status(401).json({ error: "Authentication required." });
  }
  if (!soundCloudApi.configured) {
    return response.status(503).json({ error: "SoundCloud search is not configured yet." });
  }

  const parsed = soundCloudSearchSchema.safeParse(request.query);
  if (!parsed.success) {
    return response.status(400).json({ error: "Enter at least 2 characters to search." });
  }

  const now = Date.now();
  const rateKey = request.ip || request.socket.remoteAddress || "unknown";
  const currentLimit = soundCloudSearchLimits.get(rateKey);
  const limit = !currentLimit || currentLimit.resetAt <= now
    ? { count: 0, resetAt: now + 10 * 60 * 1000 }
    : currentLimit;
  if (limit.count >= 30) {
    return response.status(429).json({ error: "Too many searches. Please try again in a few minutes." });
  }
  limit.count += 1;
  soundCloudSearchLimits.set(rateKey, limit);

  const cacheKey = parsed.data.q.toLocaleLowerCase();
  const cached = soundCloudSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return response.json({ results: cached.results });
  }

  try {
    const results = await soundCloudApi.searchTracks(parsed.data.q);
    soundCloudSearchCache.set(cacheKey, {
      expiresAt: now + 5 * 60 * 1000,
      results
    });
    response.json({ results });
  } catch (error) {
    console.error("SoundCloud search failed", error);
    response.status(502).json({
      error: error instanceof Error ? error.message : "SoundCloud search failed."
    });
  }
});

app.get("/api/soundcloud/resolve", async (request, response) => {
  if (authEnabled && !(await getApiUserId(request))) {
    return response.status(401).json({ error: "Authentication required." });
  }
  if (!soundCloudApi.configured) {
    return response.status(503).json({ error: "SoundCloud is not configured yet." });
  }

  const parsed = soundCloudResolveSchema.safeParse(request.query);
  if (!parsed.success) {
    return response.status(400).json({ error: "Enter a valid SoundCloud track URL." });
  }

  try {
    response.json({ result: await soundCloudApi.resolveTrack(parsed.data.url) });
  } catch (error) {
    console.error("SoundCloud URL resolution failed", error);
    response.status(400).json({
      error: error instanceof Error ? error.message : "Could not resolve that SoundCloud URL."
    });
  }
});

app.get("/api/config", (_request, response) => {
  response.json({
    giphyKey: process.env.GIPHY_API_KEY || null,
    supabase: authEnabled
      ? { url: supabaseUrl, anonKey: supabasePublishableKey }
      : null
  });
});

if (process.env.NODE_ENV === "production") {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const publicDir = path.resolve(dirname, "../dist");
  app.use(express.static(publicDir));
  app.get("/{*splat}", (_request, response) => response.sendFile(path.join(publicDir, "index.html")));
}

await store.init();
httpServer.listen(port, "0.0.0.0", () => {
  console.log(`SoundSpin listening on http://0.0.0.0:${port}`);
});
