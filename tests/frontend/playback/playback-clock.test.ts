import assert from "node:assert/strict";
import test from "node:test";
import { RoomPlaybackClock } from "../../../src/features/playback/playback-clock";
import type { Playback, RoomSnapshot } from "../../../src/types";

function snapshot(): RoomSnapshot {
  return {
    room: {
      id: "room-a",
      name: "Room A",
      ownerUserId: "dj",
      moderatorUserIds: [],
      djRoleUserIds: [],
      isPublic: true,
      passwordProtected: false,
      settings: {},
      djUserId: "dj",
      djQueueUserIds: ["dj"],
      queue: [],
      history: [],
      playback: {
        track: {
          id: "track-a",
          provider: "spotify",
          providerId: "recording-a",
          title: "Track A",
          addedBy: { id: "dj", name: "DJ", avatarSeed: "dj" },
          addedAt: 1
        },
        playing: true,
        position: 4,
        updatedAt: 90_000
      },
      vibe: null,
      createdAt: 1
    },
    users: [],
    djUsers: [],
    serverTime: 100_000
  };
}

function positionAt(playback: Playback, now: number) {
  return playback.position + (playback.playing ? (now - playback.updatedAt) / 1000 : 0);
}


test("listeners hear the same room position despite different device clocks", () => {
  for (const offset of [-300_000, 300_000]) {
    const incoming = snapshot();
    const receivedAt = incoming.serverTime + offset;
    const normalized = new RoomPlaybackClock().normalize(incoming, receivedAt);
    assert.equal(positionAt(normalized.room.playback, receivedAt), 14);
    assert.equal(positionAt(normalized.room.playback, receivedAt + 2_000), 16);
    assert.equal(incoming.room.playback.updatedAt, 90_000);
  }
});

test("room updates do not make listening jump when delivery is delayed", () => {
  const clock = new RoomPlaybackClock();
  const incoming = snapshot();
  const first = clock.normalize(incoming, 400_000);
  const next = structuredClone(incoming);
  next.serverTime += 5_000;
  next.room.playback.track!.title = "Updated track title";
  next.room.vibe = { trackId: "track-a", votes: { listener: 1 } };
  next.users = [{ id: "listener", name: "Listener", avatarSeed: "listener" }];
  const refreshed = clock.normalize(next, 405_600);
  assert.equal(refreshed.room.playback.updatedAt, first.room.playback.updatedAt);
  assert.equal(positionAt(refreshed.room.playback, 405_600), 19.6);
  assert.equal(refreshed.room.playback.track!.title, "Updated track title");
  assert.deepEqual(refreshed.room.vibe, next.room.vibe);
  assert.deepEqual(refreshed.users, next.users);
});
