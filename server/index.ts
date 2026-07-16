import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServer } from "node:http";
import { verifyCredentials } from "@supabase/server/core";
import { Server } from "socket.io";
import { z } from "zod";
import { Store } from "./store.js";
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
const authEnabled = Boolean(
  supabaseUrl &&
  supabasePublishableKey &&
  supabaseSecretKey &&
  supabaseJwksUrl &&
  store.usesSupabase
);
const roomUsers = new Map<string, Map<string, User>>();
const socketRooms = new Map<string, string>();

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

function createRoom(id: string, ownerUserId: string, name?: string): Room {
  return {
    id,
    name: name || id.replaceAll("-", " "),
    ownerUserId,
    djUserId: null,
    queue: [],
    playback: { track: null, playing: false, position: 0, updatedAt: Date.now() },
    messages: [],
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
    const user = {
      ...parsed.data.user,
      id: authEnabled ? socket.data.authUserId : parsed.data.user.id
    };

    try {
      const room = await store.loadRoom(roomId) || createRoom(roomId, user.id, roomName);
      if (!room.ownerUserId) room.ownerUserId = user.id;
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
      reply?.({ ok: false, error: "Could not load this room." });
    }
  });

  socket.on("queue:add", async (payload, reply) => {
    const membership = getMembership(socket.id);
    const parsed = trackSchema.safeParse(payload);
    if (!membership || !parsed.success) return reply?.({ ok: false, error: "Invalid track." });
    if (parsed.data.provider !== "youtube") {
      return reply?.({ ok: false, error: "That provider is not enabled yet." });
    }
    const track: Track = {
      id: crypto.randomUUID(),
      ...parsed.data,
      addedBy: membership.user,
      addedAt: Date.now()
    };
    membership.room.queue.push(track);
    if (!membership.room.playback.track) {
      membership.room.playback = {
        track: membership.room.queue.shift()!,
        playing: false,
        position: 0,
        updatedAt: Date.now()
      };
    }
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
    membership.room.playback = { track, playing: true, position: 0, updatedAt: Date.now() };
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
    membership.room.playback = { track, playing: Boolean(track), position: 0, updatedAt: Date.now() };
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

  socket.on("chat:send", async (text, reply) => {
    const membership = getMembership(socket.id);
    const parsed = z.string().trim().min(1).max(500).safeParse(text);
    if (!membership || !parsed.success) {
      return reply?.({ ok: false, error: "Message must be between 1 and 500 characters." });
    }
    membership.room.messages.push({
      id: crypto.randomUUID(),
      user: membership.user,
      text: parsed.data,
      sentAt: Date.now()
    });
    membership.room.messages = membership.room.messages.slice(-200);
    await store.saveRoom(membership.room);
    broadcast(membership.room);
    reply?.({ ok: true });
  });

  socket.on("disconnect", () => leaveCurrentRoom(socket.id));
});

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.get("/api/config", (_request, response) => {
  response.json({
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
