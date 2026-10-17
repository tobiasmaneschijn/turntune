import assert from "node:assert/strict";
import test from "node:test";
import { localPlaybackAligned, playbackFeedback } from "../src/playback-feedback.js";

const status = { ready: true, buffering: false, currentTime: 30, duration: 120 };
const input = { connected: true, roomPlaying: true, status, provider: "Spotify" };


test("listeners only see synchronization confirmed by measured local playback", () => {
  const feedback = playbackFeedback(input);
  assert.notEqual(feedback.tone, "live");
  assert.doesNotMatch(feedback.text, /\b(?:playing|synced|synchronized)\b/i);
  assert.equal(localPlaybackAligned(status, true, 30), false);
  assert.equal(localPlaybackAligned({ ...status, playing: true }, true, 30), true);
  assert.equal(localPlaybackAligned({ ...status, playing: true, buffering: true }, true, 30), false);
  assert.equal(localPlaybackAligned({ ...status, playing: true }, true, 40), false);
});
