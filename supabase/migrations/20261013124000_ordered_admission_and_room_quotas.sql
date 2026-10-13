-- Only the trusted server invokes admission; ordinary clients cannot grant membership.
create function public.soundspin_admit_room(p_slug text, p_user_id uuid, p_password_hash text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.soundspin_rooms%rowtype; member_role text;
begin
  select * into r from public.soundspin_rooms where slug=p_slug for update;
  if not found or not public.soundspin_account_enabled(p_user_id) or not public.soundspin_room_enabled(p_slug)
    then raise exception 'Room admission denied'; end if;
  if r.password_hash is distinct from p_password_hash then raise exception 'Room policy changed'; end if;
  if public.soundspin_room_has_ban(p_slug,p_user_id) then raise exception 'Room admission denied'; end if;
  select role into member_role from public.soundspin_room_members where room_slug=p_slug and user_id=p_user_id;
  if r.owner_id=p_user_id then member_role:='owner'; end if;
  if r.access_mode='members' and member_role is null then raise exception 'Room admission denied'; end if;
  -- A revoked private member is never recreated. Only public/unlisted entry grants new membership.
  if member_role is null then
    insert into public.soundspin_room_members(room_slug,user_id,role,updated_at)
      values(p_slug,p_user_id,'member',now()) on conflict(room_slug,user_id) do nothing;
    member_role:='member';
  end if;
  return jsonb_build_object('role',member_role,'policyRevision',r.policy_revision);
end $$;
revoke all on function public.soundspin_admit_room(text,uuid,text) from public,anon,authenticated;
grant execute on function public.soundspin_admit_room(text,uuid,text) to service_role;

create function private.soundspin_room_creation_budget() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('soundspin-room-owner:'||new.owner_id::text,0));
  if not public.soundspin_account_enabled(new.owner_id) then raise exception 'Account unavailable'; end if;
  if (select count(*) from public.soundspin_rooms where owner_id=new.owner_id)>=10 then raise exception 'Room ownership limit reached'; end if;
  return new;
end $$;
revoke all on function private.soundspin_room_creation_budget() from public,anon,authenticated;
grant execute on function private.soundspin_room_creation_budget() to service_role;
create trigger soundspin_room_creation_budget before insert on public.soundspin_rooms
for each row execute function private.soundspin_room_creation_budget();

-- Bound each durable document and the waiting queues across rooms, including
-- concurrent commands in different room queues. Legacy over-limit accounts
-- may reduce their usage but cannot increase it until below the limit.
alter table public.soundspin_rooms add constraint soundspin_room_state_bytes
  check(octet_length(state::text)<=4194304) not valid;
alter table public.soundspin_room_moderation add constraint soundspin_moderation_state_bytes
  check(octet_length(data::text)<=4194304) not valid;
create table private.soundspin_queue_usage(
  room_slug text not null references public.soundspin_rooms(slug) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  track_count integer not null check(track_count>=0),
  primary key(room_slug,user_id)
);
grant usage on schema private to service_role;
revoke all on private.soundspin_queue_usage from public,anon,authenticated;
grant all on private.soundspin_queue_usage to service_role;
insert into private.soundspin_queue_usage(room_slug,user_id,track_count)
select r.slug,e.key::uuid,jsonb_array_length(e.value) from public.soundspin_rooms r
cross join lateral jsonb_each(case when jsonb_typeof(r.state->'djQueues')='object' then r.state->'djQueues' else '{}'::jsonb end) e
join auth.users u on u.id::text=e.key
where jsonb_typeof(e.value)='array';

create function private.soundspin_room_queue_budget() returns trigger
language plpgsql security invoker set search_path='' as $$
declare queues jsonb; actor record; previous_count integer; new_count integer; other_count bigint; room_count bigint;
begin
  if tg_op='UPDATE' and new.state->'djQueues' is not distinct from old.state->'djQueues' then return new;end if;
  queues:=coalesce(new.state->'djQueues','{}'::jsonb);
  if jsonb_typeof(queues)<>'object' then raise exception 'Invalid room queues';end if;
  if exists(select 1 from jsonb_each(queues) e where jsonb_typeof(e.value)<>'array' or e.key!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then raise exception 'Invalid room queues';end if;
  select coalesce(sum(jsonb_array_length(e.value)),0) into room_count from jsonb_each(queues) e;
  if room_count>2000 then raise exception 'Room waiting queue limit reached';end if;
  for actor in select user_id from (
    select key::uuid user_id from jsonb_each(queues)
    union select user_id from private.soundspin_queue_usage where room_slug=new.slug
  ) actors order by user_id loop
    perform pg_advisory_xact_lock(hashtextextended('soundspin-queue-user:'||actor.user_id::text,0));
    select coalesce(sum(track_count),0) into other_count from private.soundspin_queue_usage where user_id=actor.user_id and room_slug<>new.slug;
    select track_count into previous_count from private.soundspin_queue_usage where room_slug=new.slug and user_id=actor.user_id;
    new_count:=coalesce(jsonb_array_length(queues->actor.user_id::text),0);
    if other_count+new_count>2000 and new_count>coalesce(previous_count,0) then raise exception 'Account waiting queue limit reached';end if;
    if new_count=0 then delete from private.soundspin_queue_usage where room_slug=new.slug and user_id=actor.user_id;
    else insert into private.soundspin_queue_usage values(new.slug,actor.user_id,new_count)
      on conflict(room_slug,user_id) do update set track_count=excluded.track_count;end if;
  end loop;
  return new;
end $$;
revoke all on function private.soundspin_room_queue_budget() from public,anon,authenticated;
grant execute on function private.soundspin_room_queue_budget() to service_role;
create trigger soundspin_room_queue_budget after insert or update of state on public.soundspin_rooms
for each row execute function private.soundspin_room_queue_budget();

create function private.soundspin_provider_actor_active() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('soundspin-room-owner:'||new.user_id::text,0));
  if not public.soundspin_account_enabled(new.user_id) then raise exception 'Account unavailable';end if;
  return new;
end $$;
revoke all on function private.soundspin_provider_actor_active() from public,anon,authenticated;
grant execute on function private.soundspin_provider_actor_active() to service_role;
create trigger soundspin_provider_actor_active before insert or update on public.soundspin_music_connections
for each row execute function private.soundspin_provider_actor_active();

-- Every actor-associated deletion key must belong to that account namespace,
-- even if a future privileged producer forgets to validate a legacy reference.
-- NULL actor keys are reserved for inventory-proven orphan maintenance.
alter table public.soundspin_storage_deletion_outbox add constraint soundspin_outbox_actor_scope
  check(actor_id is null or split_part(storage_path,'/',1)=actor_id::text);

-- Startup refuses a schema from before the release security migrations. This
-- is a compatibility check; it does not replace hosted ACL/Storage verification.
create function public.soundspin_release_ready() returns boolean
language sql security invoker set search_path='' as $$
select to_regclass('private.soundspin_queue_usage') is not null
  and to_regclass('public.soundspin_storage_deletion_outbox') is not null
  and to_regclass('public.soundspin_account_deletion_jobs') is not null
  and to_regprocedure('public.soundspin_admit_room(text,uuid,text)') is not null
  and to_regprocedure('public.soundspin_room_member_page(text,text,text,integer)') is not null
  and to_regprocedure('public.soundspin_erase_live_moderation_account(text,uuid)') is not null
  and to_regprocedure('public.soundspin_social_profiles(uuid[])') is not null
  and to_regprocedure('public.soundspin_has_account_identity(jsonb,text)') is not null
  and not has_function_privilege('authenticated','public.soundspin_admit_room(text,uuid,text)','EXECUTE')
  and not has_function_privilege('anon','public.soundspin_admit_room(text,uuid,text)','EXECUTE')
  and not has_table_privilege('authenticated','public.soundspin_private_libraries','INSERT,UPDATE,DELETE')
  and not has_any_column_privilege('authenticated','public.soundspin_private_libraries','INSERT,UPDATE')
  and not has_table_privilege('authenticated','public.soundspin_feedback','INSERT')
  and not has_any_column_privilege('authenticated','public.soundspin_feedback','INSERT');
$$;
revoke all on function public.soundspin_release_ready() from public,anon,authenticated;
grant execute on function public.soundspin_release_ready() to service_role;
