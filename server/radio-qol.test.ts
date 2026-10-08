import assert from "node:assert/strict";
import test from "node:test";
import { advanceRadio, appendQueueSet, normalizeRadioState, QueueUndoRegistry, roomForListener } from "./radio.js";
import type { Room, Track, User } from "./types.js";
const alice: User = { id: "alice", name: "Alice", avatarSeed: "a" };
const bob: User = { id: "bob", name: "Bob", avatarSeed: "b" };
const track = (id: string, user = alice): Track => ({ id, provider: "youtube", providerId: id, title: id, addedBy: user, addedAt: 10 });
const room = (): Room => ({ id: "qol-room", name: "QOL", ownerUserId: alice.id, moderatorUserIds: [], djRoleUserIds: [], isPublic: true, passwordProtected: false, settings: {}, djUserId: bob.id, djQueueUserIds: [alice.id, bob.id], djQueues: { alice: [track("a"), track("b"), track("c")], bob: [track("bob-next", bob)] }, history: [], playback: { track: track("on-air", bob), playing: true, position: 12, updatedAt: 100 }, vibe: null, createdAt: 1 });

test("Undo preserves identity, surviving anchors, another DJ's playback and private boundary", () => {
  const state = room(); const undo = new QueueUndoRegistry();
  const receipt = undo.remove(state, alice.id, "b", 100);
  state.djQueues.alice.unshift(track("new"));
  state.djQueues.alice.reverse(); // another tab may legitimately reorder while removal is pending
  const beforePlayback = structuredClone(state.playback); const beforeLineup = [...state.djQueueUserIds];
  const result = undo.restore(state, alice.id, receipt.token, 200);
  assert.equal(result.track.id, "b");
  assert.equal(state.djQueues.alice[result.position]?.id, "c");
  assert.deepEqual(state.playback, beforePlayback); assert.deepEqual(state.djQueueUserIds, beforeLineup);
  assert.equal(JSON.stringify(roomForListener(state, bob.id)).includes(receipt.token), false);
  assert.equal(JSON.stringify(roomForListener(state, bob.id)).includes('"id":"b"'), false);
  assert.throws(() => undo.restore(state, alice.id, receipt.token, 201), /expired/);
});
test("Undo is bound to recipient and room and expires after leaving the lineup", () => {
  const state = room(); const undo = new QueueUndoRegistry(500); const receipt = undo.remove(state, alice.id, "b", 100);
  assert.throws(() => undo.restore(state, bob.id, receipt.token, 110), /different room or account/);
  assert.throws(() => undo.restore(room(), alice.id, receipt.token, 110), /different room or account/);
  state.djQueueUserIds = [bob.id];
  state.settings.djAccess = "roles"; state.ownerUserId = bob.id;
  assert.equal(undo.restore(state, alice.id, receipt.token, 120).track.id, "b");
  const later = undo.remove(state, alice.id, "b", 120);
  assert.throws(() => undo.restore(state, alice.id, later.token, 620), /expired/);
});
test("Undo cannot duplicate a re-add, resurrect a played item, or start quiet-room audio", () => {
  const state = room(); const undo = new QueueUndoRegistry(); const receipt = undo.remove(state, alice.id, "b", 100);
  state.djQueues.alice.push({ ...track("new-b"), providerId: "b" });
  assert.throws(() => undo.restore(state, alice.id, receipt.token, 200), /already playing or waiting/);
  state.djQueues.alice.pop(); state.history.push(track("b"));
  assert.throws(() => undo.restore(state, alice.id, receipt.token, 201), /already played/);
  state.history = []; state.djQueues.alice = []; state.djQueues.bob = [];
  state.playback = { track: null, playing: false, position: 0, updatedAt: 300 }; state.djUserId = null;
  undo.restore(state, alice.id, receipt.token, 301);
  assert.deepEqual(state.djQueues.alice.map((item) => item.id), ["b"]);
  assert.equal(state.playback.track, null); assert.equal(state.playback.playing, false);
  assert.deepEqual(state.djQueueUserIds, [alice.id, bob.id]);
});
test("history records actual distinct start times and leaves unknown legacy times unknown", () => {
  const state = room(); advanceRadio(state, 10_000); advanceRadio(state, 20_000);
  assert.equal(state.history[0].playedAt, 10_000);
  assert.equal(state.history[1].playedAt, undefined);
  assert.equal(state.playback.track?.playedAt, 20_000);
  assert.equal(state.history[0].addedAt, 10);
});
test("set append preserves order and rotation and reports every duplicate including within-set repeats", () => {
  const state = room(); const before = structuredClone(state.playback); const lineup = [...state.djQueueUserIds];
  const input = (id: string) => ({ provider: "youtube" as const, providerId: id, title: id });
  const result = appendQueueSet(state, alice, [input("b"), input("d"), input("e"), input("d"), input("on-air")], 20);
  assert.equal(result.added, 2); assert.equal(result.skipped.length, 3); assert.equal(result.started, false);
  assert.deepEqual(state.djQueues.alice.map((item) => item.title), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(state.playback, before); assert.deepEqual(state.djQueueUserIds, lineup);
  assert.throws(() => appendQueueSet(state, alice, []), /between 1 and 50/);
});

test("listeners can prepare private sets in a quiet restricted room without entering rotation", () => {
  const state = room(); state.ownerUserId = bob.id; state.settings.djAccess = "roles";
  state.djQueueUserIds = [bob.id]; state.djUserId = null; state.djQueues.bob = [];
  state.playback = { track: null, playing: false, position: 0, updatedAt: 100 };
  const before = structuredClone(state.playback);
  const result = appendQueueSet(state, alice, [{ provider: "youtube", providerId: "new", title: "New pick" }], 200);
  assert.equal(result.added, 1); assert.equal(result.started, false);
  assert.deepEqual(state.playback, before); assert.deepEqual(state.djQueueUserIds, [bob.id]);
  const restored = JSON.parse(JSON.stringify(state)) as Room;
  normalizeRadioState(restored);
  assert.deepEqual(restored.djQueueUserIds, [bob.id]);
  assert.equal(roomForListener(restored, alice.id).queue.length, 4);
  assert.deepEqual(roomForListener(restored, bob.id).queue, []);
  assert.equal(advanceRadio(restored, 300), null);
  assert.equal(restored.djQueues.alice.length, 4);
});

test("a failed remove restores only its original track among concurrent queue edits and rotation", async () => {
  const state = room(); const undo = new QueueUndoRegistry();
  const mutation = undo.beginRemove(state, alice.id, "b", 100);
  let rejectSave!: (error: Error) => void;
  const save = new Promise<void>((_resolve, reject) => { rejectSave = reject; });
  state.djQueues.alice.unshift(track("new"));
  state.djQueues.alice.reverse();
  advanceRadio(state, 150);
  const currentPlayback = structuredClone(state.playback); const currentLineup = [...state.djQueueUserIds];
  rejectSave(new Error("storage unavailable"));
  await assert.rejects(save, /storage unavailable/);
  assert.deepEqual(mutation.rollback(), { status: "rolled-back", changed: true, undoAvailable: false });
  assert.deepEqual(state.djQueues.alice.map(item => item.id), ["a", "b", "new"]);
  assert.deepEqual(state.playback, currentPlayback); assert.deepEqual(state.djQueueUserIds, currentLineup);
  assert.equal(state.playback.track?.id, "c");
  mutation.rollback(); mutation.commit();
  assert.equal(state.djQueues.alice.filter(item => item.id === "b").length, 1);
  assert.throws(() => undo.restore(state, alice.id, mutation.receipt.token, 200), /expired/);
});

test("failed Undo removes only its waiting object and retains the receipt's original expiry", async () => {
  const state = room(); const undo = new QueueUndoRegistry(500);
  const receipt = undo.remove(state, alice.id, "b", 100);
  const mutation = undo.beginRestore(state, alice.id, receipt.token, 200);
  assert.throws(() => undo.beginRestore(state, alice.id, receipt.token, 201), /still being saved/);
  state.djQueues.alice.unshift(track("new")); state.djQueues.alice.reverse();
  const otherOrder = state.djQueues.alice.filter(item => item.id !== "b").map(item => item.id);
  const playback = structuredClone(state.playback);
  await assert.rejects(Promise.reject(new Error("save failed")), /save failed/);
  assert.deepEqual(mutation.rollback(250), { status: "rolled-back", changed: true, undoAvailable: true });
  assert.deepEqual(state.djQueues.alice.map(item => item.id), otherOrder);
  assert.deepEqual(state.playback, playback);
  const retry = undo.beginRestore(state, alice.id, receipt.token, 599);
  assert.equal(retry.result.track.id, "b");
  assert.deepEqual(retry.rollback(600), { status: "rolled-back", changed: true, undoAvailable: false });
  assert.throws(() => undo.restore(state, alice.id, receipt.token, 601), /expired/);
});

test("Undo save failure never rewinds a restored track that another action has put on air", () => {
  const state = room(); const undo = new QueueUndoRegistry();
  const receipt = undo.remove(state, alice.id, "b", 100);
  state.djQueues.alice = [];
  const mutation = undo.beginRestore(state, alice.id, receipt.token, 200);
  advanceRadio(state, 210);
  const playback = structuredClone(state.playback); const history = structuredClone(state.history);
  assert.deepEqual(mutation.rollback(220), { status: "superseded", changed: false, undoAvailable: false });
  assert.deepEqual(state.playback, playback); assert.deepEqual(state.history, history);
  assert.equal(state.playback.track?.id, "b");
  assert.throws(() => undo.restore(state, alice.id, receipt.token, 230), /expired/);
});

test("rollback does not remove a concurrent replacement or overwrite a newer removal receipt", () => {
  const state = room(); const undo = new QueueUndoRegistry();
  const receipt = undo.remove(state, alice.id, "b", 100);
  const mutation = undo.beginRestore(state, alice.id, receipt.token, 200);
  const replacement = { ...mutation.result.track, title: "Updated in another operation" };
  state.djQueues.alice[state.djQueues.alice.indexOf(mutation.result.track)] = replacement;
  assert.equal(mutation.rollback(201).status, "superseded");
  assert.equal(state.djQueues.alice.find(item => item.id === "b"), replacement);

  const secondReceipt = undo.remove(state, alice.id, "b", 210);
  const second = undo.beginRestore(state, alice.id, secondReceipt.token, 220);
  const latest = undo.remove(state, alice.id, "c", 230);
  assert.deepEqual(second.rollback(240), { status: "rolled-back", changed: true, undoAvailable: false });
  assert.throws(() => undo.restore(state, alice.id, secondReceipt.token, 250), /expired/);
  assert.equal(undo.restore(state, alice.id, latest.token, 251).track.id, "c");
});

test("failed remove does not duplicate a concurrent re-add and cannot invalidate another tab's newest Undo", () => {
  const state = room(); const undo = new QueueUndoRegistry();
  const first = undo.beginRemove(state, alice.id, "b", 100);
  assert.throws(() => undo.restore(state, alice.id, first.receipt.token, 101), /still being saved/);
  const latest = undo.remove(state, alice.id, "c", 110);
  state.djQueues.alice.push({ ...track("re-added-b"), providerId: "b" });
  assert.deepEqual(first.rollback(), { status: "superseded", changed: false, undoAvailable: false });
  assert.equal(state.djQueues.alice.filter(item => item.providerId === "b").length, 1);
  assert.throws(() => undo.restore(state, alice.id, first.receipt.token, 120), /expired/);
  assert.throws(() => undo.remove(state, alice.id, "does-not-exist", 121), /no longer in your queue/);
  assert.equal(undo.restore(state, alice.id, latest.token, 122).track.id, "c");
});
