import assert from "node:assert/strict";
import test from "node:test";
import { profileUpdateSchema } from "./profile-fields.js";

const track = { provider: "youtube", providerId: "abcdefghijk", title: "A song", addedBy: { id: "private" }, roomId: "private-room" };
test("profile showcases strip private fields and normalize handles", () => {
  const value = profileUpdateSchema.parse({ handle: " Alex_1 ", favoriteTracks: [track], is_app_admin: true });
  assert.equal(value.handle, "alex_1");
  assert.deepEqual(value.favoriteTracks, [{ provider: "youtube", providerId: "abcdefghijk", title: "A song" }]);
  assert.equal("is_app_admin" in value, false);
});
test("profile showcases reject duplicates, invalid recordings, unsafe URLs and oversized lists", () => {
  for (const favoriteTracks of [[track, track], [{ ...track, providerId: "bad" }], [{ ...track, artworkUrl: "javascript:alert(1)" }], Array.from({length:4}, (_,i) => ({...track, providerId: `abcdefghij${i}`}))]) {
    assert.equal(profileUpdateSchema.safeParse({ favoriteTracks }).success, false);
  }
  assert.equal(profileUpdateSchema.safeParse({ statusText: "x".repeat(81) }).success, false);
  assert.equal(profileUpdateSchema.safeParse({ handle: "ab" }).success, false);
  assert.equal(profileUpdateSchema.safeParse({ is_app_admin: true }).success, false);
});
