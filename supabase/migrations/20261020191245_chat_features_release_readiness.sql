-- Keep the startup contract last in the append-only release chain. An older
-- schema must fail readiness before the server accepts chat feature requests.
alter function public.soundspin_release_ready() rename to soundspin_release_ready_chat_base;

create function public.soundspin_release_ready() returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare relation regclass; routine regprocedure; object_name text;
begin
  if not public.soundspin_release_ready_chat_base() then return false; end if;
  if (select count(*) from pg_catalog.pg_attribute
      where attrelid=to_regclass('public.soundspin_messages') and attname in ('song','game')
        and atttypid='jsonb'::regtype and not attisdropped)<>2 then return false; end if;

  foreach object_name in array array['public.soundspin_chat_pins','public.soundspin_chat_trivia_answers'] loop
    relation:=to_regclass(object_name);
    if relation is null then return false; end if;
    if not (select relrowsecurity from pg_catalog.pg_class where oid=relation)
      or has_table_privilege('anon',relation,'SELECT,INSERT,UPDATE,DELETE')
      or has_table_privilege('authenticated',relation,'SELECT,INSERT,UPDATE,DELETE')
      or has_any_column_privilege('anon',relation,'SELECT,INSERT,UPDATE')
      or has_any_column_privilege('authenticated',relation,'SELECT,INSERT,UPDATE')
      or not has_table_privilege('service_role',relation,'SELECT')
      or not has_table_privilege('service_role',relation,'INSERT')
      or not has_table_privilege('service_role',relation,'DELETE') then return false; end if;
  end loop;

  foreach object_name in array array[
    'public.soundspin_chat_game_result(jsonb)',
    'public.soundspin_set_chat_pin(text,uuid,uuid,boolean)',
    'public.soundspin_chat_trivia_answer(text,uuid,uuid,integer)',
    'public.soundspin_remove_message_pin()',
    'public.soundspin_chat_remove_trivia_answers()'
  ] loop
    routine:=to_regprocedure(object_name);
    if routine is null then return false; end if;
    if has_function_privilege('anon',routine,'EXECUTE')
      or has_function_privilege('authenticated',routine,'EXECUTE')
      or not has_function_privilege('service_role',routine,'EXECUTE') then return false; end if;
  end loop;

  return (select count(*)=2 from pg_catalog.pg_trigger
    where tgrelid=to_regclass('public.soundspin_messages')
      and tgname in ('soundspin_remove_message_pin','soundspin_chat_remove_trivia_answers')
      and tgenabled in ('O','A') and not tgisinternal);
end;
$$;
revoke all on function public.soundspin_release_ready() from public,anon,authenticated;
grant execute on function public.soundspin_release_ready() to service_role;

notify pgrst, 'reload schema';
