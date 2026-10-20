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
      create table public.soundspin_feedback(created_at timestamptz);
      grant select on public.soundspin_profiles, public.soundspin_messages, public.soundspin_feedback to service_role;
      insert into public.soundspin_messages select '2026-10-07T10:00:00Z'::timestamptz from generate_series(1,1275);
      insert into public.soundspin_messages values ('2026-10-07T01:00:00+02:00');
      insert into public.soundspin_profiles values ('2026-10-07T10:00:00Z');
      insert into public.soundspin_feedback values ('2026-10-07T11:00:00Z');`);
    await db.exec(await readFile(new URL("../../supabase/migrations/20261007064601_admin_daily_activity.sql", import.meta.url), "utf8"));
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query("select * from public.soundspin_admin_activity('2026-10-01T00:00:00Z')"), /permission denied/);
      await db.exec("reset role");
    }
    await db.exec("set role service_role; set timezone = 'Pacific/Honolulu'");
    const rows = (await db.query("select day::text, users::int, feedback::int, messages::int from public.soundspin_admin_activity('2026-10-01T00:00:00Z')")).rows;
    assert.deepEqual(rows, [
      { day: "2026-10-06", users: 0, feedback: 0, messages: 1 },
      { day: "2026-10-07", users: 1, feedback: 1, messages: 1275 }
    ]);
    await db.exec("reset role");
    assert.equal((await db.query("select prosecdef from pg_proc where proname='soundspin_admin_activity'")).rows[0].prosecdef, false);
  } finally { await db.close(); }
});
