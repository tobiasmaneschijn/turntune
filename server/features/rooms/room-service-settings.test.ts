import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { allowedRoomProviders, AVAILABLE_MUSIC_PROVIDERS } from "../../../shared/providers.js";
import { advanceRadio, appendQueueSet, normalizeRadioState, QueueUndoRegistry } from "./radio.js";
import { RoomCommandService } from "./room-command-service.js";
import type { LibraryTrack } from "../music/private-library.js";
import { mountRoomActions } from "./room-actions.js";
import { allowedProvidersSchema, roomSettingsPatchSchema, authorizeRoomSettingsPatch } from "./room-settings.js";
import { SetImportRegistry } from "../music/saved-set.js";
import { safeSocketHandler } from "../../realtime/socket-handler.js";
import { Store } from "../../persistence/store.js";
import type { Provider, Room, Track, User } from "../../types.js";
import { defaultResourcePolicy } from "../../../shared/resource-policy.js";
import { ResourcePolicyStore } from "../../resources/resource-policy.js";

const alice: User = { id: "alice", name: "Alice", avatarSeed: "alice" };
const bob: User = { id: "bob", name: "Bob", avatarSeed: "bob" };
const track = (title: string, provider: Provider = "youtube", user = alice): Track => ({
  id: randomUUID(), provider, providerId: provider === "spotify" ? "a".repeat(22) : provider === "soundcloud" ? "soundcloud:tracks:123" : provider === "mixcloud" ? "/dj/show/" : provider === "apple" ? "123" : title,
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
  const store = new Store({ resourcePolicies: new ResourcePolicyStore(null), supabase: {
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
    async rpc(name: string, values: Commit & { p_room_slug?: string; p_actor?: string }) {
      if (name === "soundspin_room_access") {
        assert.equal(values.p_room_slug, state.id);
        const role = values.p_actor === state.ownerUserId ? "owner" : state.moderatorUserIds.includes(values.p_actor || "") ? "moderator" : "member";
        return { data: { exists: true, isPublic: state.isPublic, passwordHash: null, role, banned: false,
          accessMode: state.settings.accessMode ?? (state.isPublic ? "public" : "members"), settings: structuredClone(state.settings),
          roomActive: true, accountActive: true, readers: [] }, error: null };
      }
      assert.ok(name === "soundspin_commit_room" || name === "soundspin_commit_room_v2");
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

test("music service settings require a nonempty unique list of available providers", async () => {
  assert.deepEqual(allowedProvidersSchema.parse([...AVAILABLE_MUSIC_PROVIDERS]), [...AVAILABLE_MUSIC_PROVIDERS]);
  const fixture = await setupStore();
  for (const providers of [[], ["youtube", "youtube"], ["unknown"], ["apple"], ["mixcloud"], null, "youtube"]) {
    assert.equal(allowedProvidersSchema.safeParse(providers).success, false);
    await assert.rejects(fixture.store.updateRoomSettings(fixture.state.id, alice.id, { allowedProviders: providers as Provider[] }));
  }
  assert.equal(fixture.commits.length, 0);
  assert.equal(fixture.state.settings.allowedProviders, undefined);
});

test("legacy room state preserves excluded recordings and restrictions while pausing playback", t => {
  let now=1000;t.mock.method(Date,"now",()=>now);
  const state = room(); const mix = track("show", "mixcloud"); const apple = track("song", "apple");
  state.djQueues.alice = [mix]; state.playback.track = mix; state.playback.playing = true;
  normalizeRadioState(state);
  assert.deepEqual(allowedRoomProviders(state.settings), ["youtube", "soundcloud", "audius"]);
  assert.equal(state.djQueues.alice[0].id, mix.id);
  assert.equal(state.playback.track?.id, mix.id);
  assert.equal(state.playback.playing, false);
  state.settings.allowedProviders = ["mixcloud", "apple", "mixcloud", "unknown"] as Provider[];
  state.djQueues.alice.push(apple); state.playback.track = apple; state.playback.playing = true;
  normalizeRadioState(state);
  assert.deepEqual(state.settings.allowedProviders, ["apple", "mixcloud"]);
  assert.deepEqual(allowedRoomProviders(state.settings), []);
  assert.deepEqual(state.djQueues.alice.map(item => item.id), [mix.id, apple.id]);
  assert.equal(state.playback.track?.id, apple.id); assert.equal(state.playback.playing, false);
  state.settings.allowedProviders = []; normalizeRadioState(state);
  assert.deepEqual(allowedRoomProviders(state.settings), []);
  state.playback.track=track("Legacy Spotify","spotify");state.playback.playing=true;
  normalizeRadioState(state);assert.equal(state.playback.playing,false);
  const paused=JSON.stringify(state);now=2000;normalizeRadioState(state);
  assert.equal(JSON.stringify(state),paused);
});

test("room owners cannot enable Spotify through generic room settings", () => {
  const state = room();
  assert.equal(roomSettingsPatchSchema.safeParse({ spotifyEnabled: true }).success, false);
  assert.throws(() => authorizeRoomSettingsPatch(state, alice.id, { allowedProviders: ["youtube", "spotify"] }), /Only an app admin/);
  assert.deepEqual(allowedRoomProviders({ allowedProviders: ["spotify"] }), []);
  state.settings.spotifyEnabled = true;
  assert.doesNotThrow(() => authorizeRoomSettingsPatch(state, alice.id, { allowedProviders: ["youtube", "spotify"] }));
  assert.ok(allowedRoomProviders(state.settings).includes("spotify"));
});

test("radio skips disabled queued recordings without deleting them and keeps DJ rotation", () => {
  const state = room(); state.settings.allowedProviders = ["youtube", "soundcloud"];
  const blocked = track("blocked", "spotify"); const first = track("allowed"); const show = track("show", "soundcloud", bob);
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
    { provider: "soundcloud", providerId: "soundcloud:tracks:123", title: "Show" },
    { provider: "youtube", providerId: "first", title: "First" },
    { provider: "spotify", providerId: "a".repeat(22), title: "Song" },
    { provider: "youtube", providerId: "second", title: "Second" }
  ]);
  assert.equal(result.added, 2); assert.equal(result.started, false);
  assert.deepEqual(state.djQueues.alice.map(item => item.title), ["First", "Second"]);
  assert.deepEqual(result.skipped, [
    { title: "Show", reason: "SoundCloud is disabled in this room" },
    { title: "Song", reason: "Spotify is disabled in this room" }
  ]);
});

test("Undo rechecks current service settings and remains usable after re-enabling", () => {
  const state = room(); const removed = track("removed", "soundcloud"); state.djQueues.alice = [removed];
  state.djQueueUserIds = [];
  const undo = new QueueUndoRegistry(); const receipt = undo.remove(state, alice.id, removed.id, 100);
  state.settings.allowedProviders = ["youtube"];
  assert.throws(() => undo.restore(state, alice.id, receipt.token, 200), /SoundCloud is disabled/);
  assert.deepEqual(state.djQueues.alice, []);
  state.settings.allowedProviders = ["soundcloud"];
  assert.equal(undo.restore(state, alice.id, receipt.token, 201).track.id, removed.id);
  assert.equal(state.playback.track, null);
});

test("only owners and moderators can change allowed services", async () => {
  const fixture = await setupStore(); fixture.state.moderatorUserIds = [bob.id];
  await assert.rejects(fixture.store.updateRoomSettings(fixture.state.id, "listener", { allowedProviders: ["soundcloud"] }), /Only the owner or a moderator/);
  assert.equal(fixture.commits.length, 0);
  await fixture.store.updateRoomSettings(fixture.state.id, bob.id, { allowedProviders: ["soundcloud"] });
  assert.deepEqual(fixture.state.settings.allowedProviders, ["soundcloud"]);
  await fixture.store.updateRoomSettings(fixture.state.id, alice.id, { allowedProviders: ["youtube"] });
  assert.deepEqual(fixture.state.settings.allowedProviders, ["youtube"]);
});

test("disabling the playing service commits settings and advancement atomically and rolls back failures", async () => {
  const state = room(); const current = track("current", "spotify"); const disabled = track("waiting", "spotify"); const next = track("next", "soundcloud");
  state.settings.spotifyEnabled = true;
  state.djUserId = alice.id; state.playback = { track: current, playing: true, position: 25, updatedAt: 1 };
  state.djQueues.alice = [disabled, next]; state.vibe = { trackId: current.id, votes: { bob: 1 } };
  const fixture = await setupStore(state); const started = gate(); const unblock = gate();
  fixture.controls.beforeCommit = async () => { started.release(); await unblock.promise; throw new Error("storage offline"); };
  const before = structuredClone(state);
  const pending = fixture.store.updateRoomSettings(state.id, alice.id, { allowedProviders: ["soundcloud"] });
  await started.promise;
  assert.deepEqual(state, before);
  assert.deepEqual(fixture.commits[0].p_metadata.settings, { spotifyEnabled: true, allowedProviders: ["soundcloud"] });
  assert.equal(fixture.commits[0].p_state.playback.track?.id, next.id);
  assert.equal(fixture.commits[0].p_state.history[0].id, current.id);
  assert.deepEqual(fixture.commits[0].p_state.djQueues.alice.map(item => item.id), [disabled.id]);
  unblock.release(); await assert.rejects(pending, /storage offline/);
  assert.deepEqual(state, before);
  fixture.controls.beforeCommit = async () => {};
  await fixture.store.updateRoomSettings(state.id, alice.id, { allowedProviders: ["soundcloud"] });
  assert.equal(state.playback.track?.id, next.id);
  assert.deepEqual(state.vibe, { trackId: next.id, votes: {} });
  assert.deepEqual(state.settings.allowedProviders, ["soundcloud"]);
});

test("re-enabling queued services starts an idle room and survives a local storage restart", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "soundspin-services-test-"));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("soundspin-services-test-"));
    await rm(directory, { recursive: true, force: true });
  });
  const store = new Store({ dataDir: directory, supabase: null }); await store.init();
  const state = room(); const show = track("show", "soundcloud"); state.settings.allowedProviders = ["youtube"];
  state.djQueues.alice = [show]; await store.saveRoom(state);
  assert.equal(advanceRadio(state), null); assert.equal(state.djQueues.alice[0].id, show.id);
  await store.updateRoomSettings(state.id, alice.id, { allowedProviders: ["youtube", "soundcloud"] });
  assert.equal(state.playback.track?.id, show.id);
  const restored = new Store({ dataDir: directory, supabase: null }); await restored.init();
  assert.deepEqual(restored.getRoom(state.id)?.settings.allowedProviders, ["youtube", "soundcloud"]);
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
  fixture.state.settings.spotifyEnabled = true;
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

test("disabled and excluded services cannot add saved or direct picks or resume legacy playback", async () => {
  const fixture = await setupStore(); fixture.state.djQueueUserIds = [];
  const setId = randomUUID(); let spotifyCalls = 0;
  fixture.store.getPrivateLibrary = async () => ({ picks: [], sets: [{ id: setId, name: "Saved", savedAt: 1, tracks: [
    { provider: "spotify", providerId: "a".repeat(22), title: "Spotify" },
    { provider: "apple", providerId: "123", title: "Apple Music" },
    { provider: "mixcloud", providerId: "/dj/show/", title: "Mixcloud", permalinkUrl: "https://www.mixcloud.com/dj/show/" },
    { provider: "youtube", providerId: "abcdefghijk", title: "YouTube" }
  ] }] });
  const { run } = mountActions(fixture, {
    resolveTrack: async input => { if (input.provider !== "youtube") spotifyCalls++; return { mappings: { spotify: { providerId: "a".repeat(22) } } }; },
    resolveSavedRecording: async input => { if (input.provider !== "youtube") spotifyCalls++; return { ...input, mappings: { spotify: { providerId: "a".repeat(22) } } }; }
  });
  assert.equal((await run("queue:add", { provider: "spotify", providerId: "a".repeat(22), title: "Spotify" })).ok, false);
  assert.equal((await run("queue:add", { provider: "apple", providerId: "123", title: "Apple Music" })).ok, false);
  assert.equal((await run("queue:add", { provider: "mixcloud", providerId: "/dj/show/", title: "Mixcloud", permalinkUrl: "https://www.mixcloud.com/dj/show/" })).ok, false);
  const appended = await run("queue:set-add", { setId, requestId: randomUUID() });
  assert.equal(appended.ok, true); assert.equal(appended.added, 1);
  assert.deepEqual(appended.skipped, [
    { title: "Spotify", reason: "Spotify is disabled in this room" },
    { title: "Apple Music", reason: "Apple Music is disabled in this room" },
    { title: "Mixcloud", reason: "Mixcloud is disabled in this room" }
  ]);
  assert.equal(spotifyCalls, 0);
  assert.equal(fixture.state.djQueues.alice[0].mappings?.spotify, undefined);
  const legacy = track("Legacy", "spotify"); fixture.state.djUserId = alice.id; fixture.state.playback.track = legacy;
  assert.equal((await run("playback:update", { trackId: legacy.id, playing: true, position: 0 })).ok, false);
  const excluded = track("Legacy Apple", "apple"); fixture.state.playback.track = excluded;
  assert.equal((await run("playback:update", { trackId: excluded.id, playing: true, position: 0 })).ok, false);
});

test("queue limits protect saved work and import retries spend capacity once", async () => {
  const fixture = await setupStore(); fixture.state.djQueueUserIds = [];
  const policy = defaultResourcePolicy(); policy.limits.queueTracksPerRoom = 2; policy.global.queueTracksPerRoom = 3; policy.limits.importTracks = 2;
  fixture.state.djQueues.alice = [track("First")]; fixture.state.djQueues.bob = [track("Bob")];
  const setId = randomUUID(), requestId = randomUUID(); let imports = 0, resolutions = 0;
  let savedTracks: LibraryTrack[] = [{ provider: "youtube", providerId: "abcdefghijk", title: "Imported" }];
  fixture.store.getPrivateLibrary = async () => ({ picks: [], sets: [{ id: setId, name: "Saved", savedAt: 1, tracks: savedTracks }] });
  const { run } = mountActions(fixture, { getResourcePolicy: async () => policy,
    runImport: async (_user, operation) => { imports++; return operation(); },
    resolveTrack: async () => { resolutions++; return { mappings: {} }; },
    resolveSavedRecording: async input => { resolutions++; return input; }
  });
  assert.equal((await run("queue:set-add", { setId, requestId })).added, 1);
  assert.equal((await run("queue:set-add", { setId, requestId })).added, 1);
  assert.equal(imports, 1); assert.equal(resolutions, 1);
  const before = structuredClone(fixture.state.djQueues);
  assert.equal((await run("queue:add", { provider: "youtube", providerId: "another1234", title: "Over limit" })).ok, false);
  assert.equal(resolutions, 1); assert.deepEqual(fixture.state.djQueues, before);
  fixture.state.djQueues.alice.pop(); policy.global.queueTracksPerRoom = 2;
  assert.equal((await run("queue:add", { provider: "youtube", providerId: "another1234", title: "Room full" })).ok, false);
  assert.equal(resolutions, 1);
  savedTracks = Array.from({ length: 3 }, (_, index) => ({ provider: "youtube", providerId: `video${index}12345`, title: String(index) }));
  assert.equal((await run("queue:set-add", { setId, requestId: randomUUID() })).ok, false);
  assert.equal(resolutions, 1);
});
