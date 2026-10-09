import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { allowedRoomProviders, MUSIC_PROVIDERS } from "../shared/providers.js";
import { advanceRadio, appendQueueSet, normalizeRadioState, QueueUndoRegistry } from "./radio.js";
import { RoomCommandService } from "./room-command-service.js";
import type { LibraryTrack } from "./private-library.js";
import { mountRoomActions } from "./room-actions.js";
import { allowedProvidersSchema } from "./room-settings.js";
import { SetImportRegistry } from "./saved-set.js";
import { safeSocketHandler } from "./socket-handler.js";
import { Store } from "./store.js";
import type { Provider, Room, Track, User } from "./types.js";

const alice: User = { id: "alice", name: "Alice", avatarSeed: "alice" };
const bob: User = { id: "bob", name: "Bob", avatarSeed: "bob" };
const track = (title: string, provider: Provider = "youtube", user = alice): Track => ({
  id: randomUUID(), provider, providerId: provider === "spotify" ? "a".repeat(22) : provider === "mixcloud" ? "/dj/show/" : title,
  title, addedBy: user, addedAt: 1
});
const room = (): Room => ({
  id: "test-room", name: "Test", ownerUserId: alice.id, moderatorUserIds: [], djRoleUserIds: [],
  isPublic: true, passwordProtected: false, settings: {}, djUserId: null, djQueueUserIds: [alice.id, bob.id],
  djQueues: { alice: [], bob: [] }, history: [], playback: { track: null, playing: false, position: 0, updatedAt: 1 },
  vibe: null, createdAt: 1
});
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
type Commit = { p_state: Room; p_metadata: Record<string, unknown> };
async function setupStore(state = room()) {
  const commits: Commit[] = [];
  const controls = { beforeCommit: async () => {} };
  const store = new Store({ supabase: {
    from(table: string) {
      let userId: string | undefined;
      const query = {
        update() { return query; }, select() { return query; },
        eq(key: string, value: string) { if (key === "user_id") userId = value; return query; },
        async maybeSingle() {
          const role = state.moderatorUserIds.includes(userId || "") ? "moderator" : "member";
          return { data: table === "soundspin_room_members" ? { role }
            : { slug: state.id, owner_id: state.ownerUserId, is_public: state.isPublic }, error: null };
        }
      };
      return query;
    },
    async rpc(name: string, values: Commit) {
      assert.equal(name, "soundspin_commit_room");
      commits.push(structuredClone(values));
      await controls.beforeCommit();
      return { data: true, error: null };
    }
  } as unknown as SupabaseClient });
  await store.saveRoom(state);
  return { state, store, commits, controls };
}
type ActionOptions = Parameters<typeof mountRoomActions>[0];
type Reply = { ok: boolean; error?: string; added?: number; skipped?: Array<{ title: string; reason: string }>; started?: boolean; position?: number };
function mountActions(fixture: Awaited<ReturnType<typeof setupStore>>, overrides: Partial<ActionOptions> = {}) {
  const handlers = new Map<string, ReturnType<typeof safeSocketHandler>>();
  const broadcasts: Room[] = [];
  mountRoomActions({
    socket: { id: "socket", connected: true }, store: fixture.store,
    commands: new RoomCommandService(fixture.store, state => broadcasts.push(structuredClone(state))),
    getMembership: () => ({ room: fixture.state, user: alice }), assertAuthorized: () => {},
    onAction: (event: string, handler: Parameters<typeof safeSocketHandler>[0]) => handlers.set(event, safeSocketHandler(handler, () => {})),
    queueUndo: new QueueUndoRegistry(), setImports: new SetImportRegistry(),
    resolveTrack: async () => ({ mappings: {} }), resolveSavedRecording: async (input: LibraryTrack) => input,
    broadcast: () => {}, rememberDj: () => {}, forgetDj: () => {}, cancelEviction: () => {}, watchAnnouncement: () => {},
    ...overrides
  } as unknown as ActionOptions);
  const run = async (event: string, payload: unknown): Promise<Reply> => {
    let result: Reply | undefined;
    await handlers.get(event)!(payload, (reply: Reply) => { result = reply; });
    assert.ok(result);
    return result;
  };
  return { run, broadcasts };
}

test("music service settings require a nonempty unique list of known providers", async () => {
  assert.deepEqual(allowedProvidersSchema.parse([...MUSIC_PROVIDERS]), [...MUSIC_PROVIDERS]);
  const fixture = await setupStore();
  for (const providers of [[], ["youtube", "youtube"], ["unknown"], null, "youtube"]) {
    assert.equal(allowedProvidersSchema.safeParse(providers).success, false);
    await assert.rejects(fixture.store.updateRoomSettings(fixture.state.id, alice.id, { allowedProviders: providers as Provider[] }));
  }
  assert.equal(fixture.commits.length, 0);
  assert.equal(fixture.state.settings.allowedProviders, undefined);
});

test("legacy room state allows all services and normalization retains Mixcloud tracks", () => {
  const state = room(); const mix = track("show", "mixcloud");
  state.djQueues.alice = [mix]; state.playback.track = mix; state.playback.playing = true;
  normalizeRadioState(state);
  assert.deepEqual(allowedRoomProviders(state.settings), [...MUSIC_PROVIDERS]);
  assert.equal(state.djQueues.alice[0].id, mix.id);
  assert.equal(state.playback.track?.id, mix.id);
  state.settings.allowedProviders = ["mixcloud", "youtube", "mixcloud", "unknown"] as Provider[];
  normalizeRadioState(state);
  assert.deepEqual(state.settings.allowedProviders, ["youtube", "mixcloud"]);
});

test("radio skips disabled queued recordings without deleting them and keeps DJ rotation", () => {
  const state = room(); state.settings.allowedProviders = ["youtube", "mixcloud"];
  const blocked = track("blocked", "spotify"); const first = track("allowed"); const show = track("show", "mixcloud", bob);
  state.djQueues.alice = [blocked, first]; state.djQueues.bob = [show];
  assert.equal(advanceRadio(state, 10)?.id, first.id);
  assert.deepEqual(state.djQueues.alice, [blocked]);
  assert.deepEqual(state.djQueueUserIds, [bob.id, alice.id]);
  assert.equal(advanceRadio(state, 20)?.id, show.id);
  assert.deepEqual(state.djQueues.alice, [blocked]);
  assert.equal(advanceRadio(state, 30), null);
  assert.deepEqual(state.djQueueUserIds, [alice.id, bob.id]);
  assert.deepEqual(state.history.map(item => item.id), [show.id, first.id]);
});

test("set appends report disabled services and keep allowed input order", () => {
  const state = room(); state.settings.allowedProviders = ["youtube"];
  state.djQueueUserIds = [];
  const result = appendQueueSet(state, alice, [
    { provider: "mixcloud", providerId: "/dj/show/", title: "Show" },
    { provider: "youtube", providerId: "first", title: "First" },
    { provider: "spotify", providerId: "a".repeat(22), title: "Song" },
    { provider: "youtube", providerId: "second", title: "Second" }
  ]);
  assert.equal(result.added, 2); assert.equal(result.started, false);
  assert.deepEqual(state.djQueues.alice.map(item => item.title), ["First", "Second"]);
  assert.deepEqual(result.skipped, [
    { title: "Show", reason: "Mixcloud is disabled in this room" },
    { title: "Song", reason: "Spotify is disabled in this room" }
  ]);
});

test("Undo rechecks current service settings and remains usable after re-enabling", () => {
  const state = room(); const removed = track("removed", "mixcloud"); state.djQueues.alice = [removed];
  state.djQueueUserIds = [];
  const undo = new QueueUndoRegistry(); const receipt = undo.remove(state, alice.id, removed.id, 100);
  state.settings.allowedProviders = ["youtube"];
  assert.throws(() => undo.restore(state, alice.id, receipt.token, 200), /Mixcloud is disabled/);
  assert.deepEqual(state.djQueues.alice, []);
  state.settings.allowedProviders = ["mixcloud"];
  assert.equal(undo.restore(state, alice.id, receipt.token, 201).track.id, removed.id);
  assert.equal(state.playback.track, null);
});

test("only owners and moderators can change allowed services", async () => {
  const fixture = await setupStore(); fixture.state.moderatorUserIds = [bob.id];
  await assert.rejects(fixture.store.updateRoomSettings(fixture.state.id, "listener", { allowedProviders: ["mixcloud"] }), /Only the owner or a moderator/);
  assert.equal(fixture.commits.length, 0);
  await fixture.store.updateRoomSettings(fixture.state.id, bob.id, { allowedProviders: ["mixcloud"] });
  assert.deepEqual(fixture.state.settings.allowedProviders, ["mixcloud"]);
  await fixture.store.updateRoomSettings(fixture.state.id, alice.id, { allowedProviders: ["youtube"] });
  assert.deepEqual(fixture.state.settings.allowedProviders, ["youtube"]);
});

test("disabling the playing service commits settings and advancement atomically and rolls back failures", async () => {
  const state = room(); const current = track("current", "spotify"); const disabled = track("waiting", "spotify"); const next = track("next", "mixcloud");
  state.djUserId = alice.id; state.playback = { track: current, playing: true, position: 25, updatedAt: 1 };
  state.djQueues.alice = [disabled, next]; state.vibe = { trackId: current.id, votes: { bob: 1 } };
  const fixture = await setupStore(state); const started = gate(); const unblock = gate();
  fixture.controls.beforeCommit = async () => { started.release(); await unblock.promise; throw new Error("storage offline"); };
  const before = structuredClone(state);
  const pending = fixture.store.updateRoomSettings(state.id, alice.id, { allowedProviders: ["mixcloud"] });
  await started.promise;
  assert.deepEqual(state, before);
  assert.deepEqual(fixture.commits[0].p_metadata.settings, { allowedProviders: ["mixcloud"] });
  assert.equal(fixture.commits[0].p_state.playback.track?.id, next.id);
  assert.equal(fixture.commits[0].p_state.history[0].id, current.id);
  assert.deepEqual(fixture.commits[0].p_state.djQueues.alice.map(item => item.id), [disabled.id]);
  unblock.release(); await assert.rejects(pending, /storage offline/);
  assert.deepEqual(state, before);
  fixture.controls.beforeCommit = async () => {};
  await fixture.store.updateRoomSettings(state.id, alice.id, { allowedProviders: ["mixcloud"] });
  assert.equal(state.playback.track?.id, next.id);
  assert.deepEqual(state.vibe, { trackId: next.id, votes: {} });
  assert.deepEqual(state.settings.allowedProviders, ["mixcloud"]);
});

test("re-enabling queued services starts an idle room and survives a local storage restart", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "soundspin-services-test-"));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("soundspin-services-test-"));
    await rm(directory, { recursive: true, force: true });
  });
  const store = new Store({ dataDir: directory, supabase: null }); await store.init();
  const state = room(); const show = track("show", "mixcloud"); state.settings.allowedProviders = ["youtube"];
  state.djQueues.alice = [show]; await store.saveRoom(state);
  assert.equal(advanceRadio(state), null); assert.equal(state.djQueues.alice[0].id, show.id);
  await store.updateRoomSettings(state.id, alice.id, { allowedProviders: ["youtube", "mixcloud"] });
  assert.equal(state.playback.track?.id, show.id);
  const restored = new Store({ dataDir: directory, supabase: null }); await restored.init();
  assert.deepEqual(restored.getRoom(state.id)?.settings.allowedProviders, ["youtube", "mixcloud"]);
  assert.equal(restored.getRoom(state.id)?.playback.track?.id, show.id);
});

test("disabled queue additions are rejected before provider work even outside the DJ lineup", async () => {
  const fixture = await setupStore(); fixture.state.settings.allowedProviders = ["youtube"]; fixture.state.djQueueUserIds = [];
  const { run, broadcasts } = mountActions(fixture, { resolveTrack: async () => assert.fail("disabled provider was resolved") });
  const reply = await run("queue:add", { provider: "spotify", providerId: "a".repeat(22), title: "Song" });
  assert.equal(reply.ok, false); assert.match(reply.error || "", /Spotify is disabled/);
  assert.deepEqual(fixture.state.djQueues.alice, []); assert.deepEqual(broadcasts, []);
});

test("a queue addition rechecks settings after awaited provider resolution", async () => {
  const fixture = await setupStore(); const started = gate(); const unblock = gate();
  const { run, broadcasts } = mountActions(fixture, { resolveTrack: async () => { started.release(); await unblock.promise; return { mappings: {} }; } });
  const pending = run("queue:add", { provider: "spotify", providerId: "a".repeat(22), title: "Song" });
  await started.promise;
  await fixture.store.updateRoomSettings(fixture.state.id, alice.id, { allowedProviders: ["youtube"] });
  unblock.release(); const reply = await pending;
  assert.equal(reply.ok, false); assert.match(reply.error || "", /Spotify is disabled/);
  assert.deepEqual(fixture.state.djQueues.alice, []); assert.deepEqual(broadcasts, []);
});

test("saved sets recheck current services after resolution and skip disabled recordings", async () => {
  const fixture = await setupStore(); fixture.state.djQueueUserIds = [];
  const setId = randomUUID();
  fixture.store.getPrivateLibrary = async () => ({ picks: [], sets: [{ id: setId, name: "Set", savedAt: 1, tracks: [
    { provider: "spotify", providerId: "a".repeat(22), title: "Song" },
    { provider: "youtube", providerId: "abcdefghijk", title: "Video" }
  ] }] });
  const started = gate(); const unblock = gate();
  const { run } = mountActions(fixture, { resolveSavedRecording: async input => { started.release(); await unblock.promise; return input; } });
  const pending = run("queue:set-add", { setId, requestId: randomUUID() });
  await started.promise;
  await fixture.store.updateRoomSettings(fixture.state.id, alice.id, { allowedProviders: ["youtube"] });
  unblock.release(); const reply = await pending;
  assert.equal(reply.ok, true); assert.equal(reply.added, 1); assert.equal(reply.started, false);
  assert.deepEqual(reply.skipped, [{ title: "Song", reason: "Spotify is disabled in this room" }]);
  assert.deepEqual(fixture.state.djQueues.alice.map(item => item.title), ["Video"]);
  assert.equal(fixture.state.playback.track, null);
});

test("play-next cannot promote a disabled recording but it can still be removed", async () => {
  const fixture = await setupStore(); fixture.state.settings.allowedProviders = ["youtube"];
  const first = track("first"); const disabled = track("disabled", "spotify"); fixture.state.djQueues.alice = [first, disabled];
  const { run, broadcasts } = mountActions(fixture);
  const reply = await run("queue:play-next", { trackId: disabled.id });
  assert.equal(reply.ok, false); assert.match(reply.error || "", /Spotify is disabled/);
  assert.deepEqual(fixture.state.djQueues.alice.map(item => item.id), [first.id, disabled.id]);
  assert.deepEqual(broadcasts, []);
  assert.equal((await run("queue:remove", { trackId: disabled.id })).ok, true);
  assert.deepEqual(fixture.state.djQueues.alice.map(item => item.id), [first.id]);
});
