create table if not exists public.soundspin_messages (
  id uuid primary key,
  room_slug text not null references public.soundspin_rooms(slug) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_name text not null check (char_length(user_name) between 1 and 32),
  avatar_seed text not null,
  content text not null check (char_length(content) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists soundspin_messages_room_created_idx
  on public.soundspin_messages(room_slug, created_at);

alter table public.soundspin_messages enable row level security;

grant select, insert on public.soundspin_messages to authenticated;

create policy "authenticated users can read room messages"
  on public.soundspin_messages
  for select
  to authenticated
  using (true);

create policy "users can send their own messages"
  on public.soundspin_messages
  for insert
  to authenticated
  with check (auth.uid() = user_id);
