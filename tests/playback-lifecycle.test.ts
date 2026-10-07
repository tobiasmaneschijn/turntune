import assert from "node:assert/strict";
import test from "node:test";
import { PlaybackCommandLifecycle, playbackNeedsSeek, playbackTargetPosition } from "../src/provider-playback.js";

test("release waits for an in-flight device command before stopping audio", async () => {
  const lifecycle = new PlaybackCommandLifecycle();
  const lease = lifecycle.claim();
  const calls: string[] = [];
  let complete!: () => void;
  const blocked = new Promise<void>((resolve) => { complete = resolve; });
  const command = lease.enqueue(async () => { calls.push("play-start"); await blocked; calls.push("play-finish"); });
  await Promise.resolve();
  const released = lease.release(async () => { calls.push("pause"); });
  assert.deepEqual(calls, ["play-start"]);
  complete();
  await Promise.all([command, released]);
  assert.deepEqual(calls, ["play-start", "play-finish", "pause"]);
});

test("a new adapter owns the device before a delayed cleanup can pause it", async () => {
  const lifecycle = new PlaybackCommandLifecycle();
  const old = lifecycle.claim();
  const calls: string[] = [];
  let complete!: () => void;
  const blocked = new Promise<void>((resolve) => { complete = resolve; });
  const oldCommand = old.enqueue(async () => { calls.push("old-start"); await blocked; calls.push("old-finish"); });
  await Promise.resolve();
  const cleanup = old.release(async () => { calls.push("old-pause"); });
  const latest = lifecycle.claim();
  const newCommand = latest.enqueue(async () => { calls.push("latest-play"); });
  complete();
  await Promise.all([oldCommand, cleanup, newCommand]);
  assert.equal(old.current(), false);
  assert.deepEqual(calls, ["old-start", "old-finish", "latest-play"]);
});

test("failed commands cannot block a device release", async () => {
  const lease = new PlaybackCommandLifecycle().claim();
  await assert.rejects(lease.enqueue(async () => { throw new Error("provider offline"); }), /offline/);
  let stopped = false;
  await lease.release(async () => { stopped = true; });
  assert.equal(stopped, true);
});

test("small explicit seeks take precedence over background drift tolerance", () => {
  assert.equal(playbackNeedsSeek(10, 11, "checkpoint"), true);
  assert.equal(playbackNeedsSeek(10, 11, "manual"), true);
  assert.equal(playbackNeedsSeek(10, 11, "health"), false);
  assert.equal(playbackNeedsSeek(10, 13, "health"), true);
  assert.equal(playbackTargetPosition({ track: null, position: 10, playing: true, updatedAt: 2_000 }, 1_000), 10);
});
