import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

// This runs the actual, complete, ordered repository chain. Bootstrap supplies
// the Supabase-managed Auth/Storage contracts, not replacement app tables/RPCs.
// It exercises PostgreSQL policies/transactions locally; hosted Storage bytes,
// Auth service behavior and independent PostgreSQL-backend races need staging.
const owner = '11111111-1111-4111-8111-111111111111';
const member = '22222222-2222-4222-8222-222222222222';
const outsider = '33333333-3333-4333-8333-333333333333';
const unconfirmed = '44444444-4444-4444-8444-444444444444';
const migrationsUrl = new URL('../../supabase/migrations/', import.meta.url);

async function bootstrap() {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb not null default '{}',
        email_confirmed_at timestamptz,created_at timestamptz not null default now());
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),
        name text not null,owner_id text,metadata jsonb not null default '{}',created_at timestamptz not null default now(),unique(bucket_id,name));
      alter table storage.objects enable row level security;
      create function storage.foldername(text) returns text[] language sql immutable as $$select regexp_split_to_array(regexp_replace($1,'/[^/]*$',''),'/')$$;
      grant usage on schema public,auth,storage to anon,authenticated,service_role;
      grant execute on function auth.uid(),storage.foldername(text) to anon,authenticated,service_role;
      grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
      grant select,insert,update,delete on storage.buckets to service_role;
      -- Supabase public-schema defaults may be broad. Final migrations must
      -- explicitly revoke privileged tables/channels despite inherited defaults.
      alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
      alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;`);
    const files = (await readdir(migrationsUrl)).filter(file => file.endsWith('.sql')).sort();
    assert.ok(files.length >= 30, 'All original and release migrations must be included.');
    for (const file of files) {
      try { await db.exec(await readFile(new URL(file,migrationsUrl),'utf8')); }
      catch (error) { throw new Error(`Migration ${file} failed (${error.code}): ${error.message}`); }
    }
    await db.query(`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)values
      ($1,'owner@example.test',now(),'{"display_name":"Owner"}'),
      ($2,'member@example.test',now(),'{"display_name":"Member"}'),
      ($3,'other@example.test',now(),'{"display_name":"Other"}'),
      ($4,'unconfirmed@example.test',null,'{}')`,[owner,member,outsider,unconfirmed]);
    await db.query('update soundspin_profiles set is_app_admin=true where user_id=$1',[owner]);
    return {db,files};
  } catch (error) { await db.close(); throw error; }
}
const identity = async (db,user) => { await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]); await db.exec('set role authenticated'); };
const createRoom = (db,slug,user,mode='public',password=null) => db.query('insert into soundspin_rooms(slug,name,owner_id,state,access_mode,is_public,password_hash)values($1,$2,$3,$4,$5,$6,$7)',[slug,slug,user,{},mode,mode!=='members',password]);
const admit = (db,slug,user,password=null) => db.query('select soundspin_admit_room($1,$2,$3)as result',[slug,user,password]);
const commit = (db,slug,{metadata={},role=null,deletes=[],moderation={}}={}) => db.query('select soundspin_commit_room_v2($1,$2,$3,$4,$5,$6)as result',[slug,{},metadata,role,deletes,moderation]);

test('entire migration chain enforces release grants, active-account gates, and private owner isolation',async context=>{
  const {db,files}=await bootstrap();
  try {
    context.diagnostic(`Applied ${files.length} migrations from ${files[0]} through ${files.at(-1)}.`);
    assert.equal((await db.query('select count(*)::integer as count from soundspin_profiles')).rows[0].count,4);
    const publicTables=(await db.query("select tablename,rowsecurity from pg_tables where schemaname='public' and tablename like 'soundspin_%'")).rows;
    assert.ok(publicTables.length>=25); assert.ok(publicTables.every(table=>table.rowsecurity), 'Every application table must enable RLS.');
    const privateTables=['soundspin_rooms','soundspin_room_members','soundspin_room_moderation','soundspin_music_connections','soundspin_chat_uploads','soundspin_chat_receipts','soundspin_chat_tombstones','soundspin_managed_uploads','soundspin_upload_limits','soundspin_storage_deletion_outbox','soundspin_account_restrictions','soundspin_account_deletion_jobs','soundspin_admin_audit','soundspin_friend_request_cooldowns','soundspin_social_request_usage'];
    for(const table of privateTables)for(const role of ['anon','authenticated'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE']) {
      assert.equal((await db.query('select has_table_privilege($1,$2,$3)as allowed',[role,`public.${table}`,privilege])).rows[0].allowed,false,`${role} ${privilege} ${table}`);
    }
    for(const role of ['anon','authenticated']) {
      assert.equal((await db.query("select has_table_privilege($1,'public.soundspin_feedback','INSERT')as allowed",[role])).rows[0].allowed,false);
      // Column-level INSERT grants are independent of the table ACL.
      assert.equal((await db.query("select has_any_column_privilege($1,'public.soundspin_feedback','INSERT')as allowed",[role])).rows[0].allowed,false);
    }
    const functions=(await db.query("select p.oid,p.proname,p.proconfig,p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'soundspin_%'")).rows;
    const browserHelpers=new Set(['soundspin_current_account_active','soundspin_current_room_active','soundspin_profile_visible','soundspin_current_reaction_room_active']);
    for(const fn of functions) {
      assert.ok(fn.proconfig?.includes('search_path=""'), `${fn.proname} must use an empty search_path`);
      for(const role of ['anon','authenticated']) {
        const allowed=(await db.query('select has_function_privilege($1,$2::oid,\'EXECUTE\')as allowed',[role,fn.oid])).rows[0].allowed;
        assert.equal(allowed, role==='authenticated' && browserHelpers.has(fn.proname),`${role} execute ${fn.proname}`);
      }
    }
    await db.exec('set role service_role');
    // A privileged cleanup producer can bypass the queue RPC. The database
    // must still reject a victim key associated with somebody else's actor.
    const cleanupPath=`${member}/${randomUUID()}.png`;
    await assert.rejects(db.query("insert into soundspin_storage_deletion_outbox(bucket_id,storage_path,actor_id)values('profile-avatars',$1,$2)",[cleanupPath,outsider]),/soundspin_outbox_actor_scope/);
    await db.query("insert into soundspin_storage_deletion_outbox(bucket_id,storage_path,actor_id)values('profile-avatars',$1,$2)",[cleanupPath,member]);
    await assert.rejects(db.query("update soundspin_storage_deletion_outbox set actor_id=$1 where storage_path=$2",[outsider,cleanupPath]),/soundspin_outbox_actor_scope/);
    assert.equal((await db.query('select actor_id from soundspin_storage_deletion_outbox where storage_path=$1',[cleanupPath])).rows[0].actor_id,member);
    await db.query('delete from soundspin_storage_deletion_outbox where storage_path=$1',[cleanupPath]);
    await createRoom(db,'private-lounge',owner,'members');
    await db.query('insert into soundspin_room_members(room_slug,user_id,role)values(\'private-lounge\',$1,\'member\')',[member]);
    await db.query('insert into soundspin_private_libraries(user_id,data)values($1,$3),($2,$3)',[owner,member,{picks:[],sets:[]}]);
    await db.query('insert into soundspin_music_connections(user_id,provider,refresh_token_ciphertext)values($1,\'spotify\',\'encrypted-test-only\')',[member]);
    const messageId=randomUUID();
    await db.query('insert into soundspin_messages(id,room_slug,user_id,user_name,avatar_seed,content)values($1,\'private-lounge\',$2,\'Member\',$3,\'Own recovered message\')',[messageId,member,member]);
    await db.query('insert into soundspin_message_reactions(message_id,user_id,emoji)values($1,$2,\'😀\')',[messageId,member]);
    await db.exec('reset role');
    await identity(db,member);
    assert.deepEqual((await db.query('select user_id from soundspin_private_libraries')).rows,[{user_id:member}]);
    await assert.rejects(db.query('insert into soundspin_private_libraries(user_id)values($1)',[outsider]),/permission denied/);
    await assert.rejects(db.query('update soundspin_profiles set is_app_admin=true where user_id=$1',[member]),/permission denied/);
    await assert.rejects(admit(db,'private-lounge',member),/permission denied/);
    await assert.rejects(db.query('select * from soundspin_music_connections'),/permission denied/);
    for(const bucket of ['chat-media','profile-avatars','feedback-screenshots'])await assert.rejects(db.query('insert into storage.objects(bucket_id,name,owner_id)values($1,$2,$3)',[bucket,`${member}/${randomUUID()}.png`,member]),/row-level security/);
    await assert.rejects(db.query('insert into soundspin_feedback(user_id,message,page_path)values($1,\'Spam\',\'/\')',[member]),/permission denied/);
    assert.equal((await db.query('select soundspin_current_account_active()as active')).rows[0].active,true);
    assert.equal((await db.query('select soundspin_current_reaction_room_active($1)as active',[messageId])).rows[0].active,true);
    await db.exec('reset role');await identity(db,outsider);
    assert.equal((await db.query('select soundspin_current_reaction_room_active($1)as active',[messageId])).rows[0].active,false);
    await db.exec('reset role');await db.query("insert into soundspin_room_restrictions(room_slug,disabled)values('private-lounge',true)");await identity(db,member);
    assert.equal((await db.query('select soundspin_current_reaction_room_active($1)as active',[messageId])).rows[0].active,false);
    assert.equal((await db.query('select * from soundspin_message_reactions')).rows.length,0);
    await db.exec('reset role');await identity(db,unconfirmed);
    assert.equal((await db.query('select soundspin_current_account_active()as active')).rows[0].active,false);
    assert.equal((await db.query('select * from soundspin_profiles')).rows.length,0);
    await db.exec('reset role');await db.query("insert into soundspin_account_restrictions(user_id,state)values($1,'suspended')",[member]);await identity(db,member);
    assert.equal((await db.query('select soundspin_current_account_active()as active')).rows[0].active,false);
    assert.equal((await db.query('select * from soundspin_private_libraries')).rows.length,0);
    await db.exec('reset role;set role service_role');
    await assert.rejects(db.query('update soundspin_music_connections set refresh_token_ciphertext=\'changed-test-only\' where user_id=$1',[member]),/Account unavailable/);
    await db.exec('reset role');await db.query("insert into soundspin_account_restrictions(user_id,state)values($1,'deleting')",[outsider]);await db.exec('set role service_role');
    await assert.rejects(db.query('insert into soundspin_music_connections(user_id,provider,refresh_token_ciphertext)values($1,\'spotify\',\'new-test-only\')',[outsider]),/Account unavailable/);
    await assert.rejects(db.query('insert into soundspin_music_connections(user_id,provider,refresh_token_ciphertext)values($1,\'spotify\',\'new-test-only\')',[unconfirmed]),/Account unavailable/);
    await db.exec('reset role');
    for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,'private.soundspin_provider_actor_active()','EXECUTE')as allowed",[role])).rows[0].allowed,false);
  } finally {await db.close();}
});

test('full chain private admission rechecks revoked membership, bans, password revisions and platform restrictions',async()=>{
  const {db}=await bootstrap();try{
    await db.exec('set role service_role');
    await createRoom(db,'private-lounge',owner,'members','old-hash');
    await commit(db,'private-lounge',{role:{user_id:member,role:'member'}});
    assert.equal((await admit(db,'private-lounge',member,'old-hash')).rows[0].result.role,'member');
    // A join whose initial server/cache checks succeeded must perform final
    // admission after the revocation commit, never recreate private membership.
    await commit(db,'private-lounge',{deletes:[member],metadata:{policy_revision:1}});
    await assert.rejects(admit(db,'private-lounge',member,'old-hash'),/Room admission denied/);
    assert.equal((await db.query('select count(*)::integer as count from soundspin_room_members where room_slug=\'private-lounge\' and user_id=$1',[member])).rows[0].count,0);
    await commit(db,'private-lounge',{role:{user_id:member,role:'member'}});
    const oppositeOrder=await Promise.allSettled([admit(db,'private-lounge',member,'old-hash'),commit(db,'private-lounge',{deletes:[member]})]);
    assert.ok(oppositeOrder.every(result=>result.status==='fulfilled'));
    assert.equal((await db.query('select count(*)::integer as count from soundspin_room_members where room_slug=\'private-lounge\' and user_id=$1',[member])).rows[0].count,0);
    const ban={id:randomUUID(),userId:member,kind:'room-ban',createdAt:Date.now(),expiresAt:null,revokedAt:null};
    await commit(db,'private-lounge',{role:{user_id:member,role:'member'},moderation:{restrictions:[ban]}});
    await assert.rejects(admit(db,'private-lounge',member,'old-hash'),/Room admission denied/);
    await commit(db,'private-lounge',{moderation:{restrictions:[{...ban,revokedAt:Date.now()}]},metadata:{password_hash:'new-hash',policy_revision:2}});
    await assert.rejects(admit(db,'private-lounge',member,'old-hash'),/Room policy changed/);
    assert.equal((await admit(db,'private-lounge',member,'new-hash')).rows[0].result.role,'member');
    await assert.rejects(commit(db,'private-lounge',{deletes:[owner]}),/owner cannot be removed/);
    await createRoom(db,'public-lounge',owner,'public');
    assert.equal((await admit(db,'public-lounge',outsider)).rows[0].result.role,'member');
    assert.equal((await admit(db,'public-lounge',owner)).rows[0].result.role,'owner');
    await db.query("insert into soundspin_account_restrictions(user_id,state)values($1,'suspended')",[outsider]);
    await assert.rejects(admit(db,'public-lounge',outsider),/Room admission denied/);
    await db.query("insert into soundspin_room_restrictions(room_slug,disabled)values('public-lounge',true)");
    await assert.rejects(admit(db,'public-lounge',member),/Room admission denied/);
    await assert.rejects(admit(db,'public-lounge',unconfirmed),/Room admission denied/);
  }finally{await db.close();}
});

test('full-chain owner quota caps simultaneous queued room creations and isolates accounts',async context=>{
  const {db}=await bootstrap();try{
    await db.exec('set role service_role');
    const results=await Promise.allSettled(Array.from({length:12},(_,index)=>createRoom(db,`quota-room-${index}`,owner)));
    assert.equal(results.filter(result=>result.status==='fulfilled').length,10);
    const denied=results.filter(result=>result.status==='rejected');assert.equal(denied.length,2);
    assert.ok(denied.every(result=>/Room ownership limit reached/.test(result.reason.message)));
    assert.equal((await db.query('select count(*)::integer as count from soundspin_rooms where owner_id=$1',[owner])).rows[0].count,10);
    await createRoom(db,'other-owner-room',member);
    await db.query("delete from soundspin_rooms where slug='quota-room-0'");
    await createRoom(db,'quota-replacement',owner);
    assert.equal((await db.query('select count(*)::integer as count from soundspin_rooms where owner_id=$1',[owner])).rows[0].count,10);
    await db.exec('reset role');
    const definition=(await db.query("select pg_get_functiondef('private.soundspin_room_creation_budget()'::regprocedure)as body")).rows[0].body;
    assert.match(definition,/pg_advisory_xact_lock/);
    context.diagnostic('Promise.all requests share one PGlite PostgreSQL backend; independent concurrent backend/lock scheduling remains a staging gate.');
  }finally{await db.close();}
});

test('release-ready marker is last-migration dependent and service-only',async()=>{
  const {db,files}=await bootstrap();try{
    assert.match(await readFile(new URL(files.at(-1),migrationsUrl),'utf8'),/create\s+(?:or replace\s+)?function public\.soundspin_release_ready\(/i,'The last release migration must define the readiness marker.');
    for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);await assert.rejects(db.query('select soundspin_release_ready()'),/permission denied/);await db.exec('reset role');}
    await db.exec('set role service_role');assert.equal((await db.query('select soundspin_release_ready()as ready')).rows[0].ready,true);
    const metadata=(await db.query("select prosecdef,proconfig from pg_proc where oid='public.soundspin_release_ready()'::regprocedure")).rows[0];
    assert.equal(metadata.prosecdef,false);assert.ok(metadata.proconfig.includes('search_path=""'));
    for(const [name,args] of [['soundspin_social_profiles','uuid[]'],['soundspin_has_account_identity','jsonb,text']]){
      await db.exec(`reset role; alter function public.${name}(${args}) rename to ${name}_fixture_missing; set role service_role`);
      assert.equal((await db.query('select soundspin_release_ready()as ready')).rows[0].ready,false,'Missing release identity helpers must prevent startup.');
      await db.exec(`reset role; alter function public.${name}_fixture_missing(${args}) rename to ${name}; set role service_role`);
      assert.equal((await db.query('select soundspin_release_ready()as ready')).rows[0].ready,true);
    }
  }finally{await db.close();}
});

test('full-chain waiting queue budgets cap aggregate accounts across rooms and allow reductions',async()=>{
  const {db}=await bootstrap();try{
    await db.exec('set role service_role');
    const tracks=count=>Array.from({length:count},(_,index)=>({id:`track-${index}`,provider:'youtube',providerId:'abcdefghijk',title:'Test track'}));
    const change=(room,count,user=member)=>db.query('update soundspin_rooms set state=$2 where slug=$1',[room,{djQueues:{[user]:tracks(count)}}]);
    for(let index=0;index<11;index++)await createRoom(db,`queue-room-${index}`,index<10?owner:outsider);
    for(let index=0;index<5;index++)await change(`queue-room-${index}`,100);
    await assert.rejects(change('queue-room-10',1),/Account waiting queue limit reached/);
    assert.equal((await db.query('select sum(track_count)::integer as count from private.soundspin_queue_usage where user_id=$1',[member])).rows[0].count,500);
    await change('queue-room-0',99);await change('queue-room-10',1);
    assert.equal((await db.query('select sum(track_count)::integer as count from private.soundspin_queue_usage where user_id=$1',[member])).rows[0].count,500);
    await assert.rejects(change('queue-room-10',501,outsider),/Room waiting queue limit reached/);
    // Seed a faithful legacy over-limit account fixture: both room state and
    // its migration-backfilled ledger agree. Only the fixture owner bypasses
    // the trigger; ordinary service/client requests retain every control.
    await db.exec('reset role; alter table soundspin_rooms disable trigger soundspin_room_queue_budget');
    await change('queue-room-0',101);
    await db.query('update private.soundspin_queue_usage set track_count=101 where room_slug=\'queue-room-0\' and user_id=$1',[member]);
    await db.exec('alter table soundspin_rooms enable trigger soundspin_room_queue_budget; set role service_role');
    await change('queue-room-0',100);
    assert.equal((await db.query('select sum(track_count)::integer as count from private.soundspin_queue_usage where user_id=$1',[member])).rows[0].count,501);
    await assert.rejects(change('queue-room-0',101),/Account waiting queue limit reached/);
    await change('queue-room-0',99);
    await change('queue-room-10',0);
    assert.equal((await db.query('select count(*)::integer as count from private.soundspin_queue_usage where room_slug=\'queue-room-10\' and user_id=$1',[member])).rows[0].count,0);
  }finally{await db.close();}
});

test('read-only deployment preflight runs against the complete schema and returns aggregates without user data',async()=>{
  const {db}=await bootstrap();try{
    const sql=await readFile(new URL('../../security/release-preflight.sql',import.meta.url),'utf8');
    assert.match(sql,/begin transaction read only;/i);assert.match(sql,/rollback;/i);
    const results=await db.exec(sql);
    const output=JSON.stringify(results.map(result=>result.rows));
    for(const id of [owner,member,outsider,unconfirmed])assert.equal(output.includes(id),false);
    assert.equal(output.includes('owner@example.test'),false);
    assert.ok(results.some(result=>result.rows.some(row=>row.release_schema_ready===true)));
    assert.ok(results.some(result=>result.rows.some(row=>row.oversized_room_states===0)));
    assert.ok(results.some(result=>result.rows.some(row=>row.invalid_legacy_avatar_references===0&&row.invalid_legacy_feedback_references===0&&row.invalid_legacy_chat_registry_references===0)));
    assert.equal((await db.query('select count(*)::integer as count from soundspin_profiles')).rows[0].count,4);
  }finally{await db.close();}
});
