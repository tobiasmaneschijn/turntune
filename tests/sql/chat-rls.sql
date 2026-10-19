-- Run in a disposable PostgreSQL database after the chat schema and read-authorization migration.
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002');
insert into public.soundspin_rooms(slug, owner_id, state) values ('lounge', '00000000-0000-4000-8000-000000000001', '{}'), ('private-room', '00000000-0000-4000-8000-000000000002', '{}');
insert into public.soundspin_messages(id, room_slug, user_id, user_name, avatar_seed, content) values
  ('10000000-0000-4000-8000-000000000001', 'lounge', '00000000-0000-4000-8000-000000000001', 'Alice', 'alice', 'Original owned message'),
  ('10000000-0000-4000-8000-000000000002', 'lounge', '00000000-0000-4000-8000-000000000002', 'Bob', 'bob', 'Other listener message'),
  ('10000000-0000-4000-8000-000000000003', 'private-room', '00000000-0000-4000-8000-000000000002', 'Bob', 'bob', 'Private room message');
insert into public.soundspin_message_reactions(message_id, user_id, emoji) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '❤️'),
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '😂');

set role authenticated;
reset role;
insert into storage.objects(bucket_id, name, owner_id) values
('chat-media', '00000000-0000-4000-8000-000000000001/lounge/20000000-0000-4000-8000-000000000001.png', '00000000-0000-4000-8000-000000000001'),
('chat-media', '00000000-0000-4000-8000-000000000002/private-room/20000000-0000-4000-8000-000000000002.png', '00000000-0000-4000-8000-000000000002');
do $$ begin if exists (select 1 from storage.buckets where id = 'chat-media' and public) then raise exception 'Chat media bucket remains public'; end if; end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false);
do $$ begin
  if (select count(*) from public.soundspin_messages) <> 1 then raise exception 'RLS exposed another listener message'; end if;
  if (select count(*) from public.soundspin_messages where room_slug = 'private-room') <> 0 then raise exception 'RLS exposed unauthorized room messages'; end if;
  if not exists (select 1 from public.soundspin_messages where id = '10000000-0000-4000-8000-000000000001') then raise exception 'Original UUID recovery lookup was denied'; end if;
  if (select count(*) from public.soundspin_message_reactions) <> 1 then raise exception 'RLS exposed another listener reaction'; end if;
  if (select count(*) from storage.objects where bucket_id = 'chat-media') <> 1 then raise exception 'Chat storage metadata exposes another account upload'; end if;
  if exists (select 1 from storage.objects where name like '%private-room%') then raise exception 'Private upload metadata leaked'; end if;
  begin
    insert into public.soundspin_messages(id, room_slug, user_id, user_name, avatar_seed, content) values ('10000000-0000-4000-8000-000000000004', 'lounge', '00000000-0000-4000-8000-000000000002', 'Bob', 'bob', 'Forged author');
    raise exception 'RLS allowed a forged author';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.soundspin_messages(id, room_slug, user_id, user_name, avatar_seed, content) values ('10000000-0000-4000-8000-000000000005', 'private-room', '00000000-0000-4000-8000-000000000001', 'Alice', 'alice', 'Blind owned insert');
    raise exception 'Direct owned INSERT bypassed room admission';
  exception when insufficient_privilege then null; end;
  begin insert into public.soundspin_message_reactions(message_id, user_id, emoji) values ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', '🔥'); raise exception 'Direct reaction INSERT bypassed admission'; exception when insufficient_privilege then null; end;
  begin delete from public.soundspin_message_reactions where user_id = '00000000-0000-4000-8000-000000000001'; raise exception 'Direct reaction DELETE bypassed admission'; exception when insufficient_privilege then null; end;
  begin update public.soundspin_messages set content = 'Edited original UUID'; raise exception 'Direct message UPDATE allowed'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', '', false);
do $$ begin
  if (select count(*) from public.soundspin_messages) <> 0 then raise exception 'A missing auth identity can read messages'; end if;
end $$;
reset role;

set role anon;
do $$ begin
  begin perform 1 from public.soundspin_messages; raise exception 'Anonymous message SELECT is allowed'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.soundspin_message_reactions; raise exception 'Anonymous reaction SELECT is allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;

set role service_role;
do $$ begin
  if (select count(*) from public.soundspin_messages) <> 3 then raise exception 'Authorized server history reader cannot read room rows'; end if;
  if (select count(*) from public.soundspin_message_reactions) <> 2 then raise exception 'Authorized server reaction enrichment is incomplete'; end if;
end $$;
reset role;
