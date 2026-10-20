-- Pins reference authoritative messages; clients reach them through fresh room admission.
create table public.soundspin_chat_pins (
  message_id uuid primary key references public.soundspin_messages(id) on delete cascade,
  room_slug text not null check (room_slug ~ '^[a-z0-9-]{3,48}$'),
  pinned_by uuid not null,
  pinned_at timestamptz not null default now()
);
create index soundspin_chat_pins_room_time_idx on public.soundspin_chat_pins(room_slug, pinned_at desc, message_id desc);
alter table public.soundspin_chat_pins enable row level security;
revoke all on public.soundspin_chat_pins from public, anon, authenticated;
grant select, insert, update, delete on public.soundspin_chat_pins to service_role;

create function public.soundspin_set_chat_pin(p_room text, p_user uuid, p_message uuid, p_pinned boolean)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare target public.soundspin_messages; changed boolean;
begin
  if p_room is null or p_room !~ '^[a-z0-9-]{3,48}$' or p_user is null or p_message is null or p_pinned is null then
    raise exception 'Invalid pinned message.';
  end if;
  -- Use the same lock as durable chat sends/removals, before locking the target row.
  perform pg_advisory_xact_lock(hashtextextended('chat:' || p_room, 0));
  if not p_pinned then
    delete from public.soundspin_chat_pins where message_id = p_message and room_slug = p_room;
    return found;
  end if;
  select * into target from public.soundspin_messages where id = p_message and room_slug = p_room for update;
  if target.id is null or target.removed_at is not null then raise exception 'This message is unavailable.'; end if;
  if exists(select 1 from public.soundspin_chat_pins where message_id = p_message and room_slug = p_room) then return false; end if;
  if (select count(*) from public.soundspin_chat_pins where room_slug = p_room) >= 50 then
    raise exception 'This room has 50 pinned messages. Unpin one first.';
  end if;
  insert into public.soundspin_chat_pins(message_id, room_slug, pinned_by) values(p_message, p_room, p_user)
    on conflict(message_id) do nothing;
  changed := found;
  return changed;
end;
$$;
revoke all on function public.soundspin_set_chat_pin(text, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.soundspin_set_chat_pin(text, uuid, uuid, boolean) to service_role;

create function public.soundspin_remove_message_pin() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.soundspin_chat_pins where message_id = new.id;
  return new;
end;
$$;
revoke all on function public.soundspin_remove_message_pin() from public, anon, authenticated;
grant execute on function public.soundspin_remove_message_pin() to service_role;
create trigger soundspin_remove_message_pin after update of removed_at on public.soundspin_messages
  for each row when (new.removed_at is not null) execute function public.soundspin_remove_message_pin();

notify pgrst, 'reload schema';
