import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rmdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import test from "node:test";
import { io, type Socket } from "socket.io-client";
import type { RoomPresence, RoomSnapshot } from "../../../src/types.js";
import { hashRoomPassword } from "../../../server/features/rooms/room-password.js";

function waitForSnapshot(socket: Socket, matches: (snapshot: RoomSnapshot) => boolean) {
  return new Promise<RoomSnapshot>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); socket.off("room:snapshot", receive); };
    const receive = (snapshot: RoomSnapshot) => {
      if (!matches(snapshot)) return;
      cleanup(); resolve(snapshot);
    };
    const timer = setTimeout(() => {
      cleanup(); reject(new Error(`Expected room snapshot was not received on socket ${socket.id}.`));
    }, 3_000);
    socket.on("room:snapshot", receive);
  });
}

test("two listeners can join, manage private queues, skip idempotently and reconnect", { timeout: 45_000 }, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "soundspin-integration-"));
  const setId = "00000000-0000-4000-8000-000000000011";
  const lockedRoom = { id: "locked-room", name: "Locked fixture", ownerUserId: "password-user", moderatorUserIds: [], djRoleUserIds: [], isPublic: true,
    passwordProtected: true, settings: {}, djUserId: null, djQueueUserIds: [], djQueues: {}, history: [],
    playback: { track: null, playing: false, position: 0, updatedAt: 1 }, vibe: null, createdAt: 1 };
  const restrictedRoom = { ...lockedRoom, id: "restricted-room", name: "Restricted fixture", ownerUserId: "restricted-owner", passwordProtected: false, settings: { djAccess: "roles" } };
  await writeFile(path.join(directory, "soundspin.json"), JSON.stringify({ rooms: { "locked-room": lockedRoom, "restricted-room": restrictedRoom }, roomPasswords: { "locked-room": await hashRoomPassword("correct-secret") }, privateLibraries: { alice: { picks: [], sets: [{ id: setId, name: "Fixture set", savedAt: 1, tracks: [
    { provider: "youtube", providerId: "abcdefghijk", title: "Existing" },
    { provider: "youtube", providerId: "savedTrack1", title: "First saved pick" },
    { provider: "youtube", providerId: "unavailable", title: "Unavailable pick" },
    { provider: "youtube", providerId: "savedTrack2", title: "Second saved pick" }
  ] }] } } }));
  const env = { ...process.env, PORT: "0", HOST: "127.0.0.1", DATA_DIR: directory, NODE_ENV: "test" };
  for (const key of Object.keys(env)) {
    if (/^(SUPABASE_|VITE_|SPOTIFY_|SOUNDCLOUD_|APPLE_MUSIC_|PROVIDER_TOKEN_|SIGNUP_|YOUTUBE_|GIPHY_)/.test(key)) {
      delete (env as NodeJS.ProcessEnv)[key];
    }
  }
  const server = spawn(process.execPath, ["--import", "tsx", "--import", "./tests/integration/rooms/server-provider-fixture.ts", "server/index.ts"], { env, stdio: ["ignore", "pipe", "pipe"] });
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
    let errors = "";
    const timer = setTimeout(() => reject(new Error(`Local test server did not start. Fixture stdout: ${output.slice(-4000)}. Fixture stderr: ${errors.slice(-4000)}`)), 20_000);
    server.stderr.on("data", (chunk: Buffer) => { errors = (errors + chunk.toString()).slice(-4000); });
    server.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/turntune listening on (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    server.once("error", (error) => { clearTimeout(timer); reject(error); });
    server.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Local test server exited (${code}). Fixture stderr: ${errors}`)); });
  });
  assert.equal((await fetch(`${url}/api/health`)).status, 200);
  assert.deepEqual(await (await fetch(`${url}/api/ready`)).json(), { ok: true });
  assert.equal((await fetch(`${url}/api/admin/runtime`)).status, 401);
  const missing = await fetch(`${url}/api/not-a-real-endpoint`);
  assert.equal(missing.status, 401);
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
  const action = (socket: Socket, event: string, payload?: unknown) => socket.timeout(10_000).emitWithAck(event, payload) as Promise<{ ok: boolean; error?: string }>;
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
  await t.test("room password attempt capacity survives another socket and reconnect", async () => {
    const first = await connect(); const second = await connect();
    const attempt = (client: Socket, id: string, password: string) => action(client, "room:join", {
      roomId: "locked-room", password, user: { id, name: id, avatarSeed: id }
    });
    for (let index = 0; index < 20; index++) {
      const rejected = await attempt(index % 2 ? first : second, "password-user", "wrong-secret");
      assert.equal(rejected.ok, false); assert.match(rejected.error || "", /incorrect/);
    }
    first.disconnect(); const reconnected = await connect();
    const limited = await attempt(reconnected, "password-user", "correct-secret");
    assert.equal(limited.ok, false); assert.match(limited.error || "", /five minutes/);
    assert.equal((await attempt(second, "different-account", "correct-secret")).ok, true);
    second.disconnect(); reconnected.disconnect();
  });
  await t.test("live chat uses admitted room sockets, stamps authors and deduplicates uncertain retries", async (t) => {
    const outsider = await connect();
    let outsiderMessages = 0; let ownMessages = 0;
    const onOwn = () => { ownMessages++; };
    alice.on("chat:message", onOwn);
    outsider.on("chat:message", () => { outsiderMessages++; });
    t.after(() => { alice.off("chat:message", onOwn); outsider.disconnect(); });
    const message = { id: "00000000-0000-4000-8000-000000000031", content: "Room-only message", type: "text", createdAt: new Date().toISOString(), user: { id: "bob", name: "Forged author", avatarSeed: "forged" }, mentions: [] };
    const payload = { roomId: "integration-room", message };
    assert.equal((await action(outsider, "chat:message", payload)).ok, false);
    const received = once(bob, "chat:message", { signal: AbortSignal.timeout(3000) });
    assert.equal((await action(alice, "chat:message", payload)).ok, true);
    const [event] = await received as [{ roomId: string; message: { user: { id: string; name: string }; content: string } }];
    assert.equal(event.roomId, "integration-room"); assert.equal(event.message.user.id, "alice"); assert.equal(event.message.user.name, "alice");
    assert.equal(event.message.content, message.content);
    assert.equal((await action(alice, "chat:message", payload)).ok, true);
    assert.equal(ownMessages, 1); assert.equal(outsiderMessages, 0);
    assert.equal((await action(alice, "chat:message", { ...payload, message: { ...message, content: "Conflicting retry" } })).ok, false);
    assert.equal((await action(alice, "chat:message", { ...payload, roomId: "another-room" })).ok, false);
    assert.equal((await action(outsider, "chat:typing", { roomId: "integration-room", typing: { active: true } })).ok, false);
  });
  await t.test("room notes require host permission, synchronize and reject stale edits", async () => {
    const host = aliceState.room.ownerUserId === "alice" ? alice : bob;
    const listener = host === alice ? bob : alice;
    const denied = await action(listener, "room:announcement", { expectedId: null, text: "Unauthorized" });
    assert.equal(denied.ok, false);
    assert.match(denied.error || "", /owners and moderators/);
    const createdNote = (snapshot: RoomSnapshot) => snapshot.room.id === "integration-room" && snapshot.room.announcement?.text === "Take turns; add two picks.";
    const aliceCreated = waitForSnapshot(alice, createdNote);
    const bobCreated = waitForSnapshot(bob, createdNote);
    const [created, aliceWithNote, bobWithNote] = await Promise.all([
      action(host, "room:announcement", { expectedId: null, text: "Take turns; add two picks.", expiresInMinutes: 60 }),
      aliceCreated, bobCreated
    ]);
    assert.equal(created.ok, true);
    const note = aliceWithNote.room.announcement!;
    assert.equal(note.text, "Take turns; add two picks.");
    assert.ok(note.expiresAt! > Date.now());
    assert.deepEqual(bobWithNote.room.announcement, note);
    const stale = await action(host, "room:announcement", { expectedId: null, text: "Stale" });
    assert.equal(stale.ok, false); assert.match(stale.error || "", /changed/);
    const clearedNote = (snapshot: RoomSnapshot) => snapshot.room.id === "integration-room" && snapshot.room.announcement === null;
    const aliceCleared = waitForSnapshot(alice, clearedNote);
    const bobCleared = waitForSnapshot(bob, clearedNote);
    const [cleared, aliceWithoutNote, bobWithoutNote] = await Promise.all([
      action(host, "room:announcement", { expectedId: note.id, text: "" }), aliceCleared, bobCleared
    ]);
    assert.equal(cleared.ok, true);
    assert.equal(aliceWithoutNote.room.announcement, null);
    assert.equal(bobWithoutNote.room.announcement, null);
    assert.equal((await action(host, "room:announcement", { expectedId: null, text: "x".repeat(501) })).ok, false);
  });
  const track = (providerId: string) => ({ provider: "youtube", providerId, title: "Test recording" });
  await t.test("a full room admits only one concurrent final listener and opens a slot when someone leaves",async t=>{
    const clients:Socket[]=[];t.after(()=>clients.forEach(client=>client.disconnect()));
    const enter=async(index:number)=>{
      const client=await connect();clients.push(client);
      return {client,result:await action(client,"room:join",{roomId:"capacity-room",user:{id:`capacity-${index}`,name:`Listener ${index}`,avatarSeed:`capacity-${index}`}})};
    };
    for(let index=0;index<24;index++)assert.equal((await enter(index)).result.ok,true);
    const final=await Promise.all([enter(24),enter(25)]);
    assert.equal(final.filter(entry=>entry.result.ok).length,1);
    const rejected=final.find(entry=>!entry.result.ok)!;
    assert.match(rejected.result.error??'',/room is full/);
    const departed=once(clients[1],"room:presence");clients[0].disconnect();await departed;
    const index=clients.indexOf(rejected.client);
    assert.equal((await action(rejected.client,"room:join",{roomId:"capacity-room",user:{id:`capacity-${index}`,name:`Listener ${index}`,avatarSeed:`capacity-${index}`}})).ok,true);
  });
  await t.test("a listener throttled while preparing tracks can still remove a track and finish playback",async t=>{
    const listener=await connect();t.after(()=>listener.disconnect());
    let state!:RoomSnapshot;
    listener.on("room:snapshot",snapshot=>{state=snapshot;});
    assert.equal((await action(listener,"room:join",{roomId:"quota-room",user:{id:"quota-listener",name:"Quota listener",avatarSeed:"quota"}})).ok,true);
    assert.equal((await action(listener,"dj:join")).ok,true);
    let blocked=false;
    for(let index=0;index<20;index++) {
      const result=await action(listener,"queue:add",track(`quota${String(index).padStart(6,"0")}`));
      if(!result.ok){assert.match(result.error??'',/Too many requests/);blocked=true;break;}
    }
    assert.equal(blocked,true);
    assert.ok(state.room.queue.length>0);
    const waiting=state.room.queue[0];
    assert.equal((await action(listener,"queue:remove",{trackId:waiting.id})).ok,true);
    assert.equal(state.room.queue.some(item=>item.id===waiting.id),false);
    const playing=state.room.playback.track!;
    assert.equal((await action(listener,"playback:ended",{trackId:playing.id,revision:state.room.playback.revision})).ok,true);
    assert.notEqual(state.room.playback.track?.id,playing.id);
  });
  await t.test("a listener can add, import and manage a private queue without a DJ role or starting playback", async (t) => {
    const listener = await connect(); t.after(() => listener.disconnect());
    let state!: RoomSnapshot;
    listener.on("room:snapshot", (snapshot: RoomSnapshot) => { state = snapshot; });
    assert.equal((await action(listener, "queue:add", track("abcdefghijk"))).ok, false);
    assert.equal((await action(listener, "room:join", { roomId: "restricted-room", user: { id: "alice", name: "Alice", avatarSeed: "alice" } })).ok, true);
    const beforePlayback = structuredClone(state.room.playback);
    assert.equal((await action(listener, "queue:add", track("invalid-video-id"))).ok, false);
    assert.deepEqual(state.room.queue, []);
    assert.deepEqual(state.room.playback, beforePlayback);
    const added = await action(listener, "queue:add", { ...track("abcdefghijk"), addedBy: { id: "bob" } }) as { ok: boolean; started: boolean; position: number };
    assert.deepEqual(added, { ok: true, started: false, position: 1 });
    assert.equal(state.room.queue[0].addedBy.id, "alice");
    assert.equal((await action(listener, "queue:add", track("abcdefghijk"))).ok, false);
    const payload = { setId, requestId: "00000000-0000-4000-8000-000000000041" };
    const imported = await action(listener, "queue:set-add", payload) as { ok: boolean; added: number; started: boolean; skipped: unknown[] };
    assert.equal(imported.ok, true); assert.equal(imported.added, 2); assert.equal(imported.started, false); assert.equal(imported.skipped.length, 2);
    const waiting = structuredClone(state.room.queue);
    assert.deepEqual(await action(listener, "queue:set-add", payload), imported);
    assert.deepEqual(state.room.queue, waiting);
    const last = waiting.at(-1)!;
    assert.equal((await action(listener, "queue:play-next", { trackId: last.id })).ok, true);
    assert.equal(state.room.queue[0].id, last.id);
    assert.equal((await action(listener, "queue:move", { trackId: last.id, toIndex: 2 })).ok, true);
    const removed = await action(listener, "queue:remove", { trackId: last.id }) as { ok: boolean; undo: { token: string } };
    assert.equal(removed.ok, true);
    assert.equal((await action(listener, "queue:undo", { token: removed.undo.token })).ok, true);
    assert.deepEqual(state.room.queue, waiting);
    assert.equal((await action(listener, "dj:join")).ok, false);
    assert.deepEqual(state.room.djQueueUserIds, []);
    assert.deepEqual(state.room.playback, beforePlayback);
    assert.equal(state.room.djUserId, null);
    assert.equal((await action(listener, "room:join", { roomId: "restricted-room", user: { id: "bob", name: "Bob", avatarSeed: "bob" } })).ok, true);
    assert.deepEqual(state.room.queue, []);
    assert.equal("djQueues" in state.room, false);
  });
  await t.test("prepared listener tracks wait until an explicit DJ join", async () => {
    const before = structuredClone(aliceState.room.playback);
    assert.deepEqual(await action(alice, "queue:add", track("abcdefghijk")), { ok: true, started: false, position: 1 });
    assert.deepEqual(await action(alice, "queue:add", track("lmnopqrstuv")), { ok: true, started: false, position: 2 });
    assert.deepEqual(aliceState.room.djQueueUserIds, []);
    assert.deepEqual(aliceState.room.playback, before);
    assert.equal(aliceState.room.queue.length, 2);
    assert.equal((await action(alice, "dj:join")).ok, true);
    assert.equal(aliceState.room.playback.track?.providerId, "abcdefghijk");
    assert.equal(aliceState.room.playback.playing, true);
  });
  assert.equal((await action(bob, "dj:join")).ok, true);
  assert.equal(aliceState.room.queue.length, 1);
  assert.equal(bobState.room.queue.length, 0);
  await t.test("queue Undo restores only the original owner's waiting item and is single-use", async () => {
    const waiting = aliceState.room.queue[0];
    const playback = structuredClone(aliceState.room.playback);
    const removed = await action(alice, "queue:remove", { trackId: waiting.id }) as { ok: boolean; undo: { token: string } };
    assert.equal(removed.ok, true); assert.equal(aliceState.room.queue.length, 0);
    assert.equal((await action(bob, "queue:undo", { token: removed.undo.token })).ok, false);
    assert.equal((await action(alice, "queue:undo", { token: removed.undo.token })).ok, true);
    assert.equal(aliceState.room.queue[0].id, waiting.id);
    assert.deepEqual(aliceState.room.playback, playback);
    assert.equal((await action(alice, "queue:undo", { token: removed.undo.token })).ok, false);
  });
  const aliceWithBobQueued = waitForSnapshot(alice, snapshot => snapshot.room.id === "integration-room" && snapshot.room.queue.length === 1);
  const bobWithTrackQueued = waitForSnapshot(bob, snapshot => snapshot.room.id === "integration-room" && snapshot.room.queue.some(value => value.providerId === "wxyzABCDEFG"));
  const [bobQueued] = await Promise.all([
    action(bob, "queue:add", track("wxyzABCDEFG")), aliceWithBobQueued, bobWithTrackQueued
  ]);
  assert.equal(bobQueued.ok, true);
  await t.test("a third listener joins and leaves without replaying playback or private queues", async (t) => {
    const aliceRoomBefore = structuredClone(aliceState.room);
    const bobRoomBefore = structuredClone(bobState.room);
    assert.equal(aliceRoomBefore.playback.playing, true);
    assert.equal(aliceRoomBefore.queue.length, 1);
    assert.equal(bobRoomBefore.queue.length, 1);

    const snapshots = { alice: 0, bob: 0 };
    const onAliceSnapshot = () => { snapshots.alice += 1; };
    const onBobSnapshot = () => { snapshots.bob += 1; };
    alice.on("room:snapshot", onAliceSnapshot);
    bob.on("room:snapshot", onBobSnapshot);
    t.after(() => {
      alice.off("room:snapshot", onAliceSnapshot);
      bob.off("room:snapshot", onBobSnapshot);
    });
    const waitForPresence = (socket: Socket) => once(socket, "room:presence", {
      signal: AbortSignal.timeout(3_000)
    }).then(([presence]) => presence as RoomPresence);
    const assertPresence = (presence: RoomPresence, userIds: string[]) => {
      assert.equal(presence.roomId, "integration-room");
      assert.deepEqual(presence.users.map((user) => user.id).sort(), userIds);
      assert.deepEqual(presence.djUsers.map((user) => user.id).sort(), ["alice", "bob"]);
      assert.equal("room" in presence, false);
      assert.equal("playback" in presence, false);
      assert.equal("queue" in presence, false);
      assert.equal("djQueues" in presence, false);
    };

    const charlie = await connect();
    let charlieState!: RoomSnapshot;
    charlie.on("room:snapshot", (snapshot: RoomSnapshot) => { charlieState = snapshot; });
    const aliceJoining = waitForPresence(alice);
    const bobJoining = waitForPresence(bob);
    const [joinReply, joinedAlice, joinedBob] = await Promise.all([
      join(charlie, "charlie"), aliceJoining, bobJoining
    ]);
    assert.equal(joinReply.ok, true);
    assertPresence(joinedAlice, ["alice", "bob", "charlie"]);
    assertPresence(joinedBob, ["alice", "bob", "charlie"]);
    assert.deepEqual(snapshots, { alice: 0, bob: 0 });
    assert.deepEqual(charlieState.room.playback, aliceRoomBefore.playback);
    assert.deepEqual(charlieState.room.queue, []);
    assert.equal("djQueues" in charlieState.room, false);

    const aliceLeaving = waitForPresence(alice);
    const bobLeaving = waitForPresence(bob);
    charlie.disconnect();
    const [leftAlice, leftBob] = await Promise.all([aliceLeaving, bobLeaving]);
    assertPresence(leftAlice, ["alice", "bob"]);
    assertPresence(leftBob, ["alice", "bob"]);
    assert.deepEqual(snapshots, { alice: 0, bob: 0 });

    // Ask for fresh personalized snapshots explicitly to verify the server's
    // playback checkpoint and both private queues survived the presence changes.
    const refreshed = await Promise.all([join(alice, "alice"), join(bob, "bob")]);
    assert.ok(refreshed.every((result) => result.ok));
    assert.deepEqual(aliceState.room, aliceRoomBefore);
    assert.deepEqual(bobState.room, bobRoomBefore);
  });
  const endedTrack = aliceState.room.playback.track!.id;
  await t.test("a failed skip never changes live playback or becomes persisted on rejoin", async () => {
    const before = structuredClone(aliceState.room);
    const blockedWriter = path.join(directory, "soundspin.tmp.json");
    await mkdir(blockedWriter);
    try {
      // Only the state-changing skip must write; a room rejoin can be a no-op.
      assert.equal((await action(alice, "chat:typing", { roomId: "integration-room", typing: { active: true } })).ok, true);
      assert.equal((await action(alice, "queue:next", { trackId: endedTrack })).ok, false);
      assert.deepEqual(aliceState.room, before);
      assert.deepEqual(bobState.room.playback, before.playback);
    } finally { await rmdir(blockedWriter); }
    assert.equal((await join(alice, "alice")).ok, true);
    assert.deepEqual(aliceState.room, before);
    assert.equal((await join(bob, "bob")).ok, true);
    assert.equal(bobState.room.playback.track!.id, endedTrack);
  });
  assert.equal((await action(bob, "vibe:vote", { trackId: endedTrack, value: 1 })).ok, true);
  assert.equal(bobState.room.vibe?.votes.bob, 1);
  assert.equal((await action(alice, "playback:update", { trackId: endedTrack, playing: false, position: 4 })).ok, true);
  assert.equal(aliceState.room.playback.playing, false);
  assert.equal((await action(alice, "queue:next", { trackId: endedTrack })).ok, true);
  const nextTrack = aliceState.room.playback.track!.id;
  assert.notEqual(nextTrack, endedTrack);
  assert.equal((await action(alice, "vibe:vote", { trackId: endedTrack, value: 1 })).ok, false);
  assert.equal(aliceState.room.vibe?.votes.alice, undefined);
  assert.equal((await action(alice, "queue:next", { trackId: endedTrack })).ok, false);
  assert.equal(aliceState.room.playback.track!.id, nextTrack);
  assert.equal((await action(alice, "playback:update", { trackId: endedTrack, playing: false, position: 8 })).ok, false);
  assert.equal(aliceState.room.playback.playing, true);
  await t.test("saved-set socket import verifies sources, reports skips and retries one authoritative outcome", async () => {
    const requestId = "00000000-0000-4000-8000-000000000021";
    assert.equal((await action(bob, "queue:set-add", { setId, requestId })).ok, false);
    const first = await action(alice, "queue:set-add", { setId, requestId }) as { ok: boolean; added: number; skipped: Array<{ title: string; reason: string }> };
    assert.equal(first.ok, true,JSON.stringify(first)); assert.equal(first.added, 3);
    assert.equal(first.skipped.length, 1); assert.match(first.skipped[0].reason, /unavailable/);
    const queued = aliceState.room.queue.map(value => value.id);
    const repeated = await action(alice, "queue:set-add", { setId, requestId });
    assert.deepEqual(repeated, first);
    assert.deepEqual(aliceState.room.queue.map(value => value.id), queued);
    assert.equal((await action(alice, "queue:set-add", { setId: "00000000-0000-4000-8000-000000000012", requestId })).ok, false);
    const otherRequest = await action(alice, "queue:set-add", { setId, requestId: "00000000-0000-4000-8000-000000000022" }) as { ok: boolean; added: number; skipped: unknown[] };
    assert.equal(otherRequest.ok, true); assert.equal(otherRequest.added, 0); assert.equal(otherRequest.skipped.length, 4);
    assert.equal("djQueues" in bobState.room, false);
    assert.equal(bobState.room.queue.length, 0);
  });
  bob.disconnect();
  const reconnected = await connect();
  let recovered!: RoomSnapshot;
  reconnected.on("room:snapshot", (snapshot: RoomSnapshot) => { recovered = snapshot; });
  assert.equal((await join(reconnected, "bob")).ok, true);
  assert.equal(recovered.room.playback.track!.id, nextTrack);
  assert.ok(recovered.room.djQueueUserIds.includes("bob"));
});
