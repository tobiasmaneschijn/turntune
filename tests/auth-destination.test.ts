import assert from "node:assert/strict";
import test from "node:test";
import { rememberAuthDestination, safeAuthDestination, takeAuthDestination } from "../src/lib/auth-destination";
import { recoveryAfterAuthEvent } from "../src/auth-state.js";

test("Sign up from a room invitation and return to that room once", () => {
  rememberAuthDestination("/room/friday-focus");
  rememberAuthDestination("/sign-up");
  rememberAuthDestination("/login");
  assert.equal(takeAuthDestination(), "/room/friday-focus");
  assert.equal(takeAuthDestination(), "/");
});

test("Signing in cannot redirect a listener to an untrusted destination", () => {
  for (const path of ["//evil.example", "https://evil.example", "/room/../admin", "/room/lounge?redirect=evil", "/login", null]) {
    assert.equal(safeAuthDestination(path), null);
  }
});

test("Finish password recovery without reopening it on later account updates", () => {
  assert.equal(recoveryAfterAuthEvent("SIGNED_IN", false, true), true);
  assert.equal(recoveryAfterAuthEvent("PASSWORD_RECOVERY", false, false), true);
  assert.equal(recoveryAfterAuthEvent("TOKEN_REFRESHED", true, false), true);
  assert.equal(recoveryAfterAuthEvent("USER_UPDATED", false, false), false);
  assert.equal(recoveryAfterAuthEvent("SIGNED_OUT", true, false), false);
});
