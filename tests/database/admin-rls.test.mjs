import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("daily activity aggregates more than an API page and remains service-only with UTC day buckets", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table public.soundspin_profiles(created_at timestamptz);
      create table public.soundspin_messages(created_at timestamptz);
      create table public.soundspin_feedback(created_at timestamptz,status text default 'new');
      create table public.soundspin_rooms(slug text);
      create function public.soundspin_require_admin(p_actor uuid) returns void language plpgsql as $$ begin
        if p_actor is null or p_actor<>'11111111-1111-4111-8111-111111111111' then raise exception 'Administrator access required.'; end if;
      end $$;
      grant select on public.soundspin_profiles, public.soundspin_messages, public.soundspin_feedback, public.soundspin_rooms to service_role;
      insert into public.soundspin_messages select '2026-10-07T10:00:00Z'::timestamptz from generate_series(1,1275);
      insert into public.soundspin_messages values ('2026-10-07T01:00:00+02:00');
      insert into public.soundspin_profiles values ('2026-10-07T10:00:00Z');
      insert into public.soundspin_feedback(created_at) values ('2026-10-07T11:00:00Z');
      insert into public.soundspin_feedback values ('2026-09-01T11:00:00Z','closed');
      insert into public.soundspin_rooms values ('lounge');`);
    await db.exec(await readFile(new URL("../../supabase/migrations/20261007064601_admin_daily_activity.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../../supabase/migrations/20261020083649_batch_social_admin_upload_queries.sql", import.meta.url), "utf8"));
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query("select * from public.soundspin_admin_activity('2026-10-01T00:00:00Z')"), /permission denied/);
      await assert.rejects(db.query("select public.soundspin_admin_summary('11111111-1111-4111-8111-111111111111','2026-10-01T00:00:00Z')"), /permission denied/);
      await db.exec("reset role");
    }
    await db.exec("set role service_role; set timezone = 'Pacific/Honolulu'");
    const rows = (await db.query("select day::text, users::int, feedback::int, messages::int from public.soundspin_admin_activity('2026-10-01T00:00:00Z')")).rows;
    assert.deepEqual(rows, [
      { day: "2026-10-06", users: 0, feedback: 0, messages: 1 },
      { day: "2026-10-07", users: 1, feedback: 1, messages: 1275 }
    ]);
    const summary=(await db.query("select public.soundspin_admin_summary('11111111-1111-4111-8111-111111111111','2026-10-01T00:00:00Z') as result")).rows[0].result;
    assert.deepEqual(summary.metrics,{users:1,rooms:1,feedback:2,openFeedback:1,messages:1276});
    assert.equal(summary.activity.at(-1).messages,1275);
    await assert.rejects(db.query("select public.soundspin_admin_summary('22222222-2222-4222-8222-222222222222','2026-10-01T00:00:00Z')"),/Administrator access required/);
    await db.exec("reset role");
    assert.equal((await db.query("select prosecdef from pg_proc where proname='soundspin_admin_activity'")).rows[0].prosecdef, false);
  } finally { await db.close(); }
});
