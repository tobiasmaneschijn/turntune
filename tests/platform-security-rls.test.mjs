import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const admin="11111111-1111-4111-8111-111111111111", owner="22222222-2222-4222-8222-222222222222", listener="33333333-3333-4333-8333-333333333333", pending="44444444-4444-4444-8444-444444444444";
async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,service_role; grant execute on function auth.uid() to authenticated,service_role;
    create table public.soundspin_profiles(user_id uuid primary key references auth.users(id) on delete cascade,is_app_admin boolean default false,avatar_path text,avatar_url text,
      display_name text default 'Listener',bio text default '',handle text,status_text text default '',favorite_tracks jsonb default '[]',updated_at timestamptz default now());
    create table public.soundspin_rooms(slug text primary key,owner_id uuid references auth.users(id) on delete cascade,is_public boolean not null default true,access_mode text not null default 'public');
    create table public.soundspin_room_members(room_slug text references public.soundspin_rooms(slug) on delete cascade,user_id uuid references auth.users(id) on delete cascade,role text);
    create table public.soundspin_messages(id uuid primary key,room_slug text references public.soundspin_rooms(slug) on delete cascade,user_id uuid references auth.users(id) on delete cascade);
    create table public.soundspin_message_reactions(message_id uuid references soundspin_messages(id) on delete cascade,user_id uuid references auth.users(id) on delete cascade,emoji text);
    create table public.soundspin_feedback(id uuid primary key,user_id uuid references auth.users(id) on delete cascade,status text not null check(status in ('new','reviewing','planned','resolved','closed')),admin_note text not null default '',updated_at timestamptz default now(),screenshot_paths text[] default '{}');
    create table public.soundspin_chat_removals(id uuid primary key,actor_id uuid not null references auth.users(id),target_user_id uuid references auth.users(id),created_at timestamptz default now());
    create table public.soundspin_storage_deletion_outbox(bucket_id text,storage_path text,actor_id uuid,primary key(bucket_id,storage_path));
    create schema storage; create table storage.objects(bucket_id text,name text,owner_id text);
    alter table storage.objects enable row level security;
    alter table public.soundspin_profiles enable row level security; alter table public.soundspin_messages enable row level security;
    alter table public.soundspin_message_reactions enable row level security;
    grant all on public.soundspin_profiles,public.soundspin_rooms,public.soundspin_feedback,public.soundspin_chat_removals,public.soundspin_storage_deletion_outbox to service_role;
    grant usage on schema storage to authenticated,service_role; grant select,insert on storage.objects to authenticated; grant all on storage.objects to service_role;
    grant select on public.soundspin_profiles,public.soundspin_messages to authenticated;
    grant select on public.soundspin_message_reactions to authenticated;
    create policy profile_read on public.soundspin_profiles for select to authenticated using(true);
    create policy own_message_read on public.soundspin_messages for select to authenticated using(auth.uid()=user_id);
    create policy own_reaction_read on public.soundspin_message_reactions for select to authenticated using(auth.uid()=user_id);
    create policy own_storage_read on storage.objects for select to authenticated using(owner_id=auth.uid()::text);
    create policy own_storage_insert on storage.objects for insert to authenticated with check(owner_id=auth.uid()::text);
    insert into auth.users values('${admin}',now()),('${owner}',now()),('${listener}',now()),('${pending}',null);
    insert into public.soundspin_profiles(user_id,is_app_admin) values('${admin}',true),('${owner}',false),('${listener}',false),('${pending}',false);
    insert into public.soundspin_rooms values('lounge','${owner}',true,'public'),('secret-room','${admin}',false,'members');
    insert into public.soundspin_messages values('55555555-5555-4555-8555-555555555555','lounge','${listener}');
    insert into public.soundspin_message_reactions values('55555555-5555-4555-8555-555555555555','${listener}','👍');
    insert into public.soundspin_feedback(id,user_id,status,admin_note,updated_at) values('66666666-6666-4666-8666-666666666666','${listener}','new','private',now());
    insert into storage.objects values('feedback-screenshots','${listener}/x.png','${listener}');`);
  await db.exec(await readFile(new URL("../supabase/migrations/20261013110000_platform_security_privacy.sql",import.meta.url),"utf8"));
  return db;
}
async function asUser(db,id) { await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${id}',false)`); }
async function asService(db) { await db.exec("reset role; set role service_role"); }

test("suspension and room takedown gate existing Auth identities and direct RLS, with reversible audit",async()=>{
  const db=await fixture();try {
    await asUser(db,listener);
    assert.equal((await db.query("select user_id from public.soundspin_profiles")).rows.length,3,"pending subjects are hidden from confirmed viewers");
    assert.equal((await db.query("select soundspin_current_room_active('secret-room') as allowed")).rows[0].allowed,false,"arbitrary helper calls do not reveal private-room existence to outsiders");
    assert.equal((await db.query("select soundspin_current_room_active('unknown-room') as allowed")).rows[0].allowed,false);
    assert.equal((await db.query("select * from public.soundspin_messages")).rows.length,1);
    assert.equal((await db.query("select * from public.soundspin_message_reactions")).rows.length,1);
    assert.equal((await db.query("select * from storage.objects")).rows.length,1);
    await assert.rejects(db.query("select public.soundspin_account_enabled($1)",[owner]),/permission denied/);
    await assert.rejects(db.query("select public.soundspin_platform_action($1,'suspend-account',$2,'spam')",[listener,owner]),/permission denied/);
    await asService(db);
    await assert.rejects(db.query("select public.soundspin_platform_action($1,'suspend-account',$2,'spam')",[listener,owner]),/Administrator access required/);
    await db.query("select public.soundspin_platform_action($1,'suspend-account',$2,'spam')",[admin,owner]);
    await asUser(db,listener);
    assert.equal((await db.query("select * from public.soundspin_messages")).rows.length,0,"owner suspension also blocks room data for other users");
    assert.equal((await db.query("select * from public.soundspin_message_reactions")).rows.length,0,"message-FK children cannot bypass disabled-room gates");
    assert.equal((await db.query("select * from public.soundspin_profiles where user_id=$1",[owner])).rows.length,0,"suspended public profile content is hidden from direct REST");
    await asUser(db,owner);
    assert.equal((await db.query("select * from public.soundspin_profiles")).rows.length,0);
    await assert.rejects(db.query("insert into storage.objects values('profile-avatars','x',$1)",[owner]),/row-level security/);
    await asService(db);
    await db.query("select public.soundspin_platform_action($1,'disable-room','lounge','content')",[admin]);
    await db.query("select public.soundspin_platform_action($1,'restore-account',$2,'reviewed')",[admin,owner]);
    assert.equal((await db.query("select public.soundspin_room_enabled('lounge') as enabled")).rows[0].enabled,false,"restoring account preserves explicit room disable");
    await db.query("select public.soundspin_platform_action($1,'restore-room','lounge','reviewed')",[admin]);
    await asUser(db,listener);
    assert.equal((await db.query("select * from public.soundspin_messages")).rows.length,1);
    await asUser(db,pending);
    assert.equal((await db.query("select * from public.soundspin_profiles")).rows.length,0,"unconfirmed account cannot bypass HTTP using REST");
    await asService(db);
    assert.equal((await db.query("select * from public.soundspin_admin_audit")).rows.length,4);
    await assert.rejects(db.query("update public.soundspin_admin_audit set reason='edited'"),/permission denied/);
    await assert.rejects(db.query("delete from public.soundspin_admin_audit"),/permission denied/);
  }finally {await db.close();}
});

test("operator profile-content removal clears public text/media and retains the deletion key",async()=>{
  const db=await fixture();try {
    await asService(db);
    await db.query("update soundspin_profiles set display_name='Abusive name',bio='abuse',handle='bad_handle',status_text='spam',favorite_tracks='[{\"title\":\"spam\"}]',avatar_path=$1,avatar_url='https://example.invalid/public.png' where user_id=$2",[`${owner}/avatar.png`,owner]);
    await db.query("select soundspin_platform_action($1,'clear-profile',$2,'content policy violation')",[admin,owner]);
    const profile=(await db.query("select display_name,bio,handle,status_text,favorite_tracks,avatar_path,avatar_url from soundspin_profiles where user_id=$1",[owner])).rows[0];
    assert.deepEqual(profile,{display_name:"Listener",bio:"",handle:null,status_text:"",favorite_tracks:[],avatar_path:null,avatar_url:null});
    assert.equal((await db.query("select storage_path from soundspin_storage_deletion_outbox")).rows[0].storage_path,`${owner}/avatar.png`);
    assert.equal((await db.query("select action from soundspin_admin_audit")).rows[0].action,"clear-profile");
    for (const action of ["clear-avatar","clear-profile"]) {
      for (const unsafe of [`${listener}/victim.png`,`${owner}/../other.png`,`${owner}/${"x".repeat(201)}.png`]) {
        await db.query("update soundspin_profiles set avatar_path=$1 where user_id=$2",[unsafe,owner]);
        await db.query("select soundspin_platform_action($1,$2,$3,'remove forged legacy reference')",[admin,action,owner]);
        assert.equal((await db.query("select count(*)::int as count from soundspin_storage_deletion_outbox")).rows[0].count,1,"clearing forged legacy profile references must not queue victim or unsafe object keys");
        assert.equal((await db.query("select avatar_path from soundspin_profiles where user_id=$1",[owner])).rows[0].avatar_path,null);
      }
    }
  }finally {await db.close();}
});

test("feedback changes and audit commit atomically; account erasure anonymizes retained removal actors",async()=>{
  const db=await fixture();try {
    await asService(db);
    await db.query("select public.soundspin_update_feedback_admin($1,'66666666-6666-4666-8666-666666666666','reviewing','note two')",[admin]);
    await assert.rejects(db.query("select public.soundspin_update_feedback_admin($1,'66666666-6666-4666-8666-666666666666','invalid','bad')",[admin]),/check constraint/);
    assert.equal((await db.query("select status from public.soundspin_feedback")).rows[0].status,"reviewing");
    const audits=(await db.query("select * from public.soundspin_admin_audit")).rows;
    assert.equal(audits.length,1);assert.equal(audits[0].actor_id,admin);assert.equal(audits[0].before_state.status,"new");assert.equal(audits[0].after_state.status,"reviewing");
    assert.equal(JSON.stringify(audits).includes("note two"),false);
    const secondAdmin="77777777-7777-4777-8777-777777777777";
    await db.exec(`reset role;insert into auth.users values('${secondAdmin}',now());insert into soundspin_profiles(user_id,is_app_admin)values('${secondAdmin}',true);set role service_role;`);
    await db.query("select soundspin_update_feedback_admin($1,'66666666-6666-4666-8666-666666666666','planned','another private note')",[secondAdmin]);
    const successive=(await db.query("select actor_id,before_state,after_state from soundspin_admin_audit order by created_at,id")).rows;
    assert.equal(successive.length,2);assert.equal(successive[1].actor_id,secondAdmin);assert.equal(successive[1].before_state.status,"reviewing");assert.equal(successive[1].after_state.status,"planned");
    await db.exec(`reset role;delete from auth.users where id='${admin}';set role service_role;`);
    assert.equal((await db.query("select count(*)::int as count from soundspin_admin_audit where actor_id is null")).rows[0].count,1,"administrative evidence survives actor erasure without retaining identity");
    await db.exec(`reset role; insert into public.soundspin_chat_removals(id,actor_id,target_user_id) values(gen_random_uuid(),'${listener}','${owner}'); delete from auth.users where id='${listener}'; delete from auth.users where id='${owner}';`);
    const removal=(await db.query("select actor_id,target_user_id from public.soundspin_chat_removals")).rows[0];
    assert.deepEqual(removal,{actor_id:null,target_user_id:null});
  }finally {await db.close();}
});

test("fixed retention queues closed feedback blobs before deleting rows and preserves open reports",async()=>{
  const db=await fixture();try {
    await db.exec(`reset role; insert into soundspin_feedback(id,user_id,status,admin_note,updated_at,screenshot_paths)
      values(gen_random_uuid(),'${listener}','closed','',now()-interval '91 days',array['${listener}/closed.png','${owner}/victim.png']),
      (gen_random_uuid(),'${listener}','new','',now()-interval '91 days',array['${listener}/open.png']);
      insert into soundspin_admin_audit(actor_id,action,target_id,reason,created_at) values('${admin}','old-action','target','test',now()-interval '181 days');
      insert into soundspin_chat_removals(id,actor_id,target_user_id,created_at) values(gen_random_uuid(),'${listener}','${owner}',now()-interval '181 days');
      set role service_role;`);
    const result=(await db.query("select soundspin_prune_security_retention() as result")).rows[0].result;
    assert.deepEqual(result,{closedFeedback:1,adminAudit:1,chatRemovalEvidence:1,completedDeletionJobs:0});
    assert.equal((await db.query("select storage_path from soundspin_storage_deletion_outbox")).rows[0].storage_path,`${listener}/closed.png`);
    assert.equal((await db.query("select count(*)::int as count from soundspin_storage_deletion_outbox")).rows[0].count,1,"legacy reporter-supplied references cannot enqueue another user's blob");
    assert.equal((await db.query("select * from soundspin_feedback where status='new'")).rows.length,2);
    await db.exec("reset role;set role authenticated");
    await assert.rejects(db.query("select soundspin_prune_security_retention()"),/permission denied/);
  }finally {await db.close();}
});

test("deletion requires administrator approval and matching room impact before a resumable claim",async()=>{
  const db=await fixture();try {
    await asService(db);
    const job=(await db.query("insert into public.soundspin_account_deletion_jobs(user_id,delete_owned_rooms,owned_room_count) values($1,true,1) returning id",[owner])).rows[0].id;
    assert.equal((await db.query("select public.soundspin_claim_account_deletion() as job")).rows[0].job,null);
    await assert.rejects(db.query("select public.soundspin_approve_account_deletion($1,$2,$3,0,'verified requester')",[admin,job,owner]),/Owned rooms changed/);
    await db.query("select public.soundspin_approve_account_deletion($1,$2,$3,1,'verified requester')",[admin,job,owner]);
    assert.equal((await db.query("select public.soundspin_claim_account_deletion() as job")).rows[0].job.id,job);
    assert.equal((await db.query("select public.soundspin_claim_account_deletion() as job")).rows[0].job,null,"leased job is not claimed twice");
    await db.query("select public.soundspin_restrict_deletion_account($1)",[job]);
    assert.equal((await db.query("select public.soundspin_account_enabled($1) as active",[owner])).rows[0].active,false);
    await assert.rejects(db.query("select public.soundspin_complete_account_deletion($1)",[job]),/Account still exists/);
    await db.exec(`reset role; delete from auth.users where id='${owner}'; set role service_role`);
    await db.query("select public.soundspin_complete_account_deletion($1)",[job]);
    assert.equal((await db.query("select state,stage from public.soundspin_account_deletion_jobs where id=$1",[job])).rows[0].state,"complete");
  }finally {await db.close();}
});
