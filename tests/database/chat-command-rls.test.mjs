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
      grant usage on schema auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;grant select on auth.users to service_role;
      create table public.soundspin_rooms(slug text primary key,owner_id uuid references auth.users(id),state jsonb not null default '{}',settings jsonb not null default '{}',updated_at timestamptz not null default now());
      create table public.soundspin_room_moderation(room_slug text primary key references public.soundspin_rooms(slug),data jsonb not null default '{}',revision bigint not null default 0,updated_at timestamptz not null default now());
      create table public.soundspin_profiles(user_id uuid primary key references auth.users(id),display_name text,avatar_key text,avatar_url text);
      create table public.soundspin_room_members(room_slug text references soundspin_rooms(slug),user_id uuid references auth.users(id),role text,joined_at timestamptz default now(),primary key(room_slug,user_id));
      grant select on public.soundspin_profiles,public.soundspin_room_members to service_role;
      grant select,update on public.soundspin_rooms to service_role;
      grant all on public.soundspin_room_moderation to service_role;
      create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text);alter table storage.objects enable row level security;
      create function storage.foldername(text) returns text[] language sql immutable as $$select regexp_split_to_array(regexp_replace($1,'/[^/]*$',''),'/')$$;
      grant usage on schema storage to anon,authenticated,service_role;grant select,insert,delete on storage.objects to authenticated;grant all on storage.objects,storage.buckets to service_role;
      insert into auth.users values('${alice}'),('${staff}');insert into auth.users select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,301) n;insert into soundspin_rooms(slug)values('lounge'),('elsewhere');
      insert into soundspin_profiles(user_id,display_name,avatar_key)select id,case when id='${alice}' then 'Alice' when id='${staff}' then 'Staff' else 'Listener '||id::text end,'moon' from auth.users;
      insert into soundspin_room_members(room_slug,user_id,role)select 'lounge',id,'member' from auth.users;`);
    for(const file of ['20260716214500_realtime_chat.sql','20260716220000_chat_media.sql','20260719130616_chat_replies_and_reactions.sql','20260719204302_chat_mentions.sql','20261006210200_room_chat_read_authorization.sql','20261008132716_chat_polls.sql']){
      await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`,import.meta.url),'utf8'));
    }
    await db.exec(await readFile(new URL('../../supabase/migrations/20261009073805_durable_room_chat.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../../supabase/migrations/20261013121000_chat_moderation_bounds.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../../supabase/migrations/20261020083659_return_committed_chat_record.sql', import.meta.url), 'utf8'));
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(command('message', `message:${randomUUID()}`, payload(randomUUID())), /permission denied/);
      await assert.rejects(db.query('select soundspin_committed_chat_row($1)', [randomUUID()]), /permission denied/);
      await assert.rejects(db.query('select soundspin_chat_message_state($1)', [randomUUID()]), /permission denied/);
      await assert.rejects(db.query('select * from public.soundspin_chat_tombstones'), /permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    const memberPage=(await db.query("select soundspin_room_member_page('lounge','Listener') as result")).rows[0].result;
    assert.equal(memberPage.members.length,50);assert.equal(memberPage.cursor,'50');assert.ok(memberPage.members.every(member=>member.user.name.startsWith('Listener') && member.user.avatarSeed===member.user.id));
    const secondMembers=(await db.query("select soundspin_room_member_page('lounge','Listener',$1) as result",[memberPage.cursor])).rows[0].result;
    assert.equal(secondMembers.members.length,50);assert.equal(new Set([...memberPage.members,...secondMembers.members].map(member=>member.user.id)).size,100);
    assert.equal((await db.query("select soundspin_room_member_page('lounge','Alice') as result")).rows[0].result.members[0].user.id,alice);
    const id = randomUUID(), input = payload(id);
    const accepted = await command('message', `message:${id}`, input, alice, 10);
    assert.equal(accepted.fresh, true);
    assert.equal(accepted.row.id, id); assert.equal(accepted.row.content, input.content);
    assert.equal(accepted.row.immutable_fingerprint, fingerprint);
    assert.deepEqual(accepted.row.soundspin_message_reactions, []);
    assert.equal((await db.query('select soundspin_chat_message_state($1) as result',[id])).rows[0].result.row.id,id);
    await db.query('update soundspin_messages set immutable_fingerprint=null where id=$1',[id]);
    assert.equal((await db.query('select soundspin_chat_message_state($1) as result',[id])).rows[0].result.row.immutable_fingerprint,fingerprint);
    await db.query('update soundspin_messages set immutable_fingerprint=$2 where id=$1',[id,fingerprint]);
    assert.equal((await command('message', `message:${id}`, input, alice, 10)).fresh, false);
    await assert.rejects(command('message', `message:${id}`, input, alice, 10, 'b'.repeat(64)), /different content/);
    await assert.rejects(command('message', `message:${randomUUID()}`, payload(randomUUID()), alice, 10), /Slow mode/);
    const reaction = emoji => command('reaction', `reaction:${randomUUID()}`, { messageId: id, action: 'add', emoji });
    await assert.rejects(reaction('not-emoji'), /supported emoji/);
    for (const emoji of ['❤️', '😂', '😮']) assert.equal((await reaction(emoji)).fresh, true);
    const receiptCount = (await db.query('select count(*)::int as count from soundspin_chat_receipts')).rows[0].count;
    assert.equal((await reaction('❤️')).fresh, false);
    assert.equal((await command('reaction', `reaction:${randomUUID()}`, { messageId: id, action: 'remove', emoji: '👍' })).fresh, false);
    assert.equal((await db.query('select count(*)::int as count from soundspin_chat_receipts')).rows[0].count, receiptCount + 2);
    const noopReaction = `reaction:${randomUUID()}`, noopValue = { messageId: id, action: 'add', emoji: '❤️' };
    assert.equal((await command('reaction',noopReaction,noopValue)).fresh,false);
    await command('reaction',`reaction:${randomUUID()}`,{ ...noopValue,action:'remove' });
    assert.equal((await command('reaction',noopReaction,noopValue)).fresh,false);
    assert.equal((await db.query("select * from soundspin_message_reactions where message_id=$1 and user_id=$2 and emoji='❤️'",[id,alice])).rows.length,0);
    await reaction('❤️');
    const excess = await Promise.allSettled(['👍','🔥'].map(reaction));
    assert.equal(excess.filter(result => result.status === 'rejected').length, 2);
    assert.equal((await db.query('select count(*)::int as count from soundspin_message_reactions where message_id=$1', [id])).rows[0].count, 3);
    const vote = randomUUID();assert.equal((await command('poll', `poll:${vote}`, { messageId: id, optionIndex: 0 })).result.revision, 1);
    const noopPoll=`poll:${randomUUID()}`;assert.equal((await command('poll', noopPoll, { messageId: id, optionIndex: 0 })).fresh, false);
    assert.equal((await command('poll', `poll:${randomUUID()}`, { messageId: id, optionIndex: 1 })).result.revision, 2);
    assert.equal((await command('poll', noopPoll, { messageId: id, optionIndex: 0 })).result.revision,1);
    assert.equal((await db.query('select option_index from soundspin_poll_votes where message_id=$1 and user_id=$2',[id,alice])).rows[0].option_index,1);
    const retried = await command('message', `message:${id}`, input);
    assert.equal(retried.fresh, false);
    assert.equal(retried.row.soundspin_message_reactions.length, 3);
    assert.equal(retried.row.soundspin_poll_votes[0].option_index, 1);
    const replyId=randomUUID(), replyInput={ ...payload(replyId), replyTo:{ id } };
    assert.equal((await command('message', `message:${replyId}`, replyInput)).row.reply.content, input.content);
    const removal = randomUUID();
    await assert.rejects(command('remove', `remove:${removal}`, { messageId: id, reason: 'x'.repeat(501) }, staff), /check constraint/);
    assert.equal((await db.query('select content from soundspin_messages where id=$1', [id])).rows[0].content, 'Secret');
    assert.equal((await db.query('select * from soundspin_chat_tombstones')).rows.length, 0);
    const removed = await command('remove', `remove:${removal}`, { messageId: id, reason: 'Spam' }, staff);
    assert.equal(removed.fresh, true);assert.equal((await command('remove', `remove:${removal}`, { messageId: id, reason: 'Spam' }, staff)).fresh, false);
    const removedRetry = await command('message', `message:${id}`, input);
    assert.equal(removedRetry.row.content, 'Message removed'); assert.ok(removedRetry.row.removed_at);
    assert.deepEqual(removedRetry.row.soundspin_message_reactions, []);
    assert.equal((await command('message', `message:${replyId}`, replyInput)).row.reply.content, 'Message removed');
    assert.deepEqual((await db.query('select content,poll_options,media_url,storage_path,removed_at is not null as removed from soundspin_messages where id=$1', [id])).rows, [{ content: 'Message removed', poll_options: null, media_url: null, storage_path: null, removed: true }]);
    assert.equal((await db.query('select * from soundspin_poll_votes')).rows.length, 0);
    await assert.rejects(command('reaction', `reaction:${randomUUID()}`, { messageId: id, action: 'add', emoji: '❤️' }), /removed/);
    await assert.rejects(command('poll', `poll:${randomUUID()}`, { messageId: id, optionIndex: 0 }), /removed/);
    const future = randomUUID();await command('remove', `remove:${randomUUID()}`, { messageId: future, reason: 'Pre-save removal' }, staff);
    const pendingRemoval=(await db.query('select soundspin_chat_message_state($1) as result',[future])).rows[0].result;
    assert.equal(pendingRemoval.row,null);assert.equal(pendingRemoval.removal.roomId,'lounge');assert.ok(pendingRemoval.removal.removedAt);
    await command('message', `message:${future}`, payload(future), alice, 10);
    assert.equal((await db.query('select content,removed_at is not null as removed from soundspin_messages where id=$1', [future])).rows[0].removed, true);
    assert.equal((await db.query('select * from soundspin_chat_removals')).rows.length, 2);
    // Expiring replay receipts cannot resurrect content or change immutable message identity.
    await db.query("update soundspin_chat_receipts set created_at=now()-interval '25 hours'");
    assert.equal((await command('message', `message:${id}`, input)).fresh, false);
    await assert.rejects(command('message', `message:${id}`, { ...input, content: 'Changed' }, alice, 0, 'c'.repeat(64)), /different content/);
    assert.equal((await command('remove', `remove:${randomUUID()}`, { messageId: id }, staff)).fresh, false);
    assert.equal((await db.query('select * from soundspin_chat_removals')).rows.length, 2);
    // The aggregate limit also applies to many accounts and direct service inserts.
    const crowded = randomUUID(); await command('message', `message:${crowded}`, payload(crowded));
    await db.query("insert into soundspin_message_reactions(message_id,user_id,emoji) select $1,id,'👍' from auth.users where id::text like '00000000-%' order by id limit 300", [crowded]);
    await assert.rejects(db.query("insert into soundspin_message_reactions(message_id,user_id,emoji)values($1,'00000000-0000-4000-8000-000000000301','😂')", [crowded]), /reaction limit/);
    await db.query("insert into soundspin_poll_votes(message_id,room_slug,user_id,option_index) select $1,'lounge',id,0 from auth.users where id::text like '00000000-%' order by id limit 300", [crowded]);
    await assert.rejects(db.query("insert into soundspin_poll_votes(message_id,room_slug,user_id,option_index)values($1,'lounge','00000000-0000-4000-8000-000000000301',1)", [crowded]), /voter limit/);
    // Mention budgets are atomic and independent of client-controlled message timestamps.
    const mentioned = () => ({ ...payload(randomUUID()), createdAt: new Date(Date.now()-3600000).toISOString(), mentions: [{ userId: staff, userName: 'Staff', handle: 'Staff' }] });
    for (let i=0;i<5;i++) { const value=mentioned(); await command('message', `message:${value.id}`, value); }
    const overMention=mentioned();await assert.rejects(command('message', `message:${overMention.id}`, overMention), /Mention limit/);
    assert.equal((await db.query('select * from soundspin_messages where id=$1',[overMention.id])).rows.length,0);
    // Archived evidence stays private and immutable; active restrictions cannot be evicted.
    const log = { id: randomUUID(), action: 'ban', actorId: staff, createdAt: Date.now(), reason: 'Evidence' };
    const restriction = { id: randomUUID(), userId: alice, kind: 'room-ban', createdAt: Date.now(), revokedAt: null, expiresAt: null };
    await db.query('insert into soundspin_room_moderation(room_slug,data)values($1,$2)', ['lounge', { log: [log], restrictions: [restriction] }]);
    await assert.rejects(db.query('update soundspin_room_moderation set data=$1 where room_slug=$2', [{ log: [{ ...log, reason: 'Changed' }], restrictions: [restriction] }, 'lounge']), /append-only/);
    await assert.rejects(db.query('update soundspin_room_moderation set data=$1 where room_slug=$2', [{ log: [log], restrictions: [] }, 'lounge']), /Active moderation/);
    await db.query('update soundspin_room_moderation set data=$1 where room_slug=$2', [{ log: [], restrictions: [restriction] }, 'lounge']);
    const archive=(await db.query("select soundspin_read_moderation_archive('lounge','log') as result")).rows[0].result;
    assert.deepEqual(archive.items, [log]);assert.equal(archive.cursor,null);
    await assert.rejects(db.query("update soundspin_moderation_archive set data='{}'"), /permission denied/);
    await db.query("insert into soundspin_chat_child_archive(kind,record_key,data)values('reaction','legacy',$1)", [{ user_id: staff, emoji: 'fabricated' }]);
    const erased=(await db.query('select soundspin_erase_archived_account($1) as result',[staff])).rows[0].result;
    assert.equal(erased.eventsAnonymized,1);assert.equal(erased.childrenRemoved,1);assert.equal(erased.messagesScrubbed,5);assert.equal(erased.remaining,false);
    assert.equal((await db.query("select count(*)::int as count from soundspin_messages where mentions @> $1", [[{ userId: staff }]])).rows[0].count,0);
    const anonymized=(await db.query("select soundspin_read_moderation_archive('lounge','log') as result")).rows[0].result.items[0];
    assert.equal(anonymized.actorId,'[deleted-account]');assert.equal(anonymized.reason,'Evidence');
    assert.deepEqual((await db.query('select soundspin_purge_security_archives() as result')).rows[0].result, { moderationRemoved: 0, childrenRemoved: 0 });
    await db.exec("reset role;update soundspin_moderation_archive set expires_at=now()-interval '1 second';set role service_role");
    assert.equal((await db.query('select soundspin_purge_security_archives() as result')).rows[0].result.moderationRemoved,1);
    // The worker replaces the same room cache document returned by the ordered erasure RPC.
    const deletedUser = { id: alice, name: 'Alice', avatarSeed: alice }, retainedUser = { id: staff, name: 'Staff', avatarSeed: staff };
    const track = { id: randomUUID(), provider: 'youtube', providerId: 'video', title: 'Track', addedBy: deletedUser, addedAt: Date.now() };
    const typedLog = { id: randomUUID(), action: 'warn', actorId: staff, targetUserId: alice, createdAt: Date.now(), reason: 'Retained evidence' };
    const liveData = { log: [typedLog], restrictions: [{ ...restriction, actorId: staff }], reports: [{ id: randomUUID(), reporterId: staff, targetUserId: alice, status: 'open', createdAt: Date.now(), reason: 'Review' }], warnings: [{ id: randomUUID(), userId: alice, actorId: staff, text: 'Warning', readAt: null, createdAt: Date.now() }], members: { [alice]: { user: deletedUser, role: 'member' }, [staff]: { user: retainedUser, role: 'moderator' } }, rulesAcceptance: { [alice]: 1 }, receipts: { [`${alice}:${randomUUID()}`]: { hash: 'a'.repeat(64), result: {}, createdAt: Date.now() } } };
    const liveState = { djUserId: alice, moderatorUserIds: [staff,alice], djRoleUserIds: [alice], djQueueUserIds: [alice,staff], djQueues: { [alice]: [track], [staff]: [{ ...track, addedBy: retainedUser }] }, history: [track], playback: { track, playing: true, position: 2, updatedAt: 1 }, vibe: { trackId: track.id, votes: { [alice]: 1, [staff]: 1 } }, radioState: { turn: { userId: alice, used: 1 }, skipVotes: { userIds: [alice,staff] } } };
    await db.query('update soundspin_rooms set state=$1 where slug=$2', [liveState,'lounge']);
    await db.query('update soundspin_room_moderation set data=$1 where room_slug=$2', [liveData,'lounge']);
    assert.deepEqual((await db.query('select soundspin_moderation_actor_rooms($1) as result', [alice])).rows[0].result, ['lounge']);
    const scrubbed=(await db.query("select soundspin_erase_live_moderation_account('lounge',$1) as result", [alice])).rows[0].result;
    assert.equal(scrubbed.state.djUserId,null);assert.equal(scrubbed.state.playback.playing,false);assert.equal(scrubbed.state.playback.track,null);
    assert.deepEqual(scrubbed.state.djQueueUserIds,[staff]);assert.equal(scrubbed.state.djQueues[alice],undefined);assert.equal(scrubbed.state.djQueues[staff][0].addedBy.name,'Staff');
    assert.equal(scrubbed.state.history[0].addedBy.name,'Deleted account');assert.equal(scrubbed.state.radioState.turn,undefined);
    assert.equal(scrubbed.moderation.members[alice],undefined);assert.equal(scrubbed.moderation.members[staff].user.name,'Staff');assert.deepEqual(scrubbed.moderation.receipts,{});
    assert.equal((await db.query('select * from soundspin_room_members where user_id=$1',[alice])).rows.length,0);
    assert.equal(scrubbed.moderation.reports[0].status,'dismissed');assert.ok(scrubbed.moderation.restrictions[0].revokedAt);assert.ok(scrubbed.moderation.warnings[0].readAt);
    assert.equal(JSON.stringify(scrubbed).includes(alice),false);
    assert.deepEqual((await db.query('select soundspin_moderation_actor_rooms($1) as result', [alice])).rows[0].result, []);
    assert.equal((await db.query('select soundspin_erase_archived_account($1) as result', [alice])).rows[0].result.remaining,false);
    // An unrelated room owner's freeform UUID text is evidence, not an account
    // contribution. Repeated edits must not hold another account's deletion open.
    const quotedIdentity = `Retained reference to ${alice} in somebody else's text`;
    const unrelatedReport = { id: randomUUID(), reporterId: staff, targetUserId: staff, status: 'resolved', createdAt: Date.now(), reason: quotedIdentity };
    const otherNamedUser = { id: staff, name: quotedIdentity, avatarSeed: staff };
    assert.equal((await db.query('select soundspin_has_account_identity($1,$2) as result', [{ id: alice, title: quotedIdentity, addedBy: otherNamedUser },alice])).rows[0].result,false);
    assert.equal((await db.query('select soundspin_has_account_identity($1,$2) as result', [{ name: alice, description: alice, reason: alice },alice])).rows[0].result,false);
    await db.query('update soundspin_rooms set state=$1,settings=$2 where slug=$3', [{ name: quotedIdentity }, { description: quotedIdentity }, 'elsewhere']);
    await db.query('insert into soundspin_room_moderation(room_slug,data)values($1,$2)', ['elsewhere', { reports: [unrelatedReport] }]);
    assert.deepEqual((await db.query('select soundspin_moderation_actor_rooms($1) as result', [alice])).rows[0].result, []);
    // Authoritative SQL membership is a typed identity even without a matching
    // private document, and must be removed before loading that room again.
    await db.exec('reset role');
    await db.query('insert into soundspin_room_members(room_slug,user_id,role)values($1,$2,$3)', ['elsewhere',alice,'moderator']);
    await db.exec('set role service_role');
    assert.deepEqual((await db.query('select soundspin_moderation_actor_rooms($1) as result', [alice])).rows[0].result, ['elsewhere']);
    const membershipScrub=(await db.query("select soundspin_erase_live_moderation_account('elsewhere',$1) as result", [alice])).rows[0].result;
    assert.equal(membershipScrub.state.name,quotedIdentity);assert.equal(membershipScrub.moderation.reports[0].reason,quotedIdentity);
    assert.deepEqual((await db.query('select soundspin_moderation_actor_rooms($1) as result', [alice])).rows[0].result, []);
    // Structured references in that same document still require a scrub.
    await db.query('update soundspin_rooms set state=$1,settings=$2 where slug=$3', [{ name: quotedIdentity, history: [track] }, { description: quotedIdentity, sessionOverrides: [{ id: randomUUID(), kind: 'dj-lock', authorId: alice, expiresAt: Date.now()+60000 }] }, 'elsewhere']);
    assert.deepEqual((await db.query('select soundspin_moderation_actor_rooms($1) as result', [alice])).rows[0].result, ['elsewhere']);
    const scopedScrub = (await db.query("select soundspin_erase_live_moderation_account('elsewhere',$1) as result", [alice])).rows[0].result;
    assert.equal(scopedScrub.state.name, quotedIdentity);assert.equal(scopedScrub.state.settings.description, quotedIdentity);
    assert.equal(scopedScrub.state.history[0].addedBy.id, 'deleted-account');assert.equal(scopedScrub.state.settings.sessionOverrides[0].authorId, 'deleted-account');
    assert.equal(scopedScrub.moderation.reports[0].reason, quotedIdentity);assert.equal(scopedScrub.moderation.reports[0].reporterId, staff);
    // A later cache write can restore unchanged freeform metadata without
    // restoring an identity reference or making the final inventory nonempty.
    await db.query('update soundspin_rooms set state=$1 where slug=$2', [scopedScrub.state, 'elsewhere']);
    assert.deepEqual((await db.query('select soundspin_moderation_actor_rooms($1) as result', [alice])).rows[0].result, []);
    await db.query('update soundspin_room_moderation set data=$1 where room_slug=$2', [{ reports: [] }, 'elsewhere']);
    const embeddedEvidenceLog = { id: randomUUID(), action: 'warn', actorId: staff, targetUserId: alice, createdAt: Date.now(), reason: quotedIdentity };
    await db.query('update soundspin_room_moderation set data=$1 where room_slug=$2', [{ reports: [], log: [embeddedEvidenceLog] }, 'elsewhere']);
    await db.query('update soundspin_room_moderation set data=$1 where room_slug=$2', [{ reports: [], log: [] }, 'elsewhere']);
    const scopedArchive = (await db.query('select soundspin_erase_archived_account($1) as result', [alice])).rows[0].result;
    assert.equal(scopedArchive.remaining,false);assert.equal(scopedArchive.eventsAnonymized,1);
    assert.equal((await db.query("select soundspin_read_moderation_archive('elsewhere','reports') as result")).rows[0].result.items[0].reason, quotedIdentity);
    const retainedEvidence=(await db.query("select soundspin_read_moderation_archive('elsewhere','log') as result")).rows[0].result.items[0];
    assert.equal(retainedEvidence.targetUserId,'[deleted-account]');assert.equal(retainedEvidence.actorId,staff);assert.equal(retainedEvidence.reason,quotedIdentity);
    assert.equal((await db.query('select soundspin_erase_archived_account($1) as result', [alice])).rows[0].result.remaining,false);
    // Chat traffic also cannot spend the staff removal reserve.
    await db.query("insert into soundspin_chat_receipts(operation_id,room_slug,user_id,fingerprint,result)select 'reaction:capacity-'||n,'lounge',$1,$2,'{}'::jsonb from generate_series(1,10000) n", [alice,fingerprint]);
    const exhausted=payload(randomUUID());await assert.rejects(command('message',`message:${exhausted.id}`,exhausted,staff),/operation limit/);
    assert.equal((await db.query('select * from soundspin_messages where id=$1',[exhausted.id])).rows.length,0);
    assert.equal((await command('remove',`remove:${randomUUID()}`,{messageId:crowded,reason:'Staff intervention'},staff)).fresh,true);
    await db.exec('reset role');
    assert.equal((await db.query("select prosecdef from pg_proc where proname='soundspin_chat_command'")).rows[0].prosecdef, false);
    await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${alice}',false);`);
    await assert.rejects(db.query("select soundspin_read_moderation_archive('lounge','log')"), /permission denied/);
    await assert.rejects(db.query('select soundspin_erase_archived_account($1)', [staff]), /permission denied/);
    await assert.rejects(db.query('select soundspin_purge_security_archives()'), /permission denied/);
    await assert.rejects(db.query("select soundspin_room_member_page('lounge')"), /permission denied/);
    await assert.rejects(db.query('select * from soundspin_moderation_archive'), /permission denied/);
    assert.equal((await db.query('select content from soundspin_messages where id=$1',[id])).rows[0].content,'Message removed');
    await assert.rejects(db.query("insert into storage.objects(bucket_id,name,owner_id)values('chat-media',$1,$2)",[`${alice}/lounge/${randomUUID()}.png`,alice]),/row-level security/);
  } finally { await db.close(); }
});
