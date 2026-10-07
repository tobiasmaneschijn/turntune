alter table public.soundspin_profiles
  add column handle text check (handle is null or handle ~ '^[a-z0-9_]{3,24}$'),
  add column status_text text not null default '' check (char_length(status_text) <= 80),
  add column favorite_tracks jsonb not null default '[]'::jsonb
    check (jsonb_typeof(favorite_tracks) = 'array' and jsonb_array_length(favorite_tracks) <= 3
      and not jsonb_path_exists(favorite_tracks, '$[*] ? (@.type() != "object")'));
create unique index soundspin_profiles_handle_unique
  on public.soundspin_profiles (handle) where handle is not null;

create table public.soundspin_friendships (
  user_low uuid not null references auth.users(id) on delete cascade,
  user_high uuid not null references auth.users(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_low, user_high),
  check (user_low < user_high),
  check (requested_by in (user_low, user_high))
);
create index soundspin_friendships_user_high_idx on public.soundspin_friendships (user_high, updated_at desc);

create table public.soundspin_social_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  share_activity boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.soundspin_room_invitations (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  room_slug text not null references public.soundspin_rooms(slug) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '1 hour'),
  accepted_at timestamptz,
  check (sender_id <> recipient_id),
  check (expires_at > created_at),
  unique (sender_id, recipient_id, room_slug)
);
create index soundspin_room_invitations_recipient_idx
  on public.soundspin_room_invitations (recipient_id, expires_at desc) where accepted_at is null;
create index soundspin_room_invitations_room_idx on public.soundspin_room_invitations (room_slug);

alter table public.soundspin_friendships enable row level security;
alter table public.soundspin_social_settings enable row level security;
alter table public.soundspin_room_invitations enable row level security;
revoke all on public.soundspin_friendships, public.soundspin_social_settings, public.soundspin_room_invitations
  from public, anon, authenticated;
grant select on public.soundspin_friendships, public.soundspin_social_settings, public.soundspin_room_invitations to authenticated;
grant select, insert, update, delete on public.soundspin_friendships, public.soundspin_social_settings, public.soundspin_room_invitations to service_role;
create policy friendship_participant_select on public.soundspin_friendships for select to authenticated
  using ((select auth.uid()) in (user_low, user_high));
create policy social_settings_owner_select on public.soundspin_social_settings for select to authenticated
  using ((select auth.uid()) = user_id);
create policy room_invitation_participant_select on public.soundspin_room_invitations for select to authenticated
  using ((select auth.uid()) in (sender_id, recipient_id));

-- Actor IDs are supplied only by the server after verifying credentials.
-- Invoker functions have no client EXECUTE grant and never elevate privileges.
create function public.soundspin_friend_action(p_actor uuid, p_target uuid, p_action text)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  low_id uuid := least(p_actor, p_target);
  high_id uuid := greatest(p_actor, p_target);
  relationship public.soundspin_friendships%rowtype;
begin
  if p_actor is null or p_target is null or p_actor = p_target then raise exception 'Choose another listener.'; end if;
  if p_action is null or p_action not in ('request', 'accept', 'decline', 'remove') then raise exception 'Invalid friend action.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('soundspin-social:' || low_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('soundspin-social:' || high_id::text, 0));
  if not exists (select 1 from public.soundspin_profiles where user_id = p_actor)
    or not exists (select 1 from public.soundspin_profiles where user_id = p_target)
    then raise exception 'Listener not found.'; end if;
  select * into relationship from public.soundspin_friendships
    where user_low = low_id and user_high = high_id for update;
  if p_action = 'request' and relationship.user_low is null then
    if (select count(*) from public.soundspin_friendships where user_low = p_actor or user_high = p_actor) >= 100
      or (select count(*) from public.soundspin_friendships where user_low = p_target or user_high = p_target) >= 100
      then raise exception 'The friends limit has been reached.'; end if;
    insert into public.soundspin_friendships (user_low, user_high, requested_by)
      values (low_id, high_id, p_actor) returning * into relationship;
  elsif p_action = 'accept' then
    if relationship.user_low is null then raise exception 'Friend request not found.'; end if;
    if relationship.status = 'pending' then
      if relationship.requested_by = p_actor then raise exception 'Only the recipient can accept this request.'; end if;
      update public.soundspin_friendships set status = 'accepted', updated_at = now()
        where user_low = low_id and user_high = high_id returning * into relationship;
    end if;
  elsif p_action = 'decline' then
    if relationship.status = 'accepted' then raise exception 'Use Remove friend for an accepted friendship.'; end if;
    delete from public.soundspin_friendships where user_low = low_id and user_high = high_id;
    return 'none';
  elsif p_action = 'remove' then
    delete from public.soundspin_friendships where user_low = low_id and user_high = high_id;
    return 'none';
  end if;
  if relationship.status = 'accepted' then return 'friends'; end if;
  if relationship.requested_by = p_actor then return 'outgoing'; end if;
  return 'incoming';
end;
$$;

create function public.soundspin_create_room_invitation(p_actor uuid, p_recipient uuid, p_room text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  room_record public.soundspin_rooms%rowtype;
  inviter_role text;
  recipient_role text;
  invitation public.soundspin_room_invitations%rowtype;
begin
  if p_actor is null or p_recipient is null or p_actor = p_recipient then raise exception 'Choose another listener.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('soundspin-social:' || least(p_actor, p_recipient)::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('soundspin-social:' || greatest(p_actor, p_recipient)::text, 0));
  perform 1 from public.soundspin_friendships
    where user_low = least(p_actor, p_recipient) and user_high = greatest(p_actor, p_recipient) and status = 'accepted' for share;
  if not found then raise exception 'Only accepted friends can receive room invitations.'; end if;
  select * into room_record from public.soundspin_rooms where slug = p_room for update;
  if not found then raise exception 'Room not found.'; end if;
  select role into inviter_role from public.soundspin_room_members where room_slug = p_room and user_id = p_actor for share;
  if room_record.owner_id = p_actor then inviter_role := 'owner'; end if;
  if inviter_role is null then raise exception 'Join this room before inviting friends.'; end if;
  select role into recipient_role from public.soundspin_room_members where room_slug = p_room and user_id = p_recipient for share;
  if not room_record.is_public and room_record.owner_id <> p_recipient and recipient_role is null
    and inviter_role not in ('owner', 'moderator')
    then raise exception 'Only the owner or a moderator can invite a new member to this private room.'; end if;
  select * into invitation from public.soundspin_room_invitations
    where sender_id = p_actor and recipient_id = p_recipient and room_slug = p_room for update;
  if invitation.id is not null and invitation.accepted_at is null and invitation.expires_at > now() then return invitation.id; end if;
  delete from public.soundspin_room_invitations where sender_id = p_actor and (expires_at <= now() or id = invitation.id);
  if (select count(*) from public.soundspin_room_invitations where sender_id = p_actor and accepted_at is null and expires_at > now()) >= 30
    or (select count(*) from public.soundspin_room_invitations where recipient_id = p_recipient and accepted_at is null and expires_at > now()) >= 30
    then raise exception 'Too many pending room invitations.'; end if;
  insert into public.soundspin_room_invitations (sender_id, recipient_id, room_slug)
    values (p_actor, p_recipient, p_room) returning id into invitation.id;
  return invitation.id;
end;
$$;

create function public.soundspin_accept_room_invitation(p_actor uuid, p_invitation uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  invitation public.soundspin_room_invitations%rowtype;
  room_record public.soundspin_rooms%rowtype;
  inviter_role text;
  recipient_role text;
begin
  select * into invitation from public.soundspin_room_invitations where id = p_invitation;
  if not found or p_actor is null or invitation.recipient_id <> p_actor then raise exception 'Invitation not found.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('soundspin-social:' || least(invitation.sender_id, p_actor)::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('soundspin-social:' || greatest(invitation.sender_id, p_actor)::text, 0));
  perform 1 from public.soundspin_friendships
    where user_low = least(invitation.sender_id, p_actor) and user_high = greatest(invitation.sender_id, p_actor) and status = 'accepted' for share;
  if not found then raise exception 'This invitation is no longer available.'; end if;
  select * into room_record from public.soundspin_rooms where slug = invitation.room_slug for update;
  if not found then raise exception 'Room not found.'; end if;
  select * into invitation from public.soundspin_room_invitations where id = p_invitation for update;
  if not found or invitation.expires_at <= now() then raise exception 'This invitation has expired.'; end if;
  select role into inviter_role from public.soundspin_room_members where room_slug = invitation.room_slug and user_id = invitation.sender_id for share;
  if room_record.owner_id = invitation.sender_id then inviter_role := 'owner'; end if;
  if inviter_role is null then raise exception 'The inviter no longer has room access.'; end if;
  select role into recipient_role from public.soundspin_room_members where room_slug = invitation.room_slug and user_id = p_actor for share;
  if not room_record.is_public and room_record.owner_id <> p_actor and recipient_role is null then
    if invitation.accepted_at is not null then raise exception 'Your room access was removed.'; end if;
    if inviter_role not in ('owner', 'moderator') then raise exception 'The inviter can no longer grant access to this private room.'; end if;
    insert into public.soundspin_room_members (room_slug, user_id, role, updated_at)
      values (invitation.room_slug, p_actor, 'member', now()) on conflict (room_slug, user_id) do nothing;
  end if;
  update public.soundspin_room_invitations set accepted_at = coalesce(accepted_at, now()) where id = p_invitation;
  return jsonb_build_object('roomSlug', invitation.room_slug, 'passwordRequired', room_record.password_hash is not null);
end;
$$;

revoke all on function public.soundspin_friend_action(uuid, uuid, text),
  public.soundspin_create_room_invitation(uuid, uuid, text), public.soundspin_accept_room_invitation(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.soundspin_friend_action(uuid, uuid, text),
  public.soundspin_create_room_invitation(uuid, uuid, text), public.soundspin_accept_room_invitation(uuid, uuid) to service_role;
