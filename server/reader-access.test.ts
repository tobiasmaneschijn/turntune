import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Store } from "./store.js";
import type { Room } from "./types.js";
test("reader admission rechecks fresh private membership and deletion rather than stale live presence", async () => {
  let metadata: { owner_id: string; is_public: boolean } | null = { owner_id: "owner", is_public: false };
  const members = new Set(["current", "revoked"]);
  const batches: string[][] = [];
  const client = { from(table: string) {
    let ids: string[] = [];
    const query = { select() { return query; }, eq(key: string, value: string) { assert.equal(key === "slug" || key === "room_slug", true); assert.equal(value, "private-room"); return query; },
      in(key: string, values: string[]) { assert.equal(key, "user_id"); ids = values; batches.push(values); return query; },
      async maybeSingle() { assert.equal(table, "soundspin_rooms"); return { data: metadata, error: null }; },
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) { assert.equal(table, "soundspin_room_members"); return Promise.resolve({ data: ids.filter((id) => members.has(id)).map((user_id) => ({ user_id })), error: null }).then(resolve, reject); }
    }; return query;
  } } as unknown as SupabaseClient;
  const store = new Store({ supabase: client });
  assert.deepEqual(await store.allowedRoomReaders("private-room", ["owner", "current", "revoked", "unknown"]), new Set(["owner", "current", "revoked"]));
  members.delete("revoked");
  assert.deepEqual(await store.allowedRoomReaders("private-room", ["owner", "current", "revoked"]), new Set(["owner", "current"]));
  metadata = null;
  assert.deepEqual(await store.allowedRoomReaders("private-room", ["owner", "current"]), new Set());
  metadata = { owner_id: "owner", is_public: true };
  const before = batches.length;
  assert.deepEqual(await store.allowedRoomReaders("private-room", ["current", "current"]), new Set(["current"]));
  assert.equal(batches.length, before);
});
test("private reader lookups bound each membership batch and never add unrequested identities", async () => {
  const ids = Array.from({ length: 205 }, (_, index) => `member-${index}`);
  const sizes: number[] = [];
  const client = { from(table: string) {
    let batch: string[] = [];
    const query = { select() { return query; }, eq() { return query; }, in(_key: string, values: string[]) { batch = values; sizes.push(values.length); return query; },
      async maybeSingle() { return { data: { owner_id: "not-requested-owner", is_public: false }, error: null }; },
      then(resolve: (value: unknown) => unknown) { assert.equal(table, "soundspin_room_members"); return Promise.resolve({ data: [...batch, "not-requested"].map((user_id) => ({ user_id })), error: null }).then(resolve); }
    }; return query;
  } } as unknown as SupabaseClient;
  const allowed = await new Store({ supabase: client }).allowedRoomReaders("room", ids);
  assert.deepEqual(sizes, [100, 100, 5]); assert.equal(allowed.size, 205); assert.equal(allowed.has("not-requested"), false); assert.equal(allowed.has("not-requested-owner"), false);
});
test("local private reader fallback admits current owner and explicit roles only", async () => {
  const store = new Store({ supabase: null });
  store.getOrCreateLocalRoom("local-room", () => ({ id: "local-room", isPublic: false, ownerUserId: "owner", moderatorUserIds: ["moderator"], djRoleUserIds: ["dj"] }) as Room);
  assert.deepEqual(await store.allowedRoomReaders("local-room", ["owner", "moderator", "dj", "unknown"]), new Set(["owner", "moderator", "dj"]));
  assert.deepEqual(await store.allowedRoomReaders("deleted", ["owner"]), new Set());
  assert.equal((await store.getRoomAccess("local-room", "moderator")).role, "moderator");
});
