import assert from "node:assert/strict";
import test from "node:test";
import { PlaybackEndTracker } from "../../../src/features/playback/playback-progress";


test("finishing a recording advances the room once and the next track starts fresh", () => {
  const tracker = new PlaybackEndTracker();
  assert.equal(tracker.observe("track-a", 179, 180, false, true), false);
  assert.equal(tracker.observe("track-a", 0, 180, true, true), true);
  assert.equal(tracker.observe("track-a", 0, 180, true, true), false);
  assert.equal(tracker.observe("track-b", 0, 120, true, true), false);
  tracker.observe("track-b", 119, 120, false, true);
  assert.equal(tracker.observe("track-b", 0, 120, true, true), true);
});

test("seeking back near the end does not skip to the next track", () => {
  const tracker = new PlaybackEndTracker();
  tracker.observe("track-a", 179, 180, false, true);
  assert.equal(tracker.observe("track-a", 10, 180, true, true), false);
  assert.equal(tracker.observe("track-a", 0, 180, true, true), false);
});
