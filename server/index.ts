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
import { validateServerConfig } from "./config.js";
import { safeSocketHandler, serialSocketHandler } from "./socket-handler.js";
import { uniqueUsers } from "./presence.js";
import { SoundCloudApi, type SoundCloudSearchResult } from "./soundcloud.js";
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
  canJoinDjQueue,
  GracePeriodRegistry,
  normalizeRadioState,
  privateQueue,
  removeDj,
  roomForListener
} from "./radio.js";
import type { Room, RoomSnapshot, Track, User } from "./types.js";

validateServerConfig(process.env);

const port = Number(process.env.PORT || 3000);
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: true } });
const store = new Store();
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
const spotifySearchCache = new Map<string, { expiresAt: number; results: Awaited<ReturnType<SpotifyApi["searchTracks"]>> }>();
const appleMusicSearchCache = new Map<string, { expiresAt: number; results: Awaited<ReturnType<AppleMusicApi["searchTracks"]>> }>();
const providerSearchLimits = new Map<string, { count: number; resetAt: number }>();
const signupAttemptLimiter = new SignupAttemptLimiter(10, 15 * 60 * 1000);
const spotifyOauthStates = new Map<string, {
  userId: string;
  returnTo: string;
  redirectUri: string;
  expiresAt: number;
}>();

interface YouTubeSearchResult {
  id: string;
  title: string;
  channel: string;
  thumbnail: string;
  duration?: string;
  durationMs?: number;
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
  if (track.provider === "spotify" && !/^[A-Za-z0-9]{22}$/.test(track.providerId)) {
    context.addIssue({ code: "custom", path: ["providerId"], message: "Invalid Spotify track ID." });
  }
  if (track.provider === "apple" && !/^\d+$/.test(track.providerId)) {
    context.addIssue({ code: "custom", path: ["providerId"], message: "Invalid Apple Music song ID." });
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
  trackId: z.string().uuid(),
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
const spotifySearchSchema = youtubeSearchSchema;
const appleMusicSearchSchema = youtubeSearchSchema.extend({
  storefront: z.string().regex(/^[a-z]{2}$/i).optional()
});
const giphySearchSchema = z.object({
  q: z.string().trim().max(100).optional().default("")
});

const spotifyResolveSchema = z.object({
  url: z.string().trim().max(2048)
});

const appleMusicResolveSchema = z.object({
  url: z.string().trim().url().max(2048),
  storefront: z.string().regex(/^[a-z]{2}$/i).optional()
});

const spotifyPlaybackSchema = z.object({
  action: z.enum(["transfer", "play", "pause", "resume", "seek", "volume"]),
  deviceId: z.string().min(1).max(200).optional(),
  spotifyUri: z.string().regex(/^spotify:track:[A-Za-z0-9]{22}$/).optional(),
  positionMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).optional(),
  volumePercent: z.number().int().min(0).max(100).optional()
}).superRefine((value, context) => {
  if (value.action === "play" && !value.spotifyUri) {
    context.addIssue({ code: "custom", path: ["spotifyUri"], message: "A Spotify track is required." });
  }
  if (value.action === "transfer" && !value.deviceId) {
    context.addIssue({ code: "custom", path: ["deviceId"], message: "A Spotify device is required." });
  }
  if (value.action === "volume" && value.volumePercent === undefined) {
    context.addIssue({ code: "custom", path: ["volumePercent"], message: "A volume level is required." });
  }
});

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
  avatarKey: z.string().regex(/^[a-z0-9-]{2,40}$/).optional(),
  customAvatarPath: z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|gif)$/).optional(),
  themeKey: z.string().regex(/^[a-z0-9-]{2,40}$/).optional()
}).refine((value) => Object.keys(value).length > 0, "No profile changes supplied.")
  .refine((value) => !(value.avatarKey && value.customAvatarPath), "Choose an unlocked avatar or a custom upload, not both.");

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

const feedbackStatusSchema = z.object({
  status: z.enum(["new", "reviewing", "planned", "resolved", "closed"]),
  adminNote: z.string().trim().max(2000).default("")
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

function youtubeDurationMs(value?: string) {
  if (!value) return undefined;
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return undefined;
  return (Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0)) * 1000;
}

function spotifyTrackId(value: string) {
  if (/^[A-Za-z0-9]{22}$/.test(value)) return value;
  const uri = value.match(/^spotify:track:([A-Za-z0-9]{22})$/)?.[1];
  if (uri) return uri;
  try {
    const url = new URL(value);
    if (url.hostname === "open.spotify.com" || url.hostname.endsWith(".spotify.com")) {
      return url.pathname.match(/^\/(?:intl-[a-z]{2}\/)?track\/([A-Za-z0-9]{22})/i)?.[1] || null;
    }
  } catch {
    // Not a Spotify URL.
  }
  return null;
}

function appleMusicTrack(value: string) {
  try {
    const url = new URL(value);
    if (url.hostname !== "music.apple.com" && !url.hostname.endsWith(".music.apple.com")) return null;
    const storefront = url.pathname.split("/").filter(Boolean)[0]?.toLowerCase();
    const id = url.searchParams.get("i") || url.pathname.match(/\/(?:song|album)\/[^/]+\/(\d+)$/)?.[1];
    return id && /^\d+$/.test(id) ? { id, storefront } : null;
  } catch {
    return null;
  }
}

function consumeProviderSearchLimit(request: express.Request) {
  const now = Date.now();
  const rateKey = request.ip || request.socket.remoteAddress || "unknown";
  const current = providerSearchLimits.get(rateKey);
  const limit = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + 10 * 60 * 1000 }
    : current;
  if (limit.count >= 40) return false;
  limit.count += 1;
  providerSearchLimits.set(rateKey, limit);
  return true;
}

function spotifyRedirectUri(request: express.Request) {
  if (process.env.SPOTIFY_REDIRECT_URI) return process.env.SPOTIFY_REDIRECT_URI;
  const host = request.get("host") || "127.0.0.1:5173";
  const spotifySafeHost = host.replace(/^localhost(?=:|$)/i, "127.0.0.1");
  return `${request.protocol}://${spotifySafeHost}/api/spotify/callback`;
}

async function spotifyForUser<T>(userId: string, operation: (accessToken: string) => Promise<T>) {
  try {
    return await operation(await spotifyAccounts.getAccessToken(userId));
  } catch (error) {
    if ((error as Error & { status?: number }).status !== 401) throw error;
    spotifyAccounts.invalidate(userId);
    return operation(await spotifyAccounts.getAccessToken(userId));
  }
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
  const onAction = (event: string, handler: Parameters<typeof safeSocketHandler>[0]) => {
    const safe = safeSocketHandler(handler);
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
      if (access.passwordHash && !passwordMatches(password, access.passwordHash)) {
        return reply?.({
          ok: false,
          error: password ? "That room password is incorrect." : "This room needs a password.",
          requiresPassword: true
        });
      }

      const room = await store.loadRoom(roomId) ||
        store.getOrCreateLocalRoom(roomId, () => createRoom(roomId, user.id, roomName));
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
      socketRooms.set(socket.id, roomId);
      await socket.join(roomId);
      await store.saveRoom(room);
      if (!socket.connected) return;
      broadcast(room);
      reply?.({ ok: true });
    } catch (error) {
      console.error(error);
      if (socketRooms.get(socket.id) === roomId) {
        await leaveCurrentRoom(socket.id);
        await socket.leave(roomId);
      }
      const message = error instanceof Error ? error.message : "Could not load this room.";
      reply?.({
        ok: false,
        error: message.startsWith("Lydman database is not initialized")
          ? message
          : "Could not load this room."
      });
    }
  });

  onAction("room:moderator:set", async (payload, reply) => {
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

  onAction("room:dj-role:set", async (payload, reply) => {
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

  onAction("dj:join", async (_payload, reply) => {
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

  onAction("dj:leave", async (_payload, reply) => {
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

  onAction("queue:add", async (payload, reply) => {
    let membership = getMembership(socket.id);
    const parsed = trackSchema.safeParse(payload);
    if (!membership || !parsed.success) return reply?.({ ok: false, error: "Invalid track." });
    if (!membership.room.djQueueUserIds.includes(membership.user.id)) {
      return reply?.({ ok: false, error: "Join the DJ queue before adding tracks." });
    }
    const originalMembership = membership;
    const resolved = await resolveTrackMappings(parsed.data, spotifyApi, appleMusicApi);
    membership = getMembership(socket.id);
    if (!socket.connected || !membership || membership.room !== originalMembership.room ||
        membership.user.id !== originalMembership.user.id ||
        !membership.room.djQueueUserIds.includes(membership.user.id)) {
      return reply?.({ ok: false, error: "Your room or DJ membership changed. Try again from your current room." });
    }
    if (
      (membership.room.playback.track?.provider === parsed.data.provider &&
      membership.room.playback.track.providerId === parsed.data.providerId) ||
      (resolved.canonicalId && membership.room.playback.track?.canonicalId === resolved.canonicalId)
    ) {
      return reply?.({ ok: false, error: "That track is already playing." });
    }
    const queue = privateQueue(membership.room, membership.user.id);
    const duplicateIndex = queue.findIndex(
      (track) =>
        (track.provider === parsed.data.provider && track.providerId === parsed.data.providerId) ||
        Boolean(resolved.canonicalId && track.canonicalId === resolved.canonicalId)
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
      ...resolved,
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

  onAction("queue:remove", async (payload, reply) => {
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

  onAction("queue:play-next", async (payload, reply) => {
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

  onAction("queue:move", async (payload, reply) => {
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

  onAction("queue:next", async (payload, reply) => {
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

  onAction("playback:update", async (payload, reply) => {
    const membership = getMembership(socket.id);
    const parsed = playbackSchema.safeParse(payload);
    if (!membership || !canControlPlayback(membership.room, membership.user.id)) {
      return reply?.({ ok: false, error: "Only the current DJ or a room moderator controls playback." });
    }
    if (!parsed.success || !membership.room.playback.track || membership.room.playback.track.id !== parsed.data.trackId) {
      return reply?.({ ok: false, error: "Invalid playback update." });
    }
    membership.room.playback = {
      ...membership.room.playback,
      playing: parsed.data.playing,
      position: parsed.data.position,
      updatedAt: Date.now()
    };
    await store.saveRoom(membership.room);
    broadcast(membership.room);
    reply?.({ ok: true });
  });

  onAction("vibe:vote", async (payload, reply) => {
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
    await store.saveRoom(membership.room);
    broadcast(membership.room);
    reply?.({ ok: true });
  });

  socket.on("disconnect", () => { void leaveCurrentRoom(socket.id).catch(console.error); });
});

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.get("/api/admin/dashboard", async (request, response) => {
  response.set("Cache-Control", "no-store");
  try {
    const admin = await getApiAdminUserId(request);
    if (!admin.ok) return response.status(admin.status).json({ error: admin.error });
    if (!supabaseAdmin) return response.status(503).json({ error: "Admin data is unavailable." });

    const activityStart = new Date();
    activityStart.setUTCHours(0, 0, 0, 0);
    activityStart.setUTCDate(activityStart.getUTCDate() - 13);
    const activityStartIso = activityStart.toISOString();

    const [
      userCount,
      roomCount,
      feedbackCount,
      openFeedbackCount,
      messageCount,
      feedbackResult,
      roomResult,
      recentUsers,
      recentFeedback,
      recentMessages
    ] = await Promise.all([
      supabaseAdmin.from("soundspin_profiles").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("soundspin_rooms").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("soundspin_feedback").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("soundspin_feedback").select("*", { count: "exact", head: true }).in("status", ["new", "reviewing", "planned"]),
      supabaseAdmin.from("soundspin_messages").select("*", { count: "exact", head: true }),
      supabaseAdmin
        .from("soundspin_feedback")
        .select("id, user_id, message, screenshot_paths, room_slug, page_path, viewport, category, impact, diagnostics, status, admin_note, created_at, updated_at")
        .order("created_at", { ascending: false })
        .limit(100),
      supabaseAdmin
        .from("soundspin_rooms")
        .select("slug, name, owner_id, is_public, created_at, updated_at")
        .order("updated_at", { ascending: false })
        .limit(50),
      supabaseAdmin.from("soundspin_profiles").select("created_at").gte("created_at", activityStartIso),
      supabaseAdmin.from("soundspin_feedback").select("created_at").gte("created_at", activityStartIso),
      supabaseAdmin.from("soundspin_messages").select("created_at").gte("created_at", activityStartIso)
    ]);

    const queryError = [
      userCount.error,
      roomCount.error,
      feedbackCount.error,
      openFeedbackCount.error,
      messageCount.error,
      feedbackResult.error,
      roomResult.error,
      recentUsers.error,
      recentFeedback.error,
      recentMessages.error
    ].find(Boolean);
    if (queryError) throw queryError;

    const feedback = feedbackResult.data || [];
    const userIds = [...new Set(feedback.map((item) => item.user_id))];
    const profileResult = userIds.length
      ? await supabaseAdmin.from("soundspin_profiles").select("user_id, display_name, avatar_key, avatar_url").in("user_id", userIds)
      : { data: [], error: null };
    if (profileResult.error) throw profileResult.error;
    const profiles = new Map((profileResult.data || []).map((item) => [item.user_id, item]));

    const screenshotPaths = feedback.flatMap((item) => item.screenshot_paths || []);
    const signedResult = screenshotPaths.length
      ? await supabaseAdmin.storage.from("feedback-screenshots").createSignedUrls(screenshotPaths, 15 * 60)
      : { data: [], error: null };
    if (signedResult.error) throw signedResult.error;
    const signedUrls = new Map((signedResult.data || []).map((item) => [item.path, item.signedUrl]));

    const activity = Array.from({ length: 14 }, (_, index) => {
      const date = new Date(activityStart);
      date.setUTCDate(activityStart.getUTCDate() + index);
      return { date: date.toISOString().slice(0, 10), users: 0, feedback: 0, messages: 0 };
    });
    const activityByDate = new Map(activity.map((item) => [item.date, item]));
    for (const item of recentUsers.data || []) {
      const bucket = activityByDate.get(item.created_at.slice(0, 10));
      if (bucket) bucket.users += 1;
    }
    for (const item of recentFeedback.data || []) {
      const bucket = activityByDate.get(item.created_at.slice(0, 10));
      if (bucket) bucket.feedback += 1;
    }
    for (const item of recentMessages.data || []) {
      const bucket = activityByDate.get(item.created_at.slice(0, 10));
      if (bucket) bucket.messages += 1;
    }

    response.json({
      metrics: {
        users: userCount.count || 0,
        rooms: roomCount.count || 0,
        feedback: feedbackCount.count || 0,
        openFeedback: openFeedbackCount.count || 0,
        messages: messageCount.count || 0
      },
      activity,
      feedback: feedback.map((item) => ({
        id: item.id,
        userId: item.user_id,
        userName: profiles.get(item.user_id)?.display_name || "Unknown listener",
        userAvatarUrl: profiles.get(item.user_id)?.avatar_url || null,
        message: item.message,
        roomSlug: item.room_slug,
        pagePath: item.page_path,
        viewport: item.viewport,
        category: item.category,
        impact: item.impact,
        diagnostics: item.diagnostics,
        status: item.status,
        adminNote: item.admin_note,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        screenshots: (item.screenshot_paths || []).map((path: string) => ({ path, url: signedUrls.get(path) || null }))
      })),
      rooms: (roomResult.data || []).map((room) => ({
        slug: room.slug,
        name: room.name,
        isPublic: room.is_public,
        listenerCount: uniqueUsers(roomUsers.get(room.slug)?.values() || []).length,
        createdAt: room.created_at,
        updatedAt: room.updated_at
      }))
    });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Could not load admin data." });
  }
});

app.patch("/api/admin/feedback/:feedbackId", express.json({ limit: "8kb" }), async (request, response) => {
  response.set("Cache-Control", "no-store");
  try {
    const admin = await getApiAdminUserId(request);
    if (!admin.ok) return response.status(admin.status).json({ error: admin.error });
    if (!supabaseAdmin) return response.status(503).json({ error: "Admin data is unavailable." });

    const feedbackId = z.string().uuid().safeParse(request.params.feedbackId);
    const update = feedbackStatusSchema.safeParse(request.body);
    if (!feedbackId.success || !update.success) {
      return response.status(400).json({ error: update.success ? "Invalid feedback item." : update.error.issues[0]?.message });
    }

    const { data, error } = await supabaseAdmin
      .from("soundspin_feedback")
      .update({
        status: update.data.status,
        admin_note: update.data.adminNote,
        updated_at: new Date().toISOString()
      })
      .eq("id", feedbackId.data)
      .select("id, status, admin_note, updated_at")
      .maybeSingle();
    if (error) throw error;
    if (!data) return response.status(404).json({ error: "Feedback item not found." });
    response.json({
      feedback: {
        id: data.id,
        status: data.status,
        adminNote: data.admin_note,
        updatedAt: data.updated_at
      }
    });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Could not update feedback." });
  }
});

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
    const durations = new Map<string, { label: string; milliseconds?: number }>();
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
          if (duration) durations.set(video.id, { label: duration, milliseconds: youtubeDurationMs(video.contentDetails?.duration) });
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
      duration: durations.get(item.id.videoId!)?.label,
      durationMs: durations.get(item.id.videoId!)?.milliseconds
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

app.get("/api/spotify/search", async (request, response) => {
  if (authEnabled && !(await getApiUserId(request))) {
    return response.status(401).json({ error: "Authentication required." });
  }
  if (!spotifyApi.configured) return response.status(503).json({ error: "Spotify is not configured yet." });
  const parsed = spotifySearchSchema.safeParse(request.query);
  if (!parsed.success) return response.status(400).json({ error: "Enter at least 2 characters to search." });
  if (!consumeProviderSearchLimit(request)) return response.status(429).json({ error: "Too many searches. Please try again shortly." });
  const key = parsed.data.q.toLocaleLowerCase();
  const cached = spotifySearchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return response.json({ results: cached.results });
  try {
    const results = await spotifyApi.searchTracks(parsed.data.q);
    spotifySearchCache.set(key, { results, expiresAt: Date.now() + 5 * 60 * 1000 });
    response.json({ results });
  } catch (error) {
    console.error("Spotify search failed", error);
    response.status(502).json({ error: error instanceof Error ? error.message : "Spotify search failed." });
  }
});

app.get("/api/spotify/resolve", async (request, response) => {
  if (authEnabled && !(await getApiUserId(request))) {
    return response.status(401).json({ error: "Authentication required." });
  }
  if (!spotifyApi.configured) return response.status(503).json({ error: "Spotify is not configured yet." });
  const parsed = spotifyResolveSchema.safeParse(request.query);
  const id = parsed.success ? spotifyTrackId(parsed.data.url) : null;
  if (!id) return response.status(400).json({ error: "Enter a valid Spotify track URL or URI." });
  try {
    response.json({ result: await spotifyApi.getTrack(id) });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Could not resolve that Spotify URL." });
  }
});

app.get("/api/apple/search", async (request, response) => {
  if (authEnabled && !(await getApiUserId(request))) {
    return response.status(401).json({ error: "Authentication required." });
  }
  if (!appleMusicApi.configured) return response.status(503).json({ error: "Apple Music is not configured yet." });
  const parsed = appleMusicSearchSchema.safeParse(request.query);
  if (!parsed.success) return response.status(400).json({ error: "Enter at least 2 characters to search." });
  if (!consumeProviderSearchLimit(request)) return response.status(429).json({ error: "Too many searches. Please try again shortly." });
  const storefront = parsed.data.storefront?.toLowerCase() || appleMusicApi.storefront;
  const key = `${storefront}:${parsed.data.q.toLocaleLowerCase()}`;
  const cached = appleMusicSearchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return response.json({ results: cached.results });
  try {
    const results = await appleMusicApi.searchTracks(parsed.data.q, 12, storefront);
    appleMusicSearchCache.set(key, { results, expiresAt: Date.now() + 5 * 60 * 1000 });
    response.json({ results });
  } catch (error) {
    console.error("Apple Music search failed", error);
    response.status(502).json({ error: error instanceof Error ? error.message : "Apple Music search failed." });
  }
});

app.get("/api/apple/resolve", async (request, response) => {
  if (authEnabled && !(await getApiUserId(request))) {
    return response.status(401).json({ error: "Authentication required." });
  }
  if (!appleMusicApi.configured) return response.status(503).json({ error: "Apple Music is not configured yet." });
  const parsed = appleMusicResolveSchema.safeParse(request.query);
  const resolved = parsed.success ? appleMusicTrack(parsed.data.url) : null;
  if (!resolved) return response.status(400).json({ error: "Enter a valid Apple Music song URL." });
  try {
    response.json({
      result: await appleMusicApi.getTrack(
        resolved.id,
        parsed.success ? parsed.data.storefront?.toLowerCase() || resolved.storefront || appleMusicApi.storefront : appleMusicApi.storefront
      )
    });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Could not resolve that Apple Music URL." });
  }
});

app.get("/api/giphy", async (request, response) => {
  if (authEnabled && !(await getApiUserId(request))) {
    return response.status(401).json({ error: "Authentication required." });
  }
  if (!giphyApi.configured) {
    return response.status(503).json({ error: "GIPHY is not configured yet." });
  }
  const parsed = giphySearchSchema.safeParse(request.query);
  if (!parsed.success) {
    return response.status(400).json({ error: "GIF searches must be 100 characters or fewer." });
  }
  if (!consumeProviderSearchLimit(request)) {
    return response.status(429).json({ error: "Too many searches. Please try again shortly." });
  }

  try {
    response.json({ results: await giphyApi.gifs(parsed.data.q) });
  } catch (error) {
    console.error("GIPHY request failed", error);
    response.status(502).json({
      error: error instanceof Error ? error.message : "Could not load GIFs."
    });
  }
});

app.get("/api/music/connections", async (request, response) => {
  const userId = await getApiUserId(request);
  if (!userId) return response.status(401).json({ error: "Authentication required." });
  try {
    const spotifyConnected = spotifyAccounts.configured ? await spotifyAccounts.connected(userId) : false;
    let spotifyProfile: { displayName: string; product?: string } | null = null;
    if (spotifyConnected) {
      try {
        const profile = await spotifyForUser(userId, (token) => spotifyApi.request<{
          display_name?: string;
          product?: string;
        }>(token, "/me"));
        spotifyProfile = { displayName: profile.display_name || "Spotify account", product: profile.product };
      } catch {
        // The saved connection remains useful even when profile metadata is temporarily unavailable.
      }
    }
    response.json({
      spotify: {
        configured: spotifyAccounts.configured,
        connected: spotifyConnected,
        profile: spotifyProfile
      },
      apple: { configured: appleMusicApi.configured }
    });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Could not load music connections." });
  }
});

app.get("/api/spotify/connect", async (request, response) => {
  const userId = await getApiUserId(request);
  if (!userId) return response.status(401).json({ error: "Authentication required." });
  if (!spotifyAccounts.configured) {
    return response.status(503).json({ error: "Spotify OAuth or provider-token encryption is not configured yet." });
  }
  const returnToValue = z.string().max(2048).safeParse(request.query.returnTo);
  const returnTo = returnToValue.success && returnToValue.data.startsWith("/") && !returnToValue.data.startsWith("//")
    ? returnToValue.data
    : "/";
  const state = crypto.randomBytes(24).toString("base64url");
  const redirectUri = spotifyRedirectUri(request);
  spotifyOauthStates.set(state, { userId, returnTo, redirectUri, expiresAt: Date.now() + 10 * 60 * 1000 });
  response.json({ url: spotifyApi.authorizationUrl(redirectUri, state) });
});

app.get("/api/spotify/callback", async (request, response) => {
  const stateValue = z.string().min(1).safeParse(request.query.state);
  const codeValue = z.string().min(1).safeParse(request.query.code);
  const oauth = stateValue.success ? spotifyOauthStates.get(stateValue.data) : undefined;
  if (stateValue.success) spotifyOauthStates.delete(stateValue.data);
  if (!oauth || oauth.expiresAt < Date.now()) return response.status(400).send("Spotify authorization expired. Return to Lydman and try again.");
  if (!codeValue.success) return response.redirect(`${oauth.returnTo}${oauth.returnTo.includes("?") ? "&" : "?"}spotify=denied`);
  try {
    await spotifyAccounts.connect(oauth.userId, codeValue.data, oauth.redirectUri);
    response.redirect(`${oauth.returnTo}${oauth.returnTo.includes("?") ? "&" : "?"}spotify=connected`);
  } catch (error) {
    console.error("Spotify callback failed", error);
    response.redirect(`${oauth.returnTo}${oauth.returnTo.includes("?") ? "&" : "?"}spotify=error`);
  }
});

app.delete("/api/spotify/connection", async (request, response) => {
  const userId = await getApiUserId(request);
  if (!userId) return response.status(401).json({ error: "Authentication required." });
  try {
    await spotifyAccounts.disconnect(userId);
    response.status(204).end();
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Could not disconnect Spotify." });
  }
});

app.get("/api/spotify/token", async (request, response) => {
  const userId = await getApiUserId(request);
  if (!userId) return response.status(401).json({ error: "Authentication required." });
  try {
    response.json({ accessToken: await spotifyAccounts.getAccessToken(userId) });
  } catch (error) {
    response.status(401).json({ error: error instanceof Error ? error.message : "Connect Spotify first." });
  }
});

app.get("/api/spotify/devices", async (request, response) => {
  const userId = await getApiUserId(request);
  if (!userId) return response.status(401).json({ error: "Authentication required." });
  try {
    response.json(await spotifyForUser(userId, (token) => spotifyApi.request(token, "/me/player/devices")));
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : "Could not load Spotify devices." });
  }
});

app.get("/api/spotify/playback", async (request, response) => {
  const userId = await getApiUserId(request);
  if (!userId) return response.status(401).json({ error: "Authentication required." });
  try {
    const state = await spotifyForUser(userId, (token) => spotifyApi.request(token, "/me/player"));
    response.json({ state });
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : "Could not read Spotify playback." });
  }
});

app.post("/api/spotify/playback", express.json(), async (request, response) => {
  const userId = await getApiUserId(request);
  if (!userId) return response.status(401).json({ error: "Authentication required." });
  const parsed = spotifyPlaybackSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid playback command." });
  const { action, deviceId, spotifyUri, positionMs, volumePercent } = parsed.data;
  const device = deviceId ? `?${new URLSearchParams({ device_id: deviceId })}` : "";
  try {
    await spotifyForUser(userId, async (token) => {
      if (action === "transfer") {
        return spotifyApi.request(token, "/me/player", {
          method: "PUT",
          body: JSON.stringify({ device_ids: [deviceId], play: false })
        });
      }
      if (action === "play") {
        return spotifyApi.request(token, `/me/player/play${device}`, {
          method: "PUT",
          body: JSON.stringify({ uris: [spotifyUri], position_ms: positionMs || 0 })
        });
      }
      if (action === "pause") return spotifyApi.request(token, `/me/player/pause${device}`, { method: "PUT" });
      if (action === "resume") return spotifyApi.request(token, `/me/player/play${device}`, { method: "PUT" });
      if (action === "volume") {
        const params = new URLSearchParams({ volume_percent: String(volumePercent) });
        if (deviceId) params.set("device_id", deviceId);
        return spotifyApi.request(token, `/me/player/volume?${params}`, { method: "PUT" });
      }
      const params = new URLSearchParams({ position_ms: String(positionMs || 0) });
      if (deviceId) params.set("device_id", deviceId);
      return spotifyApi.request(token, `/me/player/seek?${params}`, { method: "PUT" });
    });
    response.status(204).end();
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : "Spotify playback failed." });
  }
});

app.get("/api/apple/token", async (request, response) => {
  if (authEnabled && !(await getApiUserId(request))) {
    return response.status(401).json({ error: "Authentication required." });
  }
  if (!appleMusicApi.configured) return response.status(503).json({ error: "Apple Music is not configured yet." });
  try {
    response.json({ developerToken: appleMusicApi.getDeveloperToken(), storefront: appleMusicApi.storefront });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Could not create an Apple Music token." });
  }
});

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
  const publicDir = path.resolve(dirname, "../dist");
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
