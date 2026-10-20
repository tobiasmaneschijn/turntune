-- Service-only snapshots replace repeated HTTP lookups without caching grants.
create function public.soundspin_room_access(p_room_slug text, p_actor uuid default null, p_readers uuid[] default '{}')
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  room record;
  room_data jsonb;
  room_mode text;
  room_active boolean := false;
  actor_active boolean := false;
  actor_role text;
  actor_banned boolean := false;
  readers jsonb := '[]'::jsonb;
  bans uuid[] := '{}';
begin
  if p_room_slug is null or p_room_slug !~ '^[a-z0-9-]{3,48}$' or coalesce(cardinality(p_readers),0)>100 then
    raise exception 'Invalid room access request.' using errcode='22023';
  end if;
  select slug,owner_id,is_public,password_hash,access_mode,settings into room from public.soundspin_rooms where slug=p_room_slug;
  if p_actor is not null then
    actor_active := not exists(select 1 from public.soundspin_account_restrictions where user_id=p_actor and state<>'active');
  end if;
  if room.slug is null then
    return jsonb_build_object('exists',false,'isPublic',false,'passwordHash',null,'role',null,'banned',false,
      'accessMode','members','settings','{}'::jsonb,'roomActive',false,'accountActive',actor_active,'readers',readers);
  end if;
  room_mode := coalesce(room.access_mode,case when room.is_public then 'public' else 'members' end);
  room_active := public.soundspin_room_enabled(p_room_slug);
  select data into room_data from public.soundspin_room_moderation where room_slug=p_room_slug;
  select coalesce(array_agg(distinct (restriction->>'userId')::uuid),'{}'::uuid[]) into bans
    from jsonb_array_elements(coalesce(room_data->'restrictions','[]'::jsonb)) restriction
    where restriction->>'kind'='room-ban' and restriction->'revokedAt'='null'::jsonb
      and (restriction->'expiresAt'='null'::jsonb or (restriction->>'expiresAt')::numeric>extract(epoch from statement_timestamp())*1000);
  if p_actor is not null then
    if room.owner_id=p_actor then actor_role := 'owner';
    else select role into actor_role from public.soundspin_room_members where room_slug=p_room_slug and user_id=p_actor;
    end if;
    actor_banned := p_actor=any(bans);
  end if;
  if room_active then
    select coalesce(jsonb_agg(reader_id),'[]'::jsonb) into readers
      from (select distinct reader_id from unnest(coalesce(p_readers,'{}'::uuid[])) reader_id) requested
      where reader_id is not null and not reader_id=any(bans)
        and not exists(select 1 from public.soundspin_account_restrictions where user_id=reader_id and state<>'active')
        and (room_mode<>'members' or room.owner_id=reader_id or exists(
          select 1 from public.soundspin_room_members where room_slug=p_room_slug and user_id=reader_id));
  end if;
  return jsonb_build_object('exists',true,'isPublic',room_mode<>'members','passwordHash',room.password_hash,
    'role',actor_role,'banned',actor_banned,'accessMode',room_mode,'settings',coalesce(room.settings,'{}'::jsonb),
    'roomActive',room_active,'accountActive',actor_active,'readers',readers);
end;
$$;

-- Account confirmation remains in Node's bounded trusted Auth cache. Owner
-- confirmation is already included by soundspin_room_enabled.
create function public.soundspin_access_status(p_accounts uuid[] default '{}',p_rooms text[] default '{}')
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare accounts jsonb; rooms jsonb;
begin
  if coalesce(cardinality(p_accounts),0)>100 or coalesce(cardinality(p_rooms),0)>100
    or exists(select 1 from unnest(p_rooms) slug where slug is null or slug !~ '^[a-z0-9-]{3,48}$') then
    raise exception 'Invalid access status request.' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(user_id),'[]'::jsonb) into accounts
    from (select distinct user_id from unnest(coalesce(p_accounts,'{}'::uuid[])) user_id) requested
    where user_id is not null and not exists(select 1 from public.soundspin_account_restrictions r where r.user_id=requested.user_id and r.state<>'active');
  select coalesce(jsonb_agg(slug),'[]'::jsonb) into rooms
    from (select distinct slug from unnest(coalesce(p_rooms,'{}'::text[])) slug) requested
    where public.soundspin_room_enabled(slug);
  return jsonb_build_object('accounts',accounts,'rooms',rooms);
end;
$$;

revoke all on function public.soundspin_room_access(text,uuid,uuid[]),public.soundspin_access_status(uuid[],text[]) from public,anon,authenticated;
grant execute on function public.soundspin_room_access(text,uuid,uuid[]),public.soundspin_access_status(uuid[],text[]) to service_role;

-- Directory checks return only supplied visible room IDs, never moderation logs.
create function public.soundspin_directory_visibility(p_actor uuid,p_rooms text[])
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare visible jsonb;
begin
  if p_actor is null or coalesce(cardinality(p_rooms),0)>100 or exists(
    select 1 from unnest(p_rooms) slug where slug is null or slug !~ '^[a-z0-9-]{3,48}$') then
    raise exception 'Invalid directory visibility request.' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(room.slug),'[]'::jsonb) into visible
    from public.soundspin_rooms room
    where room.slug=any(coalesce(p_rooms,'{}'::text[])) and public.soundspin_room_enabled(room.slug)
      and (room.access_mode='public' or room.owner_id=p_actor
        or exists(select 1 from public.soundspin_room_members where room_slug=room.slug and user_id=p_actor)
        or (room.access_mode='unlisted' and exists(select 1 from public.soundspin_room_favorites where room_slug=room.slug and user_id=p_actor)))
      and not exists(select 1 from public.soundspin_room_moderation moderation,
        lateral jsonb_array_elements(coalesce(moderation.data->'restrictions','[]'::jsonb)) restriction
        where moderation.room_slug=room.slug and restriction->>'userId'=p_actor::text
          and restriction->>'kind'='room-ban' and restriction->'revokedAt'='null'::jsonb
          and (restriction->'expiresAt'='null'::jsonb or (restriction->>'expiresAt')::numeric>extract(epoch from statement_timestamp())*1000));
  return visible;
end;
$$;

-- One coherent snapshot on a cold load. The process still owns and bounds its
-- live room cache; this returns the same document, staff roles and moderation.
create function public.soundspin_load_room(p_room_slug text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare snapshot jsonb;
begin
  if p_room_slug is null or p_room_slug !~ '^[a-z0-9-]{3,48}$' then
    raise exception 'Invalid room load request.' using errcode='22023';
  end if;
  select jsonb_build_object('state',room.state,'name',room.name,'owner_id',room.owner_id,'is_public',room.is_public,
    'password_hash',room.password_hash,'settings',room.settings,'access_mode',room.access_mode,'policy_revision',room.policy_revision,
    'room_roles',coalesce((select jsonb_agg(jsonb_build_object('user_id',user_id,'role',role))
      from public.soundspin_room_members where room_slug=room.slug and role in ('moderator','dj')),'[]'::jsonb),
    'moderation',coalesce((select data from public.soundspin_room_moderation where room_slug=room.slug),'{}'::jsonb))
    into snapshot from public.soundspin_rooms room where slug=p_room_slug;
  return snapshot;
end;
$$;
revoke all on function public.soundspin_directory_visibility(uuid,text[]),public.soundspin_load_room(text) from public,anon,authenticated;
grant execute on function public.soundspin_directory_visibility(uuid,text[]),public.soundspin_load_room(text) to service_role;
