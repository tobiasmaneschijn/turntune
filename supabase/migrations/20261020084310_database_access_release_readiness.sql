-- Refuse startup until the optimized access and write contracts are installed.
alter function public.soundspin_release_ready() rename to soundspin_release_ready_access_base;
create function public.soundspin_release_ready() returns boolean
language sql security invoker set search_path='' as $$
 select public.soundspin_release_ready_access_base()
  and to_regprocedure('public.soundspin_room_access(text,uuid,uuid[])') is not null
  and to_regprocedure('public.soundspin_access_status(uuid[],text[])') is not null
  and to_regprocedure('public.soundspin_directory_visibility(uuid,text[])') is not null
  and to_regprocedure('public.soundspin_load_room(text)') is not null
  and to_regprocedure('public.soundspin_social_states(uuid,uuid[])') is not null
  and to_regprocedure('public.soundspin_admin_summary(uuid,timestamp with time zone)') is not null
  and to_regprocedure('public.soundspin_cancel_pending_uploads(uuid,text[])') is not null
  and to_regprocedure('public.soundspin_retry_upload_deletions(text,jsonb)') is not null
  and to_regprocedure('public.soundspin_committed_chat_row(uuid)') is not null
  and to_regprocedure('public.soundspin_chat_message_state(uuid)') is not null;
$$;
revoke all on function public.soundspin_release_ready() from public,anon,authenticated;
grant execute on function public.soundspin_release_ready() to service_role;

-- Old databases expose only the zero-argument marker. Requiring this contract
-- makes the new server fail startup rather than fail later on its first RPC.
create function public.soundspin_release_ready(p_contract text) returns boolean
language sql security invoker set search_path='' as $$
 select p_contract='database-access-v1' and public.soundspin_release_ready();
$$;
revoke all on function public.soundspin_release_ready(text) from public,anon,authenticated;
grant execute on function public.soundspin_release_ready(text) to service_role;
