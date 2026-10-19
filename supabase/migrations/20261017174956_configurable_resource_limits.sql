-- Resource entitlements are server-owned configuration. They are never read
-- from user-editable claims. No subscription or billing state is introduced.
create function private.soundspin_resource_json_valid(v jsonb, kind text) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare ceilings jsonb; item record; nested jsonb;
begin
 if jsonb_typeof(v) is distinct from 'object' then return false; end if;
 ceilings:=case kind
 when 'global' then '{"socketsTotal":1000,"socketsPerRoom":300,"queueTracksPerRoom":5000,"roomWritesPerMinute":1200,"uploadsInFlight":16,"roomUploadObjects":10000,"roomUploadBytes":10737418240,"chatRetentionDays":3650,"chatRetentionMessages":100000}'::jsonb
 when 'upload' then '{"fileBytes":6291456,"storedBytes":10737418240,"storedObjects":10000,"hourlyBytes":1073741824,"hourlyObjects":1000,"pendingBytes":104857600,"pendingObjects":50}'::jsonb
 when 'plan' then '{"ownedRooms":100,"roomCreatesPerHour":100,"libraryPicks":5000,"librarySets":100,"librarySetTracks":100,"queueTracksPerRoom":1000,"queueTracksTotal":5000,"socketsPerAccount":20,"roomWritesPerMinute":600,"roomWriteBurst":100,"roomWritesInFlight":8,"importTracks":100,"importsPerMinute":20,"importsInFlight":4,"favoriteRooms":1000,"memberships":1000,"uploadsInFlight":10}'::jsonb
 else null end;
 if ceilings is null then return false; end if;
 if kind='plan' then
  nested:=v->'uploads';
  if jsonb_typeof(nested) is distinct from 'object' or (select count(*) from jsonb_object_keys(nested))<>3 then return false;end if;
  for item in select unnest(array['avatar','feedback','chat']) as key loop
   if not private.soundspin_resource_json_valid(nested->item.key,'upload') then return false;end if;
  end loop;
  if (nested#>>'{avatar,fileBytes}')::numeric>5242880 or (nested#>>'{feedback,fileBytes}')::numeric>5242880 then return false;end if;
  v:=v-'uploads';
 end if;
 if (select count(*) from jsonb_object_keys(v))<>(select count(*) from jsonb_object_keys(ceilings)) then return false;end if;
 for item in select key,value from jsonb_each(ceilings) loop
  if jsonb_typeof(v->item.key) is distinct from 'number' then return false;end if;
  if (v->>item.key)::numeric<1 or (v->>item.key)::numeric>(item.value#>>'{}')::numeric or trunc((v->>item.key)::numeric)<>(v->>item.key)::numeric then return false;end if;
 end loop;
 return true;
end $$;
revoke all on function private.soundspin_resource_json_valid(jsonb,text) from public,anon,authenticated;
grant execute on function private.soundspin_resource_json_valid(jsonb,text) to service_role;

create table public.soundspin_resource_config (
 singleton boolean primary key default true check(singleton),
 limits jsonb not null check(private.soundspin_resource_json_valid(limits,'global')),
 updated_at timestamptz not null default now()
);
insert into public.soundspin_resource_config(limits) values('{"socketsTotal":100,"socketsPerRoom":25,"queueTracksPerRoom":500,"roomWritesPerMinute":120,"uploadsInFlight":4,"roomUploadObjects":1000,"roomUploadBytes":1073741824,"chatRetentionDays":90,"chatRetentionMessages":10000}');
create table public.soundspin_resource_plans (
 id text primary key check(id~'^[a-z][a-z0-9_-]{0,31}$'),
 limits jsonb not null check(private.soundspin_resource_json_valid(limits,'plan')),
 updated_at timestamptz not null default now()
);
insert into public.soundspin_resource_plans(id,limits) values('free','{"ownedRooms":10,"roomCreatesPerHour":3,"libraryPicks":500,"librarySets":30,"librarySetTracks":50,"queueTracksPerRoom":100,"queueTracksTotal":500,"socketsPerAccount":5,"roomWritesPerMinute":60,"roomWriteBurst":10,"roomWritesInFlight":2,"importTracks":50,"importsPerMinute":2,"importsInFlight":1,"favoriteRooms":100,"memberships":100,"uploadsInFlight":2,"uploads":{"avatar":{"fileBytes":5242880,"storedBytes":20971520,"storedObjects":4,"hourlyBytes":20971520,"hourlyObjects":4,"pendingBytes":10485760,"pendingObjects":2},"feedback":{"fileBytes":5242880,"storedBytes":104857600,"storedObjects":25,"hourlyBytes":26214400,"hourlyObjects":5,"pendingBytes":26214400,"pendingObjects":5},"chat":{"fileBytes":6291456,"storedBytes":209715200,"storedObjects":100,"hourlyBytes":52428800,"hourlyObjects":20,"pendingBytes":31457280,"pendingObjects":5}}}');
-- Preserve restricted operator customizations from the preceding upload table.
update public.soundspin_resource_plans set limits=jsonb_set(limits,'{uploads}',(
 select jsonb_object_agg(purpose,jsonb_build_object('fileBytes',case when purpose='chat' then 6291456 else 5242880 end,'storedBytes',total_bytes,'storedObjects',total_objects,'hourlyBytes',hourly_bytes,'hourlyObjects',hourly_objects,'pendingBytes',pending_bytes,'pendingObjects',pending_objects)) from public.soundspin_upload_limits
)) where id='free';
create table public.soundspin_account_plans (
 user_id uuid primary key references auth.users(id) on delete cascade,
 plan_id text not null references public.soundspin_resource_plans(id),
 updated_at timestamptz not null default now()
);
alter table public.soundspin_resource_config enable row level security;
alter table public.soundspin_resource_plans enable row level security;
alter table public.soundspin_account_plans enable row level security;
revoke all on public.soundspin_resource_config,public.soundspin_resource_plans,public.soundspin_account_plans from public,anon,authenticated;
grant select,insert,update,delete on public.soundspin_resource_config,public.soundspin_resource_plans,public.soundspin_account_plans to service_role;

create function public.soundspin_resource_policy(p_actor uuid default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare plan_name text; plan_limits jsonb; global_limits jsonb;
begin
 select coalesce((select plan_id from public.soundspin_account_plans where user_id=p_actor),'free') into plan_name;
 select limits into strict plan_limits from public.soundspin_resource_plans where id=plan_name;
 select limits into strict global_limits from public.soundspin_resource_config where singleton;
 return jsonb_build_object('plan',plan_name,'limits',plan_limits,'global',global_limits);
end $$;
revoke all on function public.soundspin_resource_policy(uuid) from public,anon,authenticated;
grant execute on function public.soundspin_resource_policy(uuid) to service_role;

create or replace function private.soundspin_room_creation_budget() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('soundspin-room-owner:'||new.owner_id::text,0));
 if not public.soundspin_account_enabled(new.owner_id) then raise exception 'Account unavailable';end if;
 if (select count(*) from public.soundspin_rooms where owner_id=new.owner_id)>=(public.soundspin_resource_policy(new.owner_id)#>>'{limits,ownedRooms}')::int then raise exception 'Room ownership limit reached';end if;
 return new;
end $$;

-- Lowering a plan never trims saved work. Existing above-limit collections can
-- be read, reordered or reduced, but cannot grow until within their new budget.
create or replace function private.soundspin_room_queue_budget() returns trigger
language plpgsql security invoker set search_path='' as $$
declare queues jsonb; old_queues jsonb; actor record; previous_count integer; new_count integer; other_count bigint; room_count bigint; old_room_count bigint; policy jsonb;
begin
 if tg_op='UPDATE' and new.state->'djQueues' is not distinct from old.state->'djQueues' then return new;end if;
 queues:=coalesce(new.state->'djQueues','{}'::jsonb);
 old_queues:=case when tg_op='UPDATE' then coalesce(old.state->'djQueues','{}'::jsonb) else '{}'::jsonb end;
 if jsonb_typeof(queues)<>'object' then raise exception 'Invalid room queues';end if;
 if exists(select 1 from jsonb_each(queues) e where jsonb_typeof(e.value)<>'array' or e.key!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then raise exception 'Invalid room queues';end if;
 select coalesce(sum(jsonb_array_length(e.value)),0) into room_count from jsonb_each(queues) e;
 select coalesce(sum(jsonb_array_length(e.value)),0) into old_room_count from jsonb_each(old_queues) e;
 if room_count>(public.soundspin_resource_policy(new.owner_id)#>>'{global,queueTracksPerRoom}')::int and room_count>old_room_count then raise exception 'Room waiting queue limit reached';end if;
 for actor in select user_id from (select key::uuid user_id from jsonb_each(queues) union select user_id from private.soundspin_queue_usage where room_slug=new.slug) actors order by user_id loop
  perform pg_advisory_xact_lock(hashtextextended('soundspin-queue-user:'||actor.user_id::text,0));
  policy:=public.soundspin_resource_policy(actor.user_id);
  select coalesce(sum(track_count),0) into other_count from private.soundspin_queue_usage where user_id=actor.user_id and room_slug<>new.slug;
  select track_count into previous_count from private.soundspin_queue_usage where room_slug=new.slug and user_id=actor.user_id;
  new_count:=coalesce(jsonb_array_length(queues->actor.user_id::text),0);
  if new_count>coalesce(previous_count,0) and (new_count>(policy#>>'{limits,queueTracksPerRoom}')::int or other_count+new_count>(policy#>>'{limits,queueTracksTotal}')::int) then raise exception 'Account waiting queue limit reached';end if;
  if new_count=0 then delete from private.soundspin_queue_usage where room_slug=new.slug and user_id=actor.user_id;
  else insert into private.soundspin_queue_usage values(new.slug,actor.user_id,new_count) on conflict(room_slug,user_id) do update set track_count=excluded.track_count;end if;
 end loop;
 return new;
end $$;

alter table public.soundspin_private_libraries drop constraint library_limits,drop constraint library_set_track_limits;
alter table public.soundspin_private_libraries add constraint library_set_tracks_shape check(not jsonb_path_exists(data,'$.sets[*] ? (!exists(@.tracks) || @.tracks.type() != "array" || @.tracks.size() < 1)'));
create function private.soundspin_library_budget() returns trigger
language plpgsql security invoker set search_path='' as $$
declare lim jsonb; prev jsonb; item jsonb; old_size int;
begin
 perform pg_advisory_xact_lock(hashtextextended('library:'||new.user_id::text,0));
 lim:=public.soundspin_resource_policy(new.user_id)->'limits';
 prev:=case when tg_op='UPDATE' then old.data else '{"picks":[],"sets":[]}'::jsonb end;
 if jsonb_array_length(new.data->'picks')>(lim->>'libraryPicks')::int and jsonb_array_length(new.data->'picks')>jsonb_array_length(prev->'picks') then raise exception 'Saved picks limit reached';end if;
 if jsonb_array_length(new.data->'sets')>(lim->>'librarySets')::int and jsonb_array_length(new.data->'sets')>jsonb_array_length(prev->'sets') then raise exception 'Saved sets limit reached';end if;
 for item in select value from jsonb_array_elements(new.data->'sets') loop
  select coalesce(max(jsonb_array_length(value->'tracks')),0) into old_size from jsonb_array_elements(prev->'sets') where value->>'id'=item->>'id';
  if jsonb_array_length(item->'tracks')>(lim->>'librarySetTracks')::int and jsonb_array_length(item->'tracks')>old_size then raise exception 'Set tracks limit reached';end if;
 end loop;
 return new;
end $$;
revoke all on function private.soundspin_library_budget() from public,anon,authenticated;
grant execute on function private.soundspin_library_budget() to service_role;
create trigger soundspin_library_budget before insert or update of data on public.soundspin_private_libraries for each row execute function private.soundspin_library_budget();

create function private.soundspin_saved_room_budget() returns trigger
language plpgsql security invoker set search_path='' as $$
declare lim jsonb; used bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended('saved-rooms:'||new.user_id::text,0));
 lim:=public.soundspin_resource_policy(new.user_id)->'limits';
 if tg_table_name='soundspin_room_favorites' then
  if exists(select 1 from public.soundspin_room_favorites where room_slug=new.room_slug and user_id=new.user_id) then return new;end if;
  select count(*) into used from public.soundspin_room_favorites where user_id=new.user_id;
  if used>=(lim->>'favoriteRooms')::int then raise exception 'Favorite room limit reached';end if;
 else
  if new.role='owner' or exists(select 1 from public.soundspin_room_members where room_slug=new.room_slug and user_id=new.user_id) then return new;end if;
  select count(*) into used from public.soundspin_room_members where user_id=new.user_id and role<>'owner';
  if used>=(lim->>'memberships')::int then raise exception 'Room memberships limit reached';end if;
 end if;
 return new;
end $$;
revoke all on function private.soundspin_saved_room_budget() from public,anon,authenticated;
grant execute on function private.soundspin_saved_room_budget() to service_role;
create trigger soundspin_saved_favorites_budget before insert on public.soundspin_room_favorites for each row execute function private.soundspin_saved_room_budget();
create trigger soundspin_saved_members_budget before insert on public.soundspin_room_members for each row execute function private.soundspin_saved_room_budget();

create or replace function public.soundspin_admit_room(p_slug text,p_user_id uuid,p_password_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.soundspin_rooms%rowtype; member_role text;
begin
 select * into r from public.soundspin_rooms where slug=p_slug for update;
 if not found or not public.soundspin_account_enabled(p_user_id) or not public.soundspin_room_enabled(p_slug) then raise exception 'Room admission denied';end if;
 if r.password_hash is distinct from p_password_hash then raise exception 'Room policy changed';end if;
 if public.soundspin_room_has_ban(p_slug,p_user_id) then raise exception 'Room admission denied';end if;
 select role into member_role from public.soundspin_room_members where room_slug=p_slug and user_id=p_user_id;
 if r.owner_id=p_user_id then member_role:='owner';end if;
 if r.access_mode='members' and member_role is null then raise exception 'Room admission denied';end if;
 -- Casual public/unlisted participation does not create permanent membership.
 return jsonb_build_object('role',coalesce(member_role,'member'),'policyRevision',r.policy_revision);
end $$;

-- Plan-aware reservations retain durable admission and exact stored bytes.
create or replace function public.soundspin_reserve_upload(p_id uuid,p_actor uuid,p_purpose text,p_bucket text,p_path text,p_bytes bigint,p_room text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare lim jsonb; policy jsonb; old public.soundspin_managed_uploads; v_count bigint; v_bytes bigint;
begin
 policy:=public.soundspin_resource_policy(p_actor);
 lim:=policy#>array['limits','uploads',p_purpose];
 if lim is null then raise exception 'Invalid upload reservation.';end if;
 if not public.soundspin_account_enabled(p_actor) or p_bytes<1 or p_bytes>(lim->>'fileBytes')::bigint
  or p_bucket<>(case p_purpose when 'chat' then 'chat-media' when 'avatar' then 'profile-avatars' when 'feedback' then 'feedback-screenshots' else '' end)
  or p_path not like p_actor::text||'/%' or char_length(p_path)>200 or p_path like '%..%' then raise exception 'Invalid upload reservation.'; end if;
 if p_purpose='chat' and (p_room is null or not public.soundspin_room_enabled(p_room) or not exists(select 1 from public.soundspin_rooms where slug=p_room)) then raise exception 'Invalid upload room.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('upload-actor:'||p_actor::text,0));
 if p_room is not null then perform pg_advisory_xact_lock(hashtextextended('upload-room:'||p_room,0)); end if;
 select * into old from public.soundspin_managed_uploads where id=p_id;
 if found then
  if old.actor_id<>p_actor or old.purpose<>p_purpose or old.size_bytes<>p_bytes or old.storage_path<>p_path then raise exception 'Upload operation ID belongs to different content.'; end if;
  return to_jsonb(old);
 end if;
 select count(*),coalesce(sum(size_bytes),0) into v_count,v_bytes from public.soundspin_managed_uploads where actor_id=p_actor and purpose=p_purpose and state<>'deleted';
 if v_count>=(lim->>'storedObjects')::bigint or v_bytes+p_bytes>(lim->>'storedBytes')::bigint then raise exception 'Too many stored images. Remove images before uploading more.'; end if;
 select count(*),coalesce(sum(size_bytes),0) into v_count,v_bytes from public.soundspin_managed_uploads where actor_id=p_actor and purpose=p_purpose and created_at>now()-interval '1 hour';
 if v_count>=(lim->>'hourlyObjects')::bigint or v_bytes+p_bytes>(lim->>'hourlyBytes')::bigint then raise exception 'Too many uploads. Try again in an hour.'; end if;
 select count(*),coalesce(sum(size_bytes),0) into v_count,v_bytes from public.soundspin_managed_uploads where actor_id=p_actor and purpose=p_purpose and state in ('reserved','pending');
 if v_count>=(lim->>'pendingObjects')::bigint or v_bytes+p_bytes>(lim->>'pendingBytes')::bigint then raise exception 'Too many unfinished uploads. Finish or remove them first.'; end if;
 select count(*) into v_count from public.soundspin_managed_uploads where actor_id=p_actor and state='reserved';
 if v_count>=(policy#>>'{limits,uploadsInFlight}')::int then raise exception 'Too many uploads in progress. Try again shortly.'; end if;
 if p_room is not null then
  select count(*),coalesce(sum(size_bytes),0) into v_count,v_bytes from public.soundspin_managed_uploads where room_slug=p_room and state<>'deleted';
  if v_count>=(policy#>>'{global,roomUploadObjects}')::int or v_bytes+p_bytes>(policy#>>'{global,roomUploadBytes}')::bigint then raise exception 'Too many stored images in this room.'; end if;
 end if;
 insert into public.soundspin_managed_uploads(id,actor_id,purpose,bucket_id,storage_path,size_bytes,room_slug)values(p_id,p_actor,p_purpose,p_bucket,p_path,p_bytes,p_room) returning * into old;
 return to_jsonb(old);
end; $$;

-- Spotify is a platform decision, independent of the room owner's permissions.
create function private.soundspin_room_spotify_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
declare previous boolean; next_value boolean; next_state boolean;
begin
 previous:=case when tg_op='UPDATE' then coalesce((old.settings->>'spotifyEnabled')::boolean,false) else false end;
 next_value:=coalesce((new.settings->>'spotifyEnabled')::boolean,false);
 next_state:=coalesce((new.state#>>'{settings,spotifyEnabled}')::boolean,false);
 if next_value is distinct from next_state then raise exception 'Spotify room policy is inconsistent';end if;
 if next_value is distinct from previous and current_setting('soundspin.spotify_admin',true) is distinct from new.slug then raise exception 'Administrator access required to change Spotify';end if;
 return new;
end $$;
revoke all on function private.soundspin_room_spotify_guard() from public,anon,authenticated;
grant execute on function private.soundspin_room_spotify_guard() to service_role;
create trigger soundspin_room_spotify_guard before insert or update of settings,state on public.soundspin_rooms for each row execute function private.soundspin_room_spotify_guard();

create function public.soundspin_set_room_spotify(p_actor uuid,p_room text,p_enabled boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if p_enabled is null or not public.soundspin_account_enabled(p_actor) or not exists(select 1 from public.soundspin_profiles where user_id=p_actor and is_app_admin) then raise exception 'Administrator access required';end if;
 perform 1 from public.soundspin_rooms where slug=p_room for update;
 if not found then raise exception 'Room not found';end if;
 perform set_config('soundspin.spotify_admin',p_room,true);
 update public.soundspin_rooms set settings=jsonb_set(settings,'{spotifyEnabled}',to_jsonb(p_enabled)),
 state=jsonb_set(state,'{settings}',coalesce(state->'settings','{}'::jsonb)||jsonb_build_object('spotifyEnabled',p_enabled)),
 policy_revision=policy_revision+1,updated_at=now() where slug=p_room
 returning jsonb_build_object('settings',settings,'policyRevision',policy_revision) into result;
 perform set_config('soundspin.spotify_admin','',true);
 return result;
end $$;
revoke all on function public.soundspin_set_room_spotify(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.soundspin_set_room_spotify(uuid,text,boolean) to service_role;

-- Bounded round-robin retention. Installing this migration removes no messages.
-- The worker must be invoked by the app after release policy review. At most 20
-- rooms and p_limit messages are processed in one call, under the room chat lock.
create table private.soundspin_chat_retention_cursor(singleton boolean primary key default true check(singleton),after_room text not null default '');
insert into private.soundspin_chat_retention_cursor default values;
revoke all on private.soundspin_chat_retention_cursor from public,anon,authenticated;
grant select,update on private.soundspin_chat_retention_cursor to service_role;
create index soundspin_messages_owned_media_reference_idx on public.soundspin_messages(storage_path,user_id,created_at desc,id desc)
 where storage_path is not null and removed_at is null;
create index soundspin_messages_room_reply_cleanup_idx on public.soundspin_messages(room_slug,reply_to_id,created_at,id)
 where reply_to_id is not null;
create function public.soundspin_prune_chat_history(p_limit integer default 500) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare lim jsonb; after_slug text; room_id text; threshold_at timestamptz; threshold_id uuid; kept_message uuid; item record;
 removed integer:=0; updated_replies integer:=0; rooms integer:=0; touched integer; ids uuid[];
begin
 if p_limit not between 1 and 1000 then raise exception 'Invalid chat cleanup batch';end if;
 lim:=public.soundspin_resource_policy()->'global';
 select after_room into after_slug from private.soundspin_chat_retention_cursor where singleton for update;
 if not exists(select 1 from public.soundspin_rooms where slug>after_slug) then after_slug:='';end if;
 for room_id in select slug from public.soundspin_rooms where slug>after_slug order by slug limit 20 loop
  perform pg_advisory_xact_lock(hashtextextended('chat:'||room_id,0));
  threshold_at:=null;threshold_id:=null;
  select created_at,id into threshold_at,threshold_id from public.soundspin_messages where room_slug=room_id
   order by created_at desc,id desc offset ((lim->>'chatRetentionMessages')::int-1) limit 1;
  select array_agg(id) into ids from (
   select id from public.soundspin_messages where room_slug=room_id and
    (created_at<now()-make_interval(days=>(lim->>'chatRetentionDays')::int) or (created_at,id)<(threshold_at,threshold_id))
    order by created_at,id limit (p_limit-removed) for update
  ) candidates;
  -- Clearing incoming replies through the FK cascade could update an unbounded
  -- number of rows for one popular message. Do that existing SET NULL work in
  -- an indexed batch first, and leave any still-referenced parent for next time.
  with targets as (
   select id from public.soundspin_messages where room_slug=room_id and reply_to_id=any(ids)
    order by reply_to_id,created_at,id limit (p_limit-updated_replies) for update
  ), cleared as (
   update public.soundspin_messages m set reply_to_id=null from targets t where m.id=t.id returning 1
  ) select count(*) into touched from cleared;
  updated_replies:=updated_replies+touched;
  select array_agg(m.id) into ids from public.soundspin_messages m where m.id=any(ids)
   and not exists(select 1 from public.soundspin_messages replies where replies.reply_to_id=m.id);
  for item in select distinct user_id,storage_path from public.soundspin_messages where id=any(ids) and storage_path is not null loop
   -- Forged legacy cross-account references cannot delete another actor's object.
   if item.user_id is not null and split_part(item.storage_path,'/',1)=item.user_id::text then
    -- A legacy object can be shared by several messages from its real owner.
    -- Preserve a retained reference and move its registry FK before the parent
    -- delete. Foreign-account references cannot keep another actor's bytes.
    select id into kept_message from public.soundspin_messages where storage_path=item.storage_path and user_id=item.user_id
     and removed_at is null and not(id=any(ids)) order by created_at desc,id desc limit 1;
    if kept_message is not null then
     update public.soundspin_chat_uploads set message_id=kept_message
      where storage_path=item.storage_path and user_id=item.user_id and message_id=any(ids);
    else
     perform public.soundspin_queue_upload('chat-media',item.storage_path,item.user_id,room_id,300);
    end if;
   end if;
  end loop;
  delete from public.soundspin_chat_uploads where message_id=any(ids);
  delete from public.soundspin_messages where id=any(ids);
  get diagnostics touched=row_count;removed:=removed+touched;rooms:=rooms+1;
  -- Advance even at the message budget so a large/hot room cannot starve other
  -- rooms. Unfinished rooms are revisited after the durable cursor wraps.
  update private.soundspin_chat_retention_cursor set after_room=room_id where singleton;
  if removed>=p_limit or updated_replies>=p_limit then exit;end if;
 end loop;
 return jsonb_build_object('removed',removed,'updatedReplies',updated_replies,'rooms',rooms,
  'hasMoreRooms',exists(select 1 from public.soundspin_rooms where slug>(select after_room from private.soundspin_chat_retention_cursor where singleton)));
end $$;
revoke all on function public.soundspin_prune_chat_history(integer) from public,anon,authenticated;
grant execute on function public.soundspin_prune_chat_history(integer) to service_role;

alter function public.soundspin_release_ready() rename to soundspin_release_ready_resource_base;
create function public.soundspin_release_ready() returns boolean language sql security invoker set search_path='' as $$
 select public.soundspin_release_ready_resource_base()
  and to_regclass('public.soundspin_resource_config') is not null
  and to_regclass('public.soundspin_resource_plans') is not null
  and to_regclass('public.soundspin_account_plans') is not null
  and to_regprocedure('public.soundspin_prune_chat_history(integer)') is not null
  and to_regprocedure('public.soundspin_set_room_spotify(uuid,text,boolean)') is not null
  and not has_function_privilege('authenticated','public.soundspin_resource_policy(uuid)','EXECUTE')
  and not has_table_privilege('authenticated','public.soundspin_account_plans','INSERT,UPDATE,DELETE');
$$;
revoke all on function public.soundspin_release_ready() from public,anon,authenticated;
grant execute on function public.soundspin_release_ready() to service_role;
