import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import test from "node:test";

const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : "@electric-sql/pglite");
test("current library grants enforce owner-only reads, service-only bounded writes, CAS and account cascade", async () => {
  const db = new PGlite();
  const alice = "11111111-1111-4111-8111-111111111111", bob = "22222222-2222-4222-8222-222222222222";
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema public, auth to anon, authenticated, service_role;
      insert into auth.users values ('${alice}'), ('${bob}');`);
    await db.exec(await readFile(new URL("../supabase/migrations/20261006205022_private_music_library.sql", import.meta.url), "utf8"));
    const launchMigration = await readFile(new URL("../supabase/migrations/20261013122000_social_blocks_library.sql", import.meta.url), "utf8");
    await db.exec(launchMigration.slice(launchMigration.indexOf("-- Direct browser writes")));
    await db.exec("set role service_role");
    await db.query("insert into public.soundspin_private_libraries(user_id) values ($1),($2)", [alice,bob]);
    await assert.rejects(db.query("update public.soundspin_private_libraries set data=$1::jsonb where user_id=$2", [JSON.stringify({ missing: [] }), alice]), /library_arrays/);
    await assert.rejects(db.query("update public.soundspin_private_libraries set data=$1::jsonb where user_id=$2", [JSON.stringify({ picks: Array(501).fill({}), sets: [] }), alice]), /library_limits/);
    await assert.rejects(db.query("update public.soundspin_private_libraries set data=$1::jsonb where user_id=$2", [JSON.stringify({ picks: [], sets: [{ tracks: Array(51).fill({}) }] }), alice]), /library_set_track_limits/);
    await assert.rejects(db.query("update public.soundspin_private_libraries set revision=9007199254740992 where user_id=$1",[alice]),/library_safe_revision/);
    assert.equal((await db.query("update public.soundspin_private_libraries set revision=2 where user_id=$1 and revision=1 returning revision",[alice])).rows[0].revision,2);
    assert.equal((await db.query("update public.soundspin_private_libraries set revision=3 where user_id=$1 and revision=1 returning revision",[alice])).rows.length,0);
    for (const id of [alice,bob]) {
      await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]); await db.exec("set role authenticated");
      assert.deepEqual((await db.query("select user_id from public.soundspin_private_libraries")).rows,[{user_id:id}]);
      for (const command of ["insert into public.soundspin_private_libraries(user_id) values($1)","update public.soundspin_private_libraries set data='{}',revision=1 where user_id=$1","delete from public.soundspin_private_libraries where user_id=$1"]) await assert.rejects(db.query(command,[id]),/permission denied/);
    }
    await db.exec("reset role; set role anon");
    await assert.rejects(db.query("select * from public.soundspin_private_libraries"),/permission denied/);
    await db.exec("reset role");
    await db.query("delete from auth.users where id=$1",[bob]);
    assert.equal((await db.query("select * from public.soundspin_private_libraries where user_id=$1",[bob])).rows.length,0);
  } finally { await db.close(); }
});
