import assert from "node:assert/strict";
import test from "node:test";
import { IdleRoomRegistry } from "./idle-rooms.js";

test("idle cache release retries pending writes and reconnect cancels eviction", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const released: string[] = [];
  let canRelease = false;
  const registry = new IdleRoomRegistry(id => { released.push(id); return canRelease; }, 1000);
  registry.schedule("room-a"); registry.schedule("room-a");
  t.mock.timers.tick(1000);
  assert.deepEqual(released, ["room-a"]);
  canRelease = true;
  t.mock.timers.tick(1000);
  assert.deepEqual(released, ["room-a", "room-a"]);
  registry.schedule("room-b"); registry.cancel("room-b");
  t.mock.timers.tick(2000);
  assert.deepEqual(released, ["room-a", "room-a"]);
  registry.schedule("room-c"); registry.clear(); t.mock.timers.tick(1000);
  assert.deepEqual(released, ["room-a", "room-a"]);
});
