import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("feedback submissions cannot forge administrative fields or another account, while defaults and admin updates work", async () => {
  const db = new PGlite();
  const alice = "11111111-1111-4111-8111-111111111111";
  const bob = "22222222-2222-4222-8222-222222222222";
  try {
    await db.exec(`create role authenticated; create role anon; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema public, auth to authenticated, anon, service_role;
      create schema storage; create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner_id text);
      create function storage.foldername(text) returns text[] language sql immutable as $$ select regexp_split_to_array(regexp_replace($1, '/[^/]*$', ''), '/') $$;
      create table public.soundspin_profiles(id uuid); create table public.soundspin_rooms(id uuid); create table public.soundspin_messages(id uuid);`);
    for (const file of ["20260720092326_add_feedback.sql", "20260720095141_admin_feedback_workflow.sql", "20260720100745_feedback_diagnostics.sql", "20261007063943_restrict_feedback_submission_columns.sql"]) {
      await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
    }
    await db.query("insert into auth.users values ($1),($2)", [alice, bob]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [alice]);
    await db.exec("set role authenticated");
    await db.query("insert into public.soundspin_feedback(user_id,message,page_path,category,impact,diagnostics) values ($1,'Actual report','/','bug','minor','{}')", [alice]);
    for (const [column, value] of [["status", "resolved"], ["admin_note", "Forged admin approval"], ["created_at", "9999-01-01"], ["updated_at", "9999-01-01"]]) {
      await assert.rejects(db.query(`insert into public.soundspin_feedback(user_id,message,page_path,${column}) values ($1,'forged','/',$2)`, [alice, value]), /permission denied/);
    }
    await assert.rejects(db.query("insert into public.soundspin_feedback(user_id,message,page_path) values ($1,'other owner','/')", [bob]), /row-level security/);
    await assert.rejects(db.query("update public.soundspin_feedback set status='resolved'"), /permission denied/);
    await assert.rejects(db.query("select admin_note from public.soundspin_feedback"), /permission denied/);
    await db.exec("reset role; set role anon");
    await assert.rejects(db.query("insert into public.soundspin_feedback(user_id,message,page_path) values ($1,'anonymous','/')", [alice]), /permission denied/);
    await db.exec("reset role; set role service_role");
    const rows = (await db.query("select status,admin_note from public.soundspin_feedback")).rows;
    assert.deepEqual(rows, [{ status: "new", admin_note: "" }]);
    await db.query("update public.soundspin_feedback set status='reviewing',admin_note='Verified admin',updated_at=now()");
    assert.deepEqual((await db.query("select status,admin_note from public.soundspin_feedback")).rows, [{ status: "reviewing", admin_note: "Verified admin" }]);
  } finally { await db.close(); }
});
