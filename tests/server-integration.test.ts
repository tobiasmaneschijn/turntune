import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import test from "node:test";
import { io, type Socket } from "socket.io-client";
import type { RoomSnapshot } from "../src/types.js";

test("two listeners can join, manage private queues, skip idempotently and reconnect", { timeout: 20_000 }, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "soundspin-integration-"));
  const env = { ...process.env, PORT: "0", HOST: "127.0.0.1", DATA_DIR: directory, NODE_ENV: "test" };
  for (const key of Object.keys(env)) {
    if (/^(SUPABASE_|VITE_|SPOTIFY_|SOUNDCLOUD_|APPLE_MUSIC_|PROVIDER_TOKEN_|SIGNUP_|YOUTUBE_|GIPHY_)/.test(key)) {
      delete (env as NodeJS.ProcessEnv)[key];
    }
  }
  const server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], { env, stdio: ["ignore", "pipe", "pipe"] });
  const sockets: Socket[] = [];
  t.after(async () => {
    for (const socket of sockets) socket.disconnect();
    if (server.exitCode === null) {
      const exited = once(server, "exit");
      server.kill();
      await exited;
    }
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("soundspin-integration-"));
    await rm(directory, { recursive: true, force: true });
  });
  const url = await new Promise<string>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Local test server did not start")), 8_000);
    server.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/Lydman listening on (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    server.once("error", (error) => { clearTimeout(timer); reject(error); });
    server.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Local test server exited (${code})`)); });
  });
  assert.equal((await fetch(`${url}/api/health`)).status, 200);
  const missing = await fetch(`${url}/api/not-a-real-endpoint`);
  assert.equal(missing.status, 404);
  assert.ok((await missing.json() as { error: string }).error);
  const malformed = await fetch(`${url}/api/signup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
  assert.equal(malformed.status, 400);
  assert.ok((await malformed.json() as { error: string }).error);

  const connect = async () => {
    const socket = io(url, { autoConnect: false, reconnection: false, transports: ["websocket"] });
    sockets.push(socket);
    const connected = once(socket, "connect");
    socket.connect();
    await connected;
    return socket;
  };
  const action = (socket: Socket, event: string, payload?: unknown) => socket.timeout(3_000).emitWithAck(event, payload) as Promise<{ ok: boolean; error?: string }>;
  const alice = await connect();
  const bob = await connect();
  let aliceState!: RoomSnapshot;
  let bobState!: RoomSnapshot;
  alice.on("room:snapshot", (snapshot: RoomSnapshot) => { aliceState = snapshot; });
  bob.on("room:snapshot", (snapshot: RoomSnapshot) => { bobState = snapshot; });
  const join = (socket: Socket, id: string) => action(socket, "room:join", {
    roomId: "integration-room", user: { id, name: id, avatarSeed: id }
  });
  const joins = await Promise.all([join(alice, "alice"), join(bob, "bob")]);
  assert.ok(joins.every((result) => result.ok));
  assert.equal(aliceState.room.ownerUserId, bobState.room.ownerUserId);
  assert.equal(bobState.users.length, 2);
  assert.equal((await action(alice, "dj:join")).ok, true);
  assert.equal((await action(bob, "dj:join")).ok, true);
  const track = (providerId: string) => ({ provider: "youtube", providerId, title: "Test recording" });
  assert.equal((await action(alice, "queue:add", track("abcdefghijk"))).ok, true);
  assert.equal((await action(alice, "queue:add", track("lmnopqrstuv"))).ok, true);
  assert.equal(aliceState.room.queue.length, 1);
  assert.equal(bobState.room.queue.length, 0);
  assert.equal((await action(bob, "queue:add", track("wxyzABCDEFG"))).ok, true);
  const endedTrack = aliceState.room.playback.track!.id;
  assert.equal((await action(alice, "playback:update", { trackId: endedTrack, playing: false, position: 4 })).ok, true);
  assert.equal(aliceState.room.playback.playing, false);
  assert.equal((await action(alice, "queue:next", { trackId: endedTrack })).ok, true);
  const nextTrack = aliceState.room.playback.track!.id;
  assert.notEqual(nextTrack, endedTrack);
  assert.equal((await action(alice, "queue:next", { trackId: endedTrack })).ok, false);
  assert.equal(aliceState.room.playback.track!.id, nextTrack);
  assert.equal((await action(alice, "playback:update", { trackId: endedTrack, playing: false, position: 8 })).ok, false);
  assert.equal(aliceState.room.playback.playing, true);
  assert.equal((await action(alice, "queue:move", { trackId: "invalid", toIndex: -1 })).ok, false);
  bob.disconnect();
  const reconnected = await connect();
  let recovered!: RoomSnapshot;
  reconnected.on("room:snapshot", (snapshot: RoomSnapshot) => { recovered = snapshot; });
  assert.equal((await join(reconnected, "bob")).ok, true);
  assert.equal(recovered.room.playback.track!.id, nextTrack);
  assert.ok(recovered.room.djQueueUserIds.includes("bob"));
});
