import assert from "node:assert/strict";
import test from "node:test";
import { appleDeveloperTokenExpiresAt, createAppleMusicSession } from "../src/apple-music-session.js";

function token(expiresAt: number) {
  return `test.${Buffer.from(JSON.stringify({ exp: expiresAt / 1000 })).toString("base64url")}.test`;
}

test("Apple renews expiring credentials, preserves healthy sessions and shares concurrent refreshes", async () => {
  let now = 100_000;
  let requests = 0;
  let configured = 0;
  const session = createAppleMusicSession({
    now: () => now,
    requestToken: async () => { requests++; return { developerToken: token(now + 6 * 60 * 60 * 1000) }; },
    configure: async () => ({ id: ++configured })
  });
  const first = await session.get("session-1");
  now += 5 * 60 * 60 * 1000;
  assert.equal(await session.get("refreshed-app-session"), first);
  assert.equal(requests, 1);
  now += 60 * 60 * 1000;
  const [latest, concurrent] = await Promise.all([session.get("session-2"), session.get("session-2")]);
  assert.notEqual(latest, first);
  assert.equal(concurrent, latest);
  assert.equal(requests, 2);
  assert.equal(configured, 2);
});

test("an early refresh returning the same valid token does not reconfigure MusicKit", async () => {
  let now = 100_000;
  const developerToken = token(now + 120_000);
  let configured = 0;
  const session = createAppleMusicSession({
    now: () => now,
    requestToken: async () => ({ developerToken }),
    configure: async () => ({ id: ++configured })
  });
  const first = await session.get("session");
  now += 70_000;
  assert.equal(await session.get("session"), first);
  assert.equal(configured, 1);
});

test("malformed and expired tokens fail without preventing a later successful retry", async () => {
  let developerToken = "malformed";
  const session = createAppleMusicSession({
    now: () => 100_000,
    requestToken: async () => ({ developerToken }),
    configure: async () => ({ authorized: true })
  });
  await assert.rejects(session.get("session"), /valid expiry/);
  developerToken = token(99_000);
  await assert.rejects(session.get("session"), /expired/);
  developerToken = token(200_000);
  assert.equal((await session.get("session")).authorized, true);
  assert.equal(appleDeveloperTokenExpiresAt(developerToken), 200_000);
});
