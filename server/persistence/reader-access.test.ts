import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Store } from "./store.js";
import type { Room } from "../types.js";

function readerDatabase(options: {
  metadata: () => { owner_id: string; is_public: boolean } | null;
  members: () => string[];
  restrictions?: () => unknown[];
  membershipBatches: string[][];
}) {
  return { async rpc(name: string, input: { p_actor: string | null; p_readers: string[] }) {
    assert.equal(name, "soundspin_room_access");
    const metadata = options.metadata(), ids = input.p_readers;
    options.membershipBatches.push(ids);
    const bans = (options.restrictions?.() || []) as Array<{ userId: string }>;
    const readers = metadata ? ids.filter(id => !bans.some(ban => ban.userId === id) && (metadata.is_public || metadata.owner_id === id || options.members().includes(id))) : [];
    return { error: null, data: { exists: Boolean(metadata), isPublic: metadata?.is_public ?? false, passwordHash: null,
      role: input.p_actor === metadata?.owner_id ? "owner" : input.p_actor && options.members().includes(input.p_actor) ? "member" : null,
      banned: bans.some(ban => ban.userId === input.p_actor), accessMode: metadata?.is_public ? "public" : "members", settings: {},
      roomActive: Boolean(metadata), accountActive: true, readers: [...readers, "not-requested"] } };
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
  assert.equal(batches.length, before + 1, "one fresh RPC also verifies public readers");
  const admission = await store.getRoomAdmission("private-room", "owner", ["current"]);
  assert.equal(admission.role, "owner"); assert.equal(admission.accountActive, true);
  assert.deepEqual(admission.readers, new Set(["current"]));
  const unavailable = new Store({ supabase: { rpc: async () => ({ data: null, error: { message: "unavailable" } }) } as unknown as SupabaseClient });
  await assert.rejects(unavailable.allowedRoomReaders("private-room", ["current"]), /Could not check room access/);
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
