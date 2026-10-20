import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Store } from "../../persistence/store.js";
import { ResourcePolicyStore } from "../../resources/resource-policy.js";
import { RoomCommandService } from "./room-command-service.js";
import { advanceRadio, QueueUndoRegistry } from "./radio.js";
import type { Room, Track } from "../../types.js";
import { configureTelemetry, type MetricOptions } from "../../../shared/observability.js";

const track = (id: string): Track => ({ id, provider: "youtube", providerId: id, title: id, addedBy: { id: "alice", name: "Alice", avatarSeed: "alice" }, addedAt: 1 });
const room = (id = "room-one"): Room => ({ id, name: id, ownerUserId: "alice", moderatorUserIds: [], djRoleUserIds: [], isPublic: true,
  passwordProtected: false, settings: {}, djUserId: "alice", djQueueUserIds: ["alice"], djQueues: { alice: [track("second"), track("third")] },
  history: [], playback: { track: track("first"), playing: true, position: 0, updatedAt: 1 }, vibe: null, createdAt: 1 });
function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
async function setup(write: (state: Room) => Promise<void>) {
  let recording = false;
  const store = new Store({ resourcePolicies:new ResourcePolicyStore(null),supabase: { from() { return { update({ state }: { state: Room }) {
    const query = { eq() { return query; }, select() { return query; }, async maybeSingle() {
      if (recording) await write(state); return { data: { slug: state.id }, error: null };
    } }; return query;
  } }; } } as unknown as SupabaseClient });
  const first = room(); const second = room("room-two");
  await store.saveRoom(first); await store.saveRoom(second); recording = true;
  const broadcasts: Room[] = [];
  return { store, first, second, broadcasts, service: new RoomCommandService(store, value => { broadcasts.push(structuredClone(value)); }) };
}

test("failed skip leaves authoritative state untouched and the same command can retry", async t => {
  const measurements: Array<{ name: string; options: MetricOptions }> = [];
  const restore = configureTelemetry({ captureError() {}, log() {}, async flush() {},
    metric(_type, name, _value, options) { measurements.push({ name, options }); } });
  t.after(restore);
  let fail = true;
  const { store, first, service, broadcasts } = await setup(async () => { if (fail) throw new Error("storage offline"); });
  const before = structuredClone(first);
  await assert.rejects(service.execute(first, draft => { advanceRadio(draft); return { result: draft.playback.track!.id }; }), /storage offline/);
  assert.deepEqual(first, before); assert.equal(store.getRoom(first.id), first); assert.equal(broadcasts.length, 0);
  fail = false;
  assert.equal(await service.execute(first, draft => { advanceRadio(draft); return { result: draft.playback.track!.id }; }), "second");
  assert.equal(broadcasts.length, 1); assert.equal(first.history[0].id, "first");
  assert.deepEqual(measurements.filter(item => item.name === "server.operation.results").map(item => item.options.attributes), [
    { operation: "room_save", outcome: "failure" }, { operation: "room_command", outcome: "failure" },
    { operation: "room_save", outcome: "success" }, { operation: "room_command", outcome: "success" }
  ]);
  assert.equal(measurements.filter(item => item.name === "server.operation.duration" && item.options.unit === "millisecond").length, 4);
  assert.doesNotMatch(JSON.stringify(measurements), /storage offline|room-one|Alice|youtube/);
});

test("slow writes expose only committed state and do not block unrelated rooms", async () => {
  const started = gate(); const unblock = gate();
  const { first, second, service } = await setup(async state => { if (state.id === first.id) { started.release(); await unblock.promise; } });
  const slow = service.execute(first, draft => { draft.name = "new first"; return { result: 1 }; });
  await started.promise; assert.equal(first.name, "room-one");
  await service.execute(second, draft => { draft.name = "new second"; return { result: 2 }; });
  assert.equal(second.name, "new second"); assert.equal(first.name, "room-one");
  unblock.release(); await slow; assert.equal(first.name, "new first");
});

test("queued commands read the preceding committed state and recover after failure", async () => {
  const started = gate(); const unblock = gate(); let attempts = 0;
  const { first, service } = await setup(async () => { if (++attempts === 1) { started.release(); await unblock.promise; throw new Error("failed"); } });
  const failed = service.execute(first, draft => { draft.name = "discarded"; return { result: undefined }; }).catch(() => {});
  await started.promise;
  const later = service.execute(first, draft => { assert.equal(draft.name, "room-one"); draft.name = "committed"; return { result: undefined }; });
  unblock.release(); await Promise.all([failed, later]); assert.equal(first.name, "committed");
});

test("failed Undo preserves both waiting item state and the receipt for a successful retry", async () => {
  let fail = false;
  const { first, service } = await setup(async () => { if (fail) throw new Error("failed"); });
  const undo = new QueueUndoRegistry();
  const receipt = await service.execute(first, draft => {
    const removal = undo.beginRemove(first, "alice", "second", Date.now(), draft);
    return { result: removal.receipt, committed: removal.commit, rejected: () => { removal.rollback(); } };
  });
  fail = true;
  const restore = () => service.execute(first, draft => {
    const restoration = undo.beginRestore(first, "alice", receipt.token, Date.now(), draft);
    return { result: restoration.result, committed: restoration.commit, rejected: () => { restoration.rollback(); } };
  });
  await assert.rejects(restore(), /failed/); assert.deepEqual(first.djQueues.alice.map(value => value.id), ["third"]);
  fail = false; await restore(); assert.deepEqual(first.djQueues.alice.map(value => value.id), ["second", "third"]);
  await assert.rejects(restore(), /expired/);
});
