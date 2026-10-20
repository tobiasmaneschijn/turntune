import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cleanupRestrictedAccount } from "./account-restriction-cleanup.js";
import { GracePeriodRegistry, advanceRadio, removeDj } from "../rooms/radio.js";
import { Store } from "../../persistence/store.js";
import type { Room, Track, User } from "../../types.js";

const actor: User = { id: "restricted-user", name: "Restricted", avatarSeed: "restricted" };
function fixture(id: string, ownerUserId: string): Room {
  return { id, name: id, ownerUserId, moderatorUserIds: [], djRoleUserIds: [], isPublic: true, passwordProtected: false,
    settings: {}, djUserId: null, djQueueUserIds: [], djQueues: {}, history: [],
    playback: { track: null, playing: false, position: 0, updatedAt: 1 }, vibe: null, createdAt: 1 };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test("restriction snapshots every cached owned room before disconnect removes the sole owner's presence", async () => {
  const online = fixture("online-owned", actor.id), offline = fixture("offline-owned", actor.id), fallback = fixture("fallback-owned", actor.id);
  const unrelated = fixture("unrelated-room", "another-owner");
  online.djUserId = actor.id; online.djQueueUserIds = [actor.id];
  const cached = [online, offline, fallback, unrelated];
  const presence = new Map([[online.id, new Set([actor.id])]]);
  const scheduled = new Set([online.id, offline.id, fallback.id]);
  const grace = new GracePeriodRegistry(60_000);
  const paused = deferred(), entered = deferred();
  let allowed = true, disconnected = false;
  const restricted: string[] = [];
  try {
    const operation = cleanupRestrictedAccount(actor.id, {
      cachedRooms: () => cached,
      blockAccount: () => { allowed = false; },
      restrictOwnedRoom: async roomId => {
        restricted.push(roomId);
        if (roomId === online.id) { entered.resolve(); await paused.promise; }
        scheduled.delete(roomId); presence.delete(roomId);
      },
      removeDjFromRoom: async () => { assert.fail("Unrelated rooms must retain their DJs and pending music."); },
      disconnectAccount: () => {
        disconnected = true;
        // Model the ordinary disconnect path: it deletes the final presence
        // entry synchronously and would schedule a grace timer if still there.
        for (const [roomId, users] of presence) if (users.delete(actor.id)) {
          if (!users.size) presence.delete(roomId);
          if (cached.find(room => room.id === roomId)?.djQueueUserIds.includes(actor.id)) grace.schedule(`${roomId}:${actor.id}`, () => undefined);
        }
      }
    });
    await entered.promise;
    assert.equal(allowed, false, "The actor is blocked before the first awaited cleanup.");
    assert.equal(disconnected, false);
    paused.resolve(); await operation;
    assert.deepEqual(restricted, [online.id, offline.id, fallback.id]);
    assert.equal(scheduled.size, 0);
    assert.equal(presence.size, 0);
    assert.equal(grace.has(`${online.id}:${actor.id}`), false);
    assert.equal(disconnected, true);
  } finally { paused.resolve(); grace.clear(); }
});

test("restriction waits for ordered online and offline DJ removal without deleting personal waiting queues", async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "soundspin-restricted-dj-"));
  const grace = new GracePeriodRegistry(60_000);
  t.after(async () => { grace.clear(); await rm(dataDir, { recursive: true, force: true }); });
  const store = new Store({ supabase: null, dataDir }); await store.init();
  const online = store.getOrCreateLocalRoom("online-dj", () => fixture("online-dj", "another-owner"));
  const offline = store.getOrCreateLocalRoom("offline-dj", () => fixture("offline-dj", "another-owner"));
  const unrelated = store.getOrCreateLocalRoom("unrelated-room", () => fixture("unrelated-room", "another-owner"));
  const pending: Track = { id: "pending-pick", provider: "youtube", providerId: "abcdefghijk", title: "Pending", addedBy: actor, addedAt: 1 };
  online.djQueueUserIds = [actor.id]; online.djUserId = actor.id; online.djQueues[actor.id] = [pending];
  offline.djQueueUserIds = [actor.id]; offline.djQueues[actor.id] = [pending];
  unrelated.djQueues[actor.id] = [pending];
  grace.schedule(`${offline.id}:${actor.id}`, () => assert.fail("A platform-restricted DJ must not retain disconnect grace."));
  const barrier = deferred(), entered = deferred();
  const queued = store.withRoomOperation(online.id, async () => { entered.resolve(); await barrier.promise; });
  await entered.promise;
  let allowed = true, disconnected = false;
  const removed: string[] = [];
  const operation = cleanupRestrictedAccount(actor.id, {
    cachedRooms: () => [online, offline, unrelated],
    blockAccount: () => { allowed = false; },
    restrictOwnedRoom: async () => { assert.fail("This actor owns no rooms."); },
    removeDjFromRoom: async room => {
      grace.cancel(`${room.id}:${actor.id}`);
      await store.changeRoom(room, draft => {
        const current = draft.djUserId === actor.id;
        removeDj(draft, actor.id); if (current) advanceRadio(draft);
        return { result: undefined };
      });
      removed.push(room.id);
    },
    disconnectAccount: () => {
      disconnected = true;
      if (online.djQueueUserIds.includes(actor.id)) grace.schedule(`${online.id}:${actor.id}`, () => undefined);
    }
  });
  assert.equal(allowed, false); assert.equal(disconnected, false);
  barrier.resolve(); await queued; await operation;
  assert.deepEqual(removed, [online.id, offline.id]);
  assert.equal(online.djUserId, null);
  assert.equal(online.playback.playing, false);
  assert.deepEqual(online.djQueueUserIds, []); assert.deepEqual(offline.djQueueUserIds, []);
  assert.deepEqual(online.djQueues[actor.id], [pending]); assert.deepEqual(offline.djQueues[actor.id], [pending]);
  assert.deepEqual(unrelated.djQueues[actor.id], [pending]);
  assert.equal(grace.has(`${online.id}:${actor.id}`), false); assert.equal(grace.has(`${offline.id}:${actor.id}`), false);
  assert.equal(disconnected, true);
});

test("a failed cleanup leaves the actor blocked and retry completes without a partial disconnect", async () => {
  const room = fixture("owned-room", actor.id);
  let allowed = true, disconnected = false, failed = true;
  const options = {
    cachedRooms: () => [room], blockAccount: () => { allowed = false; },
    restrictOwnedRoom: async () => { if (failed) throw new Error("Synthetic persistence failure"); },
    removeDjFromRoom: async () => undefined, disconnectAccount: () => { disconnected = true; }
  };
  await assert.rejects(cleanupRestrictedAccount(actor.id, options), /Synthetic persistence failure/);
  assert.equal(allowed, false); assert.equal(disconnected, false);
  failed = false; await cleanupRestrictedAccount(actor.id, options);
  assert.equal(allowed, false); assert.equal(disconnected, true);
});
