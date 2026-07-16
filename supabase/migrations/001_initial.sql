create table if not exists public.soundspin_rooms (
  slug text primary key check (slug ~ '^[a-z0-9-]{3,48}$'),
  name text not null check (char_length(name) between 1 and 48),
  owner_id uuid not null references auth.users(id) on delete cascade,
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists soundspin_rooms_owner_id_idx
  on public.soundspin_rooms(owner_id);

alter table public.soundspin_rooms enable row level security;

-- SoundSpin currently reads and writes rooms through its authenticated Node
-- server using the service-role key. With RLS enabled and no public policies,
-- browser clients cannot bypass the room server and mutate state directly.
