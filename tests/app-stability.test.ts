import assert from "node:assert/strict";
import test from "node:test";
import { parseRuntimeConfig } from "../src/runtime-config.js";
import { requestSocketAction } from "../src/socket-request.js";
import { readStoredValue, storeValue } from "../src/lib/browser-storage.js";
import { recoveryAfterAuthEvent } from "../src/auth-state.js";

test("account recovery survives initialization but does not reopen after completion", () => {
  assert.equal(recoveryAfterAuthEvent("SIGNED_IN", false, true), true);
  assert.equal(recoveryAfterAuthEvent("PASSWORD_RECOVERY", false, false), true);
  assert.equal(recoveryAfterAuthEvent("TOKEN_REFRESHED", true, false), true);
  assert.equal(recoveryAfterAuthEvent("USER_UPDATED", false, false), false);
  assert.equal(recoveryAfterAuthEvent("SIGNED_OUT", true, false), false);
});

test("runtime configuration enables local mode only for an explicit null", () => {
  assert.deepEqual(parseRuntimeConfig({ supabase: null }), { supabase: null });
  for (const config of [null, {}, { supabase: false }, { supabase: {} },
    { supabase: { url: "https://example.com", anonKey: "" } },
    { supabase: { url: "javascript:alert(1)", anonKey: "public" } }]) {
    assert.throws(() => parseRuntimeConfig(config));
  }
  assert.equal(parseRuntimeConfig({ supabase: { url: "https://example.com", anonKey: "public" } }).supabase?.url, "https://example.com");
});

test("offline actions are rejected without buffering a request", () => {
  let result: unknown;
  requestSocketAction({ connected: false, timeout() { throw new Error("Must not emit"); } },
    "queue:add", {}, (reply) => { result = reply; });
  assert.equal((result as { ok: boolean }).ok, false);
});

test("socket requests report timeouts and malformed replies and retain success metadata", () => {
  for (const response of [undefined, {}, { ok: true, started: true, position: 2 }]) {
    let result: unknown;
    const client = { connected: true, timeout(ms: number) {
      assert.equal(ms, 15_000);
      return { emit(_event: string, _payload: unknown, callback: Function) { callback(null, response); } };
    } };
    requestSocketAction(client, "queue:add", {}, (reply) => { result = reply; });
    assert.equal((result as { ok: boolean }).ok, Boolean(response && "ok" in response));
  }
  let timeoutResult: { ok: boolean } | undefined;
  requestSocketAction({ connected: true, timeout() {
    return { emit(_event: string, _payload: unknown, callback: Function) { callback(new Error("timeout")); } };
  } }, "queue:add", {}, (reply) => { timeoutResult = reply; });
  assert.equal(timeoutResult?.ok, false);
});

test("blocked browser storage does not prevent reading or updating preferences", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("Storage blocked"); } });
  try {
    assert.equal(readStoredValue("profile"), null);
    assert.doesNotThrow(() => storeValue("profile", "value"));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
