import { mountAdminRoutes } from "./admin-routes.js";
import { mountMusicRoutes } from "./music-routes.js";
import { mountRoomActions } from "./room-actions.js";
import { RoomCommandService } from "./room-command-service.js";
import { hashRoomPassword, passwordMatches } from "./room-password.js";
import { RoomEntryLimiter } from "./room-entry-limiter.js";
import { IdleRoomRegistry } from "./idle-rooms.js";
import { reconcileDjPresence } from "./dj-presence.js";
import { runtimeMetrics } from "./runtime-metrics.js";
import { mountSpotifyOAuthRoutes } from "./spotify-oauth-routes.js";
import { createSocketCredentialLease, type SocketCredentialLease } from "./socket-credentials.js";
import { createChatWritePolicy } from "./chat-write-policy.js";
import { joinSchema } from "../shared/room-protocol.js";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServer } from "node:http";
import { createAdminClient, verifyCredentials } from "@supabase/server/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Server } from "socket.io";
import { z } from "zod";
import { Store } from "./store.js";
import { profileUpdateSchema } from "./profile-fields.js";
import { allowedProvidersSchema } from "./room-settings.js";
import { mountPrivateLibraryRoutes } from "./library-routes.js";
import { mountSocialRoutes } from "./social-routes.js";
import { SocialStore } from "./social-store.js";
import { loadChatReply, loadStoredChatMessage, mountChatHistoryRoutes } from "./chat-history.js";
import { createChatRelay } from "./chat-relay.js";
import { resolveChatMediaUrl } from "./chat-media.js";
import { withPublicRoomPreview } from "./directory-preview.js";
import { createSavedSetResolver, SetImportRegistry } from "./saved-set.js";
import { validateServerConfig } from "./config.js";
import { RoomCommandError, safeSocketHandler, serialSocketHandler } from "./socket-handler.js";
import { roomPresence, uniqueUsers } from "./presence.js";
import { activeAnnouncement, AnnouncementExpiryRegistry } from "./announcements.js";
import { SoundCloudApi } from "./soundcloud.js";
import { AppleMusicApi } from "./apple-music.js";
import { resolveTrackMappings } from "./provider-mappings.js";
import { SpotifyAccounts } from "./spotify-accounts.js";
import { SpotifyApi } from "./spotify.js";
import { GiphyApi } from "./giphy.js";
import {
  invitePasswordMatches,
  inviteSignupSchema,
  SignupAttemptLimiter
} from "./invite-signup.js";
import {
  advanceRadio,
  GracePeriodRegistry,
  QueueUndoRegistry,
  normalizeRadioState,
  removeDj,
  roomForListener
} from "./radio.js";
import type { Room, RoomSnapshot, User } from "./types.js";

validateServerConfig(process.env);

const port = Number(process.env.PORT || 3000);
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: true } });
const store = new Store();
const roomCommands = new RoomCommandService(store, broadcast);
const supabaseUrl = process.env.SUPABASE_URL;
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const supabaseJwksUrl = process.env.SUPABASE_JWKS_URL;
const signupInvitePassword = process.env.SIGNUP_INVITE_PASSWORD?.trim() || "";
const youtubeApiKey = process.env.YOUTUBE_API_KEY;
const soundCloudApi = new SoundCloudApi(
  process.env.SOUNDCLOUD_CLIENT_ID,
  process.env.SOUNDCLOUD_CLIENT_SECRET
);
const spotifyApi = new SpotifyApi();
const giphyApi = new GiphyApi();
const appleMusicApi = new AppleMusicApi();
const spotifyAccounts = new SpotifyAccounts(store, spotifyApi);
const authEnabled = Boolean(
  supabaseUrl &&
  supabasePublishableKey &&
  supabaseSecretKey &&
  supabaseJwksUrl &&
  store.usesSupabase
);
const supabaseAdmin: SupabaseClient | null = authEnabled ? createAdminClient() : null;
const signupAdmin = supabaseAdmin && signupInvitePassword ? supabaseAdmin : null;

// Live coordination is process-local. `roomUsers` is socket presence, while
// `roomDjUsers` also keeps a disconnected DJ's display data during the grace
// period. Durable room/radio state lives in Store/Supabase.
const roomUsers = new Map<string, Map<string, User>>();
const roomDjUsers = new Map<string, Map<string, User>>();
const socketRooms = new Map<string, string>();
const activeSocketActions = new Set<Promise<void>>();
let shuttingDown = false;
const DJ_DISCONNECT_GRACE_MS = 60_000;
const djEvictions = new GracePeriodRegistry(DJ_DISCONNECT_GRACE_MS);
const queueUndo = new QueueUndoRegistry();
const setImports = new SetImportRegistry();
const roomEntryLimiter = new RoomEntryLimiter();
const resolveSavedRecording = createSavedSetResolver({ spotify: spotifyApi, appleMusic: appleMusicApi, soundCloud: soundCloudApi });
const announcementExpiries = new AnnouncementExpiryRegistry(async (room) => {
  await roomCommands.execute(room, draft => {
    if (draft.announcement?.expiresAt !== null && draft.announcement?.expiresAt !== undefined && draft.announcement.expiresAt <= Date.now()) draft.announcement = null;
    return { result: undefined };
  });
});
const signupAttemptLimiter = new SignupAttemptLimiter(10, 15 * 60 * 1000);
const idleRooms = new IdleRoomRegistry(roomId => {
  if (roomUsers.get(roomId)?.size) return true;
  const room = store.getRoom(roomId);
  if (room?.djQueueUserIds.some(id => hasPendingDjEviction(roomId, id))) return false;
  if (!store.releaseRoom(roomId)) return false;
  announcementExpiries.cancel(roomId);
  queueUndo.releaseRoom(roomId);
  setImports.releaseRoom(roomId);
  roomDjUsers.delete(roomId);
  return true;
});
function watchIdleRoom(roomId: string) { if (store.usesSupabase && !roomUsers.get(roomId)?.size) idleRooms.schedule(roomId); }
const roomCreateSchema = z.object({
  name: z.string().trim().min(1).max(48),
  isPublic: z.boolean().default(true),
  password: z.string().max(128).optional()
});

const roomSettingsSchema = z.object({
  name: z.string().trim().min(1).max(48).optional(),
  description: z.string().trim().max(240).optional(),
  isPublic: z.boolean().optional(),
  password: z.union([z.string().max(128), z.null()]).optional(),
  djAccess: z.enum(["everyone", "roles"]).optional(),
  themePrompt: z.string().trim().max(160).nullable().optional(),
  allowedProviders: allowedProvidersSchema.optional()
}).refine((value) => Object.keys(value).length > 0, "No room changes supplied.");

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

console.log("Signup configuration:", {
  signupInvitePassword: Boolean(signupInvitePassword),
  supabaseUrl: Boolean(supabaseUrl),
  supabasePublishableKey: Boolean(supabasePublishableKey),
  supabaseSecretKey: Boolean(supabaseSecretKey),
  supabaseJwksUrl: Boolean(supabaseJwksUrl),
  usesSupabase: store.usesSupabase,
  authEnabled,
  signupAdmin: Boolean(signupAdmin)
});

function spotifyRedirectUri(request: express.Request) {
  if (process.env.SPOTIFY_REDIRECT_URI) return process.env.SPOTIFY_REDIRECT_URI;
  const host = request.get("host") || "127.0.0.1:5173";
  const spotifySafeHost = host.replace(/^localhost(?=:|$)/i, "127.0.0.1");
  return `${request.protocol}://${spotifySafeHost}/api/spotify/callback`;
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

async function getApiAdminUserId(request: express.Request): Promise<
  { ok: true; userId: string } |
  { ok: false; error: string; status: 401 | 403 }
> {
  const userId = await getApiUserId(request);
  if (!userId) return { ok: false, error: "Authentication required.", status: 401 };
  const profile = await store.getProfile(userId);
  if (!profile?.is_app_admin) return { ok: false, error: "Administrator access required.", status: 403 };
  return { ok: true, userId };
}

mountPrivateLibraryRoutes(app, store, getApiUserId);
const socialStore = new SocialStore({
  supabase: supabaseAdmin,
  getRoomAccess: async (slug, userId) => {
    const access = await store.getRoomAccess(slug, userId);
    return { ...access, passwordProtected: Boolean(access.passwordHash) };
  },
  getProfile: userId => store.getProfile(userId),
  getRoom: async slug => { const room = await store.loadRoom(slug); return room ? { name: room.name } : null; },
  getActivity: userId => {
    for (const [roomSlug, users] of roomUsers) {
      if ([...users.values()].some(user => user.id === userId)) return { roomSlug };
    }
    return null;
  }
});
mountSocialRoutes(app, socialStore, getApiUserId);
async function canWriteRoomChat(userId: string, roomSlug: string) {
  const access = await store.getRoomAccess(roomSlug, userId);
  return access.exists && (access.isPublic || Boolean(access.role)) &&
    [...(roomUsers.get(roomSlug)?.values() || [])].some(user => user.id === userId);
}
const chatWritePolicy = createChatWritePolicy();
/** HTTP poll mutations and the relay share the same fresh admitted recipient gate. */
async function emitAdmittedChat(roomId: string, event: 'chat:message' | 'chat:reaction' | 'chat:typing' | 'chat:poll', payload: unknown,
  origin: { socketId?: string; userId: string }) {
  const recipients = [...(roomUsers.get(roomId) || [])];
  const [allowed, canWrite] = await Promise.all([
    store.allowedRoomReaders(roomId, recipients.map(([, user]) => user.id)),
    canWriteRoomChat(origin.userId, roomId)
  ]);
  const sender = origin.socketId ? getMembership(origin.socketId) : undefined;
  const senderAdmitted = origin.socketId
    ? sender?.room.id === roomId && sender.user.id === origin.userId
    : [...(roomUsers.get(roomId)?.values() || [])].some(user => user.id === origin.userId);
  if (!canWrite || !allowed.has(origin.userId) || !senderAdmitted) {
    throw new Error("This room session has ended. Join again before sending chat.");
  }
  for (const [socketId, user] of recipients) {
    const current = getMembership(socketId);
    if (allowed.has(user.id) && current?.room.id === roomId && current.user.id === user.id) io.to(socketId).emit(event, payload);
  }
}
const chatRelay = createChatRelay({
  writePolicy: chatWritePolicy,
  getMembership,
  canWriteRoom: canWriteRoomChat,
  // The standalone JSON mode has no durable chat table. Configured production
  // always checks stored IDs and propagates lookup failure before broadcasting.
  loadMessageById: id => authEnabled ? loadStoredChatMessage(supabaseAdmin, id) : Promise.resolve(null),
  loadReply: (roomId, messageId) => loadChatReply(supabaseAdmin, roomId, messageId),
  resolveMediaUrl: async (roomId, storagePath, userId) => (await resolveChatMediaUrl(supabaseAdmin, roomId, storagePath, userId)).url,
  emitToRoom: emitAdmittedChat
});
mountChatHistoryRoutes(app, {
  writePolicy: chatWritePolicy,
  client: supabaseAdmin,
  getUserId: getApiUserId,
  canWriteRoom: canWriteRoomChat,
  onPollVote: (roomId, event, userId) => emitAdmittedChat(roomId, 'chat:poll', { roomId, poll: event }, { userId }),
  getUser: async (userId, roomId) => [...(roomUsers.get(roomId)?.values() || [])].find(user => user.id === userId) || null,
  canReadRoom: async (userId, roomSlug) => {
    const access = await store.getRoomAccess(roomSlug, userId);
    if (!access.exists || (!access.isPublic && !access.role)) return false;
    if (access.isPublic && !access.passwordHash) return true;
    // Protected/private history requires the same live admission as the room.
    return [...(roomUsers.get(roomSlug)?.values() || [])].some(user => user.id === userId);
  }
});

app.post("/api/signup", express.json({ limit: "4kb" }), async (request, response) => {
  response.set("Cache-Control", "no-store");
  if (!signupAdmin || !signupInvitePassword) {
    return response.status(503).json({ error: "Invite-only signup is not configured." });
  }

  const rateKey = request.ip || request.socket.remoteAddress || "unknown";
  if (!signupAttemptLimiter.consume(rateKey)) {
    return response.status(429).json({ error: "Too many signup attempts. Try again later." });
  }

  const parsed = inviteSignupSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ error: "Enter a valid email, password, and invite password." });
  }
  if (!invitePasswordMatches(parsed.data.invitePassword, signupInvitePassword)) {
    return response.status(403).json({ error: "The invite password is incorrect." });
  }

  try {
    const { error } = await signupAdmin.auth.admin.createUser({
      email: parsed.data.email,
      password: parsed.data.password,
      ...(parsed.data.displayName ? { user_metadata: { display_name: parsed.data.displayName } } : {}),
      email_confirm: true
    });
    if (error) {
      return response.status(400).json({
        error: "Could not create the account. Try signing in if this email is already registered."
      });
    }
  } catch {
    return response.status(502).json({ error: "The account service is unavailable. Try again later." });
  }

  signupAttemptLimiter.reset(rateKey);
  return response.status(201).json({ ok: true });
});

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
  announcementExpiries.watch(room);
  return {
    room: { ...roomForListener(room, userId), announcement: activeAnnouncement(room.announcement) },
    // Presence is socket-based internally, but listeners are unique accounts.
    users: uniqueUsers(roomUsers.get(room.id)?.values() || []),
    djUsers: [...(roomDjUsers.get(room.id)?.values() || [])]
      .filter((user) => room.djQueueUserIds.includes(user.id)),
    serverTime: Date.now()
  };
}

function broadcastPresence(room: Room) {
  // Presence is identical for every recipient and does not carry private queues.
  // Keep it separate from room snapshots so a join/leave cannot seek every player.
  io.to(room.id).emit("room:presence", roomPresence(
    room,
    roomUsers.get(room.id)?.values() || [],
    roomDjUsers.get(room.id)?.values() || []
  ));
}

function broadcast(room: Room) {
  // Do not replace this with io.to(room.id).emit(...). Queue privacy requires a
  // separate snapshot for every recipient.
  for (const [socketId, user] of roomUsers.get(room.id) || []) {
    io.to(socketId).emit("room:snapshot", snapshot(room, user.id));
  }
}

function djEvictionKey(roomId: string, userId: string) {
  return `${roomId}:${userId}`;
}

function rememberDjUser(roomId: string, user: User) {
  if (!roomDjUsers.has(roomId)) roomDjUsers.set(roomId, new Map());
  roomDjUsers.get(roomId)!.set(user.id, user);
}

function reconcileDjUser(roomId: string, user: User) {
  const room = store.getRoom(roomId);
  if (room) reconcileDjPresence(room, user, { onlineUsers: roomUsers.get(roomId)?.values() || [],
    remember: rememberDjUser, scheduleEviction: scheduleDjEviction, cancelEviction: cancelDjEviction });
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
  if (shuttingDown) return;
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

      await roomCommands.execute(currentRoom, draft => {
        if ([...(roomUsers.get(room.id)?.values() || [])].some(roomUser => roomUser.id === user.id)) return { result: undefined };
        const wasCurrentDj = draft.djUserId === user.id;
        removeDj(draft, user.id);
        if (wasCurrentDj) advanceRadio(draft);
        return { result: undefined, committed: () => forgetDjUser(currentRoom.id, user.id) };
      });
    })().catch(error => {
      console.error("Could not persist offline DJ removal", error);
      if (!shuttingDown && ![...(roomUsers.get(room.id)?.values() || [])].some(roomUser => roomUser.id === user.id)) scheduleDjEviction(room, user);
    });
  });
}

function getMembership(socketId: string) {
  const lease = io.sockets.sockets.get(socketId)?.data.credentialLease as SocketCredentialLease | undefined;
  if (lease && Date.now() >= lease.expiresAt) return null;
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
  broadcastPresence(room);
  watchIdleRoom(roomId);
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
  try {
    socket.data.credentialLease = createSocketCredentialLease(data.userClaims.id, data.jwtClaims?.exp);
  } catch { return next(new Error("Your session has expired.")); }
  socket.data.authUserId = data.userClaims.id;
  next();
});

io.on("connection", (socket) => {
  const lease = socket.data.credentialLease as SocketCredentialLease | undefined;
  const assertAuthorized = () => {
    try { lease?.assertActive(); }
    catch (error) { throw new RoomCommandError((error as Error).message); }
  };
  const cancelCredentialExpiry = lease?.scheduleExpiry(() => socket.disconnect(true));
  socket.once("disconnect", () => cancelCredentialExpiry?.());
  const onAction = (event: string, handler: Parameters<typeof safeSocketHandler>[0]) => {
    const safe = safeSocketHandler(async (payload, reply) => { assertAuthorized(); await handler(payload, reply); });
    const run = event === "room:join" ? serialSocketHandler(safe) : safe;
    socket.on(event, (payload: unknown, reply?: unknown) => {
      if (shuttingDown) return;
      const operation = run(payload, reply);
      activeSocketActions.add(operation);
      void operation.finally(() => activeSocketActions.delete(operation));
    });
  };
  onAction("room:join", async (payload, reply) => {
    const parsed = joinSchema.safeParse(payload);
    if (!parsed.success) return reply?.({ ok: false, error: "Invalid room or profile." });

    const { roomId, roomName, password } = parsed.data;
    let user: User = {
      ...parsed.data.user,
      id: authEnabled ? socket.data.authUserId : parsed.data.user.id
    };
    const previousRoomId = socketRooms.get(socket.id);
    const previousUser = previousRoomId ? roomUsers.get(previousRoomId)?.get(socket.id) : undefined;
    if (!roomEntryLimiter.join(user.id, socket.handshake.address)) return reply?.({ ok: false, error: "Too many room entries. Wait a minute before trying again." });

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
            avatarKey: soundspinProfile.avatar_key,
            avatarUrl: soundspinProfile.avatar_url || undefined,
            isAppAdmin: soundspinProfile.is_app_admin
          };
        }
      }
      const access = await store.getRoomAccess(roomId, user.id);
      if (authEnabled && !access.exists) {
        return reply?.({ ok: false, error: "That room does not exist." });
      }
      if (authEnabled && !access.isPublic && !access.role) {
        return reply?.({ ok: false, error: "You no longer have access to this private room." });
      }
      if (access.passwordHash && !roomEntryLimiter.password(user.id, roomId)) return reply?.({ ok: false, error: "Too many room password attempts. Wait five minutes before trying again.", requiresPassword: true });
      if (access.passwordHash && !await passwordMatches(password, access.passwordHash)) {
        return reply?.({
          ok: false,
          error: password ? "That room password is incorrect." : "This room needs a password.",
          requiresPassword: true
        });
      }

      const room = await store.loadRoom(roomId) ||
        store.getOrCreateLocalRoom(roomId, () => createRoom(roomId, user.id, roomName));
      await store.recordRoomMember(roomId, user.id);
      if (!socket.connected) return;

      // Switch rooms only after the destination has been authorized and loaded.
      // A same-room join is an idempotent presence/profile refresh.
      if (previousRoomId && previousRoomId !== roomId) {
        await leaveCurrentRoom(socket.id);
      }
      for (const joinedRoom of socket.rooms) {
        if (joinedRoom !== socket.id && joinedRoom !== roomId) await socket.leave(joinedRoom);
      }

      if (!socket.connected) return;
      idleRooms.cancel(roomId);
      if (!roomUsers.has(roomId)) roomUsers.set(roomId, new Map());
      roomUsers.get(roomId)!.set(socket.id, user);
      cancelDjEviction(roomId, user.id);
      socketRooms.set(socket.id, roomId);
      await socket.join(roomId);
      const changed = await store.changeRoom(room, draft => {
        assertAuthorized();
        if (!socket.connected || socketRooms.get(socket.id) !== roomId) throw new RoomCommandError("This room session has ended.");
        if (!draft.ownerUserId) draft.ownerUserId = user.id;
        normalizeRadioState(draft);
        if (draft.vibe && draft.playback.track) delete draft.vibe.votes[draft.playback.track.addedBy.id];
        // Restarted lineups have no grace timers; only admitted or grace-period DJs remain.
        const online = new Set([...(roomUsers.get(roomId)?.values() || [])].map(roomUser => roomUser.id));
        draft.djQueueUserIds = draft.djQueueUserIds.filter(id => online.has(id) || hasPendingDjEviction(roomId, id));
        if (draft.djUserId && !draft.djQueueUserIds.includes(draft.djUserId)) advanceRadio(draft);
        return { result: JSON.stringify(draft) !== JSON.stringify(room), committed: () => {
          if (room.djQueueUserIds.includes(user.id)) reconcileDjUser(roomId, user);
        } };
      });
      if (!socket.connected) return;
      if (changed) {
        // Legacy normalization or stale-lineup cleanup changed shared radio state.
        broadcast(room);
      } else {
        // Only the joining socket needs the room document. Existing listeners
        // receive presence without replaying the unchanged playback checkpoint.
        io.to(socket.id).emit("room:snapshot", snapshot(room, user.id));
        broadcastPresence(room);
      }
      reply?.({ ok: true });
    } catch (error) {
      console.error(error);
      if (socketRooms.get(socket.id) === roomId) {
        if (previousRoomId === roomId && previousUser && socket.connected) {
          roomUsers.get(roomId)?.set(socket.id, previousUser);
        } else {
          await leaveCurrentRoom(socket.id);
          await socket.leave(roomId);
        }
      }
      watchIdleRoom(roomId);
      const message = error instanceof Error ? error.message : "Could not load this room.";
      reply?.({
        ok: false,
        error: message.startsWith("Lydman database is not initialized")
          ? message
          : "Could not load this room."
      });
    }
  });

  mountRoomActions({
    socket, onAction, store, commands: roomCommands, getMembership, assertAuthorized,
    broadcast, rememberDj: reconcileDjUser, forgetDj: forgetDjUser, cancelEviction: cancelDjEviction,
    watchAnnouncement: room => announcementExpiries.watch(room), queueUndo, setImports,
    resolveTrack: track => resolveTrackMappings(track, spotifyApi, appleMusicApi), resolveSavedRecording
  });
  for (const kind of ["message", "reaction", "typing"] as const) {
    onAction(`chat:${kind}`, async (payload, reply) => { reply?.(await chatRelay.handle(socket.id, kind, payload)); });
  }
  socket.on("disconnect", () => { void leaveCurrentRoom(socket.id).catch(console.error); });
});

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});
app.get("/api/ready", async (_request, response) => {
  response.set("Cache-Control", "no-store");
  try {
    const ready = !shuttingDown && await store.isReady();
    response.status(ready ? 200 : 503).json({ ok: ready });
  } catch { response.status(503).json({ ok: false }); }
});
app.get("/api/admin/runtime", async (request, response) => {
  response.set("Cache-Control", "no-store");
  const access = await getApiAdminUserId(request);
  if (!access.ok) return response.status(access.status).json({ error: access.error });
  response.json({ coordination: "single-instance", cachedRooms: store.cachedRoomCount, activeRooms: roomUsers.size,
    connectedSockets: io.engine.clientsCount, ...runtimeMetrics.snapshot() });
});

mountAdminRoutes(app, { client: supabaseAdmin, getAdminUserId: getApiAdminUserId,
  listenerCount: slug => uniqueUsers(roomUsers.get(slug)?.values() || []).length });
app.get("/api/profiles/:userId", async (request, response) => {
  if (!(await getApiUserId(request))) {
    return response.status(401).json({ error: "Authentication required." });
  }
  const userId = z.string().uuid().safeParse(request.params.userId);
  if (!userId.success) return response.status(400).json({ error: "Invalid profile." });
  try {
    const [profile, options] = await Promise.all([
      store.getProfile(userId.data),
      store.getProfileOptions()
    ]);
    if (!profile) return response.status(404).json({ error: "Profile not found." });
    response.json({ profile, options });
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
    response.json({ rooms: rooms.map(room => withPublicRoomPreview(room, store.getRoom(room.slug))) });
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
    await store.createRoom(room, await hashRoomPassword(parsed.data.password));
    watchIdleRoom(room.id);
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
    const previousDjs = [...(store.getRoom(slug.data)?.djQueueUserIds || [])];
    const room = await store.updateRoomSettings(slug.data, userId, {
      name: parsed.data.name,
      isPublic: parsed.data.isPublic,
      passwordHash: parsed.data.password === undefined ? undefined : await hashRoomPassword(parsed.data.password),
      djAccess: parsed.data.djAccess,
      description: parsed.data.description,
      themePrompt: parsed.data.themePrompt,
      allowedProviders: parsed.data.allowedProviders
    });
    if (room) {
      for (const id of previousDjs.filter(id => !room.djQueueUserIds.includes(id))) {
        cancelDjEviction(room.id, id); forgetDjUser(room.id, id);
      }
      broadcast(room);
    }
    response.json({ room: room ? { id: room.id, name: room.name } : null });
  } catch (error) {
    response.status(403).json({ error: error instanceof Error ? error.message : "Could not update room." });
  } finally {
    watchIdleRoom(slug.data);
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

mountMusicRoutes(app, { authEnabled, getUserId: getApiUserId, youtubeApiKey,
  soundCloudApi, spotifyApi, spotifyAccounts, appleMusicApi, giphyApi });
mountSpotifyOAuthRoutes(app, { getUserId: getApiUserId, accounts: spotifyAccounts,
  authorizationUrl: (redirectUri, state) => spotifyApi.authorizationUrl(redirectUri, state), redirectUri: spotifyRedirectUri });
app.get("/api/config", (_request, response) => {
  response.json({
    giphyConfigured: giphyApi.configured,
    music: {
      spotifyConfigured: spotifyAccounts.configured,
      appleMusicConfigured: appleMusicApi.configured
    },
    supabase: authEnabled
      ? { url: supabaseUrl, anonKey: supabasePublishableKey }
      : null
  });
});

app.use("/api", (_request, response) => {
  response.status(404).json({ error: "That API endpoint does not exist." });
});

app.use((error: unknown, _request: express.Request, response: express.Response, next: express.NextFunction) => {
  if (response.headersSent) return next(error);
  const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 500;
  if (status === 400 || status === 413) {
    return response.status(status).json({ error: status === 413 ? "The request is too large." : "The request body is invalid." });
  }
  console.error(error);
  response.status(500).json({ error: "The server could not complete this request. Please try again." });
});

if (process.env.NODE_ENV === "production") {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const publicDir = path.resolve(dirname, "../../dist");
  app.use(express.static(publicDir));
  app.get("/{*splat}", (_request, response) => response.sendFile(path.join(publicDir, "index.html")));
}

await store.init();
httpServer.listen(port, process.env.HOST || "0.0.0.0", () => {
  const address = httpServer.address();
  console.log(`Lydman listening on http://${process.env.HOST || "0.0.0.0"}:${typeof address === "object" && address ? address.port : port}`);
});

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  djEvictions.clear();
  announcementExpiries.clear();
  idleRooms.clear();
  const deadline = setTimeout(() => process.exit(1), 10_000);
  deadline.unref();
  try {
    await new Promise<void>((resolve) => io.close(() => resolve()));
    await Promise.allSettled([...activeSocketActions]);
    await store.flush();
    clearTimeout(deadline);
  } catch (error) {
    console.error("Could not finish pending saves during shutdown.", error);
    process.exitCode = 1;
  }
}

process.once("SIGTERM", () => { void shutdown(); });
process.once("SIGINT", () => { void shutdown(); });
