import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
const actor = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
async function fixture(beforeManaged) {
  const db = new PGlite();
  await db.exec(`create role authenticated;create role anon;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${actor}'),('${other}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text);alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql immutable as $$select regexp_split_to_array(regexp_replace($1,'/[^/]*$',''),'/')$$;
    grant usage on schema public,auth,storage to authenticated,anon,service_role;grant select,insert,delete on storage.objects to authenticated;grant all on storage.objects to service_role;
    create table public.soundspin_profiles(user_id uuid primary key references auth.users(id) on delete cascade,avatar_path text,avatar_url text);
    create table public.soundspin_rooms(slug text primary key);insert into soundspin_rooms values('lounge');
    create table public.soundspin_messages(id uuid primary key,user_id uuid,room_slug text,storage_path text,removed_at timestamptz);
    create table public.soundspin_chat_uploads(storage_path text primary key,user_id uuid references auth.users(id) on delete cascade,room_slug text references soundspin_rooms(slug) on delete cascade,size_bytes integer,message_id uuid,removed_at timestamptz,expires_at timestamptz default now()+interval '15 minutes');
    create table restrictions(actor uuid primary key,disabled boolean default false);
    create function public.soundspin_account_enabled(uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from auth.users where id=$1) and not exists(select 1 from public.restrictions where actor=$1 and disabled)$$;
    create function public.soundspin_room_enabled(text) returns boolean language sql stable as $$select true$$;
    grant all on public.soundspin_profiles,public.soundspin_chat_uploads to service_role;grant select on public.soundspin_rooms to service_role;`);
  for (const file of ['20260720092326_add_feedback.sql','20260720095141_admin_feedback_workflow.sql','20260720100745_feedback_diagnostics.sql','20261007063943_restrict_feedback_submission_columns.sql','20261013120000_managed_uploads_feedback.sql']) {
    if (file==='20261013120000_managed_uploads_feedback.sql' && beforeManaged) await beforeManaged(db);
    await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`,import.meta.url),'utf8'));
  }
  return db;
}
async function reserve(db, purpose='avatar', bytes=100, actorId=actor, room=null) {
  const id=randomUUID(), bucket=purpose==='avatar'?'profile-avatars':purpose==='feedback'?'feedback-screenshots':'chat-media', path=`${actorId}/${room?`${room}/`:''}${id}.png`;
  const row=(await db.query('select soundspin_reserve_upload($1,$2,$3,$4,$5,$6,$7) as result',[id,actorId,purpose,bucket,path,bytes,room])).rows[0].result;
  return row;
}
const record = (paths=[]) => ({message:'Actual report',screenshot_paths:paths,room_slug:null,page_path:'/',viewport:{width:100,height:100},category:'bug',impact:'minor',diagnostics:{}});

test('upload and feedback direct channels are denied; RPC/ledger are service-only', async () => {
  const db=await fixture();try {
    for(const role of ['authenticated','anon']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(reserve(db),/permission denied/);
      await assert.rejects(db.query('select * from soundspin_managed_uploads'),/permission denied/);
      await assert.rejects(db.query('insert into soundspin_feedback(user_id,message,page_path)values($1,\'Spam\',\'/\')',[actor]),/permission denied/);
      if(role==='authenticated') await assert.rejects(db.query('insert into storage.objects(bucket_id,name,owner_id)values(\'feedback-screenshots\',$1,$2)',[`${actor}/${randomUUID()}.png`,actor]),/row-level security/);
      await db.exec('reset role');
    }
  }finally{await db.close();}
});
test('reservations serialize actor count/bytes/concurrency and cancelled attempts still consume hourly budget',async()=>{
  const db=await fixture();try{
    await db.exec('set role service_role');
    const results=await Promise.allSettled([reserve(db),reserve(db),reserve(db)]);
    assert.equal(results.filter(result=>result.status==='fulfilled').length,2);
    assert.equal(results.filter(result=>result.status==='rejected').length,1);
    const accepted=results.filter(result=>result.status==='fulfilled').map(result=>result.value);
    for(const row of accepted)await db.query('select soundspin_cancel_pending_upload($1,$2)',[actor,row.storage_path]);
    await db.query("update soundspin_managed_uploads set state='deleted'");
    const third=await reserve(db);await db.query('select soundspin_cancel_pending_upload($1,$2)',[actor,third.storage_path]);await db.query("update soundspin_managed_uploads set state='deleted'");
    const fourth=await reserve(db);await db.query('select soundspin_cancel_pending_upload($1,$2)',[actor,fourth.storage_path]);await db.query("update soundspin_managed_uploads set state='deleted'");
    await assert.rejects(reserve(db),/Too many uploads/);
    const different=await reserve(db,'avatar',100,other);assert.equal(different.actor_id,other);
    await db.exec('reset role');await db.query('update soundspin_upload_limits set total_bytes=150 where purpose=\'feedback\'');await db.exec('set role service_role');
    await reserve(db,'feedback',100);await assert.rejects(reserve(db,'feedback',100),/stored images/);
  }finally{await db.close();}
});
test('feedback attachments bind actor/purpose/state; immutable receipts and rate limits are transactional',async()=>{
  const db=await fixture();try{
    await db.exec('set role service_role');
    const image=await reserve(db,'feedback');await db.query('select soundspin_finish_upload($1,$2)',[image.id,actor]);
    const id=randomUUID(),hash='a'.repeat(64),payload=record([image.storage_path]);
    const send=(rid=id,h=hash,r=payload,user=actor)=>db.query('select soundspin_submit_feedback($1,$2,$3,$4)as result',[user,rid,h,r]);
    assert.equal((await send()).rows[0].result.fresh,true);assert.equal((await send()).rows[0].result.fresh,false);
    await assert.rejects(send(id,'b'.repeat(64)),/different content/);
    await assert.rejects(send(randomUUID(),hash,payload,other),/attachment/);
    await assert.rejects(send(randomUUID(),hash,payload),/attachment/);
    for(let i=0;i<4;i++)await send(randomUUID(),hash,record());
    await assert.rejects(send(randomUUID(),hash,record()),/Too many feedback/);
    assert.equal((await db.query('select count(*)as count from soundspin_feedback where user_id=$1',[actor])).rows[0].count,5);
    await db.query('select soundspin_cancel_pending_upload($1,$2)',[actor,image.storage_path]);
    assert.equal((await db.query('select state from soundspin_managed_uploads where id=$1',[image.id])).rows[0].state,'committed');
  }finally{await db.close();}
});
test('avatar reference commits/replacement queues old key; erasure outbox survives account/room cascade and late-upload completion',async()=>{
  const db=await fixture();try{
    await db.exec('set role service_role');
    const old=await reserve(db);await db.query('select soundspin_finish_upload($1,$2)',[old.id,actor]);
    await db.query('insert into soundspin_profiles(user_id)values($1)',[actor]);
    await db.query('update soundspin_profiles set avatar_path=$1,avatar_url=\'https://avatar\' where user_id=$2',[old.storage_path,actor]);
    assert.equal((await db.query('select state from soundspin_managed_uploads where id=$1',[old.id])).rows[0].state,'committed');
    const next=await reserve(db);await db.query('select soundspin_finish_upload($1,$2)',[next.id,actor]);
    await db.query('update soundspin_profiles set avatar_path=$1 where user_id=$2',[next.storage_path,actor]);
    const chat=await reserve(db,'chat',100,actor,'lounge');
    await db.query('insert into soundspin_chat_uploads(storage_path,user_id,room_slug,size_bytes)values($1,$2,\'lounge\',100)',[chat.storage_path,actor]);
    await db.query('select soundspin_enqueue_upload_deletion($1,null)',[actor]);
    await assert.rejects(db.query('select soundspin_finish_upload($1,$2)',[chat.id,actor]),/reservation has ended/);
    await db.exec('reset role');await db.query('delete from auth.users where id=$1',[actor]);await db.query("delete from soundspin_rooms where slug='lounge'");
    assert.equal((await db.query('select count(*)as count from soundspin_storage_deletion_outbox')).rows[0].count,3);
    assert.equal((await db.query('select count(*)as count from soundspin_managed_uploads')).rows[0].count,3);
    const observed=(await db.query('select generation from soundspin_storage_deletion_outbox where storage_path=$1',[chat.storage_path])).rows[0].generation;
    await db.query('select soundspin_queue_upload($1,$2,$3,$4,0)',['chat-media',chat.storage_path,actor,'lounge']);
    assert.equal((await db.query('select soundspin_complete_upload_deletions($1,$2)as count',['chat-media',[{path:chat.storage_path,generation:observed}]])).rows[0].count,0);
    assert.equal((await db.query('select count(*)as count from soundspin_storage_deletion_outbox where storage_path=$1',[chat.storage_path])).rows[0].count,1);
    // The first remove may run before in-flight bytes appear. Compensation recreates its key afterward.
    const latest=(await db.query('select generation from soundspin_storage_deletion_outbox where storage_path=$1',[chat.storage_path])).rows[0].generation;
    assert.equal((await db.query('select soundspin_complete_upload_deletions($1,$2)as count',['chat-media',[{path:chat.storage_path,generation:latest}]])).rows[0].count,1);
    assert.equal((await db.query('select soundspin_complete_upload_deletions($1,$2)as count',['chat-media',[{path:chat.storage_path,generation:latest}]])).rows[0].count,0);
    await db.query('select soundspin_queue_upload($1,$2,$3,$4,0)',['chat-media',chat.storage_path,actor,'lounge']);
    assert.equal((await db.query('select count(*)as count from soundspin_storage_deletion_outbox where storage_path=$1',[chat.storage_path])).rows[0].count,1);
  }finally{await db.close();}
});

test('legacy forged feedback paths cannot delete another actor; legitimate own legacy objects still clean up',async()=>{
  const own=`${actor}/${randomUUID()}.png`,victim=`${other}/${randomUUID()}.png`,unreferenced=`${other}/${randomUUID()}.png`,orphan='legacy-orphan.png';
  const forged=randomUUID(),legitimate=randomUUID();
  const db=await fixture(async db=>{
    await db.query("insert into storage.objects(bucket_id,name,owner_id)values('feedback-screenshots',$1,$4),('feedback-screenshots',$2,$5),('feedback-screenshots',$3,$5),('feedback-screenshots',$6,null)",[own,victim,unreferenced,actor,other,orphan]);
    await db.query("insert into soundspin_feedback(id,user_id,message,page_path,screenshot_paths)values($1,$2,'Legacy attacker reference','/',$3),($4,$5,'Legitimate victim report','/',$6)",[forged,actor,[own,victim,unreferenced],legitimate,other,[victim]]);
  });try{
    await db.exec('set role service_role');
    assert.equal((await db.query('select state from soundspin_managed_uploads where storage_path=$1',[victim])).rows[0].state,'committed');
    assert.equal((await db.query('select state from soundspin_managed_uploads where storage_path=$1',[unreferenced])).rows[0].state,'pending','A forged cross-account reference must not retain a victim orphan forever.');
    await db.query('delete from soundspin_feedback where id=$1',[forged]);
    const queued=(await db.query("select storage_path from soundspin_storage_deletion_outbox where actor_id=$1",[actor])).rows.map(row=>row.storage_path);
    assert.deepEqual(queued,[own]);
    for(const bucket of ['profile-avatars','feedback-screenshots','chat-media'])await db.query('select soundspin_queue_upload($1,$2,$3,null,0)',[bucket,victim,actor]);
    assert.equal((await db.query('select count(*)::integer as count from soundspin_storage_deletion_outbox where storage_path=$1',[victim])).rows[0].count,0);
    await assert.rejects(db.query('select soundspin_queue_upload($1,$2,null,null,0)',['feedback-screenshots',victim]),/ownership evidence/);
    // Only an orphan already selected by trusted inventory can refresh without an actor.
    await db.query('select soundspin_queue_upload($1,$2,null,null,0)',['feedback-screenshots',orphan]);
    const generation=(await db.query('select generation from soundspin_storage_deletion_outbox where storage_path=$1',[own])).rows[0].generation;
    assert.equal((await db.query('select soundspin_complete_upload_deletions($1,$2)as count',['feedback-screenshots',[{path:own,generation}]])).rows[0].count,1);
    assert.equal((await db.query('select state from soundspin_managed_uploads where storage_path=$1',[victim])).rows[0].state,'committed');
    assert.equal((await db.query('select count(*)::integer as count from soundspin_feedback where id=$1',[legitimate])).rows[0].count,1);
  }finally{await db.close();}
});
