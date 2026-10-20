import assert from "node:assert/strict";
import test from "node:test";
import { advanceRadio, GracePeriodRegistry, normalizeRadioState, privateQueue, roomForListener } from "./radio.js";
import { roomPresence, uniqueUsers } from "./presence.js";
import type { Room, Track, User } from "../../types.js";

const alice: User = { id: "alice", name: "Alice", avatarSeed: "alice" };
const bob: User = { id: "bob", name: "Bob", avatarSeed: "bob" };

function track(id: string, addedBy: User): Track {
  return { id, provider: "youtube", providerId: id, title: id, addedBy, addedAt: 1 };
}

function room(): Room {
  return {
    id: "test-room",
    name: "Test room",
    ownerUserId: alice.id,
    moderatorUserIds: [],
    djRoleUserIds: [],
    isPublic: true,
    passwordProtected: false,
    settings: { djAccess: "everyone" },
    djUserId: null,
    djQueueUserIds: [alice.id, bob.id],
    djQueues: {
      [alice.id]: [track("alice-1", alice), track("alice-2", alice)],
      [bob.id]: [track("bob-1", bob)]
    },
    history: [],
    playback: { track: null, playing: false, position: 0, updatedAt: 1 },
    vibe: null,
    createdAt: 1
  };
}

test("rotates one song per DJ", () => {
  const state = room();
  assert.equal(advanceRadio(state)?.id, "alice-1");
  assert.deepEqual(state.djQueueUserIds, [bob.id, alice.id]);
  assert.equal(advanceRadio(state)?.id, "bob-1");
  assert.deepEqual(state.djQueueUserIds, [alice.id, bob.id]);
  assert.equal(advanceRadio(state)?.id, "alice-2");
});

test("listener snapshots contain only their own private queue", () => {
  const state = room();
  const aliceRoom = roomForListener(state, alice.id);
  const serialized = JSON.stringify(aliceRoom);
  assert.deepEqual(aliceRoom.queue.map((item) => item.id), ["alice-1", "alice-2"]);
  assert.equal(serialized.includes("bob-1"), false);
  assert.equal("djQueues" in aliceRoom, false);
});

test("counts one listener per account even with multiple sockets", () => {
  const updatedAlice = { ...alice, name: "Alice Updated" };
  const listeners = uniqueUsers([alice, bob, updatedAlice]);
  assert.deepEqual(listeners.map((user) => user.id), [alice.id, bob.id]);
  assert.equal(listeners.find((user) => user.id === alice.id)?.name, "Alice Updated");
});

test("presence updates cannot replay room or playback state", () => {
  const state = room();
  const payload = roomPresence(state, [alice, bob, alice], [alice, bob], 42);
  assert.deepEqual(payload, {
    roomId: state.id,
    users: [alice, bob],
    djUsers: [alice, bob],
    serverTime: 42
  });
  assert.equal("room" in payload, false);
  assert.equal("playback" in payload, false);
});

test("migrates a legacy shared queue into private queues", () => {
  const state = room();
  state.djQueueUserIds = [];
  state.djQueues = {};
  state.queue = [track("alice-old", alice), track("bob-old", bob)];
  normalizeRadioState(state);
  assert.deepEqual(state.djQueues[alice.id].map((item) => item.id), ["alice-old"]);
  assert.deepEqual(state.djQueues[bob.id].map((item) => item.id), ["bob-old"]);
  assert.equal(state.queue, undefined);
});

test("repairs missing and malformed persisted radio fields without crashing", () => {
  const state = {
    id: "legacy",
    settings: null,
    djQueueUserIds: [alice.id, alice.id, null, 3],
    djQueues: { alice: [null, {}, track("valid", alice)], bob: "invalid" },
    queue: [{}, track("valid", alice)],
    history: [null],
    playback: { track: {}, position: -10 }
  } as unknown as Room;
  normalizeRadioState(state);
  assert.deepEqual(state.djQueueUserIds, [alice.id]);
  assert.deepEqual(state.djQueues.alice.map((item) => item.id), ["valid"]);
  assert.deepEqual(state.djQueues.bob, []);
  assert.deepEqual(state.moderatorUserIds, []);
  assert.deepEqual(state.history, []);
  assert.equal(state.playback.track, null);
  assert.equal(state.playback.playing, false);
  assert.equal(state.playback.position, 0);
  assert.equal(state.vibe, null);
  normalizeRadioState(state);
  assert.deepEqual(state.djQueues.alice.map((item) => item.id), ["valid"]);
});

test("clears stale votes and rejects the playing DJ's own persisted vote", () => {
  const state = room();
  state.playback = { track: track("playing", alice), playing: true, position: -10, updatedAt: 1 };
  state.vibe = { trackId: "playing", votes: { alice: 1, bob: -1, invalid: 2 as 1 } };
  normalizeRadioState(state);
  assert.equal(state.playback.position, 0);
  assert.equal(state.djUserId, alice.id);
  assert.deepEqual(Object.entries(state.vibe!.votes), [[bob.id, -1]]);
  state.vibe!.trackId = "previous";
  normalizeRadioState(state);
  assert.deepEqual(Object.entries(state.vibe!.votes), []);
});

test("malformed stored themes cannot crash a room view", () => {
  const state = room();
  for (const invalid of [{ text: "theme" }, 42, " ", "x".repeat(161)]) {
    state.settings.themePrompt = invalid as string;
    normalizeRadioState(state);
    assert.equal(state.settings.themePrompt, undefined);
  }
});

test("private queue lookup handles guest IDs that match object properties", () => {
  const state = room();
  for (const id of ["constructor", "__proto__", "toString"]) {
    const user = { ...alice, id };
    privateQueue(state, id).push(track(id, user));
    assert.deepEqual(roomForListener(state, id).queue.map((item) => item.id), [id]);
  }
  assert.equal(Object.getPrototypeOf(state.djQueues), Object.prototype);
});

test("reading a listener snapshot does not allocate a persistent empty queue", () => {
  const state = room();
  assert.deepEqual(roomForListener(state, "new-listener").queue, []);
  assert.equal(Object.hasOwn(state.djQueues, "new-listener"), false);
});

test("cancels a pending disconnect eviction when the DJ reconnects", async () => {
  const grace = new GracePeriodRegistry(15);
  let expired = false;
  grace.schedule("room:alice", () => { expired = true; });
  assert.equal(grace.has("room:alice"), true);
  grace.cancel("room:alice");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(expired, false);
  assert.equal(grace.has("room:alice"), false);
});

test("expires a disconnected DJ after the grace period", async () => {
  const grace = new GracePeriodRegistry(15);
  let expirations = 0;
  grace.schedule("room:bob", () => { expirations += 1; });
  grace.schedule("room:bob", () => { expirations += 1; });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(expirations, 1);
  assert.equal(grace.has("room:bob"), false);
});
