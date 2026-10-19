import assert from "node:assert/strict";
import test from "node:test";
import { createSocketCredentialLease } from "./socket-credentials.js";

test("socket leases reject absent/expired expiry and expire exactly at the verified JWT deadline", () => {
  let now = 1_000;
  for (const expiry of [undefined, null, "2", Number.NaN, 0, 1]) assert.throws(() => createSocketCredentialLease("alice", expiry, () => now), /expired/);
  const lease = createSocketCredentialLease("alice", 2, () => now);
  assert.equal(lease.userId, "alice");
  assert.doesNotThrow(lease.assertActive);
  now = 2_000;
  assert.throws(lease.assertActive, /expired/);
  const refreshed = createSocketCredentialLease("alice", 3, () => now);
  assert.doesNotThrow(refreshed.assertActive);
  assert.throws(lease.assertActive, /expired/);
});

test("expiry scheduling disconnects idle sessions and canceled old leases do not disconnect a refresh", async () => {
  let now = 1_000, expired = 0;
  const lease = createSocketCredentialLease("alice", 1.02, () => now);
  const cancel = lease.scheduleExpiry(() => expired++);
  now = 1_020;
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(expired, 1);
  cancel();
  now = 1_000;
  const cancelOld = createSocketCredentialLease("alice", 1.01, () => now).scheduleExpiry(() => expired++);
  cancelOld();
  now = 1_020;
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(expired, 1);
});
