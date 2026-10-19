import assert from "node:assert/strict";
import test from "node:test";
import { ChatRateLimit, ChatWriteConflict, createChatWritePolicy } from "./chat-write-policy.js";
import { chatMessageSchema } from "./chat-validation.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const initialTime = Date.parse("2026-10-07T10:00:00.000Z");
const message = (n: number, date = initialTime) => chatMessageSchema.parse({ id: id(n), content: "Hello", type: "text", createdAt: new Date(date).toISOString() });

test("fresh message timestamps are bounded while verified durable originals and immutable retries remain retryable", () => {
  let now = initialTime;
  const policy = createChatWritePolicy(() => now);
  for (const date of [now + 300_001, now - 86_400_001]) assert.throws(() => policy.message("lounge", "alice", message(1, date)), /time is no longer valid/);
  policy.message("lounge", "alice", message(1));
  assert.throws(() => policy.message("lounge", "alice", { ...message(1), content: "changed" }), ChatWriteConflict);
  assert.throws(() => policy.message("other-room", "alice", message(1)), ChatWriteConflict);
  assert.throws(() => policy.message("lounge", "bob", message(1)), ChatWriteConflict);
  now += 86_400_001;
  policy.message("lounge", "alice", message(1), true);
  policy.message("lounge", "alice", message(2, initialTime - 86_400_001), true);
});

test("HTTP plus relay and duplicate retries charge one account operation, with independent account/room limits", () => {
  let now = initialTime;
  const policy = createChatWritePolicy(() => now);
  for (let n = 1; n <= 20; n++) {
    policy.message("lounge", "alice", message(n));
    policy.message("lounge", "alice", message(n));
  }
  assert.throws(() => policy.message("lounge", "alice", message(21)), ChatRateLimit);
  policy.message("lounge", "alice", message(1), true);
  policy.message("lounge", "bob", message(22));
  policy.message("other-room", "alice", message(23));
  now += 10_000;
  policy.message("lounge", "alice", message(21));
});

test("reaction operation IDs coalesce persistence and broadcast without allowing conflicting retries", () => {
  const policy = createChatWritePolicy(() => initialTime);
  const reaction = (n: number) => ({ id: id(n), messageId: id(100), action: "add", emoji: "❤️" });
  for (let n = 1; n <= 60; n++) {
    policy.reaction("lounge", "alice", reaction(n));
    policy.reaction("lounge", "alice", reaction(n));
  }
  assert.throws(() => policy.reaction("lounge", "alice", reaction(61)), ChatRateLimit);
  assert.throws(() => policy.reaction("lounge", "alice", { ...reaction(1), action: "remove" }), ChatWriteConflict);
  policy.reaction("lounge", "alice", reaction(1));
});
