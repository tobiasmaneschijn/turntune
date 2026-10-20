import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("room commands are service-only and a failed membership mutation rolls back radio and metadata together", async () => {
  const db = new PGlite();
  const alice = "11111111-1111-4111-8111-111111111111";
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create table public.soundspin_rooms(slug text primary key, name text, is_public boolean, password_hash text, settings jsonb, state jsonb, updated_at timestamptz);
      create table public.soundspin_room_members(room_slug text references public.soundspin_rooms(slug), user_id uuid references auth.users(id), role text check(role in ('member','moderator')), updated_at timestamptz, primary key(room_slug,user_id));
      alter table public.soundspin_rooms enable row level security;
      alter table public.soundspin_room_members enable row level security;
      grant select,insert,update on public.soundspin_rooms, public.soundspin_room_members to service_role;
      insert into auth.users values ('${alice}');
      insert into public.soundspin_rooms values ('lounge','Original',true,null,'{}','{"queue":[]}',now());`);
    await db.exec(await readFile(new URL("../../supabase/migrations/20261007064407_atomic_room_commands.sql", import.meta.url), "utf8"));
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query("select public.soundspin_commit_room('lounge','{}')"), /permission denied/);
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    const state = { queue: ["track"] }, metadata = { name: "Updated", is_public: false, password_hash: "hashed", settings: { djAccess: "roles" } };
    await assert.rejects(db.query("select public.soundspin_commit_room('lounge',$1,$2,$3)", [state, metadata, { user_id: alice, role: "invalid-role" }]), /check constraint/);
    assert.deepEqual((await db.query("select name,is_public,password_hash,settings,state from public.soundspin_rooms")).rows, [{ name: "Original", is_public: true, password_hash: null, settings: {}, state: { queue: [] } }]);
    assert.equal((await db.query("select * from public.soundspin_room_members")).rows.length, 0);
    await db.query("select public.soundspin_commit_room('lounge',$1,$2,$3)", [state, metadata, { user_id: alice, role: "moderator" }]);
    assert.deepEqual((await db.query("select name,is_public,password_hash,settings,state from public.soundspin_rooms")).rows, [{ name: "Updated", is_public: false, password_hash: "hashed", settings: { djAccess: "roles" }, state }]);
    assert.deepEqual((await db.query("select user_id,role from public.soundspin_room_members")).rows, [{ user_id: alice, role: "moderator" }]);
    await db.exec("reset role");
    assert.equal((await db.query("select prosecdef from pg_proc where proname='soundspin_commit_room'")).rows[0].prosecdef, false);
  } finally { await db.close(); }
});
