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
const authEnabled = Boolean(
  supabaseUrl &&
  supabasePublishableKey &&
  supabaseSecretKey &&
  supabaseJwksUrl &&
  store.usesSupabase
);
const roomUsers = new Map<string, Map<string, User>>();
const socketRooms = new Map<string, string>();
const youtubeSearchCache = new Map<string, {
  expiresAt: number;
  results: YouTubeSearchResult[];
}>();
const youtubeSearchLimits = new Map<string, { count: number; resetAt: number }>();

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
  user: userSchema
});

const trackSchema = z.object({
  provider: z.enum(["youtube", "spotify", "apple"]),
  providerId: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(120)
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

const vibeVoteSchema = z.object({
  value: z.union([z.literal(-1), z.literal(0), z.literal(1)])
});

const youtubeSearchSchema = z.object({
  q: z.string().trim().min(2).max(100)
});

const profileUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(32).optional(),
  bio: z.string().trim().max(160).optional(),
  avatarKey: z.string().regex(/^[a-z0-9-]{2,40}$/).optional()
}).refine((value) => Object.keys(value).length > 0, "No profile changes supplied.");

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
    djUserId: null,
    queue: [],
    history: [],
    playback: { track: null, playing: false, position: 0, updatedAt: Date.now() },
    vibe: null,
    createdAt: Date.now()
  };
}

function snapshot(room: Room): RoomSnapshot {
  return {
    room,
    users: [...(roomUsers.get(room.id)?.values() || [])],
    serverTime: Date.now()
  };
}

function broadcast(room: Room) {
  io.to(room.id).emit("room:snapshot", snapshot(room));
}

function getMembership(socketId: string) {
  const roomId = socketRooms.get(socketId);
  if (!roomId) return null;
  const room = store.getRoom(roomId);
  const user = roomUsers.get(roomId)?.get(socketId);
  return room && user ? { room, user } : null;
}

function leaveCurrentRoom(socketId: string) {
  const roomId = socketRooms.get(socketId);
  if (!roomId) return;
  socketRooms.delete(socketId);
  const users = roomUsers.get(roomId);
  const leavingUser = users?.get(socketId);
  users?.delete(socketId);
  const room = store.getRoom(roomId);
  if (!room) return;
  if (leavingUser?.id === room.djUserId) {
    room.djUserId = users?.values().next().value?.id || null;
    void store.saveRoom(room);
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

    for (const joinedRoom of socket.rooms) {
      if (joinedRoom !== socket.id) await socket.leave(joinedRoom);
    }
    leaveCurrentRoom(socket.id);
    const { roomId, roomName } = parsed.data;
    let user: User = {
      ...parsed.data.user,
      id: authEnabled ? socket.data.authUserId : parsed.data.user.id
    };

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
      const room = await store.loadRoom(roomId) || createRoom(roomId, user.id, roomName);
      if (!room.ownerUserId) room.ownerUserId = user.id;
      if (!room.history) room.history = [];
      if (room.vibe === undefined) room.vibe = null;
      if (room.vibe && room.playback.track && room.vibe.trackId === room.playback.track.id) {
        delete room.vibe.votes[room.playback.track.addedBy.id];
      }
      if (room.ownerUserId === user.id || !room.djUserId) room.djUserId = user.id;
      await store.saveRoom(room);

      if (!roomUsers.has(roomId)) roomUsers.set(roomId, new Map());
      roomUsers.get(roomId)!.set(socket.id, user);
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

  socket.on("queue:add", async (payload, reply) => {
    const membership = getMembership(socket.id);
    const parsed = trackSchema.safeParse(payload);
    if (!membership || !parsed.success) return reply?.({ ok: false, error: "Invalid track." });
    if (parsed.data.provider !== "youtube") {
      return reply?.({ ok: false, error: "That provider is not enabled yet." });
    }
    if (
      membership.room.playback.track?.provider === parsed.data.provider &&
      membership.room.playback.track.providerId === parsed.data.providerId
    ) {
      return reply?.({ ok: false, error: "That track is already playing." });
    }
    const duplicateIndex = membership.room.queue.findIndex(
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
    membership.room.queue.push(track);
    const startedPlaying = !membership.room.playback.track;
    if (startedPlaying) {
      membership.room.playback = {
        track: membership.room.queue.shift()!,
        playing: false,
        position: 0,
        updatedAt: Date.now()
      };
      membership.room.vibe = {
        trackId: track.id,
        votes: {}
      };
    }
    await store.saveRoom(membership.room);
    broadcast(membership.room);
    reply?.({
      ok: true,
      started: startedPlaying,
      position: startedPlaying ? 0 : membership.room.queue.length
    });
  });

  socket.on("queue:remove", async (payload, reply) => {
    const membership = getMembership(socket.id);
    const parsed = queueTrackSchema.safeParse(payload);
    if (!membership || !parsed.success) {
      return reply?.({ ok: false, error: "Invalid queue item." });
    }
    const index = membership.room.queue.findIndex((track) => track.id === parsed.data.trackId);
    if (index < 0) return reply?.({ ok: false, error: "Track not found." });
    const track = membership.room.queue[index];
    const canRemove =
      track.addedBy.id === membership.user.id ||
      membership.room.djUserId === membership.user.id ||
      membership.room.ownerUserId === membership.user.id;
    if (!canRemove) {
      return reply?.({ ok: false, error: "You can only remove tracks you added." });
    }
    membership.room.queue.splice(index, 1);
    await store.saveRoom(membership.room);
    broadcast(membership.room);
    reply?.({ ok: true });
  });

  socket.on("queue:play-next", async (payload, reply) => {
    const membership = getMembership(socket.id);
    const parsed = queueTrackSchema.safeParse(payload);
    if (!membership || membership.room.djUserId !== membership.user.id) {
      return reply?.({ ok: false, error: "Only the DJ can change the queue order." });
    }
    if (!parsed.success) return reply?.({ ok: false, error: "Invalid queue item." });
    const index = membership.room.queue.findIndex((track) => track.id === parsed.data.trackId);
    if (index < 0) return reply?.({ ok: false, error: "Track not found." });
    const [track] = membership.room.queue.splice(index, 1);
    membership.room.queue.unshift(track);
    await store.saveRoom(membership.room);
    broadcast(membership.room);
    reply?.({ ok: true });
  });

  socket.on("queue:move", async (payload, reply) => {
    const membership = getMembership(socket.id);
    const parsed = queueMoveSchema.safeParse(payload);
    if (!membership || membership.room.djUserId !== membership.user.id) {
      return reply?.({ ok: false, error: "Only the DJ can reorder the queue." });
    }
    if (!parsed.success) return reply?.({ ok: false, error: "Invalid queue move." });
    const fromIndex = membership.room.queue.findIndex((track) => track.id === parsed.data.trackId);
    if (fromIndex < 0) return reply?.({ ok: false, error: "Track not found." });
    const [track] = membership.room.queue.splice(fromIndex, 1);
    const toIndex = Math.min(parsed.data.toIndex, membership.room.queue.length);
    membership.room.queue.splice(toIndex, 0, track);
    await store.saveRoom(membership.room);
    broadcast(membership.room);
    reply?.({ ok: true });
  });

  socket.on("queue:play", async (trackId, reply) => {
    const membership = getMembership(socket.id);
    if (!membership || membership.room.djUserId !== membership.user.id) {
      return reply?.({ ok: false, error: "Only the DJ can change tracks." });
    }
    const index = membership.room.queue.findIndex((track) => track.id === trackId);
    if (index < 0) return reply?.({ ok: false, error: "Track not found." });
    const [track] = membership.room.queue.splice(index, 1);
    if (membership.room.playback.track) {
      membership.room.history.unshift(membership.room.playback.track);
      membership.room.history = membership.room.history.slice(0, 100);
    }
    membership.room.playback = { track, playing: true, position: 0, updatedAt: Date.now() };
    membership.room.vibe = { trackId: track.id, votes: {} };
    await store.saveRoom(membership.room);
    broadcast(membership.room);
    reply?.({ ok: true });
  });

  socket.on("queue:next", async (_payload, reply) => {
    const membership = getMembership(socket.id);
    if (!membership || membership.room.djUserId !== membership.user.id) {
      return reply?.({ ok: false, error: "Only the DJ can skip tracks." });
    }
    const track = membership.room.queue.shift() || null;
    if (membership.room.playback.track) {
      membership.room.history.unshift(membership.room.playback.track);
      membership.room.history = membership.room.history.slice(0, 100);
    }
    membership.room.playback = { track, playing: Boolean(track), position: 0, updatedAt: Date.now() };
    membership.room.vibe = track ? { trackId: track.id, votes: {} } : null;
    await store.saveRoom(membership.room);
    broadcast(membership.room);
    reply?.({ ok: true });
  });

  socket.on("playback:update", async (payload, reply) => {
    const membership = getMembership(socket.id);
    const parsed = playbackSchema.safeParse(payload);
    if (!membership || membership.room.djUserId !== membership.user.id) {
      return reply?.({ ok: false, error: "Only the DJ controls playback." });
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

  socket.on("disconnect", () => leaveCurrentRoom(socket.id));
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
