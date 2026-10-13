-- Social consent and abuse controls are enforced under service-owned database locks.
-- Pending requests have their own capacity and never consume accepted-friend slots.
alter table public.soundspin_social_settings add column receive_requests boolean not null default true;
create table public.soundspin_user_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(blocker_id, blocked_id), check(blocker_id <> blocked_id)
);
create index soundspin_user_blocks_blocked_idx on public.soundspin_user_blocks(blocked_id);
create table public.soundspin_friend_request_cooldowns (
  requester_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  primary key(requester_id,recipient_id), check(requester_id <> recipient_id)
);
create table public.soundspin_social_request_usage (
  actor_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index soundspin_social_request_actor_idx on public.soundspin_social_request_usage(actor_id,created_at);
create index soundspin_social_request_recipient_idx on public.soundspin_social_request_usage(recipient_id,created_at);
create index soundspin_social_request_created_idx on public.soundspin_social_request_usage(created_at);
alter table public.soundspin_user_blocks enable row level security;
alter table public.soundspin_friend_request_cooldowns enable row level security;
alter table public.soundspin_social_request_usage enable row level security;
revoke all on public.soundspin_user_blocks,public.soundspin_friend_request_cooldowns,public.soundspin_social_request_usage from public,anon,authenticated;
grant select on public.soundspin_user_blocks to authenticated;
grant select,insert,update,delete on public.soundspin_user_blocks,public.soundspin_friend_request_cooldowns,public.soundspin_social_request_usage to service_role;
create policy user_blocks_owner_select on public.soundspin_user_blocks for select to authenticated using((select auth.uid())=blocker_id);
create policy user_blocks_active_account on public.soundspin_user_blocks as restrictive for select to authenticated
  using((select public.soundspin_current_account_active()));

create function public.soundspin_users_blocked(p_a uuid,p_b uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.soundspin_user_blocks where (blocker_id=p_a and blocked_id=p_b) or (blocker_id=p_b and blocked_id=p_a));
$$;
create function public.soundspin_set_user_block(p_actor uuid,p_target uuid,p_blocked boolean) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if p_actor is null or p_target is null or p_actor=p_target or p_blocked is null then raise exception 'Choose another listener.'; end if;
  if not public.soundspin_account_enabled(p_actor) then raise exception 'Account access is unavailable.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('soundspin-social:'||least(p_actor,p_target)::text,0));
  perform pg_advisory_xact_lock(hashtextextended('soundspin-social:'||greatest(p_actor,p_target)::text,0));
  if not exists(select 1 from public.soundspin_profiles where user_id=p_actor) or not exists(select 1 from public.soundspin_profiles where user_id=p_target) then raise exception 'Listener not found.'; end if;
  if p_blocked then
    if not exists(select 1 from public.soundspin_user_blocks where blocker_id=p_actor and blocked_id=p_target)
      and (select count(*) from public.soundspin_user_blocks where blocker_id=p_actor)>=500 then raise exception 'The blocked listeners limit has been reached.'; end if;
    insert into public.soundspin_user_blocks(blocker_id,blocked_id) values(p_actor,p_target) on conflict do nothing;
    delete from public.soundspin_friendships where user_low=least(p_actor,p_target) and user_high=greatest(p_actor,p_target);
    update public.soundspin_room_invitations set cancelled_at=coalesce(cancelled_at,now())
      where (sender_id=p_actor and recipient_id=p_target) or (sender_id=p_target and recipient_id=p_actor);
  else
    delete from public.soundspin_user_blocks where blocker_id=p_actor and blocked_id=p_target;
  end if;
end $$;
revoke all on function public.soundspin_users_blocked(uuid,uuid),public.soundspin_set_user_block(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.soundspin_users_blocked(uuid,uuid),public.soundspin_set_user_block(uuid,uuid,boolean) to service_role;

create or replace function public.soundspin_friend_action(p_actor uuid,p_target uuid,p_action text)
returns text language plpgsql security invoker set search_path='' as $$
declare low_id uuid:=least(p_actor,p_target); high_id uuid:=greatest(p_actor,p_target); relationship public.soundspin_friendships%rowtype;
begin
  if p_actor is null or p_target is null or p_actor=p_target then raise exception 'Choose another listener.'; end if;
  if p_action is null or p_action not in ('request','accept','decline','remove') then raise exception 'Invalid friend action.'; end if;
  if not public.soundspin_account_enabled(p_actor) or (p_action in ('request','accept') and not public.soundspin_account_enabled(p_target)) then raise exception 'Account access is unavailable.'; end if;
  -- A single bounded global budget is appropriate for the first single-instance release.
  -- Take this lock before per-account locks to keep the acquisition order consistent.
  if p_action='request' then perform pg_advisory_xact_lock(hashtextextended('soundspin-social:global-budget',0)); end if;
  perform pg_advisory_xact_lock(hashtextextended('soundspin-social:'||low_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('soundspin-social:'||high_id::text,0));
  if not exists(select 1 from public.soundspin_profiles where user_id=p_actor) or not exists(select 1 from public.soundspin_profiles where user_id=p_target) then raise exception 'Listener not found.'; end if;
  if p_action in ('request','accept') and public.soundspin_users_blocked(p_actor,p_target) then raise exception 'This listener cannot receive this request.'; end if;
  delete from public.soundspin_friendships where status='pending' and updated_at<=now()-interval '14 days' and (user_low in(p_actor,p_target) or user_high in(p_actor,p_target));
  select * into relationship from public.soundspin_friendships where user_low=low_id and user_high=high_id for update;
  if p_action='request' and relationship.user_low is null then
    if exists(select 1 from public.soundspin_social_settings where user_id=p_target and not receive_requests)
      or exists(select 1 from public.soundspin_friend_request_cooldowns where requester_id=p_actor and recipient_id=p_target and expires_at>now()) then raise exception 'This listener cannot receive this request.'; end if;
    if (select count(*) from public.soundspin_friendships where status='pending' and requested_by=p_actor)>=20
      or (select count(*) from public.soundspin_friendships where status='pending' and requested_by<>p_target and p_target in(user_low,user_high))>=30 then raise exception 'Too many pending friend requests.'; end if;
    delete from public.soundspin_social_request_usage where created_at<=now()-interval '1 day';
    delete from public.soundspin_friend_request_cooldowns where expires_at<=now();
    if (select count(*) from public.soundspin_social_request_usage where actor_id=p_actor)>=30
      or (select count(*) from public.soundspin_social_request_usage where recipient_id=p_target)>=50
      or (select count(*) from public.soundspin_social_request_usage)>=5000 then raise exception 'Too many friend requests. Try again later.'; end if;
    insert into public.soundspin_social_request_usage(actor_id,recipient_id) values(p_actor,p_target);
    insert into public.soundspin_friendships(user_low,user_high,requested_by) values(low_id,high_id,p_actor) returning * into relationship;
  elsif p_action='accept' then
    if relationship.user_low is null then raise exception 'Friend request not found.'; end if;
    if relationship.status='pending' then
      if relationship.requested_by=p_actor then raise exception 'Only the recipient can accept this request.'; end if;
      if (select count(*) from public.soundspin_friendships where status='accepted' and p_actor in(user_low,user_high))>=100
        or (select count(*) from public.soundspin_friendships where status='accepted' and p_target in(user_low,user_high))>=100 then raise exception 'The friends limit has been reached.'; end if;
      update public.soundspin_friendships set status='accepted',updated_at=now() where user_low=low_id and user_high=high_id returning * into relationship;
    end if;
  elsif p_action in ('decline','remove') then
    if p_action='decline' and relationship.status='accepted' then raise exception 'Use Remove friend for an accepted friendship.'; end if;
    -- Remove cannot bypass the cooldown for a recipient rejecting a pending request.
    if relationship.status='pending' and relationship.requested_by<>p_actor then
      insert into public.soundspin_friend_request_cooldowns(requester_id,recipient_id,expires_at) values(relationship.requested_by,p_actor,now()+interval '7 days')
        on conflict(requester_id,recipient_id) do update set expires_at=excluded.expires_at;
    end if;
    delete from public.soundspin_friendships where user_low=low_id and user_high=high_id;
    return 'none';
  end if;
  if relationship.status='accepted' then return 'friends'; end if;
  if relationship.requested_by=p_actor then return 'outgoing'; end if;
  return 'incoming';
end $$;
revoke all on function public.soundspin_friend_action(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.soundspin_friend_action(uuid,uuid,text) to service_role;

create or replace function public.soundspin_create_room_invitation(p_actor uuid,p_recipient uuid,p_room text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare invitation public.soundspin_room_invitations%rowtype; room_exists boolean;
begin
  if p_actor is null or p_recipient is null or p_actor=p_recipient then raise exception 'Choose another listener.'; end if;
  if not public.soundspin_account_enabled(p_actor) or not public.soundspin_account_enabled(p_recipient) or not public.soundspin_room_enabled(p_room) then raise exception 'Invitation access is unavailable.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('soundspin-social:'||least(p_actor,p_recipient)::text,0));
  perform pg_advisory_xact_lock(hashtextextended('soundspin-social:'||greatest(p_actor,p_recipient)::text,0));
  if public.soundspin_users_blocked(p_actor,p_recipient) then raise exception 'This listener cannot receive invitations.'; end if;
  perform 1 from public.soundspin_friendships where user_low=least(p_actor,p_recipient) and user_high=greatest(p_actor,p_recipient) and status='accepted' for share;
  if not found then raise exception 'Only accepted friends can receive room invitations.'; end if;
  perform 1 from public.soundspin_rooms where slug=p_room for update;
  if not found then raise exception 'Room not found.'; end if;
  if not public.soundspin_may_invite(p_room,p_actor) then raise exception 'You cannot invite members to this room.'; end if;
  if public.soundspin_room_has_ban(p_room,p_recipient) then raise exception 'That listener is banned from this room.'; end if;
  select * into invitation from public.soundspin_room_invitations where sender_id=p_actor and recipient_id=p_recipient and room_slug=p_room for update;
  if found and invitation.accepted_at is null and invitation.cancelled_at is null and invitation.expires_at>now() then return invitation.id; end if;
  delete from public.soundspin_room_invitations where sender_id=p_actor and (expires_at<=now() or id=invitation.id);
  if (select count(*) from public.soundspin_room_invitations where sender_id=p_actor and accepted_at is null and cancelled_at is null and expires_at>now())>=30
    or (select count(*) from public.soundspin_room_invitations where recipient_id=p_recipient and accepted_at is null and cancelled_at is null and expires_at>now())>=30 then raise exception 'Too many pending room invitations.'; end if;
  insert into public.soundspin_room_invitations(sender_id,recipient_id,room_slug,expires_at) values(p_actor,p_recipient,p_room,now()+interval '1 hour') returning id into invitation.id;
  return invitation.id;
end $$;

create or replace function public.soundspin_accept_room_invitation(p_actor uuid,p_invitation uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare invitation public.soundspin_room_invitations%rowtype; r public.soundspin_rooms%rowtype; recipient_role text;
begin
  select * into invitation from public.soundspin_room_invitations where id=p_invitation and recipient_id=p_actor;
  if not found then raise exception 'Invitation not found.'; end if;
  if not public.soundspin_account_enabled(p_actor) or not public.soundspin_account_enabled(invitation.sender_id) or not public.soundspin_room_enabled(invitation.room_slug) then raise exception 'Invitation access is unavailable.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('soundspin-social:'||least(invitation.sender_id,p_actor)::text,0));
  perform pg_advisory_xact_lock(hashtextextended('soundspin-social:'||greatest(invitation.sender_id,p_actor)::text,0));
  if public.soundspin_users_blocked(invitation.sender_id,p_actor) then raise exception 'This invitation is no longer available.'; end if;
  select * into r from public.soundspin_rooms where slug=invitation.room_slug for update;
  if not found then raise exception 'Room not found.'; end if;
  select * into invitation from public.soundspin_room_invitations where id=p_invitation and recipient_id=p_actor for update;
  if invitation.cancelled_at is not null then raise exception 'This invitation was cancelled.'; end if;
  if invitation.expires_at<=now() then raise exception 'This invitation has expired.'; end if;
  if public.soundspin_room_has_ban(r.slug,p_actor) then raise exception 'You are banned from this room.'; end if;
  if not public.soundspin_may_invite(r.slug,invitation.sender_id) then raise exception 'The inviter can no longer grant room access.'; end if;
  perform 1 from public.soundspin_friendships where user_low=least(invitation.sender_id,p_actor) and user_high=greatest(invitation.sender_id,p_actor) and status='accepted' for share;
  if not found then raise exception 'Only accepted friends can receive room invitations.'; end if;
  select role into recipient_role from public.soundspin_room_members where room_slug=r.slug and user_id=p_actor;
  if r.access_mode='members' and r.owner_id<>p_actor and recipient_role is null then
    if invitation.accepted_at is not null then raise exception 'Your room access was removed.'; end if;
    insert into public.soundspin_room_members(room_slug,user_id,role) values(r.slug,p_actor,'member') on conflict do nothing;
  end if;
  update public.soundspin_room_invitations set accepted_at=coalesce(accepted_at,now()) where id=p_invitation;
  return jsonb_build_object('roomSlug',r.slug,'passwordRequired',r.password_hash is not null);
end $$;
revoke all on function public.soundspin_create_room_invitation(uuid,uuid,text),public.soundspin_accept_room_invitation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.soundspin_create_room_invitation(uuid,uuid,text),public.soundspin_accept_room_invitation(uuid,uuid) to service_role;

-- Search filters account state before the result limit, without Auth API fanout.
create function public.soundspin_find_people(p_actor uuid,p_query text)
returns table(user_id uuid,display_name text,avatar_key text,avatar_url text,is_app_admin boolean)
language plpgsql stable security invoker set search_path='' as $$
begin
  if not public.soundspin_account_enabled(p_actor) then raise exception 'Account access is unavailable.'; end if;
  if p_query is null or char_length(trim(p_query))<2 then return; end if;
  if char_length(trim(p_query))>48 then raise exception 'Search is limited to 48 characters.'; end if;
  return query select p.user_id,p.display_name,p.avatar_key,p.avatar_url,p.is_app_admin
    from public.soundspin_profiles p where p.user_id<>p_actor and public.soundspin_account_enabled(p.user_id)
      and not public.soundspin_users_blocked(p_actor,p.user_id)
      and (strpos(lower(p.display_name),lower(trim(p_query)))>0 or strpos(lower(coalesce(p.handle,'')),lower(trim(p_query)))>0)
    order by p.display_name,p.user_id limit 20;
end $$;
revoke all on function public.soundspin_find_people(uuid,text) from public,anon,authenticated;
grant execute on function public.soundspin_find_people(uuid,text) to service_role;

-- Service clients bypass profile RLS. All social identity projections must
-- apply the same confirmed/active subject gate, including established friends
-- and blocked accounts. Restrict this lookup to bounded service-owned IDs.
create function public.soundspin_social_profiles(p_ids uuid[])
returns table(user_id uuid,display_name text,avatar_key text,avatar_url text,is_app_admin boolean)
language plpgsql stable security invoker set search_path='' as $$
begin
  if p_ids is null then return; end if;
  if cardinality(p_ids)>500 then raise exception 'Listener lookup exceeds its limit.'; end if;
  return query select p.user_id,p.display_name,p.avatar_key,p.avatar_url,p.is_app_admin
    from public.soundspin_profiles p where p.user_id=any(p_ids) and public.soundspin_account_enabled(p.user_id);
end $$;
revoke all on function public.soundspin_social_profiles(uuid[]) from public,anon,authenticated;
grant execute on function public.soundspin_social_profiles(uuid[]) to service_role;

-- Direct browser writes are unused; the validated server API owns schema and CAS.
revoke insert,update,delete on public.soundspin_private_libraries from public,anon,authenticated;
grant select on public.soundspin_private_libraries to authenticated;
drop policy if exists library_owner_insert on public.soundspin_private_libraries;
drop policy if exists library_owner_update on public.soundspin_private_libraries;
drop policy if exists library_owner_delete on public.soundspin_private_libraries;
-- NOT VALID preserves a recovery path for legacy rows with an unsafe revision.
-- New inserts/updates must remain exactly representable by the Node CAS implementation.
alter table public.soundspin_private_libraries add constraint library_safe_revision check(revision between 1 and 9007199254740991) not valid;
comment on table public.soundspin_private_libraries is 'Owner-private SELECT; validated service API owns mutations and compare-and-swap revisions. Explicit clear-library resets corrupt metadata. Auth-account deletion cascades.';
