import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Store } from "./store.js";
import type { Room } from "./types.js";

function room(): Room {
  return {
    id: "test-room", name: "Test room", ownerUserId: "alice",
    moderatorUserIds: [], djRoleUserIds: [], isPublic: true,
    passwordProtected: false, settings: { djAccess: "everyone" },
    djUserId: null, djQueueUserIds: [], djQueues: {}, history: [],
    playback: { track: null, playing: false, position: 0, updatedAt: 1 },
    vibe: null, createdAt: 1
  };
}

test("theme nights require room authority and survive a server restart", async t => {
  const dataDir = await temporaryDirectory(t);
  const store = new Store({ dataDir, supabase: null });
  await store.init();
  const state = store.getOrCreateLocalRoom("test-room", room);
  state.moderatorUserIds = ["moderator"];
  await store.saveRoom(state);
  await assert.rejects(store.updateRoomSettings(state.id, "listener", { themePrompt: "School years" }), /Only the owner or a moderator/);
  assert.equal(state.settings.themePrompt, undefined);
  await store.updateRoomSettings(state.id, "moderator", { themePrompt: "  School years  " });
  await store.flush();
  const restored = new Store({ dataDir, supabase: null });
  await restored.init();
  assert.equal(restored.getRoom(state.id)?.settings.themePrompt, "School years");
  await assert.rejects(restored.updateRoomSettings(state.id, "alice", { themePrompt: "x".repeat(161) }), /at most 160/);
  await restored.updateRoomSettings(state.id, "alice", { themePrompt: null });
  assert.equal(restored.getRoom(state.id)?.settings.themePrompt, undefined);
});

function client(from: (table: string) => unknown) {
  return { from } as unknown as SupabaseClient;
}

function roomWrites(save: (values: { state: Room; updated_at: string }) => Promise<{ error: unknown; data?: unknown }>) {
  return client(() => ({
    update(values: { state: Room; updated_at: string }) {
      const query = {
        eq() { return query; }, select() { return query; },
        async maybeSingle() {
          const result = await save(values);
          return { data: { slug: values.state.id }, ...result };
        }
      };
      return query;
    }
  }));
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function temporaryDirectory(t: { after: (cleanup: () => Promise<void>) => void }) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "soundspin-store-test-"));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("soundspin-store-test-"));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test("a failed database save rejects its caller but later saves recover", async () => {
  let writes = 0;
  const store = new Store({ supabase: roomWrites(async () => {
      writes += 1;
      return { error: writes === 1 ? { code: "08006", message: "soundspin_rooms connection unavailable" } : null };
  }) });
  await assert.rejects(store.saveRoom(room()), /Could not save room: soundspin_rooms connection unavailable/);
  await store.saveRoom(room());
  await store.flush();
  assert.equal(writes, 2);
});

test("queued room saves retain the state at the time of each save", async () => {
  const started = deferred();
  const release = deferred();
  const writes: Room[] = [];
  const store = new Store({ supabase: roomWrites(async (values) => {
      if (writes.length === 0) {
        started.resolve();
        await release.promise;
      }
      writes.push(values.state);
      return { error: null };
  }) });
  const state = room();
  const first = store.saveRoom(state);
  await started.promise;
  state.name = "Second save";
  const second = store.saveRoom(state);
  state.name = "Unsaved mutation";
  release.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(writes.map((saved) => saved.name), ["Test room", "Second save"]);
  assert.equal(store.getRoom(state.id), state);
});

test("radio saves leave authoritative room metadata untouched", async () => {
  const values: unknown[] = [];
  const store = new Store({ supabase: roomWrites(async (update) => {
    values.push(update);
    return { error: null };
  }) });
  await store.saveRoom(room());
  assert.deepEqual(Object.keys(values[0] as object).sort(), ["state", "updated_at"]);
});

test("saving a deleted room rejects rather than recreating it from stale cache", async () => {
  const store = new Store({ supabase: roomWrites(async () => ({ data: null, error: null })) });
  await assert.rejects(store.saveRoom(room()), /room no longer exists/);
});

test("DJ role changes do not downgrade a moderator in a room that is not cached", async () => {
  let writes = 0;
  const store = new Store({ supabase: client((table) => {
    const query = {
      select() { return query; }, eq() { return query; },
      async single() { return { data: { owner_id: "alice" }, error: null }; },
      async maybeSingle() {
        assert.equal(table, "soundspin_room_members");
        return { data: { role: "moderator" }, error: null };
      },
      async upsert() { writes += 1; return { error: null }; }
    };
    return query;
  }) });
  await assert.rejects(store.setDjRole("test-room", "alice", "bob", true), /Moderators can already join/);
  assert.equal(writes, 0);
});

test("concurrent room loads share one authoritative object and database read", async () => {
  const started = deferred();
  const release = deferred();
  let reads = 0;
  const store = new Store({ supabase: client((table) => {
    const query = {
      select() { return query; },
      eq() { return query; },
      async maybeSingle() {
        reads += 1;
        started.resolve();
        await release.promise;
        return { data: { state: room(), name: "Loaded room", owner_id: "alice", is_public: true, settings: {} }, error: null };
      },
      async in() {
        assert.equal(table, "soundspin_room_members");
        return { data: [], error: null };
      }
    };
    return query;
  }) });
  const first = store.loadRoom("test-room");
  await started.promise;
  const second = store.loadRoom("test-room");
  release.resolve();
  const [one, two] = await Promise.all([first, second]);
  assert.equal(reads, 1);
  assert.equal(one, two);
  assert.equal(one, store.getRoom("test-room"));
});

test("a failed room read can be retried instead of leaving a rejected cached load", async () => {
  let reads = 0;
  const store = new Store({ supabase: client(() => {
    const query = {
      select() { return query; }, eq() { return query; },
      async maybeSingle() {
        reads += 1;
        return { data: null, error: reads === 1 ? { code: "08006", message: "temporary outage" } : null };
      }
    };
    return query;
  }) });
  await assert.rejects(store.loadRoom("missing-room"), /temporary outage/);
  assert.equal(await store.loadRoom("missing-room"), undefined);
  assert.equal(reads, 2);
});

test("joining preserves a saved display name rather than overwriting it with browser data", async () => {
  let inserts = 0;
  const saved = { user_id: "alice", display_name: "Saved name" };
  const store = new Store({ supabase: client(() => {
    const query = {
      select() { return query; }, eq() { return query; },
      async maybeSingle() { return { data: saved, error: null }; },
      async upsert() { inserts += 1; return { error: null }; }
    };
    return query;
  }) });
  assert.equal((await store.loadOrCreateProfile("alice", "Stale name"))?.display_name, "Saved name");
  assert.equal(inserts, 0);
});

test("profile creation handles another connection winning the insert race", async () => {
  let reads = 0;
  const saved = { user_id: "alice", display_name: "Other connection's name" };
  const store = new Store({ supabase: client(() => {
    const query = {
      select() { return query; }, eq() { return query; },
      async maybeSingle() { return { data: ++reads === 1 ? null : saved, error: null }; },
      async upsert(_values: unknown, options: { ignoreDuplicates?: boolean }) {
        assert.equal(options.ignoreDuplicates, true);
        return { error: null };
      }
    };
    return query;
  }) });
  assert.equal((await store.loadOrCreateProfile("alice", "Stale name"))?.display_name, saved.display_name);
});

test("room and provider connection writes share an atomic local persistence queue", async (t) => {
  const dataDir = await temporaryDirectory(t);
  const store = new Store({ dataDir, supabase: null });
  await store.init();
  const state = room();
  const saves = Array.from({ length: 20 }, (_, index) => {
    state.name = `Saved room ${index}`;
    return store.saveRoom(state);
  });
  saves.push(store.saveMusicConnection({ userId: "alice", provider: "spotify", refreshTokenCiphertext: "test-ciphertext", scopes: [], metadata: {} }));
  saves.push(store.deleteMusicConnection("bob", "spotify"));
  await Promise.all(saves);
  await store.flush();
  const persisted = JSON.parse(await readFile(path.join(dataDir, "soundspin.json"), "utf8"));
  assert.equal(persisted.rooms[state.id].name, "Saved room 19");
  assert.equal(persisted.musicConnections["alice:spotify"].refreshTokenCiphertext, "test-ciphertext");
});

test("local storage recovers after a failed file write", async (t) => {
  const dataDir = await temporaryDirectory(t);
  const store = new Store({ dataDir, supabase: null });
  await store.init();
  const tempFile = path.join(dataDir, "soundspin.tmp.json");
  await mkdir(tempFile);
  await assert.rejects(store.saveRoom(room()));
  await rmdir(tempFile);
  const state = room();
  state.name = "Recovered";
  await store.saveRoom(state);
  const persisted = JSON.parse(await readFile(path.join(dataDir, "soundspin.json"), "utf8"));
  assert.equal(persisted.rooms[state.id].name, "Recovered");
});

test("invalid saved databases fail clearly without replacing existing data", async (t) => {
  const dataDir = await temporaryDirectory(t);
  const dataFile = path.join(dataDir, "soundspin.json");
  const invalid = JSON.stringify({ rooms: null });
  await writeFile(dataFile, invalid);
  const store = new Store({ dataDir, supabase: null });
  await assert.rejects(store.init(), /invalid format/);
  assert.equal(await readFile(dataFile, "utf8"), invalid);
});

test("room cache lookup never treats Object prototype properties as saved rooms", () => {
  const store = new Store({ supabase: null });
  assert.equal(store.getRoom("constructor"), undefined);
  assert.equal(store.getRoom("__proto__"), undefined);
  assert.equal(store.getRoom("toString"), undefined);
});

test("concurrent guest joins reserve the same local room and preserve its first owner", async () => {
  const store = new Store({ supabase: null });
  let creations = 0;
  async function join(ownerUserId: string) {
    const cached = await store.loadRoom("test-room");
    return cached || store.getOrCreateLocalRoom("test-room", () => {
      creations += 1;
      return { ...room(), ownerUserId };
    });
  }
  const [aliceRoom, bobRoom] = await Promise.all([join("alice"), join("bob")]);
  assert.equal(creations, 1);
  assert.equal(aliceRoom, bobRoom);
  assert.equal(aliceRoom.ownerUserId, "alice");
  assert.equal(store.getRoom("test-room"), aliceRoom);
});

test("local room reservation cannot bypass Supabase room creation", () => {
  const store = new Store({ supabase: client(() => ({})) });
  assert.throws(() => store.getOrCreateLocalRoom("test-room", room), /explicitly created/);
});
