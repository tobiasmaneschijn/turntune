-- Return the current committed row in the same request as the chat mutation.
-- The existing transaction retains immutable receipts, cooldowns and tombstone
-- ordering. Application authorization and fresh admitted-recipient gates remain.
create function public.soundspin_committed_chat_row(p_id uuid) returns jsonb
language sql security invoker set search_path='' as $$
 select to_jsonb(message) || jsonb_build_object(
  'immutable_fingerprint',coalesce(message.immutable_fingerprint,(select fingerprint from public.soundspin_chat_receipts where operation_id='message:'||message.id::text)),
  'soundspin_message_reactions',coalesce((select jsonb_agg(to_jsonb(reaction)) from (
   select user_id,emoji from public.soundspin_message_reactions where message_id=message.id order by user_id,emoji limit 300
  ) reaction),'[]'::jsonb),
  'soundspin_poll_votes',coalesce((select jsonb_agg(to_jsonb(vote)) from (
   select user_id,option_index,revision from public.soundspin_poll_votes where message_id=message.id order by user_id limit 300
  ) vote),'[]'::jsonb),
  'reply',(select to_jsonb(reply) from public.soundspin_messages reply where reply.id=message.reply_to_id and reply.room_slug=message.room_slug)
 ) from public.soundspin_messages message where message.id=p_id
$$;
revoke all on function public.soundspin_committed_chat_row(uuid) from public,anon,authenticated;
grant execute on function public.soundspin_committed_chat_row(uuid) to service_role;

-- Admission is checked before this privileged global UUID lookup. Read both
-- immutable identity and pre-save removals in one network request.
create function public.soundspin_chat_message_state(p_id uuid) returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object('row',public.soundspin_committed_chat_row(p_id),
  'removal',(select jsonb_build_object('roomId',room_slug,'removedAt',removed_at)
   from public.soundspin_chat_tombstones where message_id=p_id))
$$;
revoke all on function public.soundspin_chat_message_state(uuid) from public,anon,authenticated;
grant execute on function public.soundspin_chat_message_state(uuid) to service_role;

create or replace function public.soundspin_chat_command(p_kind text,p_room text,p_user uuid,p_id text,p_fingerprint text,p_payload jsonb,p_slow_seconds integer default 0)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare receipt public.soundspin_chat_receipts; target public.soundspin_messages;
  result jsonb; v_message_id uuid; last_at timestamptz; options text[]; accepted_vote public.soundspin_poll_votes; removal public.soundspin_chat_tombstones; mention_target uuid; unchanged boolean; v_fresh boolean:=true;
begin
  if p_kind not in ('message','reaction','poll','remove') or char_length(p_id)>100 or char_length(p_fingerprint)<>64 or p_slow_seconds not between 0 and 60 then raise exception 'Invalid chat command.'; end if;
  -- Orders all room chat commands, including removal racing with a send/retry.
  perform pg_advisory_xact_lock(hashtextextended('chat-user:'||p_user::text,0));
  perform pg_advisory_xact_lock(hashtextextended('chat:'||p_room,0));
  delete from public.soundspin_chat_receipts where created_at<=now()-interval '24 hours' and (room_slug=p_room or user_id=p_user);
  delete from public.soundspin_chat_mention_budgets where expires_at<=now();
  select * into receipt from public.soundspin_chat_receipts where operation_id=p_id;
  if found then
    if receipt.room_slug<>p_room or receipt.user_id<>p_user or receipt.fingerprint<>p_fingerprint then raise exception 'This operation ID belongs to different content, account, or room.'; end if;
    return jsonb_build_object('fresh',false,'result',receipt.result) || case when p_kind='message' then jsonb_build_object('row',public.soundspin_committed_chat_row((p_payload->>'id')::uuid)) else '{}'::jsonb end;
  end if;
  v_message_id:=case when p_kind='message' then (p_payload->>'id')::uuid else (p_payload->>'messageId')::uuid end;
  select * into target from public.soundspin_messages where id=v_message_id for update;
  select * into removal from public.soundspin_chat_tombstones where message_id=v_message_id;
  if removal.message_id is not null and removal.room_slug<>p_room then raise exception 'This message ID is unavailable.'; end if;
  if p_kind='message' then
    if target.id is not null then
      if target.room_slug<>p_room or target.user_id<>p_user or target.immutable_fingerprint is distinct from p_fingerprint then raise exception 'This message ID belongs to different content, account, or room.'; end if;
      result:=jsonb_build_object('id',v_message_id);
      return jsonb_build_object('fresh',false,'result',result,'row',public.soundspin_committed_chat_row(v_message_id));
    end if;
    select last_message_at into last_at from public.soundspin_chat_cooldowns where room_slug=p_room and user_id=p_user;
    if removal.message_id is not null then p_payload:=p_payload||jsonb_build_object('content','Message removed','type','text','mediaUrl',null,'storagePath',null,'mentions','[]'::jsonb,'poll',null); end if;
    if removal.message_id is null and p_slow_seconds>0 and last_at+make_interval(secs=>p_slow_seconds)>now() then raise exception 'Slow mode is active. Wait before sending another message.'; end if;
    if p_payload->>'storagePath' is not null then
      perform 1 from public.soundspin_chat_uploads where storage_path=p_payload->>'storagePath' and room_slug=p_room and user_id=p_user and removed_at is null and message_id is null and expires_at>now() for update;
      if not found then raise exception 'This uploaded image is unavailable.'; end if;
    end if;
    if removal.message_id is null and jsonb_array_length(coalesce(p_payload->'mentions','[]'::jsonb))>0 then
      for mention_target in select distinct (value->>'userId')::uuid from jsonb_array_elements(p_payload->'mentions') order by 1 loop
        perform public.soundspin_charge_mention(mention_target,'recipient',1,5);
      end loop;
      perform public.soundspin_charge_mention(p_user,'sender',jsonb_array_length(p_payload->'mentions'),20);
    end if;
    options:=case when p_payload->'poll' is null or p_payload->'poll'='null'::jsonb then null else array(select jsonb_array_elements_text(p_payload->'poll'->'options')) end;
    insert into public.soundspin_messages(id,room_slug,user_id,user_name,avatar_seed,content,message_type,media_url,storage_path,mentions,reply_to_id,created_at,poll_options,immutable_fingerprint)
    values(v_message_id,p_room,p_user,p_payload->'user'->>'name',p_payload->'user'->>'avatarSeed',p_payload->>'content',p_payload->>'type',p_payload->>'mediaUrl',p_payload->>'storagePath',coalesce(p_payload->'mentions','[]'::jsonb),(p_payload->'replyTo'->>'id')::uuid,(p_payload->>'createdAt')::timestamptz,options,p_fingerprint);
    update public.soundspin_chat_uploads set message_id=v_message_id where storage_path=p_payload->>'storagePath';
    if removal.message_id is null then insert into public.soundspin_chat_cooldowns values(p_room,p_user,now()) on conflict(room_slug,user_id)do update set last_message_at=excluded.last_message_at;
    else update public.soundspin_messages set removed_at=removal.removed_at where id=v_message_id;end if;
    result:=jsonb_build_object('id',v_message_id);
  else
    if p_kind<>'remove' and target.id is null or target.id is not null and target.room_slug<>p_room then raise exception 'This message is unavailable.'; end if;
    if p_kind<>'remove' and target.removed_at is not null then raise exception 'This message was removed.'; end if;
    if p_kind='reaction' then
      if p_payload->>'action' not in ('add','remove') or not exists(select 1 from public.soundspin_chat_reaction_catalog where emoji=p_payload->>'emoji') then raise exception 'Choose a supported emoji.';end if;
      unchanged:=exists(select 1 from public.soundspin_message_reactions where message_id=v_message_id and user_id=p_user and emoji=p_payload->>'emoji');
      if (p_payload->>'action'='add' and unchanged) or (p_payload->>'action'='remove' and not unchanged) then v_fresh:=false;
      elsif p_payload->>'action'='add' then insert into public.soundspin_message_reactions(message_id,user_id,emoji) values(v_message_id,p_user,p_payload->>'emoji') on conflict do nothing;
      else delete from public.soundspin_message_reactions r where r.message_id=v_message_id and r.user_id=p_user and r.emoji=p_payload->>'emoji'; end if;
      result:=p_payload;
    elsif p_kind='poll' then
      if target.poll_options is null or (p_payload->>'optionIndex')::int not between 0 and cardinality(target.poll_options)-1 then raise exception 'This poll is unavailable.'; end if;
      select * into accepted_vote from public.soundspin_poll_votes where message_id=v_message_id and user_id=p_user;
      if found and accepted_vote.option_index=(p_payload->>'optionIndex')::smallint then v_fresh:=false;
      else insert into public.soundspin_poll_votes(message_id,room_slug,user_id,option_index) values(v_message_id,p_room,p_user,(p_payload->>'optionIndex')::smallint)
      on conflict(message_id,user_id)do update set option_index=excluded.option_index returning * into accepted_vote;end if;
      result:=jsonb_build_object('messageId',v_message_id,'userId',p_user,'optionIndex',accepted_vote.option_index,'revision',accepted_vote.revision);
    else
      if removal.message_id is not null then return jsonb_build_object('fresh',false,'result',jsonb_build_object('messageId',v_message_id,'removedAt',removal.removed_at));end if;
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
  if (select count(*) from public.soundspin_chat_receipts where room_slug=p_room)>=(case when p_kind='remove' then 11000 else 10000 end) or (select count(*) from public.soundspin_chat_receipts where user_id=p_user)>=(case when p_kind='remove' then 2000 else 1000 end) then raise exception 'Chat operation limit reached. Try again later.';end if;
  insert into public.soundspin_chat_receipts values(p_id,p_room,p_user,p_fingerprint,result,now());
  return jsonb_build_object('fresh',v_fresh,'result',result) || case when p_kind='message' then jsonb_build_object('row',public.soundspin_committed_chat_row(v_message_id)) else '{}'::jsonb end;
end; $$;
