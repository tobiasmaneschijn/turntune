import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import test from "node:test";

// Pass PGLITE_MODULE pointing to the pinned isolated runtime, or install PGlite
// in the test environment. No running Supabase instance or real accounts used.
const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : "@electric-sql/pglite");
test("actual private-library migration enforces owner CRUD, bounds and account cascade", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema public, auth to anon, authenticated, service_role;
      insert into auth.users values ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222'), ('33333333-3333-4333-8333-333333333333');`);
    await db.exec(await readFile(new URL("../supabase/migrations/20261006205022_private_music_library.sql", import.meta.url), "utf8"));
    const alice = "11111111-1111-4111-8111-111111111111";
    const bob = "22222222-2222-4222-8222-222222222222";
    const third = "33333333-3333-4333-8333-333333333333";
    const asUser = async (id) => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]); await db.exec("set role authenticated"); };
    await asUser(alice);
    await db.query("insert into public.soundspin_private_libraries(user_id) values ($1)", [alice]);
    assert.equal((await db.query("select * from public.soundspin_private_libraries")).rows.length, 1);
    await db.query("update public.soundspin_private_libraries set revision=2 where user_id=$1", [alice]);
    await assert.rejects(db.query("update public.soundspin_private_libraries set user_id=$1 where user_id=$2", [third, alice]), /row-level security/);
    await assert.rejects(db.query("update public.soundspin_private_libraries set data=$1::jsonb where user_id=$2", [JSON.stringify({ missing: [] }), alice]), /library_arrays/);
    await assert.rejects(db.query("update public.soundspin_private_libraries set data=$1::jsonb where user_id=$2", [JSON.stringify({ picks: Array(501).fill({}), sets: [] }), alice]), /library_limits/);
    await assert.rejects(db.query("update public.soundspin_private_libraries set data=$1::jsonb where user_id=$2", [JSON.stringify({ picks: [], sets: [{ tracks: Array(51).fill({}) }] }), alice]), /library_set_track_limits/);
    await asUser(bob);
    assert.equal((await db.query("select * from public.soundspin_private_libraries")).rows.length, 0);
    assert.equal((await db.query("update public.soundspin_private_libraries set revision=3 where user_id=$1 returning user_id", [alice])).rows.length, 0);
    assert.equal((await db.query("delete from public.soundspin_private_libraries where user_id=$1 returning user_id", [alice])).rows.length, 0);
    await assert.rejects(db.query("insert into public.soundspin_private_libraries(user_id) values ($1)", [third]), /row-level security/);
    await db.query("insert into public.soundspin_private_libraries(user_id) values ($1)", [bob]);
    await db.exec("reset role; set role anon");
    await assert.rejects(db.query("select * from public.soundspin_private_libraries"), /permission denied/);
    await assert.rejects(db.query("insert into public.soundspin_private_libraries(user_id) values ($1)", [third]), /permission denied/);
    await asUser(alice);
    assert.equal((await db.query("delete from public.soundspin_private_libraries where user_id=$1 returning user_id", [alice])).rows.length, 1);
    await db.exec("reset role");
    await db.query("delete from auth.users where id=$1", [bob]);
    assert.equal((await db.query("select * from public.soundspin_private_libraries")).rows.length, 0);
  } finally { await db.close(); }
});
