import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const alice='11111111-1111-4111-8111-111111111111',bob='22222222-2222-4222-8222-222222222222';
async function fixture(){
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb not null default '{}',email_confirmed_at timestamptz,created_at timestamptz not null default now());
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null,owner_id text,metadata jsonb not null default '{}',created_at timestamptz not null default now(),unique(bucket_id,name));
   alter table storage.objects enable row level security;
   create function storage.foldername(text) returns text[] language sql immutable as $$select regexp_split_to_array(regexp_replace($1,'/[^/]*$',''),'/')$$;
   grant usage on schema public,auth,storage to anon,authenticated,service_role;
   grant select,insert,update,delete on storage.objects,storage.buckets to service_role;
   alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
   alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;`);
  const url=new URL('../supabase/migrations/',import.meta.url);
  for(const file of (await readdir(url)).filter(file=>file.endsWith('.sql')).sort()){
   try{await db.exec(await readFile(new URL(file,url),'utf8'));}catch(error){throw new Error(`Migration ${file}: ${error.message}`);}
  }
  await db.query("insert into auth.users(id,email,email_confirmed_at)values($1,'alice@example.test',now()),($2,'bob@example.test',now())",[alice,bob]);
  await db.exec('set role service_role');return db;
 }catch(error){await db.close();throw error;}
}
const room=(db,slug='lounge',owner=alice)=>db.query('insert into soundspin_rooms(slug,name,owner_id,state)values($1,$1,$2,\'{}\')',[slug,owner]);
const plan=(db,patch)=>db.query("update soundspin_resource_plans set limits=limits||$1 where id='free'",[patch]);
const global=(db,patch)=>db.query('update soundspin_resource_config set limits=limits||$1',[patch]);
const queue=(db,count)=>db.query("update soundspin_rooms set state=$1 where slug='lounge'",[{djQueues:{[bob]:Array.from({length:count},(_,id)=>({id}))}}]);

test('operators assign validated plans while ordinary accounts cannot change their capacity',async()=>{
 const db=await fixture();try{
  assert.equal((await db.query('select soundspin_resource_policy($1)as policy',[alice])).rows[0].policy.limits.libraryPicks,500);
  await db.query("insert into soundspin_resource_plans(id,limits)select 'supporter',limits||'{\"ownedRooms\":20}' from soundspin_resource_plans where id='free'");
  await db.query("insert into soundspin_account_plans(user_id,plan_id)values($1,'supporter')",[alice]);
  assert.equal((await db.query('select soundspin_resource_policy($1)as policy',[alice])).rows[0].policy.limits.ownedRooms,20);
  assert.equal((await db.query('select soundspin_resource_policy($1)as policy',[bob])).rows[0].policy.limits.ownedRooms,10);
  await db.query("update soundspin_resource_plans set limits=jsonb_set(limits,'{ownedRooms}','1')where id='supporter'");
  await room(db,'first');await assert.rejects(room(db,'second'),/Room ownership limit reached/);
  await room(db,'other-owner',bob);
  await assert.rejects(plan(db,{queueTracksPerRoom:0}),/check constraint/);
  await assert.rejects(plan(db,{unknownGrant:100000}),/check constraint/);
  await assert.rejects(global(db,{socketsTotal:1001}),/check constraint/);
  for(const role of ['anon','authenticated']){
   await db.exec(`reset role;set role ${role}`);
   await assert.rejects(db.query('select soundspin_resource_policy($1)',[alice]),/permission denied/);
   for(const table of ['soundspin_resource_plans','soundspin_resource_config','soundspin_account_plans'])await assert.rejects(db.query(`select * from ${table}`),/permission denied/);
   await assert.rejects(db.query("insert into soundspin_account_plans(user_id,plan_id)values($1,'supporter')",[bob]),/permission denied/);
  }
 }finally{await db.close();}
});

test('configured upload bytes and rolling reservations are enforced before storing a file',async()=>{
 const db=await fixture();try{
  await room(db);
  await db.query("update soundspin_resource_plans set limits=jsonb_set(limits,'{uploads,avatar}',(limits#>'{uploads,avatar}')||'{\"fileBytes\":100,\"storedBytes\":150,\"hourlyObjects\":2}')where id='free'");
  const reserve=async(bytes,actor=alice)=>{
   const id=randomUUID(),path=`${actor}/${id}.png`;
   return (await db.query("select soundspin_reserve_upload($1,$2,'avatar','profile-avatars',$3,$4,null)as lease",[id,actor,path,bytes])).rows[0].lease;
  };
  await assert.rejects(reserve(101),/Invalid upload reservation/);
  const first=await reserve(100);await assert.rejects(reserve(100),/stored images/);
  await reserve(50);
  await db.query('select soundspin_cancel_pending_upload($1,$2)',[alice,first.storage_path]);
  const outbox=(await db.query('select generation from soundspin_storage_deletion_outbox where storage_path=$1',[first.storage_path])).rows[0];
  await db.query("select soundspin_complete_upload_deletions('profile-avatars',$1)",[[{path:first.storage_path,generation:outbox.generation}]]);
  await assert.rejects(reserve(1),/Too many uploads/);
  assert.equal((await reserve(100,bob)).actor_id,bob);
 }finally{await db.close();}
});

test('lowering library and waiting-queue budgets keeps saved work readable and removable',async()=>{
 const db=await fixture();try{
  await room(db);await queue(db,3);
  const setId=randomUUID();
  await db.query('insert into soundspin_private_libraries(user_id,data)values($1,$2)',[bob,{picks:[{id:1},{id:2},{id:3}],sets:[{id:setId,tracks:[1,2,3]}]}]);
  await plan(db,{queueTracksPerRoom:1,queueTracksTotal:1,libraryPicks:1,librarySetTracks:1});await global(db,{queueTracksPerRoom:1});
  assert.equal((await db.query('select data from soundspin_private_libraries where user_id=$1',[bob])).rows[0].data.picks.length,3);
  await queue(db,2);await assert.rejects(queue(db,3),/Room waiting queue limit reached/);
  await queue(db,1);await queue(db,0);
  const update=data=>db.query('update soundspin_private_libraries set data=$1 where user_id=$2',[data,bob]);
  await update({picks:[{id:1},{id:2}],sets:[{id:setId,tracks:[1,2]}]});
  await assert.rejects(update({picks:[{id:1},{id:2},{id:3}],sets:[{id:setId,tracks:[1,2]}]}),/Saved picks limit/);
  await assert.rejects(update({picks:[{id:1},{id:2}],sets:[{id:setId,tracks:[1,2,3]}]}),/Set tracks limit/);
  await update({picks:[],sets:[]});
  assert.deepEqual((await db.query('select data from soundspin_private_libraries where user_id=$1',[bob])).rows[0].data,{picks:[],sets:[]});
 }finally{await db.close();}
});

test('casual listening creates no permanent membership and saved room quotas recover after removal',async()=>{
 const db=await fixture();try{
  await room(db,'first');await room(db,'second');await plan(db,{memberships:1,favoriteRooms:1});
  await db.query('select soundspin_admit_room($1,$2,null)',['first',bob]);
  assert.equal((await db.query('select count(*)::int n from soundspin_room_members where user_id=$1',[bob])).rows[0].n,0);
  for(const table of ['soundspin_room_members','soundspin_room_favorites']){
   await db.query(`insert into ${table}(room_slug,user_id)values('first',$1)`,[bob]);
   await assert.rejects(db.query(`insert into ${table}(room_slug,user_id)values('second',$1)`,[bob]),/limit reached/);
   await db.query(`insert into ${table}(room_slug,user_id)values('first',$1)on conflict do nothing`,[bob]);
   await db.query(`delete from ${table} where room_slug='first' and user_id=$1`,[bob]);
   await db.query(`insert into ${table}(room_slug,user_id)values('second',$1)`,[bob]);
  }
 }finally{await db.close();}
});

test('bounded chat retention removes expired history and safely queues owned attachments for cleanup',async()=>{
 const db=await fixture();try{
  await room(db);await room(db,'second');await global(db,{chatRetentionMessages:2,chatRetentionDays:90});
  const ids=Array.from({length:4},()=>randomUUID()),path=`${bob}/lounge/${randomUUID()}.png`,sharedPath=`${bob}/lounge/${randomUUID()}.png`;
  await db.query("insert into soundspin_messages(id,room_slug,user_id,user_name,avatar_seed,content,created_at,storage_path)select x.id,'lounge',$1::uuid,'Bob',($1::uuid)::text,'Message',now()-make_interval(days=>x.age),case when x.age=2 then $2 when x.age in(100,1)then $5 else null end from unnest($3::uuid[],$4::int[])as x(id,age)",[bob,path,ids,[100,2,1,0],sharedPath]);
  await db.query("insert into soundspin_managed_uploads(id,actor_id,purpose,bucket_id,storage_path,room_slug,size_bytes,state)values($1,$2,'chat','chat-media',$3,'lounge',100,'committed')",[randomUUID(),bob,path]);
  await db.query("insert into soundspin_chat_uploads(storage_path,room_slug,user_id,mime_type,size_bytes,message_id)values($1,'lounge',$2,'image/png',100,$3)",[path,bob,ids[1]]);
  await db.query("insert into soundspin_managed_uploads(id,actor_id,purpose,bucket_id,storage_path,room_slug,size_bytes,state)values($1,$2,'chat','chat-media',$3,'lounge',100,'committed')",[randomUUID(),bob,sharedPath]);
  await db.query("insert into soundspin_chat_uploads(storage_path,room_slug,user_id,mime_type,size_bytes,message_id)values($1,'lounge',$2,'image/png',100,$3)",[sharedPath,bob,ids[0]]);
  const otherOld=randomUUID();
  await db.query("insert into soundspin_messages(id,room_slug,user_id,user_name,avatar_seed,content,created_at)values($1,'second',$2,'Bob',$3,'Old',now()-interval '100 days')",[otherOld,bob,bob]);
  assert.equal((await db.query('select soundspin_prune_chat_history(1)as result')).rows[0].result.removed,1);
  assert.equal((await db.query('select message_id from soundspin_chat_uploads where storage_path=$1',[sharedPath])).rows[0].message_id,ids[2],'A surviving message keeps its shared owned attachment.');
  assert.equal((await db.query('select count(*)::int n from soundspin_storage_deletion_outbox where storage_path=$1',[sharedPath])).rows[0].n,0);
  assert.equal((await db.query('select soundspin_prune_chat_history(1)as result')).rows[0].result.removed,1);
  assert.equal((await db.query('select count(*)::int n from soundspin_messages where id=$1',[otherOld])).rows[0].n,0,'A full first-room batch must not starve the next room.');
  assert.equal((await db.query('select soundspin_prune_chat_history(1)as result')).rows[0].result.removed,1);
  assert.equal((await db.query('select count(*)::int n from soundspin_messages')).rows[0].n,2);
  const deleted=(await db.query('select actor_id,available_at>now()as delayed from soundspin_storage_deletion_outbox where storage_path=$1',[path])).rows[0];
  assert.equal(deleted.actor_id,bob);assert.equal(deleted.delayed,true);
  const endOfPass=(await db.query('select soundspin_prune_chat_history(1)as result')).rows[0].result;
  assert.equal(endOfPass.removed,0);assert.equal(endOfPass.hasMoreRooms,false,'A quiet completed pass must not request repeated full rescans.');
 }finally{await db.close();}
});

test('retiring a popular message bounds reply-reference cleanup before deleting its parent',async()=>{
 const db=await fixture();try{
  await room(db);
  const parent=randomUUID();
  await db.query("insert into soundspin_messages(id,room_slug,user_id,user_name,avatar_seed,content,created_at)values($1,'lounge',$2,'Bob',$3,'Expired parent',now()-interval '100 days')",[parent,bob,bob]);
  const replies=Array.from({length:5},()=>randomUUID());
  await db.query("insert into soundspin_messages(id,room_slug,user_id,user_name,avatar_seed,content,reply_to_id)select unnest($1::uuid[]),'lounge',$2::uuid,'Bob',$3,'Current reply',$4",[replies,bob,bob,parent]);
  for(const expected of [2,2,1]){
   const result=(await db.query('select soundspin_prune_chat_history(2)as result')).rows[0].result;
   assert.equal(result.updatedReplies,expected);assert.ok(result.removed<=2);
   if(expected===2)assert.equal((await db.query('select count(*)::int n from soundspin_messages where id=$1',[parent])).rows[0].n,1);
  }
  assert.equal((await db.query('select count(*)::int n from soundspin_messages where id=$1',[parent])).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from soundspin_messages where id=any($1::uuid[])and reply_to_id is null',[replies])).rows[0].n,5);
 }finally{await db.close();}
});

test('only an active platform admin can enable Spotify and room commits cannot bypass that gate',async()=>{
 const db=await fixture();try{
  await room(db);
  await assert.rejects(db.query('select soundspin_set_room_spotify($1,\'lounge\',true)',[alice]),/Administrator access/);
  await assert.rejects(db.query("update soundspin_rooms set settings='{\"spotifyEnabled\":true}',state='{\"settings\":{\"spotifyEnabled\":true}}' where slug='lounge'"),/Administrator access/);
  await db.exec('reset role');await db.query('update soundspin_profiles set is_app_admin=true where user_id=$1',[alice]);await db.exec('set role service_role');
  const result=(await db.query('select soundspin_set_room_spotify($1,\'lounge\',true)as result',[alice])).rows[0].result;
  assert.equal(result.settings.spotifyEnabled,true);assert.equal(result.policyRevision,1);
  await assert.rejects(db.query("update soundspin_rooms set state='{}' where slug='lounge'"),/inconsistent/);
  await db.query('select soundspin_set_room_spotify($1,\'lounge\',false)',[alice]);
  assert.equal((await db.query("select settings->>'spotifyEnabled' as enabled from soundspin_rooms where slug='lounge'")).rows[0].enabled,'false');
 }finally{await db.close();}
});
