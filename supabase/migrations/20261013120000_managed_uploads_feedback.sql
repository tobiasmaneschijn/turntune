-- Trusted upload APIs are the only insertion channel. Ledger/outbox deliberately
-- have no cascading foreign keys: erasure must not discard the only object key.
create table public.soundspin_upload_limits (
  purpose text primary key check (purpose in ('avatar','feedback','chat')),
  total_bytes bigint not null check(total_bytes>0), total_objects integer not null check(total_objects>0),
  hourly_bytes bigint not null check(hourly_bytes>0), hourly_objects integer not null check(hourly_objects>0),
  pending_bytes bigint not null check(pending_bytes>0), pending_objects integer not null check(pending_objects>0),
  concurrent_uploads integer not null check(concurrent_uploads between 1 and 10)
);
insert into public.soundspin_upload_limits values
 ('avatar',20971520,4,20971520,4,10485760,2,2),
 ('feedback',104857600,25,26214400,5,26214400,5,2),
 ('chat',209715200,100,52428800,20,31457280,5,2);
create table public.soundspin_managed_uploads (
 id uuid primary key, actor_id uuid not null, purpose text not null references public.soundspin_upload_limits(purpose),
 bucket_id text not null check(bucket_id in ('profile-avatars','feedback-screenshots','chat-media')),
 storage_path text not null unique check(char_length(storage_path)<=200), room_slug text,
 size_bytes bigint not null check(size_bytes between 1 and 6291456),
 state text not null default 'reserved' check(state in ('reserved','pending','committed','deleting','deleted')),
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '15 minutes',
 updated_at timestamptz not null default now(), deletion_generation uuid
);
create index soundspin_uploads_actor_purpose_idx on public.soundspin_managed_uploads(actor_id,purpose,created_at);
create index soundspin_uploads_room_idx on public.soundspin_managed_uploads(room_slug) where state<>'deleted';
create table public.soundspin_storage_deletion_outbox (
 bucket_id text not null, storage_path text not null, actor_id uuid, room_slug text,
 queued_at timestamptz not null default now(), available_at timestamptz not null default now(),
 attempts integer not null default 0, last_error text, generation uuid not null default gen_random_uuid(), primary key(bucket_id,storage_path)
);
create index soundspin_storage_deletion_due_idx on public.soundspin_storage_deletion_outbox(available_at,queued_at);
-- Bring existing objects into the same budget, including browser-abandoned
-- uploads. Missing legacy metadata is charged at the bucket's maximum size.
insert into public.soundspin_managed_uploads(id,actor_id,purpose,bucket_id,storage_path,room_slug,size_bytes,state,expires_at)
 select gen_random_uuid(),user_id,'chat','chat-media',storage_path,room_slug,size_bytes,
 case when removed_at is not null then 'deleting' when message_id is not null then 'committed' else 'pending' end,expires_at
 from public.soundspin_chat_uploads where split_part(storage_path,'/',1)=user_id::text on conflict(storage_path)do nothing;
insert into public.soundspin_managed_uploads(id,actor_id,purpose,bucket_id,storage_path,size_bytes,state,expires_at)
 select gen_random_uuid(),split_part(o.name,'/',1)::uuid,case when o.bucket_id='profile-avatars' then 'avatar' else 'feedback' end,o.bucket_id,o.name,
 case when (to_jsonb(o)->'metadata'->>'size') ~ '^[0-9]{1,8}$' then least(greatest((to_jsonb(o)->'metadata'->>'size')::bigint,1),5242880) else 5242880 end,
 case when exists(select 1 from public.soundspin_profiles p where p.user_id::text=split_part(o.name,'/',1) and p.avatar_path=o.name)
 or exists(select 1 from public.soundspin_feedback f where f.user_id::text=split_part(o.name,'/',1) and o.name=any(f.screenshot_paths)) then 'committed' else 'pending' end,now()+interval '15 minutes'
 from storage.objects o where o.bucket_id in ('profile-avatars','feedback-screenshots') and char_length(o.name)<=200
 and split_part(o.name,'/',1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
 on conflict(storage_path)do nothing;
-- Referenced images written before the chat registry also consume retained
-- budgets; preserve their room/actor association rather than treating them as orphans.
insert into public.soundspin_managed_uploads(id,actor_id,purpose,bucket_id,storage_path,room_slug,size_bytes,state)
 select distinct on(m.storage_path) gen_random_uuid(),m.user_id,'chat','chat-media',m.storage_path,m.room_slug,
 case when (to_jsonb(o)->'metadata'->>'size') ~ '^[0-9]{1,8}$' then least(greatest((to_jsonb(o)->'metadata'->>'size')::bigint,1),6291456) else 6291456 end,
 case when m.removed_at is null then 'committed' else 'deleting' end
 from public.soundspin_messages m left join storage.objects o on o.bucket_id='chat-media' and o.name=m.storage_path
 where m.storage_path is not null and char_length(m.storage_path)<=200 and m.user_id is not null
 and split_part(m.storage_path,'/',1)=m.user_id::text on conflict(storage_path)do nothing;
-- Malformed/long legacy keys have no accepted new write path. Preserve known
-- references and queue only objects that have no application association.
insert into public.soundspin_storage_deletion_outbox(bucket_id,storage_path,actor_id)
 select o.bucket_id,o.name,case when split_part(o.name,'/',1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then split_part(o.name,'/',1)::uuid else null end
 from storage.objects o where o.bucket_id in ('profile-avatars','feedback-screenshots','chat-media')
 and not exists(select 1 from public.soundspin_managed_uploads l where l.bucket_id=o.bucket_id and l.storage_path=o.name)
 and not exists(select 1 from public.soundspin_profiles p where o.bucket_id='profile-avatars' and p.user_id::text=split_part(o.name,'/',1) and p.avatar_path=o.name)
 and not exists(select 1 from public.soundspin_feedback f where o.bucket_id='feedback-screenshots' and f.user_id::text=split_part(o.name,'/',1) and o.name=any(f.screenshot_paths))
 and not exists(select 1 from public.soundspin_messages m where o.bucket_id='chat-media' and m.user_id::text=split_part(o.name,'/',1) and m.storage_path=o.name)
 on conflict(bucket_id,storage_path)do nothing;
insert into public.soundspin_storage_deletion_outbox(bucket_id,storage_path,actor_id,room_slug,available_at)
 select bucket_id,storage_path,actor_id,room_slug,now()+interval '5 minutes' from public.soundspin_managed_uploads where state='deleting'
 on conflict(bucket_id,storage_path)do nothing;
update public.soundspin_managed_uploads l set deletion_generation=o.generation
 from public.soundspin_storage_deletion_outbox o where l.bucket_id=o.bucket_id and l.storage_path=o.storage_path;
alter table public.soundspin_feedback add column submission_fingerprint text;
alter table public.soundspin_upload_limits enable row level security;
alter table public.soundspin_managed_uploads enable row level security;
alter table public.soundspin_storage_deletion_outbox enable row level security;
revoke all on public.soundspin_upload_limits,public.soundspin_managed_uploads,public.soundspin_storage_deletion_outbox from public,anon,authenticated;
grant all on public.soundspin_upload_limits,public.soundspin_managed_uploads,public.soundspin_storage_deletion_outbox to service_role;
revoke all on public.soundspin_feedback from public,anon,authenticated;
revoke insert(id,user_id,message,screenshot_paths,room_slug,page_path,viewport,category,impact,diagnostics) on public.soundspin_feedback from public,anon,authenticated;
drop policy if exists "users can submit their own feedback" on public.soundspin_feedback;
drop policy if exists "users can upload their own avatars" on storage.objects;
drop policy if exists "users can upload their own feedback screenshots" on storage.objects;
-- Service-owned uploads cannot be deleted directly by the browser. Existing
-- private read policies and the intentionally public avatar bucket stay intact.
drop policy if exists "users can delete their own avatars" on storage.objects;
drop policy if exists "users can remove their own feedback screenshots" on storage.objects;
grant insert,delete,update,select on public.soundspin_feedback to service_role;

create function public.soundspin_reserve_upload(p_id uuid,p_actor uuid,p_purpose text,p_bucket text,p_path text,p_bytes bigint,p_room text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare lim public.soundspin_upload_limits; old public.soundspin_managed_uploads; v_count bigint; v_bytes bigint;
begin
 if not public.soundspin_account_enabled(p_actor) or p_bytes<1 or p_bytes>(case when p_purpose='chat' then 6291456 else 5242880 end)
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
 select * into strict lim from public.soundspin_upload_limits where purpose=p_purpose;
 select count(*),coalesce(sum(size_bytes),0) into v_count,v_bytes from public.soundspin_managed_uploads where actor_id=p_actor and purpose=p_purpose and state<>'deleted';
 if v_count>=lim.total_objects or v_bytes+p_bytes>lim.total_bytes then raise exception 'Too many stored images. Remove images before uploading more.'; end if;
 select count(*),coalesce(sum(size_bytes),0) into v_count,v_bytes from public.soundspin_managed_uploads where actor_id=p_actor and purpose=p_purpose and created_at>now()-interval '1 hour';
 if v_count>=lim.hourly_objects or v_bytes+p_bytes>lim.hourly_bytes then raise exception 'Too many uploads. Try again in an hour.'; end if;
 select count(*),coalesce(sum(size_bytes),0) into v_count,v_bytes from public.soundspin_managed_uploads where actor_id=p_actor and purpose=p_purpose and state in ('reserved','pending');
 if v_count>=lim.pending_objects or v_bytes+p_bytes>lim.pending_bytes then raise exception 'Too many unfinished uploads. Finish or remove them first.'; end if;
 select count(*) into v_count from public.soundspin_managed_uploads where actor_id=p_actor and state='reserved';
 if v_count>=lim.concurrent_uploads then raise exception 'Too many uploads in progress. Try again shortly.'; end if;
 if p_room is not null then
  select count(*),coalesce(sum(size_bytes),0) into v_count,v_bytes from public.soundspin_managed_uploads where room_slug=p_room and state<>'deleted';
  if v_count>=1000 or v_bytes+p_bytes>1073741824 then raise exception 'Too many stored images in this room.'; end if;
 end if;
 insert into public.soundspin_managed_uploads(id,actor_id,purpose,bucket_id,storage_path,size_bytes,room_slug)values(p_id,p_actor,p_purpose,p_bucket,p_path,p_bytes,p_room) returning * into old;
 return to_jsonb(old);
end; $$;

create function public.soundspin_queue_upload(p_bucket text,p_path text,p_actor uuid default null,p_room text default null,p_delay integer default 0)
returns void language plpgsql security invoker set search_path='' as $$ declare version uuid; begin
 -- Legacy references were client supplied. A record's actor must own the
 -- namespace; deleting that record must never queue somebody else's bytes.
 if p_actor is not null and split_part(p_path,'/',1) is distinct from p_actor::text then return; end if;
 -- Actor-less maintenance can refresh only an already inventory-proven orphan
 -- key. It cannot create a new deletion request by omitting ownership evidence.
 if p_actor is null and not exists(select 1 from public.soundspin_storage_deletion_outbox where bucket_id=p_bucket and storage_path=p_path and actor_id is null) then raise exception 'Upload ownership evidence is required.'; end if;
 insert into public.soundspin_storage_deletion_outbox(bucket_id,storage_path,actor_id,room_slug,available_at)values(p_bucket,p_path,p_actor,p_room,now()+make_interval(secs=>greatest(0,p_delay)))
 on conflict(bucket_id,storage_path)do update set generation=gen_random_uuid(),available_at=greatest(soundspin_storage_deletion_outbox.available_at,excluded.available_at)
 returning generation into version;
 update public.soundspin_managed_uploads set state='deleting',deletion_generation=version,updated_at=now() where bucket_id=p_bucket and storage_path=p_path;
end; $$;

create function public.soundspin_finish_upload(p_id uuid,p_actor uuid)
returns void language plpgsql security invoker set search_path='' as $$ declare obj public.soundspin_managed_uploads; begin
 select * into obj from public.soundspin_managed_uploads where id=p_id and actor_id=p_actor for update;
 if not found or obj.state<>'reserved' or obj.expires_at<=now() or not public.soundspin_account_enabled(p_actor)
  or (obj.room_slug is not null and not public.soundspin_room_enabled(obj.room_slug)) then raise exception 'This upload reservation has ended.'; end if;
 update public.soundspin_managed_uploads set state='pending',updated_at=now() where id=p_id;
end; $$;

-- A single transaction acknowledges a bounded Storage batch. Generation checks
-- keep any later compensation; repeated acknowledgements release capacity once.
create function public.soundspin_complete_upload_deletions(p_bucket text,p_items jsonb)
returns integer language plpgsql security invoker set search_path='' as $$ declare item jsonb; path text; version uuid; n integer:=0; begin
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>100 then raise exception 'Invalid cleanup batch.'; end if;
 for item in select jsonb_array_elements(p_items) loop
  path:=item->>'path'; version:=(item->>'generation')::uuid;
  perform 1 from public.soundspin_storage_deletion_outbox where bucket_id=p_bucket and storage_path=path and generation=version for update;
  if found then
   if p_bucket='chat-media' then delete from public.soundspin_chat_uploads where storage_path=path; end if;
   update public.soundspin_managed_uploads set state='deleted',updated_at=now() where bucket_id=p_bucket and storage_path=path and deletion_generation=version;
   delete from public.soundspin_storage_deletion_outbox where bucket_id=p_bucket and storage_path=path and generation=version;
   if found then n:=n+1; end if;
  end if;
 end loop;
 return n;
end; $$;

create function public.soundspin_enqueue_upload_deletion(p_actor uuid default null,p_room text default null)
returns integer language plpgsql security invoker set search_path='' as $$ declare obj record; n integer:=0; begin
 if p_actor is null and p_room is null then raise exception 'Deletion scope is required.'; end if;
 for obj in select bucket_id,storage_path,actor_id,room_slug from public.soundspin_managed_uploads where (p_actor is not null and actor_id=p_actor) or (p_room is not null and room_slug=p_room)
 union select 'chat-media',storage_path,user_id,room_slug from public.soundspin_chat_uploads where (p_actor is not null and user_id=p_actor) or (p_room is not null and room_slug=p_room)
 union select bucket_id,name,p_actor,null from storage.objects where p_actor is not null and bucket_id in ('profile-avatars','feedback-screenshots','chat-media') and split_part(name,'/',1)=p_actor::text
 loop perform public.soundspin_queue_upload(obj.bucket_id,obj.storage_path,obj.actor_id,obj.room_slug); n:=n+1; end loop;
 return n;
end; $$;

create function public.soundspin_cancel_pending_upload(p_actor uuid,p_path text)
returns void language plpgsql security invoker set search_path='' as $$ declare obj public.soundspin_managed_uploads; begin
 select * into obj from public.soundspin_managed_uploads where actor_id=p_actor and storage_path=p_path and purpose in ('avatar','feedback') for update;
 if not found or obj.state not in ('reserved','pending') then return; end if;
 perform public.soundspin_queue_upload(obj.bucket_id,obj.storage_path,obj.actor_id,obj.room_slug);
end; $$;

create function public.soundspin_collect_expired_uploads(p_limit integer default 500)
returns integer language plpgsql security invoker set search_path='' as $$ declare obj record; n integer:=0; begin
 for obj in select * from public.soundspin_managed_uploads where state in ('reserved','pending') and expires_at<now() order by expires_at limit least(greatest(p_limit,1),1000) for update skip locked
 loop
  -- Profile save/feedback association racing expiry is serialized by the row lock.
  if (obj.purpose='avatar' and exists(select 1 from public.soundspin_profiles where user_id=obj.actor_id and avatar_path=obj.storage_path))
   or (obj.purpose='feedback' and exists(select 1 from public.soundspin_feedback where user_id=obj.actor_id and obj.storage_path=any(screenshot_paths)))
   or (obj.purpose='chat' and exists(select 1 from public.soundspin_chat_uploads where storage_path=obj.storage_path and message_id is not null and removed_at is null)) then
    update public.soundspin_managed_uploads set state='committed',updated_at=now() where id=obj.id;
  else perform public.soundspin_queue_upload(obj.bucket_id,obj.storage_path,obj.actor_id,obj.room_slug,case when obj.purpose='chat' then 300 else 0 end); n:=n+1; end if;
 end loop;
 -- Existing pre-ledger chat rows and removed message attachments also enter the
 -- independent outbox before registry/cascade deletion can discard them.
 for obj in select * from public.soundspin_chat_uploads where (removed_at is not null and removed_at<now()-interval '5 minutes') or (message_id is null and expires_at<now()) order by expires_at limit least(greatest(p_limit,1),1000) for update skip locked
 loop
  update public.soundspin_chat_uploads set removed_at=coalesce(removed_at,now()) where storage_path=obj.storage_path and message_id is null;
  perform public.soundspin_queue_upload('chat-media',obj.storage_path,obj.user_id,obj.room_slug,case when obj.removed_at is null then 300 else 0 end);
 end loop;
 return n;
end; $$;

create function public.soundspin_upload_reference_change() returns trigger language plpgsql security definer set search_path='' as $$
declare path text; bucket text; actor uuid; room text;
begin
 if tg_table_name='soundspin_profiles' then
  if tg_op='DELETE' then if old.avatar_path is not null then perform public.soundspin_queue_upload('profile-avatars',old.avatar_path,old.user_id); end if; return old; end if;
  if new.avatar_path is distinct from old.avatar_path then
   if new.avatar_path is not null then
    if not public.soundspin_account_enabled(new.user_id) then raise exception 'This account is unavailable.'; end if;
    perform 1 from public.soundspin_managed_uploads where storage_path=new.avatar_path and actor_id=new.user_id and purpose='avatar' and state in ('pending','committed') and (state='committed' or expires_at>now()) for update;
    if not found then raise exception 'This avatar upload is unavailable.'; end if;
    update public.soundspin_managed_uploads set state='committed',updated_at=now() where storage_path=new.avatar_path;
   end if;
   if old.avatar_path is not null then perform public.soundspin_queue_upload('profile-avatars',old.avatar_path,old.user_id); end if;
  end if;
 elsif tg_table_name='soundspin_chat_uploads' then
  if tg_op='DELETE' then
   if not exists(select 1 from public.soundspin_storage_deletion_outbox where bucket_id='chat-media' and storage_path=old.storage_path) then perform public.soundspin_queue_upload('chat-media',old.storage_path,old.user_id,old.room_slug); end if;
   return old;
  end if;
  if new.removed_at is not null then perform public.soundspin_queue_upload('chat-media',new.storage_path,new.user_id,new.room_slug,300);
  elsif new.message_id is not null and old.message_id is null then
   perform 1 from public.soundspin_managed_uploads where storage_path=new.storage_path and actor_id=new.user_id and purpose='chat' and state='pending' and expires_at>now() for update;
   if not found or not public.soundspin_account_enabled(new.user_id) or not public.soundspin_room_enabled(new.room_slug) then raise exception 'This chat upload is unavailable.'; end if;
   update public.soundspin_managed_uploads set state='committed',updated_at=now() where storage_path=new.storage_path;
  end if;
 elsif tg_table_name='soundspin_feedback' then
  foreach path in array old.screenshot_paths loop
   if split_part(path,'/',1)=old.user_id::text then perform public.soundspin_queue_upload('feedback-screenshots',path,old.user_id); end if;
  end loop;
  return old;
 end if;
 return new;
end; $$;
create trigger soundspin_profile_upload_reference before update of avatar_path or delete on public.soundspin_profiles for each row execute function public.soundspin_upload_reference_change();
create trigger soundspin_chat_upload_reference after update or delete on public.soundspin_chat_uploads for each row execute function public.soundspin_upload_reference_change();
create trigger soundspin_feedback_upload_erasure before delete on public.soundspin_feedback for each row execute function public.soundspin_upload_reference_change();

create function public.soundspin_submit_feedback(p_actor uuid,p_id uuid,p_fingerprint text,p_record jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare old public.soundspin_feedback; paths text[]; path text; n bigint;
begin
 if not public.soundspin_account_enabled(p_actor) then raise exception 'This account is unavailable.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('feedback:'||p_actor::text,0));
 select * into old from public.soundspin_feedback where id=p_id;
 if found then if old.user_id<>p_actor or old.submission_fingerprint is distinct from p_fingerprint then raise exception 'Feedback operation ID belongs to different content.'; end if; return jsonb_build_object('id',old.id,'fresh',false); end if;
 if p_fingerprint !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_record)<>'object' or pg_column_size(p_record)>25000
  or exists(select 1 from jsonb_object_keys(p_record) k where k not in ('message','screenshot_paths','room_slug','page_path','viewport','category','impact','diagnostics'))
  or jsonb_typeof(p_record->'screenshot_paths')<>'array' or jsonb_array_length(p_record->'screenshot_paths')>5
  or jsonb_typeof(p_record->'viewport')<>'object' or pg_column_size(p_record->'viewport')>100
  or char_length(p_record->>'page_path') not between 1 and 512 or p_record->>'page_path' not like '/%'
  or char_length(coalesce(p_record->>'room_slug',''))>48 then raise exception 'Invalid feedback submission.'; end if;
 paths:=array(select jsonb_array_elements_text(p_record->'screenshot_paths'));
 if cardinality(paths)<> (select count(distinct v) from unnest(paths) v) then raise exception 'Invalid feedback attachments.'; end if;
 select count(*) into n from public.soundspin_feedback where user_id=p_actor and created_at>now()-interval '1 hour';
 if n>=5 then raise exception 'Too many feedback submissions. Try again in an hour.'; end if;
 select count(*) into n from public.soundspin_feedback where user_id=p_actor and created_at>now()-interval '24 hours';
 if n>=20 then raise exception 'Too many feedback submissions. Try again tomorrow.'; end if;
 select count(*) into n from public.soundspin_feedback where user_id=p_actor;
 if n>=200 then raise exception 'Too many retained feedback submissions. Contact support.'; end if;
 foreach path in array paths loop
  perform 1 from public.soundspin_managed_uploads where actor_id=p_actor and purpose='feedback' and storage_path=path and state='pending' and expires_at>now() for update;
  if not found then raise exception 'This feedback attachment is unavailable.'; end if;
 end loop;
 insert into public.soundspin_feedback(id,user_id,message,screenshot_paths,room_slug,page_path,viewport,category,impact,diagnostics,submission_fingerprint)
 values(p_id,p_actor,p_record->>'message',paths,p_record->>'room_slug',p_record->>'page_path',p_record->'viewport',p_record->>'category',p_record->>'impact',p_record->'diagnostics',p_fingerprint);
 update public.soundspin_managed_uploads set state='committed',updated_at=now() where actor_id=p_actor and purpose='feedback' and storage_path=any(paths);
 return jsonb_build_object('id',p_id,'fresh',true);
end; $$;

revoke all on function public.soundspin_reserve_upload(uuid,uuid,text,text,text,bigint,text),public.soundspin_queue_upload(text,text,uuid,text,integer),public.soundspin_enqueue_upload_deletion(uuid,text),public.soundspin_collect_expired_uploads(integer),public.soundspin_submit_feedback(uuid,uuid,text,jsonb),public.soundspin_cancel_pending_upload(uuid,text),public.soundspin_finish_upload(uuid,uuid),public.soundspin_complete_upload_deletions(text,jsonb),public.soundspin_upload_reference_change() from public,anon,authenticated;
grant execute on function public.soundspin_reserve_upload(uuid,uuid,text,text,text,bigint,text),public.soundspin_queue_upload(text,text,uuid,text,integer),public.soundspin_enqueue_upload_deletion(uuid,text),public.soundspin_collect_expired_uploads(integer),public.soundspin_submit_feedback(uuid,uuid,text,jsonb),public.soundspin_cancel_pending_upload(uuid,text),public.soundspin_finish_upload(uuid,uuid),public.soundspin_complete_upload_deletions(text,jsonb) to service_role;
