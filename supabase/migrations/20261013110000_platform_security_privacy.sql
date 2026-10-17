-- Platform decisions live outside cascading account/room rows so erasure
-- retries and backup reconciliation retain a minimal UUID-only receipt.
create table public.soundspin_account_restrictions (
  user_id uuid primary key, state text not null check(state in ('active','suspended','deleting','deleted')),
  updated_at timestamptz not null default now()
);
create table public.soundspin_room_restrictions (
  room_slug text primary key, disabled boolean not null default false,
  owner_suspended boolean not null default false, updated_at timestamptz not null default now()
);
create table public.soundspin_admin_audit (
  id uuid primary key default gen_random_uuid(), actor_id uuid references auth.users(id) on delete set null,
  action text not null check(char_length(action) between 1 and 48), target_id text not null check(char_length(target_id)<=100),
  reason text not null check(char_length(reason) between 1 and 500), before_state jsonb not null default '{}',
  after_state jsonb not null default '{}', created_at timestamptz not null default now()
);
create index soundspin_admin_audit_created_idx on public.soundspin_admin_audit(created_at desc);
create table public.soundspin_account_deletion_jobs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null,
  state text not null default 'requested' check(state in ('requested','approved','running','failed','complete')),
  delete_owned_rooms boolean not null check(delete_owned_rooms), owned_room_count integer not null,
  owned_room_slugs text[] not null default '{}',
  requested_at timestamptz not null default now(), approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz, completed_at timestamptz, stage text not null default 'requested', attempts integer not null default 0,
  last_error text, updated_at timestamptz not null default now()
);
create unique index soundspin_deletion_pending_user_idx on public.soundspin_account_deletion_jobs(user_id) where state<>'complete';
alter table public.soundspin_account_restrictions enable row level security;
alter table public.soundspin_room_restrictions enable row level security;
alter table public.soundspin_admin_audit enable row level security;
alter table public.soundspin_account_deletion_jobs enable row level security;
revoke all on public.soundspin_account_restrictions,public.soundspin_room_restrictions,public.soundspin_admin_audit,public.soundspin_account_deletion_jobs from public,anon,authenticated;
grant all on public.soundspin_account_restrictions,public.soundspin_room_restrictions,public.soundspin_account_deletion_jobs to service_role;
grant select,insert on public.soundspin_admin_audit to service_role;

-- Keep retained moderation evidence, remove account identifiers at erasure.
alter table public.soundspin_chat_removals alter column actor_id drop not null;
alter table public.soundspin_chat_removals drop constraint soundspin_chat_removals_actor_id_fkey;
alter table public.soundspin_chat_removals drop constraint soundspin_chat_removals_target_user_id_fkey;
alter table public.soundspin_chat_removals add constraint soundspin_chat_removals_actor_id_fkey foreign key(actor_id) references auth.users(id) on delete set null;
alter table public.soundspin_chat_removals add constraint soundspin_chat_removals_target_user_id_fkey foreign key(target_user_id) references auth.users(id) on delete set null;

-- Only reveals the current authenticated account's access state. No caller-
-- supplied user ID, safe search path, and never exposes private restriction rows.
create function public.soundspin_current_account_active() returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null)
    and not exists(select 1 from public.soundspin_account_restrictions r where r.user_id=auth.uid() and r.state<>'active')
$$;
create function public.soundspin_current_room_active(p_room text) returns boolean
language sql stable security definer set search_path='' as $$
  select public.soundspin_current_account_active() and exists(select 1 from public.soundspin_rooms room where room.slug=p_room and
    (room.access_mode='public' or room.owner_id=auth.uid() or exists(select 1 from public.soundspin_room_members member where member.room_slug=p_room and member.user_id=auth.uid())))
    and not exists(select 1 from public.soundspin_room_restrictions r
    where r.room_slug=p_room and (r.disabled or r.owner_suspended))
    and not exists(select 1 from public.soundspin_rooms room join auth.users owner on owner.id=room.owner_id
      where room.slug=p_room and (owner.email_confirmed_at is null or exists(select 1 from public.soundspin_account_restrictions r where r.user_id=owner.id and r.state<>'active')))
$$;
revoke all on function public.soundspin_current_account_active(),public.soundspin_current_room_active(text) from public,anon;
grant execute on function public.soundspin_current_account_active(),public.soundspin_current_room_active(text) to authenticated,service_role;
create function public.soundspin_account_enabled(p_user_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.users where id=p_user_id and email_confirmed_at is not null)
    and not exists(select 1 from public.soundspin_account_restrictions where user_id=p_user_id and state<>'active')
$$;
create function public.soundspin_room_enabled(p_room_slug text) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.soundspin_rooms where slug=p_room_slug) and not exists(select 1 from public.soundspin_room_restrictions where room_slug=p_room_slug and (disabled or owner_suspended))
    and not exists(select 1 from public.soundspin_rooms where slug=p_room_slug and not public.soundspin_account_enabled(owner_id))
$$;
revoke all on function public.soundspin_account_enabled(uuid),public.soundspin_room_enabled(text) from public,anon,authenticated;
grant execute on function public.soundspin_account_enabled(uuid),public.soundspin_room_enabled(text) to service_role;
-- Profiles are visible to active members, but a pending/suspended subject's
-- public content is not exposed through direct REST. Own privacy export uses a
-- separately authenticated service route and is not an RLS visibility escape.
create function public.soundspin_profile_visible(p_subject uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select public.soundspin_current_account_active() and public.soundspin_account_enabled(p_subject)
$$;
revoke all on function public.soundspin_profile_visible(uuid) from public,anon;
grant execute on function public.soundspin_profile_visible(uuid) to authenticated,service_role;
create policy platform_profile_subject_visible on public.soundspin_profiles as restrictive for select to authenticated
  using (public.soundspin_profile_visible(user_id));
-- Reactions carry a message FK instead of room_slug. This helper exposes only
-- the current user's own reaction-read permission, never another user's rows.
create function public.soundspin_current_reaction_room_active(p_message uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select public.soundspin_current_account_active() and exists(select 1 from public.soundspin_message_reactions reaction
    join public.soundspin_messages message on message.id=reaction.message_id
    where reaction.message_id=p_message and reaction.user_id=auth.uid() and public.soundspin_current_room_active(message.room_slug))
$$;
revoke all on function public.soundspin_current_reaction_room_active(uuid) from public,anon;
grant execute on function public.soundspin_current_reaction_room_active(uuid) to authenticated,service_role;
create policy platform_reaction_room_active on public.soundspin_message_reactions as restrictive for select to authenticated
  using(public.soundspin_current_reaction_room_active(message_id));

-- RESTRICTIVE gates compose with the existing owner/reader policies. They do
-- not create a new read/write grant, even on private server-only tables.
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname='public' and tablename like 'soundspin_%' loop
    execute format('create policy platform_account_active on public.%I as restrictive for all to authenticated using ((select public.soundspin_current_account_active())) with check ((select public.soundspin_current_account_active()))',t.tablename);
    if exists(select 1 from information_schema.columns where table_schema='public' and table_name=t.tablename and column_name='room_slug') then
      execute format('create policy platform_room_active on public.%I as restrictive for all to authenticated using (room_slug is null or public.soundspin_current_room_active(room_slug)) with check (room_slug is null or public.soundspin_current_room_active(room_slug))',t.tablename);
    end if;
  end loop;
end $$;
create policy platform_storage_account_active on storage.objects as restrictive for all to authenticated
  using ((select public.soundspin_current_account_active())) with check ((select public.soundspin_current_account_active()));
-- Chat storage is served through authorized Node signing routes. A public
-- avatar URL cannot be revoked by RLS; clear-avatar operator deletes the bytes.

create function public.soundspin_require_admin(p_actor uuid) returns void
language plpgsql security invoker set search_path='' as $$ begin
  if not exists(select 1 from public.soundspin_profiles where user_id=p_actor and is_app_admin)
    or not public.soundspin_account_enabled(p_actor)
  then raise exception 'Administrator access required.'; end if;
end $$;
create function public.soundspin_platform_action(p_actor uuid,p_action text,p_target text,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare before_value jsonb; after_value jsonb; v_user uuid; begin
  perform public.soundspin_require_admin(p_actor);
  if char_length(trim(p_reason)) not between 1 and 500 then raise exception 'A reason is required.'; end if;
  if p_action in ('suspend-account','restore-account') then
    v_user:=p_target::uuid;
    perform pg_advisory_xact_lock(hashtextextended('soundspin-room-owner:'||v_user::text,0));
    if v_user=p_actor then raise exception 'Self-suspension is not allowed.'; end if;
    perform 1 from public.soundspin_profiles where user_id=v_user;
    if not found then raise exception 'Account not found.'; end if;
    select to_jsonb(r) into before_value from public.soundspin_account_restrictions r where user_id=v_user for update;
    if before_value->>'state' in ('deleting','deleted') then raise exception 'Deletion has already started.'; end if;
    insert into public.soundspin_account_restrictions(user_id,state) values(v_user,case when p_action='suspend-account' then 'suspended' else 'active' end)
      on conflict(user_id) do update set state=excluded.state,updated_at=now() returning to_jsonb(soundspin_account_restrictions.*) into after_value;
    insert into public.soundspin_room_restrictions(room_slug,owner_suspended)
      select slug,p_action='suspend-account' from public.soundspin_rooms where owner_id=v_user
      on conflict(room_slug) do update set owner_suspended=excluded.owner_suspended,updated_at=now();
  elsif p_action in ('disable-room','restore-room') then
    perform 1 from public.soundspin_rooms where slug=p_target;
    if not found then raise exception 'Room not found.'; end if;
    select to_jsonb(r) into before_value from public.soundspin_room_restrictions r where room_slug=p_target for update;
    insert into public.soundspin_room_restrictions(room_slug,disabled) values(p_target,p_action='disable-room')
      on conflict(room_slug) do update set disabled=excluded.disabled,updated_at=now() returning to_jsonb(soundspin_room_restrictions.*) into after_value;
  elsif p_action in ('clear-avatar','clear-profile') then
    v_user:=p_target::uuid;
    select jsonb_build_object('avatar_path',avatar_path) into before_value from public.soundspin_profiles where user_id=v_user for update;
    if not found then raise exception 'Account not found.'; end if;
    update public.soundspin_profiles set avatar_url=null,avatar_path=null where user_id=v_user;
    if p_action='clear-profile' then
      update public.soundspin_profiles set display_name='Listener',bio='',handle=null,status_text='',favorite_tracks='[]',updated_at=now() where user_id=v_user;
    end if;
    if before_value->>'avatar_path' is not null
      and split_part(before_value->>'avatar_path','/',1)=v_user::text
      and char_length(before_value->>'avatar_path') between 1 and 200
      and position('..' in before_value->>'avatar_path')=0 then
      -- Upload ledger migration follows this migration. The function is only
      -- invoked after the complete release chain has been installed.
      -- Legacy profile references were browser-writable; they are not proof
      -- that this account owns another actor's blob.
      insert into public.soundspin_storage_deletion_outbox(bucket_id,storage_path,actor_id)
        values('profile-avatars',before_value->>'avatar_path',v_user) on conflict(bucket_id,storage_path) do nothing;
    end if;
    after_value:='{}';
  else raise exception 'Unknown platform action.'; end if;
  insert into public.soundspin_admin_audit(actor_id,action,target_id,reason,before_state,after_state)
    values(p_actor,p_action,p_target,trim(p_reason),coalesce(before_value,'{}'),coalesce(after_value,'{}'));
  return coalesce(after_value,'{}');
end $$;
create function public.soundspin_update_feedback_admin(p_actor uuid,p_id uuid,p_status text,p_note text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare item public.soundspin_feedback; before_value jsonb; begin
  perform public.soundspin_require_admin(p_actor);
  select * into item from public.soundspin_feedback where id=p_id for update;
  if not found then return null; end if;
  before_value:=jsonb_build_object('status',item.status,'noteHash',encode(sha256(convert_to(item.admin_note,'UTF8')),'hex'),'noteLength',char_length(item.admin_note));
  update public.soundspin_feedback set status=p_status,admin_note=p_note,updated_at=now() where id=p_id returning * into item;
  insert into public.soundspin_admin_audit(actor_id,action,target_id,reason,before_state,after_state)
    values(p_actor,'feedback-update',p_id::text,'Support workflow update',before_value,
      jsonb_build_object('status',item.status,'noteHash',encode(sha256(convert_to(item.admin_note,'UTF8')),'hex'),'noteLength',char_length(item.admin_note)));
  return jsonb_build_object('id',item.id,'status',item.status,'admin_note',item.admin_note,'updated_at',item.updated_at);
end $$;
revoke all on function public.soundspin_require_admin(uuid),public.soundspin_platform_action(uuid,text,text,text),public.soundspin_update_feedback_admin(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.soundspin_require_admin(uuid),public.soundspin_platform_action(uuid,text,text,text),public.soundspin_update_feedback_admin(uuid,uuid,text,text) to service_role;

create function public.soundspin_approve_account_deletion(p_actor uuid,p_job uuid,p_user uuid,p_room_count integer,p_reason text) returns void
language plpgsql security invoker set search_path='' as $$
declare job public.soundspin_account_deletion_jobs; actual_count integer; begin
  perform public.soundspin_require_admin(p_actor);
  perform pg_advisory_xact_lock(hashtextextended('soundspin-room-owner:'||p_user::text,0));
  if char_length(trim(p_reason)) not between 1 and 500 or p_user=p_actor then raise exception 'Invalid deletion approval.'; end if;
  select * into job from public.soundspin_account_deletion_jobs where id=p_job for update;
  if not found or job.user_id<>p_user or job.state not in ('requested','approved','failed') then raise exception 'Request changed.'; end if;
  select count(*) into actual_count from public.soundspin_rooms where owner_id=p_user;
  if job.owned_room_count<>p_room_count or actual_count<>p_room_count then raise exception 'Owned rooms changed. Obtain a new confirmation.'; end if;
  update public.soundspin_account_deletion_jobs set state='approved',approved_by=p_actor,approved_at=now(),last_error=null,updated_at=now() where id=p_job;
  -- Block new room/upload/provider work in the same transaction as approval.
  -- This shares the owner lock with room creation and closes approval-to-worker
  -- races without relying on an already connected browser to stop requests.
  insert into public.soundspin_account_restrictions(user_id,state) values(p_user,'deleting')
    on conflict(user_id) do update set state='deleting',updated_at=now();
  insert into public.soundspin_room_restrictions(room_slug,owner_suspended)
    select slug,true from public.soundspin_rooms where owner_id=p_user
    on conflict(room_slug) do update set owner_suspended=true,updated_at=now();
  insert into public.soundspin_admin_audit(actor_id,action,target_id,reason,before_state,after_state)
    values(p_actor,'approve-account-deletion',p_job::text,trim(p_reason),jsonb_build_object('state',job.state),jsonb_build_object('state','approved','ownedRooms',actual_count));
end $$;
create function public.soundspin_claim_account_deletion() returns jsonb
language plpgsql security invoker set search_path='' as $$ declare job public.soundspin_account_deletion_jobs; begin
  select * into job from public.soundspin_account_deletion_jobs
    where state='approved' or state='failed' and updated_at<now()-interval '5 minutes'
      or state='running' and updated_at<now()-interval '5 minutes'
    order by requested_at for update skip locked limit 1;
  if not found then return null; end if;
  update public.soundspin_account_deletion_jobs set state='running',attempts=attempts+1,updated_at=now() where id=job.id returning * into job;
  return to_jsonb(job);
end $$;
create function public.soundspin_restrict_deletion_account(p_job uuid) returns void
language plpgsql security invoker set search_path='' as $$ declare job public.soundspin_account_deletion_jobs; begin
  select * into job from public.soundspin_account_deletion_jobs where id=p_job and state='running' for update;
  if not found or job.approved_at is null then raise exception 'Deletion has not been approved.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('soundspin-room-owner:'||job.user_id::text,0));
  insert into public.soundspin_account_restrictions(user_id,state) values(job.user_id,'deleting')
    on conflict(user_id) do update set state='deleting',updated_at=now();
  insert into public.soundspin_room_restrictions(room_slug,owner_suspended)
    select slug,true from public.soundspin_rooms where owner_id=job.user_id
    on conflict(room_slug) do update set owner_suspended=true,updated_at=now();
end $$;
create function public.soundspin_complete_account_deletion(p_job uuid) returns void
language plpgsql security invoker set search_path='' as $$ declare job public.soundspin_account_deletion_jobs; begin
  select * into job from public.soundspin_account_deletion_jobs where id=p_job and state='running' for update;
  if not found then raise exception 'Deletion is not running.'; end if;
  if exists(select 1 from public.soundspin_profiles where user_id=job.user_id) then raise exception 'Account still exists.'; end if;
  update public.soundspin_account_restrictions set state='deleted',updated_at=now() where user_id=job.user_id;
  update public.soundspin_account_deletion_jobs set state='complete',stage='complete',last_error=null,completed_at=now(),updated_at=now() where id=p_job;
  insert into public.soundspin_admin_audit(actor_id,action,target_id,reason,after_state)
    values(job.approved_by,'account-deletion-complete',p_job::text,'Approved erasure workflow completed',jsonb_build_object('state','complete'));
end $$;
revoke all on function public.soundspin_approve_account_deletion(uuid,uuid,uuid,integer,text),public.soundspin_claim_account_deletion(),public.soundspin_restrict_deletion_account(uuid),public.soundspin_complete_account_deletion(uuid) from public,anon,authenticated;
grant execute on function public.soundspin_approve_account_deletion(uuid,uuid,uuid,integer,text),public.soundspin_claim_account_deletion(),public.soundspin_restrict_deletion_account(uuid),public.soundspin_complete_account_deletion(uuid) to service_role;

-- Fixed retention bounds; service-only definer is narrowly needed to prune
-- append-only audit rows. All referenced later upload tables are accessed only
-- at execution after the full release migration chain is installed.
create function public.soundspin_prune_security_retention() returns jsonb
language plpgsql security definer set search_path='' as $$
declare feedback_count integer; audit_count integer; removal_count integer; receipt_count integer; begin
  with expired as (select id,user_id,screenshot_paths from public.soundspin_feedback where status in ('closed','resolved') and updated_at<now()-interval '90 days' order by updated_at limit 500 for update),
    queued as (insert into public.soundspin_storage_deletion_outbox(bucket_id,storage_path,actor_id)
      select 'feedback-screenshots',p,e.user_id from expired e cross join lateral unnest(e.screenshot_paths) p
      where split_part(p,'/',1)=e.user_id::text and char_length(p)<=200 and p not like '%..%'
      on conflict(bucket_id,storage_path) do nothing)
    delete from public.soundspin_feedback where id in(select id from expired);
  get diagnostics feedback_count=row_count;
  delete from public.soundspin_admin_audit where id in(select id from public.soundspin_admin_audit where created_at<now()-interval '180 days' order by created_at limit 500);
  get diagnostics audit_count=row_count;
  delete from public.soundspin_chat_removals where id in(select id from public.soundspin_chat_removals where created_at<now()-interval '180 days' order by created_at limit 500);
  get diagnostics removal_count=row_count;
  delete from public.soundspin_account_deletion_jobs where id in(select id from public.soundspin_account_deletion_jobs where state='complete' and completed_at<now()-interval '180 days' order by completed_at limit 500);
  get diagnostics receipt_count=row_count;
  return jsonb_build_object('closedFeedback',feedback_count,'adminAudit',audit_count,'chatRemovalEvidence',removal_count,'completedDeletionJobs',receipt_count);
end $$;
revoke all on function public.soundspin_prune_security_retention() from public,anon,authenticated;
grant execute on function public.soundspin_prune_security_retention() to service_role;
