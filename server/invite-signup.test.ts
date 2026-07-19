import assert from "node:assert/strict";
import test from "node:test";
import {
  invitePasswordMatches,
  inviteSignupSchema,
  SignupAttemptLimiter
} from "./invite-signup.js";

test("invite signup validation accepts the expected payload", () => {
  const result = inviteSignupSchema.safeParse({
    email: " friend@example.com ",
    password: "correct horse battery staple",
    invitePassword: "the listening room"
  });

  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.email, "friend@example.com");
});

test("invite signup validation rejects extra fields and short passwords", () => {
  assert.equal(inviteSignupSchema.safeParse({
    email: "friend@example.com",
    password: "short",
    invitePassword: "invite",
    isAdmin: true
  }).success, false);
});

test("invite password comparison only accepts the configured password", () => {
  assert.equal(invitePasswordMatches("open-sesame", "open-sesame"), true);
  assert.equal(invitePasswordMatches("open-sesamf", "open-sesame"), false);
});

test("signup attempt limiter blocks excess attempts until reset", () => {
  const limiter = new SignupAttemptLimiter(2, 1_000);

  assert.equal(limiter.consume("listener", 1_000), true);
  assert.equal(limiter.consume("listener", 1_001), true);
  assert.equal(limiter.consume("listener", 1_002), false);
  assert.equal(limiter.consume("listener", 2_001), true);
  limiter.reset("listener");
  assert.equal(limiter.consume("listener", 2_002), true);
});
