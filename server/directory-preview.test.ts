import assert from "node:assert/strict";
import test from "node:test";
import { withPublicRoomPreview } from "./directory-preview.js";
import type { Room, RoomDirectoryEntry } from "./types.js";
const entry = { slug: "room", isPublic: true, passwordProtected: false, listenerCount: 2 } as RoomDirectoryEntry;
const room = { isPublic: true, passwordProtected: false, djQueues: { secret: [{ title: "Hidden pick" }] }, playback: { track: { title: "Now", artist: "Artist", provider: "youtube", artworkUrl: "https://example.com/art.png" }, playing: true } } as unknown as Room;
test("public preview has bounded safe current-track metadata and no queued picks", () => {
  const result = withPublicRoomPreview(entry, room, 123);
  assert.deepEqual(result.preview, { title: "Now", artist: "Artist", artworkUrl: "https://example.com/art.png", provider: "youtube", playing: true, observedAt: 123 });
  assert.ok(!JSON.stringify(result).includes("Hidden pick"));
  const malformed = structuredClone(room); malformed.playback.track!.artworkUrl = "javascript:bad"; malformed.playback.track!.title = "x".repeat(500);
  const safe = withPublicRoomPreview(entry, malformed).preview!;
  assert.equal(safe.title.length, 120); assert.equal(safe.artworkUrl, undefined);
});
test("private, protected, inactive or uncached room metadata never gets a preview", () => {
  for (const value of [{ ...entry, isPublic: false }, { ...entry, passwordProtected: true }, { ...entry, listenerCount: 0 }]) assert.equal(withPublicRoomPreview(value, room).preview, undefined);
  assert.equal(withPublicRoomPreview(entry, undefined).preview, undefined);
  assert.equal(withPublicRoomPreview(entry, { ...room, isPublic: false }).preview, undefined);
  assert.equal(withPublicRoomPreview(entry, { ...room, passwordProtected: true }).preview, undefined);
});
