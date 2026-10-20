import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../../persistence/store.js";
import { ResourcePolicyStore } from "../../resources/resource-policy.js";
import { DEFAULT_PLAN_LIMITS } from "../../../shared/resource-policy.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { changePrivateLibrary, emptyLibrary, libraryMutationSchema } from "./private-library.js";
const track = { provider: "youtube" as const, providerId: "dQw4w9WgXcQ", title: "A saved recording" };
test("saved metadata strips contributor/private room fields and rejects invalid sources", () => {
  const parsed = libraryMutationSchema.parse({ type: "save-pick", track: { ...track, roomId: "private-room", addedBy: { id: "other" }, mappings: { spotify: "hidden" } }, userId: "victim" });
  assert.deepEqual(parsed, { type: "save-pick", track });
  assert.equal(libraryMutationSchema.safeParse({ type: "save-pick", track: { ...track, providerId: "bad", artworkUrl: "http://unsafe.test/a" } }).success, false);
});
test("picks and sets are idempotent, ordered, bounded and explicitly deletable", () => {
  let library = changePrivateLibrary(emptyLibrary(), { type: "save-pick", track }, 10);
  library = changePrivateLibrary(library, { type: "save-pick", track }, 20);
  assert.equal(library.picks.length, 1); assert.equal(library.picks[0].savedAt, 10);
  const id = "11111111-1111-4111-8111-111111111111";
  const other = { ...track, providerId: "9bZkp7q19f0", title: "Second" };
  library = changePrivateLibrary(library, { type: "save-set", id, name: "Opening", tracks: [other, track, other] }, 20);
  assert.deepEqual(library.sets[0].tracks.map((item) => item.title), ["Second", "A saved recording"]);
  library = changePrivateLibrary(library, { type: "rename-set", id, name: "Closing" });
  assert.equal(library.sets[0].name, "Closing");
  assert.deepEqual(changePrivateLibrary(library, { type: "clear-library" }), emptyLibrary());
  assert.equal(libraryMutationSchema.safeParse({ type: "save-set", id, name: "Too long", tracks: Array(101).fill(track) }).success, false);
  const smallerPlan={...DEFAULT_PLAN_LIMITS,libraryPicks:1};
  assert.throws(()=>changePrivateLibrary(library,{type:"save-pick",track:other},30,smallerPlan),/saved favorites are full/);
  assert.equal(changePrivateLibrary(library,{type:"delete-pick",id:library.picks[0].id},30,smallerPlan).picks.length,0);
  assert.equal(changePrivateLibrary(library,{type:"save-pick",track:other},30,{...smallerPlan,libraryPicks:2}).picks.length,2);
});
test("local fallback persists library across restart, isolates owners and serializes concurrent writes", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "soundspin-library-test-"));
  t.after(async () => { assert.equal(path.dirname(path.resolve(dataDir)), path.resolve(os.tmpdir())); assert.ok(path.basename(dataDir).startsWith("soundspin-library-test-")); await rm(dataDir, { recursive: true, force: true }); });
  const store = new Store({ dataDir, supabase: null }); await store.init();
  await Promise.all([store.updatePrivateLibrary("alice", { type: "save-pick", track }), store.updatePrivateLibrary("alice", { type: "save-pick", track: { ...track, providerId: "9bZkp7q19f0" } })]);
  assert.equal((await store.getPrivateLibrary("alice")).picks.length, 2);
  assert.deepEqual(await store.getPrivateLibrary("bob"), emptyLibrary());
  const restored = new Store({ dataDir, supabase: null }); await restored.init();
  assert.equal((await restored.getPrivateLibrary("alice")).picks.length, 2);
});

test("database revision conflict merges a concurrent writer instead of overwriting saved picks", async () => {
  let row = { data: emptyLibrary(), revision: 1 };
  let raced = false;
  let updates = 0;
  const requestedUsers: unknown[] = [];
  const client = { from(table: string) {
    assert.equal(table, "soundspin_private_libraries");
    let update: typeof row | undefined; let revision: number | undefined;
    const query = { select() { return query; },
      update(values: typeof row) { update = values; return query; },
      eq(key: string, value: unknown) { if (key === "user_id") requestedUsers.push(value); if (key === "revision") revision = value as number; return query; },
      async maybeSingle() {
        if (!update) return { data: structuredClone(row), error: null };
        updates++;
        if (!raced) { raced = true; row = { revision: 2, data: changePrivateLibrary(row.data, { type: "save-pick", track: { ...track, providerId: "9bZkp7q19f0", title: "Concurrent pick" } }) }; }
        if (row.revision !== revision) return { data: null, error: null };
        row = update; return { data: { revision: row.revision }, error: null };
      }
    }; return query;
  } } as unknown as SupabaseClient;
  const store = new Store({ supabase: client,resourcePolicies:new ResourcePolicyStore(null) });
  const saved = await store.updatePrivateLibrary("alice", { type: "save-pick", track });
  assert.deepEqual(saved.picks.map((pick) => pick.track.title).sort(), ["A saved recording", "Concurrent pick"]);
  assert.equal(updates, 2); assert.equal(row.revision, 3);
  assert.ok(requestedUsers.every((user) => user === "alice"));
});

test("explicit owner reset repairs corrupt metadata or unsafe legacy revisions without bypassing CAS", async () => {
  for (const initial of [
    { data: { picks: [{ unexpected: "legacy" }], sets: [] }, revision: 7 },
    { data: emptyLibrary(), revision: "9007199254740993" },
  ]) {
    let row: { data: unknown; revision: number | string } = structuredClone(initial);
    const filters: Array<[string, unknown]> = [];
    let writes = 0;
    const client = { from(table: string) {
      assert.equal(table, "soundspin_private_libraries");
      let update: typeof row | undefined;
      let expectedRevision: unknown;
      const query = {
        select() { return query; },
        eq(column: string, value: unknown) { filters.push([column, value]); if (column === "revision") expectedRevision = value; return query; },
        update(value: typeof row) { update = value; return query; },
        async maybeSingle() {
          if (!update) return { data: structuredClone(row), error: null };
          writes++;
          assert.equal(expectedRevision, initial.revision);
          row = update;
          return { data: { revision: row.revision }, error: null };
        },
      };
      return query;
    } } as unknown as SupabaseClient;
    const store = new Store({ supabase: client,resourcePolicies:new ResourcePolicyStore(null) });
    await assert.rejects(store.getPrivateLibrary("alice"), /Clear your library/);
    await assert.rejects(store.updatePrivateLibrary("alice", { type: "save-pick", track }), /Clear your library/);
    assert.equal(writes, 0);
    assert.deepEqual(await store.updatePrivateLibrary("alice", { type: "clear-library" }), emptyLibrary());
    assert.equal(writes, 1);
    assert.equal(row.revision, initial.revision === 7 ? 8 : 1);
    assert.ok(filters.filter(([column]) => column === "user_id").every(([, value]) => value === "alice"));
  }
});
