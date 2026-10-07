import assert from "node:assert/strict";
import test from "node:test";
import { localPlaybackAligned, playbackFeedback } from "../src/playback-feedback.js";

const status = { ready: true, buffering: false, currentTime: 30, duration: 120 };
const input = { connected: true, roomPlaying: true, status, provider: "Spotify" };

test("SDK readiness does not imply verified playing or synchronization", () => {
  assert.equal(playbackFeedback(input).text, "Spotify ready · following the room");
  assert.equal(localPlaybackAligned(status, true, 30), false);
});
test("silent and ask fallback never claim that the listener hears music", () => {
  assert.match(playbackFeedback({ ...input, fallback: "silent" }).text, /silent/);
  assert.match(playbackFeedback({ ...input, fallback: "ask" }).text, /Choose/);
});
test("errors and loss of connection remain visible regardless of room play intent", () => {
  assert.equal(playbackFeedback({ ...input, error: "Seek failed" }).tone, "error");
  assert.match(playbackFeedback({ ...input, connected: false }).text, /connection lost/);
  assert.match(playbackFeedback({ ...input, status: { ...status, buffering: true } }).text, /Buffering/);
});
test("alignment requires confirmed local play state and position within tolerance", () => {
  assert.equal(localPlaybackAligned({ ...status, playing: true }, true, 32), true);
  assert.equal(localPlaybackAligned({ ...status, playing: false }, true, 30), false);
  assert.equal(localPlaybackAligned({ ...status, playing: true }, true, 34), false);
  assert.equal(localPlaybackAligned({ ...status, playing: true, buffering: true }, true, 30), false);
});
