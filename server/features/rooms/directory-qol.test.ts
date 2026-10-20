import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Store } from "../../persistence/store.js";

test("public discovery remains bounded while all older memberships, favorites and owned rooms are looked up", async () => {
  const row = (slug: string, isPublic: boolean, index: number, owner = "other") => ({ slug, name: slug, owner_id: owner, is_public: isPublic, access_mode: isPublic ? "public" : "members", password_hash: null, settings: { description: "x".repeat(300) }, created_at: "2020-01-01", updated_at: `2026-${String(index).padStart(5, "0")}` });
  const rooms = [...Array.from({ length: 220 }, (_, index) => row(`public-room-${index}`, true, 900 - index)), ...Array.from({ length: 501 }, (_, index) => row(`private-member-${index}`, false, index)), row("old-favorite", true, 1), row("owned-private", false, 0, "alice"), row("revoked-private", false, 0)];
  const tables: Record<string, any[]> = { soundspin_rooms: rooms, soundspin_room_members: Array.from({ length: 501 }, (_, index) => ({ user_id: "alice", room_slug: `private-member-${index}`, role: "member" })), soundspin_room_favorites: [{ user_id: "alice", room_slug: "old-favorite" }, { user_id: "alice", room_slug: "revoked-private" }, { user_id: "alice", room_slug: "invalid,(injected)" }] };
  tables.soundspin_room_moderation = [];
  tables.soundspin_room_restrictions = [];
  tables.soundspin_account_restrictions = [];
  const lookupSlugs: string[] = [];
  const visibilityBatches: string[][] = [];
  const client = { async rpc(name: string, input: { p_actor: string; p_rooms: string[]; p_room_slug: string }) {
    if (name === "soundspin_room_access") {
      const room = rooms.find(room => room.slug === input.p_room_slug)!;
      return { data: { exists: true, isPublic: room.is_public, passwordHash: null, role: room.owner_id === input.p_actor ? "owner" : null,
        banned: false, accessMode: room.access_mode, settings: room.settings, roomActive: true, accountActive: true, readers: [] }, error: null };
    }
    assert.equal(name, "soundspin_directory_visibility");
    visibilityBatches.push(input.p_rooms);
    return { data: [...input.p_rooms, "unrequested-room"], error: null };
  }, from(table: string) {
    assert.ok(Object.hasOwn(tables, table), `Unexpected directory table: ${table}`);
    let result = [...tables[table]];
    const query = {
      select() { return query; },
      eq(key: string, value: unknown) { result = result.filter((item) => item[key] === value); return query; },
      in(key: string, values: string[]) { lookupSlugs.push(...values); result = result.filter((item) => values.includes(item[key])); return query; },
      order(key: string, options?: { ascending?: boolean }) { result.sort((first, second) => String(first[key]).localeCompare(String(second[key])) * (options?.ascending === false ? -1 : 1)); return query; },
      range(start: number, end: number) { result = result.slice(start, end + 1); return query; },
      limit(limit: number) { result = result.slice(0, limit); return query; },
      async maybeSingle() { return { data: result[0] || null, error: null }; },
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) { return Promise.resolve({ data: result, error: null }).then(resolve, reject); }
    };
    return query;
  } } as unknown as SupabaseClient;
  const store = new Store({ supabase: client });
  const directory = await store.listRooms("alice", {});
  assert.equal(directory.filter((entry) => entry.slug.startsWith("public-room")).length, 200);
  assert.equal(directory.filter((entry) => entry.slug.startsWith("private-member")).length, 501);
  assert.ok(directory.some((entry) => entry.slug === "private-member-500"));
  assert.equal(directory.find((entry) => entry.slug === "old-favorite")?.isFavorite, true);
  assert.equal(directory.find((entry) => entry.slug === "owned-private")?.role, "owner");
  assert.equal(directory.find((entry) => entry.slug === "owned-private")?.description?.length, 240);
  assert.equal(directory.some((entry) => entry.slug === "revoked-private"), false);
  assert.equal(lookupSlugs.includes("invalid,(injected)"), false);
  assert.ok(visibilityBatches.every(batch => batch.length <= 100), "directory restrictions use bounded snapshots");
  assert.equal(directory.some(entry => entry.slug === "unrequested-room"), false);
  assert.equal((await store.getRoomAccess("owned-private", "alice")).role, "owner");
});
