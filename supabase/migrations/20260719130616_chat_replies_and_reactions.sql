alter table public.soundspin_messages
  add column reply_to_id uuid;

alter table public.soundspin_messages
  add constraint soundspin_messages_id_room_unique unique (id, room_slug),
  add constraint soundspin_messages_reply_same_room_fk
    foreign key (reply_to_id, room_slug)
    references public.soundspin_messages(id, room_slug)
    on delete set null (reply_to_id);

create index soundspin_messages_reply_to_idx
  on public.soundspin_messages(reply_to_id)
  where reply_to_id is not null;

create table public.soundspin_message_reactions (
  message_id uuid not null references public.soundspin_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create index soundspin_message_reactions_user_idx
  on public.soundspin_message_reactions(user_id);

alter table public.soundspin_message_reactions enable row level security;

grant select, insert, delete on public.soundspin_message_reactions to authenticated;

create policy "authenticated users can read message reactions"
  on public.soundspin_message_reactions
  for select
  to authenticated
  using (true);

create policy "users can add their own message reactions"
  on public.soundspin_message_reactions
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "users can remove their own message reactions"
  on public.soundspin_message_reactions
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
