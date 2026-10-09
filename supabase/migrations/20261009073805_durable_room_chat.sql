-- All chat mutations use one durable receipt path. Service credentials do not
-- replace the server's fresh room admission and participation checks.
alter table public.soundspin_messages add column removed_at timestamptz;
grant update on public.soundspin_messages to service_role;
grant delete on public.soundspin_poll_votes to service_role;

create table public.soundspin_chat_receipts (
  operation_id text primary key,
  room_slug text not null references public.soundspin_rooms(slug) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  fingerprint text not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
create table public.soundspin_chat_cooldowns (
  room_slug text not null references public.soundspin_rooms(slug) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_message_at timestamptz not null,
  primary key (room_slug,user_id)
);
create table public.soundspin_chat_removals (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  room_slug text not null references public.soundspin_rooms(slug) on delete cascade,
  actor_id uuid not null references auth.users(id),
  target_user_id uuid references auth.users(id),
  message_id uuid not null,
  reason text not null default '' check(char_length(reason)<=500),
  created_at timestamptz not null default now()
);
create table public.soundspin_chat_tombstones (
  message_id uuid primary key,
  room_slug text not null references public.soundspin_rooms(slug) on delete cascade,
  removed_at timestamptz not null default now()
);
create table public.soundspin_chat_uploads (
  storage_path text primary key,
  room_slug text not null references public.soundspin_rooms(slug) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  mime_type text not null,
  size_bytes integer not null check(size_bytes between 1 and 6291456),
  message_id uuid references public.soundspin_messages(id),
  removed_at timestamptz,
  expires_at timestamptz not null default (now()+interval '15 minutes')
);
alter table public.soundspin_chat_receipts enable row level security;
alter table public.soundspin_chat_cooldowns enable row level security;
alter table public.soundspin_chat_removals enable row level security;
alter table public.soundspin_chat_uploads enable row level security;
alter table public.soundspin_chat_tombstones enable row level security;
revoke all on public.soundspin_chat_receipts,public.soundspin_chat_cooldowns,public.soundspin_chat_removals,public.soundspin_chat_uploads,public.soundspin_chat_tombstones from public,anon,authenticated;
grant all on public.soundspin_chat_receipts,public.soundspin_chat_cooldowns,public.soundspin_chat_removals,public.soundspin_chat_uploads,public.soundspin_chat_tombstones to service_role;
create index soundspin_chat_removals_room_time_idx on public.soundspin_chat_removals(room_slug,created_at desc);
create index soundspin_chat_receipts_room_idx on public.soundspin_chat_receipts(room_slug);
create index soundspin_chat_receipts_user_idx on public.soundspin_chat_receipts(user_id);
create index soundspin_chat_cooldowns_user_idx on public.soundspin_chat_cooldowns(user_id);
create index soundspin_chat_removals_actor_idx on public.soundspin_chat_removals(actor_id);
create index soundspin_chat_removals_target_idx on public.soundspin_chat_removals(target_user_id);
create index soundspin_chat_tombstones_room_idx on public.soundspin_chat_tombstones(room_slug);
create index soundspin_chat_uploads_room_idx on public.soundspin_chat_uploads(room_slug);
create index soundspin_chat_uploads_user_idx on public.soundspin_chat_uploads(user_id);
create index soundspin_chat_uploads_message_idx on public.soundspin_chat_uploads(message_id);
create index soundspin_chat_uploads_pending_expiry_idx on public.soundspin_chat_uploads(expires_at) where message_id is null and removed_at is null;
create index soundspin_chat_uploads_removed_time_idx on public.soundspin_chat_uploads(removed_at) where removed_at is not null;

drop policy if exists "users can upload their own chat media" on storage.objects;
drop policy if exists "users can delete their own chat media" on storage.objects;
drop policy if exists "users can view their own chat media metadata" on storage.objects;

create function public.soundspin_chat_command(p_kind text,p_room text,p_user uuid,p_id text,p_fingerprint text,p_payload jsonb,p_slow_seconds integer default 0)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare receipt public.soundspin_chat_receipts; target public.soundspin_messages;
  result jsonb; v_message_id uuid; last_at timestamptz; options text[]; accepted_vote public.soundspin_poll_votes; removal public.soundspin_chat_tombstones;
begin
  if p_kind not in ('message','reaction','poll','remove') or char_length(p_id)>100 or char_length(p_fingerprint)<>64 or p_slow_seconds not between 0 and 60 then raise exception 'Invalid chat command.'; end if;
  -- Orders all room chat commands, including removal racing with a send/retry.
  perform pg_advisory_xact_lock(hashtextextended('chat:'||p_room,0));
  select * into receipt from public.soundspin_chat_receipts where operation_id=p_id;
  if found then
    if receipt.room_slug<>p_room or receipt.user_id<>p_user or receipt.fingerprint<>p_fingerprint then raise exception 'This operation ID belongs to different content, account, or room.'; end if;
    return jsonb_build_object('fresh',false,'result',receipt.result);
  end if;
  v_message_id:=case when p_kind='message' then (p_payload->>'id')::uuid else (p_payload->>'messageId')::uuid end;
  select * into target from public.soundspin_messages where id=v_message_id for update;
  select * into removal from public.soundspin_chat_tombstones where message_id=v_message_id;
  if removal.message_id is not null and removal.room_slug<>p_room then raise exception 'This message ID is unavailable.'; end if;
  if p_kind='message' then
    if target.id is not null then
      if target.room_slug<>p_room or target.user_id<>p_user or target.removed_at is not null then raise exception 'This message ID is unavailable.'; end if;
      result:=jsonb_build_object('id',v_message_id);
      insert into public.soundspin_chat_receipts values(p_id,p_room,p_user,p_fingerprint,result,now());
      return jsonb_build_object('fresh',false,'result',result);
    end if;
    select last_message_at into last_at from public.soundspin_chat_cooldowns where room_slug=p_room and user_id=p_user;
    if removal.message_id is not null then p_payload:=p_payload||jsonb_build_object('content','Message removed','type','text','mediaUrl',null,'storagePath',null,'mentions','[]'::jsonb,'poll',null); end if;
    if removal.message_id is null and p_slow_seconds>0 and last_at+make_interval(secs=>p_slow_seconds)>now() then raise exception 'Slow mode is active. Wait before sending another message.'; end if;
    if p_payload->>'storagePath' is not null then
      perform 1 from public.soundspin_chat_uploads where storage_path=p_payload->>'storagePath' and room_slug=p_room and user_id=p_user and removed_at is null and message_id is null and expires_at>now() for update;
      if not found then raise exception 'This uploaded image is unavailable.'; end if;
    end if;
    options:=case when p_payload->'poll' is null or p_payload->'poll'='null'::jsonb then null else array(select jsonb_array_elements_text(p_payload->'poll'->'options')) end;
    insert into public.soundspin_messages(id,room_slug,user_id,user_name,avatar_seed,content,message_type,media_url,storage_path,mentions,reply_to_id,created_at,poll_options)
    values(v_message_id,p_room,p_user,p_payload->'user'->>'name',p_payload->'user'->>'avatarSeed',p_payload->>'content',p_payload->>'type',p_payload->>'mediaUrl',p_payload->>'storagePath',coalesce(p_payload->'mentions','[]'::jsonb),(p_payload->'replyTo'->>'id')::uuid,(p_payload->>'createdAt')::timestamptz,options);
    update public.soundspin_chat_uploads set message_id=v_message_id where storage_path=p_payload->>'storagePath';
    if removal.message_id is null then insert into public.soundspin_chat_cooldowns values(p_room,p_user,now()) on conflict(room_slug,user_id)do update set last_message_at=excluded.last_message_at;
    else update public.soundspin_messages set removed_at=removal.removed_at where id=v_message_id;end if;
    result:=jsonb_build_object('id',v_message_id);
  else
    if p_kind<>'remove' and target.id is null or target.id is not null and target.room_slug<>p_room then raise exception 'This message is unavailable.'; end if;
    if p_kind<>'remove' and target.removed_at is not null then raise exception 'This message was removed.'; end if;
    if p_kind='reaction' then
      if p_payload->>'action'='add' then insert into public.soundspin_message_reactions(message_id,user_id,emoji) values(v_message_id,p_user,p_payload->>'emoji') on conflict do nothing;
      else delete from public.soundspin_message_reactions r where r.message_id=v_message_id and r.user_id=p_user and r.emoji=p_payload->>'emoji'; end if;
      result:=p_payload;
    elsif p_kind='poll' then
      if target.poll_options is null or (p_payload->>'optionIndex')::int not between 0 and cardinality(target.poll_options)-1 then raise exception 'This poll is unavailable.'; end if;
      insert into public.soundspin_poll_votes(message_id,room_slug,user_id,option_index) values(v_message_id,p_room,p_user,(p_payload->>'optionIndex')::smallint)
      on conflict(message_id,user_id)do update set option_index=excluded.option_index returning * into accepted_vote;
      result:=jsonb_build_object('messageId',v_message_id,'userId',p_user,'optionIndex',accepted_vote.option_index,'revision',accepted_vote.revision);
    else
      insert into public.soundspin_chat_tombstones(message_id,room_slug)values(v_message_id,p_room)on conflict(message_id)do nothing returning * into removal;
      if removal.message_id is null then select * into removal from public.soundspin_chat_tombstones where message_id=v_message_id;end if;
      if removal.room_slug<>p_room then raise exception 'This message ID is unavailable.';end if;
      update public.soundspin_chat_uploads set removed_at=coalesce(removed_at,now()) where storage_path=target.storage_path;
      update public.soundspin_messages set content='Message removed',message_type='text',media_url=null,storage_path=null,mentions='[]'::jsonb,poll_options=null,removed_at=coalesce(removed_at,now()) where id=v_message_id returning * into target;
      delete from public.soundspin_message_reactions r where r.message_id=v_message_id;
      delete from public.soundspin_poll_votes v where v.message_id=v_message_id;
      insert into public.soundspin_chat_removals(operation_id,room_slug,actor_id,target_user_id,message_id,reason) values(substring(p_id from 8)::uuid,p_room,p_user,target.user_id,v_message_id,coalesce(p_payload->>'reason',''));
      result:=jsonb_build_object('messageId',v_message_id,'removedAt',removal.removed_at);
    end if;
  end if;
  insert into public.soundspin_chat_receipts values(p_id,p_room,p_user,p_fingerprint,result,now());
  return jsonb_build_object('fresh',true,'result',result);
end; $$;
revoke all on function public.soundspin_chat_command(text,text,uuid,text,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.soundspin_chat_command(text,text,uuid,text,text,jsonb,integer) to service_role;
