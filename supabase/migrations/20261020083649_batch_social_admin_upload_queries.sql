-- Keep bounded social reads in one fresh database snapshot. Service callers own
-- the verified actor; browser roles cannot select relationships for other users.
create function public.soundspin_social_states(p_actor uuid, p_targets uuid[])
returns table(user_id uuid, state text, share_activity boolean)
language plpgsql stable security invoker set search_path='' as $$
begin
  if cardinality(p_targets)>500 then raise exception 'Listener lookup exceeds its limit.'; end if;
  if p_actor is null or not public.soundspin_account_enabled(p_actor) then return; end if;
  return query
    select target.id,
      case when not public.soundspin_account_enabled(target.id)
          or public.soundspin_users_blocked(p_actor,target.id)
          or friendship.user_low is null
          or (friendship.status='pending' and friendship.updated_at<=now()-interval '14 days') then 'none'
        when friendship.status='accepted' then 'friends'
        when friendship.requested_by=p_actor then 'outgoing'
        else 'incoming' end,
      coalesce(settings.share_activity,false)
    from (select distinct id from unnest(p_targets) as input(id) where id is not null and id<>p_actor) target
    left join public.soundspin_friendships friendship
      on friendship.user_low=least(p_actor,target.id) and friendship.user_high=greatest(p_actor,target.id)
    left join public.soundspin_social_settings settings on settings.user_id=target.id;
end $$;

-- The dashboard needs totals and daily activity, rather than five independent
-- HEAD requests followed by another aggregation request.
create function public.soundspin_admin_summary(p_actor uuid, p_start timestamptz)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare feedback_totals jsonb;
begin
  perform public.soundspin_require_admin(p_actor);
  select jsonb_build_object('feedback',count(*),'openFeedback',count(*) filter(where status in ('new','reviewing','planned')))
    into feedback_totals from public.soundspin_feedback;
  return jsonb_build_object(
    'metrics',feedback_totals || jsonb_build_object(
      'users',(select count(*) from public.soundspin_profiles),
      'rooms',(select count(*) from public.soundspin_rooms),
      'messages',(select count(*) from public.soundspin_messages)),
    'activity',coalesce((select jsonb_agg(to_jsonb(activity) order by activity.day)
      from public.soundspin_admin_activity(p_start) activity),'[]'::jsonb));
end $$;

-- Cancellation still uses the existing per-upload row lock so an upload claimed
-- by a profile/feedback save cannot be removed by a racing cleanup request.
create function public.soundspin_cancel_pending_uploads(p_actor uuid, p_paths text[])
returns void language plpgsql security invoker set search_path='' as $$
declare path text;
begin
  if p_actor is null or not public.soundspin_account_enabled(p_actor) then raise exception 'Account access is unavailable.'; end if;
  if p_paths is null or cardinality(p_paths) not between 1 and 5
    or exists(select 1 from unnest(p_paths) input(path) where input.path is null or char_length(input.path)>200 or split_part(input.path,'/',1)<>p_actor::text)
    then raise exception 'Invalid upload cleanup request.'; end if;
  for path in select distinct input.path from unnest(p_paths) input(path) order by input.path
  loop perform public.soundspin_cancel_pending_upload(p_actor,path); end loop;
end $$;

-- A failed Storage batch is one bounded retry update. Generation matching keeps
-- a stale failure from postponing newly queued compensation for the same key.
create function public.soundspin_retry_upload_deletions(p_bucket text, p_items jsonb)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'Invalid upload retry batch.'; end if;
  if jsonb_array_length(p_items)>100 then raise exception 'Upload retry batch exceeds its limit.'; end if;
  update public.soundspin_storage_deletion_outbox outbox
    set attempts=outbox.attempts+1,
      available_at=now()+interval '1 second'*least(3600,30*power(2,least(outbox.attempts+1,7))),
      last_error='Storage cleanup failed; retry scheduled.'
    from jsonb_to_recordset(p_items) as item(path text,generation uuid)
    where outbox.bucket_id=p_bucket and outbox.storage_path=item.path and outbox.generation=item.generation;
end $$;

revoke all on function public.soundspin_social_states(uuid,uuid[]),public.soundspin_admin_summary(uuid,timestamptz),
  public.soundspin_cancel_pending_uploads(uuid,text[]),public.soundspin_retry_upload_deletions(text,jsonb) from public,anon,authenticated;
grant execute on function public.soundspin_social_states(uuid,uuid[]),public.soundspin_admin_summary(uuid,timestamptz),
  public.soundspin_cancel_pending_uploads(uuid,text[]),public.soundspin_retry_upload_deletions(text,jsonb) to service_role;
