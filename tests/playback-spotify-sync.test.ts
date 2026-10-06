import assert from "node:assert/strict";
import test from "node:test";
import { spotifyPlaybackSignature, spotifySyncActions, spotifyTargetPositionMs } from "../src/spotify-playback-sync";
import type { Playback } from "../src/types";

const playback: Playback = {
  track: { id: "instance-a", provider: "spotify", providerId: "recording-a", title: "A",
    addedBy: { id: "dj", name: "DJ", avatarSeed: "dj" }, addedAt: 0 },
  playing: true, position: 20, updatedAt: 1_000
};
const uri = "spotify:track:recording-a";

test("healthy Spotify playback tolerates small focus-check drift without mutations", () => {
  assert.deepEqual(spotifySyncActions(playback, uri, { uri, paused: false, positionMs: 23_000 }, false, 3_000), []);
});

test("Spotify corrections seek and resume the loaded recording without restarting it", () => {
  assert.deepEqual(spotifySyncActions(playback, uri, { uri, paused: true, positionMs: 5_000 }, false, 3_000), [
    { action: "seek", positionMs: 22_000 }, { action: "resume" }
  ]);
  assert.deepEqual(spotifySyncActions(playback, uri, { uri, paused: true, positionMs: 22_000 }, false, 3_000), [{ action: "resume" }]);
});

test("paused-room corrections pause before seeking and never start an unrelated recording", () => {
  const paused = { ...playback, playing: false };
  assert.deepEqual(spotifySyncActions(paused, uri, { uri, paused: false, positionMs: 10_000 }, false, 3_000), [
    { action: "pause" }, { action: "seek", positionMs: 20_000 }
  ]);
  assert.deepEqual(spotifySyncActions(paused, uri, { uri: "spotify:track:other", paused: true, positionMs: 10_000 }, false, 3_000), []);
});

test("manual sync applies even a small seek while missing or changed recordings are loaded", () => {
  assert.deepEqual(spotifySyncActions(playback, uri, { uri, paused: false, positionMs: 21_000 }, true, 3_000), [{ action: "seek", positionMs: 22_000 }]);
  for (const state of [null, { uri: "spotify:track:other", paused: false, positionMs: 22_000 }]) {
    assert.deepEqual(spotifySyncActions(playback, uri, state, false, 3_000), [{ action: "play", spotifyUri: uri, positionMs: 22_000 }]);
  }
});

test("explicit room seeks use exact positions but leave an exactly matched player untouched", () => {
  assert.deepEqual(spotifySyncActions(playback, uri, { uri, paused: false, positionMs: 21_000 }, false, 3_000, 0),
    [{ action: "seek", positionMs: 22_000 }]);
  assert.deepEqual(spotifySyncActions(playback, uri, { uri, paused: false, positionMs: 22_000 }, false, 3_000, 0), []);
});

test("an idle or unmapped room pauses the player", () => {
  assert.deepEqual(spotifySyncActions({ ...playback, track: null }, "", { uri, paused: false, positionMs: 0 }), [{ action: "pause" }]);
  assert.deepEqual(spotifySyncActions(playback, "", { uri, paused: true, positionMs: 0 }), []);
});

test("target position uses current elapsed time and command identity includes the mapping", () => {
  assert.equal(spotifyTargetPositionMs(playback, 4_000), 23_000);
  assert.equal(spotifyTargetPositionMs(playback, 0), 20_000);
  assert.notEqual(spotifyPlaybackSignature(playback, { providerId: "a" }, "device"),
    spotifyPlaybackSignature(playback, { providerId: "b" }, "device"));
});
