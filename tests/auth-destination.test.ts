import assert from "node:assert/strict";
import test from "node:test";
import { rememberAuthDestination, safeAuthDestination, takeAuthDestination } from "../src/lib/auth-destination";

test("signup retains a room invitation across auth screens and consumes it once", () => {
  rememberAuthDestination("/room/friday-focus");
  rememberAuthDestination("/sign-up");
  rememberAuthDestination("/login");
  assert.equal(takeAuthDestination(), "/room/friday-focus");
  assert.equal(takeAuthDestination(), "/");
});

test("auth return destinations never redirect to another origin or arbitrary paths", () => {
  for (const path of ["//evil.example", "https://evil.example", "/room/../admin", "/room/lounge?redirect=evil", "/login", null]) {
    assert.equal(safeAuthDestination(path), null);
  }
});
