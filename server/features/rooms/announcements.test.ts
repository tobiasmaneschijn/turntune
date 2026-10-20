import assert from "node:assert/strict";
import test from "node:test";
import { activeAnnouncement, announcementSchema, AnnouncementExpiryRegistry, changeAnnouncement } from "./announcements.js";
import type { Room } from "../../types.js";
const room = () => ({ ownerUserId: "owner", moderatorUserIds: ["mod"], announcement: null } as unknown as Room);

test("room notes are owner/moderator-only and use optimistic revision checks", () => {
  const state = room();
  const input = announcementSchema.parse({ expectedId: null, text: "  One pick per turn.  ", expiresInMinutes: 60 });
  assert.throws(() => changeAnnouncement(state, "listener", input), /owners and moderators/);
  const note = changeAnnouncement(state, "owner", input, 1000)!;
  assert.equal(note.text, "One pick per turn."); assert.equal(note.expiresAt, 3_601_000);
  const kept = changeAnnouncement(state, "owner", { expectedId: note.id, text: "Updated wording", expiresInMinutes: "keep" }, 1001)!;
  assert.equal(kept.expiresAt, note.expiresAt);
  assert.throws(() => changeAnnouncement(state, "mod", input, 1001), /changed/);
  const edited = changeAnnouncement(state, "mod", { ...input, expectedId: kept.id, text: "New theme", expiresInMinutes: null }, 1002)!;
  assert.notEqual(edited.id, note.id); assert.equal(edited.expiresAt, null);
  assert.equal(changeAnnouncement(state, "owner", { ...input, expectedId: edited.id, text: "" }, 1003), null);
});

test("expiry registry cancels superseded notes and persists the current expiry", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000 });
  const state = { ...room(), id: "room" };
  const expired: string[] = [];
  const registry = new AnnouncementExpiryRegistry(async (value) => { value.announcement = null; expired.push(value.id); });
  t.after(() => registry.clear());
  const first = changeAnnouncement(state, "owner", { expectedId: null, text: "First", expiresInMinutes: 1 });
  registry.watch(state);
  const next = changeAnnouncement(state, "owner", { expectedId: first!.id, text: "Replacement", expiresInMinutes: 2 });
  registry.watch(state);
  t.mock.timers.tick(60_000);
  assert.equal(state.announcement?.id, next!.id); assert.deepEqual(expired, []);
  t.mock.timers.tick(60_000);
  await Promise.resolve();
  assert.equal(state.announcement, null); assert.deepEqual(expired, ["room"]);
});

test("expiry is based on authoritative timestamps and stale notes cannot be revived", () => {
  const state = room();
  const note = changeAnnouncement(state, "owner", { expectedId: null, text: "Session theme", expiresInMinutes: 1 }, 1000)!;
  assert.equal(activeAnnouncement(note, 60_999)?.id, note.id);
  assert.equal(activeAnnouncement(note, 61_000), null);
  assert.throws(() => changeAnnouncement(state, "mod", { expectedId: note.id, text: "Stale edit", expiresInMinutes: null }, 61_001), /changed/);
  assert.equal(changeAnnouncement(state, "owner", { expectedId: null, text: "New session", expiresInMinutes: null }, 61_001)?.text, "New session");
});

test("notes enforce bounded plain-text input and filter malformed stored state", () => {
  assert.equal(announcementSchema.safeParse({ expectedId: null, text: "x".repeat(501) }).success, false);
  assert.equal(announcementSchema.safeParse({ expectedId: null, text: "ok", expiresInMinutes: 10081 }).success, false);
  assert.equal(activeAnnouncement({ id: "bad", text: "", authorId: "owner", updatedAt: 0, expiresAt: null }), null);
  assert.equal(changeAnnouncement(room(), "owner", { expectedId: null, text: "<b>text</b>", expiresInMinutes: null }, 1)?.text, "<b>text</b>");
});
