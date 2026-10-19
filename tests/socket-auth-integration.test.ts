import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { io, type Socket } from "socket.io-client";
import type { RoomSnapshot } from "../shared/types.js";

test("the real socket enforces signed actor claims, expiry, refreshed identity and platform restrictions", { timeout: 45_000 }, async (t) => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), alg: "RS256", kid: "socket-test", use: "sig" };
  const verifiedUserId = "11111111-1111-4111-8111-111111111111";
  const token = (expiresAt: number, overrides: Record<string, unknown> = {}) => {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${encode({ alg: "RS256", typ: "JWT", kid: jwk.kid })}.${encode({ sub: verifiedUserId, iss: "https://soundspin-socket-auth.invalid/auth/v1", aud: "authenticated", role: "authenticated", exp: expiresAt, ...overrides })}`;
    return `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url")}`;
  };
  const directory = await mkdtemp(path.join(os.tmpdir(), "soundspin-socket-auth-"));
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(SUPABASE_|VITE_|SPOTIFY_|SOUNDCLOUD_|APPLE_MUSIC_|PROVIDER_TOKEN_|SIGNUP_|YOUTUBE_|GIPHY_)/.test(key)) delete env[key];
  }
  delete env.NODE_OPTIONS;
  Object.assign(env, { PORT: "0", HOST: "127.0.0.1", NODE_ENV: "test", DATA_DIR: directory,
    SUPABASE_URL: "https://soundspin-socket-auth.invalid", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_socket_fixture",
    SUPABASE_SECRET_KEY: "sb_secret_socket_fixture", SUPABASE_JWKS_URL: "https://soundspin-socket-auth.invalid/auth/v1/.well-known/jwks.json",
    SUPABASE_JWKS: JSON.stringify({ keys: [jwk] }) });
  const server = spawn(process.execPath, ["--import", "tsx", "--import", "./tests/socket-auth-network-fixture.mjs", "server/index.ts"], {
    env, stdio: ["ignore", "pipe", "pipe", "ipc"]
  });
  const sockets: Socket[] = []; let errors = "";
  server.stderr.on("data", chunk => { errors += chunk.toString(); });
  t.after(async () => {
    for (const socket of sockets) socket.disconnect();
    if (server.exitCode === null && server.signalCode === null) { const exited = once(server, "exit"); server.kill(); await exited; }
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("soundspin-socket-auth-"));
    await rm(directory, { recursive: true, force: true });
  });
  const url = await new Promise<string>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Socket auth fixture did not start: ${errors}`)), 20_000);
    server.stdout.on("data", chunk => {
      output += chunk.toString();
      const match = output.match(/turntune listening on (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    server.once("error", error => { clearTimeout(timer); reject(error); });
    server.once("exit", code => { clearTimeout(timer); reject(new Error(`Socket auth fixture exited (${code}): ${errors}`)); });
  });
  for (const claims of [{ iss: "https://wrong-project.invalid/auth/v1" }, { aud: "service_role" }, { role: "service_role" }, { sub: "not-an-account" }]) {
    const rejected = io(url, { autoConnect: false, reconnection: false, transports: ["websocket"], auth: { accessToken: token(Math.floor(Date.now() / 1000) + 60, claims) } });
    sockets.push(rejected);
    const denial = once(rejected, "connect_error", { signal: AbortSignal.timeout(5_000) });
    rejected.connect();
    await denial;
    assert.equal(rejected.connected, false);
    rejected.disconnect();
  }
  const socket = io(url, { autoConnect: false, reconnection: false, transports: ["websocket"] });
  sockets.push(socket);
  const waitEvent = (event: string) => once(socket, event, { signal: AbortSignal.timeout(7_000) });
  const firstExpiry = Math.floor(Date.now() / 1000) + 5;
  const shortToken = token(firstExpiry);
  const spotifySearch = (credential: string, roomSlug = "auth-room") => fetch(`${url}/api/spotify/search?q=fixture&roomSlug=${roomSlug}`, {
    headers: { Authorization: `Bearer ${credential}` }, signal: AbortSignal.timeout(3_000)
  });
  assert.equal((await spotifySearch(shortToken)).status, 403, "Room read access alone must not permit Spotify without live admission.");
  socket.auth = { accessToken: shortToken };
  const connected = waitEvent("connect"); socket.connect(); await connected;
  const firstSocketId = socket.id;
  const join = () => socket.timeout(3_000).emitWithAck("room:join", {
    roomId: "auth-room", user: { id: "forged", name: "Forged", avatarSeed: "fixture" }
  }) as Promise<{ ok: boolean; error?: string }>;
  const snapshot = waitEvent("room:snapshot");
  assert.deepEqual(await join(), { ok: true });
  const [joined] = await snapshot as [RoomSnapshot];
  assert.equal(joined.users[0].id, verifiedUserId);
  assert.equal(joined.users[0].name, "Verified listener");
  assert.equal((await spotifySearch(shortToken, "another-room")).status, 403);
  assert.equal((await spotifySearch(shortToken)).status, 503, "An admitted account reaches the unconfigured test catalog without provider traffic.");
  assert.deepEqual(await socket.timeout(3_000).emitWithAck("dj:join", undefined), { ok: true });
  const [reason] = await waitEvent("disconnect");
  assert.equal(reason, "io server disconnect");
  assert.equal(socket.connected, false);
  assert.ok(Date.now() >= firstExpiry * 1000);
  assert.equal((await spotifySearch(token(Math.floor(Date.now() / 1000) + 60))).status, 403, "A fresh HTTP token cannot reuse expired socket admission.");

  // Expired credentials must fail a new handshake as well as ending the old one.
  const denied = waitEvent("connect_error"); socket.connect();
  const [error] = await denied as [Error];
  assert.match(error.message, /expired/);
  assert.equal(socket.connected, false);
  socket.auth = { accessToken: token(Math.floor(Date.now() / 1000) + 10) };
  const refreshed = waitEvent("connect"); socket.connect(); await refreshed;
  assert.notEqual(socket.id, firstSocketId);
  const resumed = waitEvent("room:snapshot");
  assert.deepEqual(await join(), { ok: true });
  const [rejoined] = await resumed as [RoomSnapshot];
  assert.equal(rejoined.users[0].id, verifiedUserId);
  assert.deepEqual(rejoined.room.djQueueUserIds, [verifiedUserId]);
  assert.deepEqual(await socket.timeout(3_000).emitWithAck("dj:leave", undefined), { ok: true });
  const updateFixture = async (fixture: "account" | "room", disabled: boolean) => {
    const updated = once(server, "message", { signal: AbortSignal.timeout(3_000) });
    server.send({ fixture, disabled });
    assert.deepEqual((await updated)[0], { fixtureUpdated: fixture });
  };
  await updateFixture("room", true);
  const deniedRoom = await join();
  assert.equal(deniedRoom.ok, false);
  await updateFixture("room", false);
  assert.deepEqual(await join(), { ok: true });
  await updateFixture("account", true);
  const profileResponse = await fetch(`${url}/api/profiles/${verifiedUserId}`, { headers: { Authorization: `Bearer ${token(Math.floor(Date.now() / 1000) + 60)}` }, signal: AbortSignal.timeout(3_000) });
  assert.ok([401, 403].includes(profileResponse.status));
  const suspendedSocket = io(url, { autoConnect: false, reconnection: false, transports: ["websocket"], auth: { accessToken: token(Math.floor(Date.now() / 1000) + 60) } });
  sockets.push(suspendedSocket);
  const suspendedDenial = once(suspendedSocket, "connect_error", { signal: AbortSignal.timeout(5_000) });
  suspendedSocket.connect();
  await suspendedDenial;
  assert.equal(suspendedSocket.connected, false);
  const existingSessionDenied = await new Promise<boolean>((resolve, reject) => {
    if (!socket.connected) { resolve(true); return; }
    const onDisconnect = () => resolve(true);
    socket.once("disconnect", onDisconnect);
    void socket.timeout(3_000).emitWithAck("dj:join", undefined).then((result: { ok?: boolean }) => {
      socket.off("disconnect", onDisconnect); resolve(result.ok === false);
    }, error => { socket.off("disconnect", onDisconnect); if (!socket.connected) resolve(true); else reject(error); });
  });
  assert.equal(existingSessionDenied, true, "Suspension must deny the next command on an existing connection.");
  assert.doesNotMatch(errors, /blocked an unexpected/);
});
