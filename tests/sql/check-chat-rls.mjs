import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

// Optional external module path; CI uses the exact-pinned project dependency.
const modulePath = process.argv[2]
const { PGlite } = await import(modulePath ? pathToFileURL(modulePath).href : '@electric-sql/pglite')
const database = new PGlite()
try {
  await database.exec(`create role authenticated; create role anon; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon, service_role;
    grant execute on function auth.uid() to authenticated, anon, service_role;
    create table public.soundspin_rooms(slug text primary key, owner_id uuid references auth.users(id), state jsonb not null default '{}');
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner_id text);
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql immutable as $$ select regexp_split_to_array(regexp_replace($1, '/[^/]*$', ''), '/') $$;
    grant usage on schema storage to authenticated, anon, service_role;
    grant select, insert, delete on storage.objects to authenticated;
    grant all on storage.objects, storage.buckets to service_role;`)
  for (const file of ['20260716214500_realtime_chat.sql', '20260716220000_chat_media.sql', '20260719130616_chat_replies_and_reactions.sql', '20260719204302_chat_mentions.sql', '20261006210200_room_chat_read_authorization.sql', '20261008132716_chat_polls.sql']) {
    const sql = await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8')
    await database.exec(sql)
  }
  await database.exec(await readFile(new URL('./chat-rls.sql', import.meta.url), 'utf8'))
  await database.exec(await readFile(new URL('./chat-polls.sql', import.meta.url), 'utf8'))
  const policies = await database.query("select qual from pg_policies where tablename in ('soundspin_messages','soundspin_message_reactions') and cmd = 'SELECT'")
  assert.equal(policies.rows.length, 2)
  assert.ok(policies.rows.every((row) => row.qual.includes('auth.uid') && !row.qual.includes('true')))
  await database.exec('set enable_seqscan = off')
  const plan = await database.query("explain select id, created_at from public.soundspin_messages where room_slug = 'lounge' order by created_at desc, id desc limit 200")
  assert.match(JSON.stringify(plan.rows), /soundspin_messages_room_created_id_idx/)
  console.log('Chat SQL passed: room reads and direct mutations denied; server-only polls enforce one changeable vote per account, same-room options and monotonic revisions; storage is private; cursor index used.')
} catch (error) {
  console.error(`Chat SQL check failed (${error.code || 'assertion'}): ${error.message}`)
  process.exitCode = 1
} finally { await database.close() }
