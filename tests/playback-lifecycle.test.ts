import assert from "node:assert/strict";
import test from "node:test";
import { PlaybackCommandLifecycle } from "../src/provider-playback.js";


test("changing playback source keeps delayed cleanup from stopping the new audio", async () => {
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
