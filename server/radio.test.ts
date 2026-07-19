import assert from "node:assert/strict";
import test from "node:test";
import { advanceRadio, GracePeriodRegistry, normalizeRadioState, roomForListener } from "./radio.js";
import type { Room, Track, User } from "./types.js";

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
