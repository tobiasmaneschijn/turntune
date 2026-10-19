import assert from "node:assert/strict";
import test from "node:test";
import { spotifySyncActions } from "../src/spotify-playback-sync";
import type { Playback } from "../src/types";

const playback: Playback = {
  track: { id: "instance-a", provider: "spotify", providerId: "recording-a", title: "A",
    addedBy: { id: "dj", name: "DJ", avatarSeed: "dj" }, addedAt: 0 },
  playing: true, position: 20, updatedAt: 1_000
};
const uri = "spotify:track:recording-a";


test("a listener's explicit Sync corrects drift too small for automatic adjustment", () => {
  const state = { uri, paused: false, positionMs: 21_000 };
  assert.deepEqual(spotifySyncActions(playback, uri, state, false, 3_000), []);
  assert.deepEqual(spotifySyncActions(playback, uri, state, true, 3_000), [{ action: "seek", positionMs: 22_000 }]);
});
