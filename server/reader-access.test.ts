import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Store } from "./store.js";
import type { Room } from "./types.js";

function readerDatabase(options: {
  metadata: () => { owner_id: string; is_public: boolean } | null;
  members: () => string[];
  restrictions?: () => unknown[];
  membershipBatches: string[][];
}) {
  const known = new Set(["soundspin_rooms", "soundspin_room_members", "soundspin_room_moderation", "soundspin_room_restrictions", "soundspin_account_restrictions"]);
  return { from(table: string) {
    assert.ok(known.has(table), `Unexpected reader table: ${table}`);
    let ids: string[] = [];
    const rows = () => table === "soundspin_rooms" ? options.metadata()
      : table === "soundspin_room_moderation" ? { data: { restrictions: options.restrictions?.() || [] } }
      : table === "soundspin_room_members" ? [...ids, "not-requested"].filter(id => id === "not-requested" || options.members().includes(id)).map(user_id => ({ user_id }))
      : null;
    const query = {
      select() { return query; }, eq(key: string) { assert.ok(["slug", "room_slug", "user_id"].includes(key)); return query; },
      in(key: string, values: string[]) {
        assert.ok(["user_id", "room_slug"].includes(key)); ids = values;
        if (table === "soundspin_room_members") options.membershipBatches.push(values);
        return query;
      },
      async maybeSingle() { const data = rows(); return { data: Array.isArray(data) ? data[0] || null : data, error: null }; },
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        const data = rows(); return Promise.resolve({ data: Array.isArray(data) ? data : data ? [data] : [], error: null }).then(resolve, reject);
      }
    }; return query;
  } } as unknown as SupabaseClient;
}

test("reader admission rechecks fresh private membership, bans and deletion rather than stale live presence", async () => {
  let metadata: { owner_id: string; is_public: boolean } | null = { owner_id: "owner", is_public: false };
  const members = new Set(["current", "revoked"]);
  const batches: string[][] = [];
  let restrictions: unknown[] = [];
  const client = readerDatabase({ metadata: () => metadata, members: () => [...members], membershipBatches: batches, restrictions: () => restrictions });
  const store = new Store({ supabase: client });
  assert.deepEqual(await store.allowedRoomReaders("private-room", ["owner", "current", "revoked", "unknown"]), new Set(["owner", "current", "revoked"]));
  members.delete("revoked");
  assert.deepEqual(await store.allowedRoomReaders("private-room", ["owner", "current", "revoked"]), new Set(["owner", "current"]));
  restrictions = [{ userId: "current", kind: "room-ban", revokedAt: null, expiresAt: null }];
  assert.deepEqual(await store.allowedRoomReaders("private-room", ["owner", "current"]), new Set(["owner"]));
  metadata = null;
  assert.deepEqual(await store.allowedRoomReaders("private-room", ["owner", "current"]), new Set());
  metadata = { owner_id: "owner", is_public: true };
  restrictions = [];
  const before = batches.length;
  assert.deepEqual(await store.allowedRoomReaders("private-room", ["current", "current"]), new Set(["current"]));
  assert.equal(batches.length, before);
});

test("private reader lookups bound each membership batch and never add unrequested identities", async () => {
  const ids = Array.from({ length: 205 }, (_, index) => `member-${index}`);
  const batches: string[][] = [];
  const client = readerDatabase({ metadata: () => ({ owner_id: "not-requested-owner", is_public: false }), members: () => ids, membershipBatches: batches });
  const allowed = await new Store({ supabase: client }).allowedRoomReaders("room", ids);
  assert.deepEqual(batches.map(batch => batch.length), [100, 100, 5]);
  assert.equal(allowed.size, 205); assert.equal(allowed.has("not-requested"), false); assert.equal(allowed.has("not-requested-owner"), false);
});

test("local private reader fallback admits current owner and explicit roles only", async () => {
  const store = new Store({ supabase: null });
  store.getOrCreateLocalRoom("local-room", () => ({ id: "local-room", isPublic: false, settings: {}, ownerUserId: "owner", moderatorUserIds: ["moderator"], djRoleUserIds: ["dj"] }) as Room);
  assert.deepEqual(await store.allowedRoomReaders("local-room", ["owner", "moderator", "dj", "unknown"]), new Set(["owner", "moderator", "dj"]));
  assert.deepEqual(await store.allowedRoomReaders("deleted", ["owner"]), new Set());
  assert.equal((await store.getRoomAccess("local-room", "moderator")).role, "moderator");
});
