-- Poll definitions are part of the immutable chat message. Votes are server-only.
create function public.soundspin_valid_poll_options(options text[])
returns boolean
language sql immutable strict
set search_path = ''
as $$
  select cardinality(options) between 2 and 4
    and array_ndims(options) = 1 and array_lower(options, 1) = 1
    and not exists (
      select 1 from unnest(options) as label
      where label is null or char_length(label) not between 1 and 80 or label <> btrim(label)
    )
    and (select count(distinct lower(label)) from unnest(options) as label) = cardinality(options);
$$;
revoke all on function public.soundspin_valid_poll_options(text[]) from public, anon, authenticated;
grant execute on function public.soundspin_valid_poll_options(text[]) to service_role;

alter table public.soundspin_messages
  add column poll_options text[],
  add constraint soundspin_messages_poll_options_check check (
    poll_options is null or (
      message_type = 'text' and char_length(content) between 1 and 200
      and content = btrim(content) and public.soundspin_valid_poll_options(poll_options)
    )
  );

create table public.soundspin_poll_votes (
  message_id uuid not null,
  room_slug text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  option_index smallint not null check (option_index between 0 and 3),
  revision integer not null default 1 check (revision > 0),
  primary key (message_id, user_id),
  constraint soundspin_poll_votes_same_room_fk foreign key (message_id, room_slug)
    references public.soundspin_messages(id, room_slug) on delete cascade
);
create index soundspin_poll_votes_user_idx on public.soundspin_poll_votes(user_id);
alter table public.soundspin_poll_votes enable row level security;
revoke all on public.soundspin_poll_votes from public, anon, authenticated, service_role;
grant select, insert, update on public.soundspin_poll_votes to service_role;

-- ON CONFLICT locks each account's vote before this UPDATE trigger increments its
-- revision, so delayed HTTP/socket responses cannot replace a newer accepted vote.
create function public.soundspin_guard_poll_vote()
returns trigger
language plpgsql
set search_path = ''
as $$
declare options text[];
begin
  if tg_op = 'UPDATE' then
    if new.message_id <> old.message_id or new.user_id <> old.user_id or new.room_slug <> old.room_slug then
      raise exception 'A poll vote cannot change its message, room, or account.' using errcode = '23514';
    end if;
    new.revision := old.revision + 1;
  else
    new.revision := 1;
  end if;
  select poll_options into options from public.soundspin_messages
    where id = new.message_id and room_slug = new.room_slug;
  if options is null or new.option_index < 0 or new.option_index >= cardinality(options) then
    raise exception 'This poll option is unavailable.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.soundspin_guard_poll_vote() from public, anon, authenticated;
grant execute on function public.soundspin_guard_poll_vote() to service_role;
create trigger soundspin_poll_votes_guard
  before insert or update on public.soundspin_poll_votes
  for each row execute function public.soundspin_guard_poll_vote();
