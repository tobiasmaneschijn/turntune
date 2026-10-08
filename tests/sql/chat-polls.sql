-- Runs after chat-rls.sql in a disposable PostgreSQL database.
set role service_role;
insert into public.soundspin_messages(id, room_slug, user_id, user_name, avatar_seed, content, poll_options) values
  ('10000000-0000-4000-8000-000000000004', 'lounge', '00000000-0000-4000-8000-000000000001', 'Alice', 'alice', 'Next genre?', array['House', 'Jazz']),
  ('10000000-0000-4000-8000-000000000005', 'private-room', '00000000-0000-4000-8000-000000000002', 'Bob', 'bob', 'Private poll?', array['Yes', 'No']);
do $$ begin
  begin
    insert into public.soundspin_messages(id, room_slug, user_id, user_name, avatar_seed, content, poll_options)
    values ('10000000-0000-4000-8000-000000000006', 'lounge', '00000000-0000-4000-8000-000000000001', 'Alice', 'alice', 'Duplicate labels?', array['House', 'house']);
    raise exception 'Case-insensitive duplicate poll labels allowed';
  exception when check_violation then null; end;
  begin
    insert into public.soundspin_messages(id, room_slug, user_id, user_name, avatar_seed, content, poll_options)
    values ('10000000-0000-4000-8000-000000000006', 'lounge', '00000000-0000-4000-8000-000000000001', 'Alice', 'alice', 'One label?', array['House']);
    raise exception 'Single-option poll allowed';
  exception when check_violation then null; end;
  begin
    insert into public.soundspin_messages(id, room_slug, user_id, user_name, avatar_seed, content, poll_options)
    values ('10000000-0000-4000-8000-000000000006', 'lounge', '00000000-0000-4000-8000-000000000001', 'Alice', 'alice', 'Invalid label?', array['House', repeat('a', 81)]);
    raise exception 'Oversized poll label allowed';
  exception when check_violation then null; end;
  begin
    insert into public.soundspin_messages(id, room_slug, user_id, user_name, avatar_seed, content, message_type, poll_options)
    values ('10000000-0000-4000-8000-000000000006', 'lounge', '00000000-0000-4000-8000-000000000001', 'Alice', 'alice', 'Media poll?', 'image', array['House', 'Jazz']);
    raise exception 'Media poll allowed';
  exception when check_violation then null; end;
end $$;

-- The server cannot choose a non-poll, an absent option or a mismatched room.
do $$ begin
  begin
    insert into public.soundspin_poll_votes(message_id, room_slug, user_id, option_index)
    values ('10000000-0000-4000-8000-000000000001', 'lounge', '00000000-0000-4000-8000-000000000001', 0);
    raise exception 'Non-poll vote allowed';
  exception when check_violation then null; end;
  begin
    insert into public.soundspin_poll_votes(message_id, room_slug, user_id, option_index)
    values ('10000000-0000-4000-8000-000000000004', 'lounge', '00000000-0000-4000-8000-000000000001', 2);
    raise exception 'Absent poll option allowed';
  exception when check_violation then null; end;
  begin
    insert into public.soundspin_poll_votes(message_id, room_slug, user_id, option_index)
    values ('10000000-0000-4000-8000-000000000005', 'lounge', '00000000-0000-4000-8000-000000000001', 0);
    raise exception 'Wrong-room poll vote allowed';
  exception when check_violation or foreign_key_violation then null; end;
end $$;

-- Trigger-owned revisions ignore caller values on inserts and updates.
insert into public.soundspin_poll_votes(message_id, room_slug, user_id, option_index, revision)
values ('10000000-0000-4000-8000-000000000004', 'lounge', '00000000-0000-4000-8000-000000000001', 0, 999);
do $$ begin
  if (select revision from public.soundspin_poll_votes) <> 1 then raise exception 'Caller forged insert revision'; end if;
  begin
    insert into public.soundspin_poll_votes(message_id, room_slug, user_id, option_index)
    values ('10000000-0000-4000-8000-000000000004', 'lounge', '00000000-0000-4000-8000-000000000001', 1);
    raise exception 'Duplicate account vote allowed';
  exception when unique_violation then null; end;
end $$;
insert into public.soundspin_poll_votes(message_id, room_slug, user_id, option_index)
values ('10000000-0000-4000-8000-000000000004', 'lounge', '00000000-0000-4000-8000-000000000001', 1)
on conflict (message_id, user_id) do update set option_index = excluded.option_index, revision = 999;
insert into public.soundspin_poll_votes(message_id, room_slug, user_id, option_index)
values ('10000000-0000-4000-8000-000000000004', 'lounge', '00000000-0000-4000-8000-000000000002', 0);
do $$ begin
  if (select count(*) from public.soundspin_poll_votes) <> 2 then raise exception 'Vote change created another account vote'; end if;
  if not exists (select 1 from public.soundspin_poll_votes where user_id = '00000000-0000-4000-8000-000000000001' and option_index = 1 and revision = 2) then raise exception 'Vote replacement or revision failed'; end if;
  begin
    update public.soundspin_poll_votes set user_id = '00000000-0000-4000-8000-000000000002' where user_id = '00000000-0000-4000-8000-000000000001';
    raise exception 'Vote account reassignment allowed';
  exception when check_violation then null; end;
end $$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false);
do $$ begin
  begin perform 1 from public.soundspin_poll_votes; raise exception 'Direct authenticated vote reads allowed'; exception when insufficient_privilege then null; end;
  begin insert into public.soundspin_poll_votes(message_id, room_slug, user_id, option_index) values ('10000000-0000-4000-8000-000000000005', 'private-room', '00000000-0000-4000-8000-000000000001', 0); raise exception 'Direct vote INSERT bypassed admission'; exception when insufficient_privilege then null; end;
  begin update public.soundspin_poll_votes set option_index = 0; raise exception 'Direct vote UPDATE bypassed admission'; exception when insufficient_privilege then null; end;
  begin delete from public.soundspin_poll_votes; raise exception 'Direct vote DELETE bypassed admission'; exception when insufficient_privilege then null; end;
  begin perform public.soundspin_guard_poll_vote(); raise exception 'Trigger function is public'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role anon;
do $$ begin
  begin perform 1 from public.soundspin_poll_votes; raise exception 'Anonymous vote SELECT allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;

do $$ begin
  if not (select relrowsecurity from pg_class where oid = 'public.soundspin_poll_votes'::regclass) then raise exception 'Poll votes lack RLS'; end if;
  if has_table_privilege('service_role', 'public.soundspin_poll_votes', 'DELETE') then raise exception 'Vote server has unnecessary DELETE privilege'; end if;
end $$;
-- Cascading deletion preserves ordinary chat cleanup.
set role service_role;
delete from public.soundspin_messages where id = '10000000-0000-4000-8000-000000000004';
do $$ begin
  if exists (select 1 from public.soundspin_poll_votes) then raise exception 'Message deletion orphaned votes'; end if;
end $$;
reset role;
