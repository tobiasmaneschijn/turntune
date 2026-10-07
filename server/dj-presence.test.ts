import assert from "node:assert/strict";
import test from "node:test";
import { reconcileDjPresence } from "./dj-presence.js";
import type { Room, User } from "./types.js";

const user: User = { id: "alice", name: "Alice", avatarSeed: "alice" };
const room = { id: "room-one", djQueueUserIds: [user.id] } as unknown as Room;

test("a committed DJ with no remaining account socket gets a grace eviction", () => {
  const effects: string[] = [];
  reconcileDjPresence(room, user, {
    onlineUsers: [{ ...user, id: "bob" }],
    remember: (roomId, remembered) => effects.push(`remember:${roomId}:${remembered.id}`),
    cancelEviction: () => effects.push("cancel"),
    scheduleEviction: (current, remembered) => { assert.equal(current, room); effects.push(`evict:${remembered.id}`); }
  });
  assert.deepEqual(effects, ["remember:room-one:alice", "evict:alice"]);
});

test("another account tab preserves the DJ and cancels an earlier grace timer", () => {
  const effects: string[] = [];
  reconcileDjPresence(room, user, {
    onlineUsers: [{ ...user, name: "New profile" }], remember: () => effects.push("remember"),
    cancelEviction: (roomId, userId) => effects.push(`cancel:${roomId}:${userId}`),
    scheduleEviction: () => effects.push("evict")
  });
  assert.deepEqual(effects, ["remember", "cancel:room-one:alice"]);
});

test("a DJ already removed by a later committed command has no presence effects", () => {
  reconcileDjPresence({ ...room, djQueueUserIds: [] }, user, {
    onlineUsers: [user], remember: () => assert.fail("removed DJ remembered"),
    cancelEviction: () => assert.fail("removed DJ timer changed"), scheduleEviction: () => assert.fail("removed DJ evicted")
  });
});
