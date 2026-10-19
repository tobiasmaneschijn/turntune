alter table public.soundspin_rooms
  add column access_mode text not null default 'public' check (access_mode in ('public', 'unlisted', 'members')),
  add column policy_revision bigint not null default 0;
update public.soundspin_rooms set access_mode = case when is_public then 'public' else 'members' end;
alter table public.soundspin_rooms add column session_active boolean generated always as (
  (case when jsonb_typeof(settings->'themeSchedules') = 'array' then jsonb_array_length(settings->'themeSchedules') else 0 end) > 0
  or coalesce(state #>> '{radioState,fallback,enabled}' = 'true', false)
) stored;
create index soundspin_rooms_discovery_mode_idx on public.soundspin_rooms (updated_at desc) where access_mode = 'public';
create index soundspin_rooms_active_sessions_idx on public.soundspin_rooms (slug) where session_active;

-- This document is server-only. Public listener projections never include it.
-- It shares the radio commit transaction while preserving the existing single-server coordinator.
create table public.soundspin_room_moderation (
  room_slug text primary key references public.soundspin_rooms(slug) on delete cascade,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.soundspin_room_moderation enable row level security;
revoke all on public.soundspin_room_moderation from public, anon, authenticated;
grant select, insert, update, delete on public.soundspin_room_moderation to service_role;
alter table public.soundspin_room_invitations add column cancelled_at timestamptz;
-- The social API filters current access and bans before disclosing room details.
-- Direct invitation reads cannot apply those private checks.
revoke all on public.soundspin_room_invitations from public, anon, authenticated;

create function public.soundspin_commit_room_v2(
  p_slug text, p_state jsonb, p_metadata jsonb default '{}'::jsonb,
  p_member jsonb default null, p_member_deletes uuid[] default '{}', p_moderation jsonb default '{}'::jsonb
) returns text language plpgsql security invoker set search_path = '' as $$
declare room_owner uuid; previous_data jsonb; mode text;
begin
  select owner_id into room_owner from public.soundspin_rooms where slug = p_slug for update;
  if not found then return null; end if;
  if jsonb_typeof(p_moderation) <> 'object' then raise exception 'Invalid moderation document'; end if;
  select data into previous_data from public.soundspin_room_moderation where room_slug = p_slug for update;
  if previous_data ? 'log' and exists (
    select 1 from jsonb_array_elements(previous_data->'log') with ordinality as old(event, n)
    where p_moderation->'log'->((old.n - 1)::integer) is distinct from old.event
  ) then raise exception 'Moderation history is append-only'; end if;
  if room_owner = any(p_member_deletes) then raise exception 'The room owner cannot be removed'; end if;
  if p_member is not null and (p_member->>'user_id')::uuid = room_owner and p_member->>'role' <> 'owner' then raise exception 'The room owner role cannot be changed'; end if;
  mode := case when p_metadata ? 'access_mode' then p_metadata->>'access_mode' else null end;
  update public.soundspin_rooms set
    state = p_state - 'moderation',
    name = case when p_metadata ? 'name' then p_metadata->>'name' else name end,
    access_mode = coalesce(mode, access_mode),
    is_public = case when mode is not null then mode <> 'members' when p_metadata ? 'is_public' then (p_metadata->>'is_public')::boolean else is_public end,
    password_hash = case when p_metadata ? 'password_hash' then p_metadata->>'password_hash' else password_hash end,
    settings = case when p_metadata ? 'settings' then p_metadata->'settings' else settings end,
    policy_revision = case when p_metadata ? 'policy_revision' then (p_metadata->>'policy_revision')::bigint else policy_revision end,
    updated_at = now() where slug = p_slug;
  if p_member is not null then
    insert into public.soundspin_room_members(room_slug,user_id,role,updated_at)
    values(p_slug,(p_member->>'user_id')::uuid,p_member->>'role',now())
    on conflict(room_slug,user_id) do update set role=excluded.role,updated_at=excluded.updated_at;
  end if;
  delete from public.soundspin_room_members where room_slug=p_slug and user_id=any(p_member_deletes);
  update public.soundspin_room_invitations set cancelled_at=coalesce(cancelled_at,now())
    where room_slug=p_slug and id::text in (select jsonb_array_elements_text(coalesce(p_moderation->'cancelledInvitations','[]'::jsonb)));
  insert into public.soundspin_room_moderation(room_slug,data,revision,updated_at) values(p_slug,p_moderation,1,now())
    on conflict(room_slug) do update set data=excluded.data,revision=public.soundspin_room_moderation.revision+1,updated_at=now();
  return p_slug;
end $$;
revoke all on function public.soundspin_commit_room_v2(text,jsonb,jsonb,jsonb,uuid[],jsonb) from public,anon,authenticated;
grant execute on function public.soundspin_commit_room_v2(text,jsonb,jsonb,jsonb,uuid[],jsonb) to service_role;

create function public.soundspin_room_has_ban(p_room text,p_user uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from public.soundspin_room_moderation m,
    lateral jsonb_array_elements(coalesce(m.data->'restrictions','[]'::jsonb)) r
    where m.room_slug=p_room and r->>'userId'=p_user::text and r->>'kind'='room-ban'
      and r->>'revokedAt' is null and (r->>'expiresAt' is null or (r->>'expiresAt')::numeric > extract(epoch from now())*1000));
$$;
revoke all on function public.soundspin_room_has_ban(text,uuid) from public,anon,authenticated;
grant execute on function public.soundspin_room_has_ban(text,uuid) to service_role;

create function public.soundspin_may_invite(p_room text,p_actor uuid)
returns boolean language plpgsql stable security invoker set search_path = '' as $$
declare r public.soundspin_rooms%rowtype; role_name text; policy text; staff boolean;
begin
  select * into r from public.soundspin_rooms where slug=p_room;
  if not found or public.soundspin_room_has_ban(p_room,p_actor) then return false; end if;
  if r.owner_id=p_actor then return true; end if;
  select role into role_name from public.soundspin_room_members where room_slug=p_room and user_id=p_actor;
  if role_name is null then return false; end if;
  staff:=role_name='moderator' and coalesce((r.settings #>> '{moderatorPermissions,accessInvites}')::boolean,true);
  policy:=coalesce(r.settings->>'invitePermission','default');
  return case when policy='owner' then false when policy='staff' then staff
    when policy='members' then true when r.access_mode='members' then staff else true end;
end $$;
revoke all on function public.soundspin_may_invite(text,uuid) from public,anon,authenticated;
grant execute on function public.soundspin_may_invite(text,uuid) to service_role;

create or replace function public.soundspin_create_room_invitation(p_actor uuid,p_recipient uuid,p_room text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare invitation public.soundspin_room_invitations%rowtype; room_exists boolean;
begin
  if p_actor is null or p_recipient is null or p_actor=p_recipient then raise exception 'Choose another listener.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('soundspin-social:'||least(p_actor,p_recipient)::text,0));
  perform pg_advisory_xact_lock(hashtextextended('soundspin-social:'||greatest(p_actor,p_recipient)::text,0));
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
  perform pg_advisory_xact_lock(hashtextextended('soundspin-social:'||least(invitation.sender_id,p_actor)::text,0));
  perform pg_advisory_xact_lock(hashtextextended('soundspin-social:'||greatest(invitation.sender_id,p_actor)::text,0));
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
