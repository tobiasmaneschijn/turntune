import assert from "node:assert/strict";
import test from "node:test";
import { PlaybackEndTracker } from "../src/playback-progress";

test("track completion fires once after current track progress reaches the end", () => {
  const tracker = new PlaybackEndTracker();
  assert.equal(tracker.observe("track-a", 179, 180, false, true), false);
  assert.equal(tracker.observe("track-a", 0, 180, true, true), true);
  assert.equal(tracker.observe("track-a", 0, 180, true, true), false);
});

test("previous track progress cannot end a newly selected recording", () => {
  const tracker = new PlaybackEndTracker();
  tracker.observe("track-a", 179, 180, false, true);
  assert.equal(tracker.observe("track-b", 0, 120, true, true), false);
  tracker.observe("track-b", 119, 120, false, true);
  assert.equal(tracker.observe("track-b", 0, 120, true, true), true);
});

test("manual pause, unrelated playback, and invalid progress cannot advance a room", () => {
  const tracker = new PlaybackEndTracker();
  tracker.observe("track-a", 179, 180, false, true);
  assert.equal(tracker.observe("track-a", 179, 180, true, false), false);
  assert.equal(tracker.observe("track-a", 0, 180, false, true), false);
  assert.equal(tracker.observe("track-a", 0, 180, true, true), false);
  assert.equal(tracker.observe("short-track", 0, 1, true, true), false);
  assert.equal(tracker.observe("track-a", NaN, 180, true, true), false);
});
