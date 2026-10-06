import assert from "node:assert/strict";
import test from "node:test";
import { RoomPlaybackClock } from "../src/playback-clock";
import type { Playback, RoomSnapshot } from "../src/types";

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

test("room playback uses server elapsed time when listener clocks are ahead or behind", () => {
  for (const offset of [-300_000, 300_000]) {
    const incoming = snapshot();
    const receivedAt = incoming.serverTime + offset;
    const normalized = new RoomPlaybackClock().normalize(incoming, receivedAt);
    assert.equal(positionAt(normalized.room.playback, receivedAt), 14);
    assert.equal(positionAt(normalized.room.playback, receivedAt + 2_000), 16);
    assert.equal(incoming.room.playback.updatedAt, 90_000);
  }
});

test("unchanged room refreshes preserve the translated checkpoint despite delivery jitter", () => {
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

test("paused playback retains its requested position across time and room refreshes", () => {
  const clock = new RoomPlaybackClock();
  const incoming = snapshot();
  incoming.room.playback.playing = false;
  incoming.room.playback.position = 25;
  const normalized = clock.normalize(incoming, 400_000);
  assert.equal(positionAt(normalized.room.playback, 500_000), 25);
  const refreshed = clock.normalize({ ...incoming, serverTime: 110_000 }, 411_000);
  assert.equal(refreshed.room.playback.updatedAt, normalized.room.playback.updatedAt);
  assert.equal(positionAt(refreshed.room.playback, 500_000), 25);
});

test("a new timestamp, seek, play state, track, or room creates a new checkpoint", () => {
  const changes = [
    (next: RoomSnapshot) => { next.room.playback.updatedAt = 95_000; },
    (next: RoomSnapshot) => { next.room.playback.position = 45; },
    (next: RoomSnapshot) => { next.room.playback.playing = false; },
    (next: RoomSnapshot) => { next.room.playback.track!.id = "track-b"; },
    (next: RoomSnapshot) => { next.room.id = "room-b"; }
  ];
  for (const change of changes) {
    const clock = new RoomPlaybackClock();
    const incoming = snapshot();
    const first = clock.normalize(incoming, 400_000);
    const next = structuredClone(incoming);
    change(next);
    const normalized = clock.normalize(next, 402_000);
    assert.notEqual(normalized.room.playback.updatedAt, first.room.playback.updatedAt);
    assert.equal(normalized.room.playback.updatedAt, 402_000 - Math.max(0, next.serverTime - next.room.playback.updatedAt));
  }
});

test("a server timestamp in the future cannot give a negative elapsed position", () => {
  const incoming = snapshot();
  incoming.room.playback.updatedAt = incoming.serverTime + 5_000;
  incoming.room.playback.position = 0;
  const normalized = new RoomPlaybackClock().normalize(incoming, 400_000);
  assert.equal(positionAt(normalized.room.playback, 400_000), 0);
});
