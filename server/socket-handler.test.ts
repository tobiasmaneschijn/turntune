import assert from "node:assert/strict";
import test from "node:test";
import { safeSocketHandler, serialSocketHandler } from "./socket-handler.js";
import { validateServerConfig } from "./config.js";

test("socket failures are reported to the caller without an unhandled rejection", async () => {
  let result: { ok: boolean; error?: string } | undefined;
  const errors: unknown[] = [];
  await safeSocketHandler(async () => { throw new Error("Database unavailable"); }, (error) => errors.push(error))
    ({}, (reply: typeof result) => { result = reply; });
  assert.equal(result?.ok, false);
  assert.equal(errors.length, 1);
});

test("malformed acknowledgements cannot crash a socket listener", async () => {
  const handler = safeSocketHandler((_payload, reply) => { reply?.({ ok: true }); });
  for (const reply of [undefined, "invalid", {}, 1]) await handler({}, reply);
});

test("joins complete in request order even when the first operation fails", async () => {
  const events: number[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const join = serialSocketHandler(async (payload) => {
    if (payload === 1) { await gate; events.push(1); throw new Error("Failed join"); }
    events.push(payload as number);
  });
  const first = join(1).catch(() => {});
  const second = join(2);
  await Promise.resolve();
  assert.deepEqual(events, []);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(events, [1, 2]);
});

test("server rejects partial configuration and unauthenticated production startup", () => {
  assert.throws(() => validateServerConfig({}), /authentication is required/);
  assert.doesNotThrow(() => validateServerConfig({ NODE_ENV: "test" }));
  assert.doesNotThrow(() => validateServerConfig({ NODE_ENV: "development" }));
  assert.throws(() => validateServerConfig({ SUPABASE_URL: "https://example.com" }), /Incomplete/);
  assert.throws(() => validateServerConfig({ NODE_ENV: "production" }), /authentication is required/);
  assert.throws(() => validateServerConfig({ NODE_ENV: "production", SUPABASE_URL: "url", SUPABASE_PUBLISHABLE_KEY: "public", SUPABASE_SECRET_KEY: "secret", SUPABASE_JWKS_URL: "jwks" }));
  assert.doesNotThrow(() => validateServerConfig({ NODE_ENV: "production", SUPABASE_URL: "https://project.invalid",
    SUPABASE_PUBLISHABLE_KEY: "public", SUPABASE_SECRET_KEY: "secret", SUPABASE_JWKS_URL: "https://project.invalid/auth/v1/.well-known/jwks.json" }));
});
