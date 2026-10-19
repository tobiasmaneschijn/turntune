import assert from "node:assert/strict";
import test from "node:test";
import { RoomEntryLimiter } from "./room-entry-limiter.js";

test("reconnected sockets share identity and protected-room password budgets", () => {
  let now = 1000;
  const limiter = new RoomEntryLimiter(() => now);
  for (let attempt = 0; attempt < 20; attempt++) assert.equal(limiter.password("verified-account", "protected-room"), true);
  assert.equal(limiter.password("verified-account", "protected-room"), false);
  assert.equal(limiter.password("other-account", "protected-room"), true);
  assert.equal(limiter.password("verified-account", "other-room"), true);
  for (let attempt = 0; attempt < 30; attempt++) assert.equal(limiter.join("verified-account", "peer"), true);
  assert.equal(limiter.join("verified-account", "different-peer"), false);
  now += 60_000;
  assert.equal(limiter.join("verified-account", "peer"), true);
  assert.equal(limiter.password("verified-account", "protected-room"), false);
  now += 4 * 60_000;
  assert.equal(limiter.password("verified-account", "protected-room"), true);
});

test("peer budgets cap many account identities from the same connection source", () => {
  const limiter = new RoomEntryLimiter();
  for (let attempt = 0; attempt < 200; attempt++) assert.equal(limiter.join(`account-${attempt}`, "same-peer"), true);
  assert.equal(limiter.join("new-account", "same-peer"), false);
  assert.equal(limiter.join("new-account", "different-peer"), true);
});
