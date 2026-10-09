import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('durable chat RPC is service-only, atomic and removal wins against replay and a future save', async () => {
  const db = new PGlite(), alice = '11111111-1111-4111-8111-111111111111', staff = '22222222-2222-4222-8222-222222222222';
  const fingerprint = 'a'.repeat(64);
  const payload = id => ({ id, content: 'Secret', type: 'text', createdAt: new Date().toISOString(), mentions: [], user: { name: 'Alice', avatarSeed: alice }, poll: { options: ['One', 'Two'] } });
  const command = async (kind, id, value, user = alice, slow = 0, hash = fingerprint) => (await db.query('select public.soundspin_chat_command($1,\'lounge\',$2,$3,$4,$5,$6) as result', [kind, user, id, hash, value, slow])).rows[0].result;
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;
      create table public.soundspin_rooms(slug text primary key,owner_id uuid references auth.users(id),state jsonb not null default '{}');
      create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text);alter table storage.objects enable row level security;
      create function storage.foldername(text) returns text[] language sql immutable as $$select regexp_split_to_array(regexp_replace($1,'/[^/]*$',''),'/')$$;
      grant usage on schema storage to anon,authenticated,service_role;grant select,insert,delete on storage.objects to authenticated;grant all on storage.objects,storage.buckets to service_role;
      insert into auth.users values('${alice}'),('${staff}');insert into soundspin_rooms(slug)values('lounge'),('elsewhere');`);
    for(const file of ['20260716214500_realtime_chat.sql','20260716220000_chat_media.sql','20260719130616_chat_replies_and_reactions.sql','20260719204302_chat_mentions.sql','20261006210200_room_chat_read_authorization.sql','20261008132716_chat_polls.sql']){
      await db.exec(await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'));
    }
    await db.exec(await readFile(new URL('../supabase/migrations/20261009073805_durable_room_chat.sql', import.meta.url), 'utf8'));
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(command('message', `message:${randomUUID()}`, payload(randomUUID())), /permission denied/);
      await assert.rejects(db.query('select * from public.soundspin_chat_tombstones'), /permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    const id = randomUUID(), input = payload(id);
    assert.equal((await command('message', `message:${id}`, input, alice, 10)).fresh, true);
    assert.equal((await command('message', `message:${id}`, input, alice, 10)).fresh, false);
    await assert.rejects(command('message', `message:${id}`, input, alice, 10, 'b'.repeat(64)), /different content/);
    await assert.rejects(command('message', `message:${randomUUID()}`, payload(randomUUID()), alice, 10), /Slow mode/);
    const vote = randomUUID();assert.equal((await command('poll', `poll:${vote}`, { messageId: id, optionIndex: 0 })).result.revision, 1);
    assert.equal((await command('poll', `poll:${randomUUID()}`, { messageId: id, optionIndex: 1 })).result.revision, 2);
    const removal = randomUUID();
    await assert.rejects(command('remove', `remove:${removal}`, { messageId: id, reason: 'x'.repeat(501) }, staff), /check constraint/);
    assert.equal((await db.query('select content from soundspin_messages where id=$1', [id])).rows[0].content, 'Secret');
    assert.equal((await db.query('select * from soundspin_chat_tombstones')).rows.length, 0);
    const removed = await command('remove', `remove:${removal}`, { messageId: id, reason: 'Spam' }, staff);
    assert.equal(removed.fresh, true);assert.equal((await command('remove', `remove:${removal}`, { messageId: id, reason: 'Spam' }, staff)).fresh, false);
    await command('message', `message:${id}`, input);
    assert.deepEqual((await db.query('select content,poll_options,media_url,storage_path,removed_at is not null as removed from soundspin_messages where id=$1', [id])).rows, [{ content: 'Message removed', poll_options: null, media_url: null, storage_path: null, removed: true }]);
    assert.equal((await db.query('select * from soundspin_poll_votes')).rows.length, 0);
    await assert.rejects(command('reaction', `reaction:${randomUUID()}`, { messageId: id, action: 'add', emoji: '❤️' }), /removed/);
    await assert.rejects(command('poll', `poll:${randomUUID()}`, { messageId: id, optionIndex: 0 }), /removed/);
    const future = randomUUID();await command('remove', `remove:${randomUUID()}`, { messageId: future, reason: 'Pre-save removal' }, staff);
    await command('message', `message:${future}`, payload(future), alice, 10);
    assert.equal((await db.query('select content,removed_at is not null as removed from soundspin_messages where id=$1', [future])).rows[0].removed, true);
    assert.equal((await db.query('select * from soundspin_chat_removals')).rows.length, 2);
    await db.exec('reset role');
    assert.equal((await db.query("select prosecdef from pg_proc where proname='soundspin_chat_command'")).rows[0].prosecdef, false);
    await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${alice}',false);`);
    assert.equal((await db.query('select content from soundspin_messages where id=$1',[id])).rows[0].content,'Message removed');
    await assert.rejects(db.query("insert into storage.objects(bucket_id,name,owner_id)values('chat-media',$1,$2)",[`${alice}/lounge/${randomUUID()}.png`,alice]),/row-level security/);
  } finally { await db.close(); }
});
