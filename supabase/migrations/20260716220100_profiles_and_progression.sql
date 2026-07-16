-- Ordered after the existing 20260716220000 migration so hosted deploys apply it.
create schema if not exists private;

create table public.soundspin_unlocks (
  key text primary key,
  kind text not null check (kind in ('avatar')),
  name text not null check (char_length(name) between 1 and 40),
  required_level integer not null check (required_level >= 1),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into public.soundspin_unlocks (key, kind, name, required_level, metadata)
values
  ('pulse', 'avatar', 'Pulse', 1, '{"glyph":"◖◗","gradient":"linear-gradient(135deg,#d8ff57,#568d2f)"}'),
  ('sunset', 'avatar', 'Sunset', 2, '{"glyph":"☀","gradient":"linear-gradient(135deg,#ffb347,#e45368)"}'),
  ('orbit', 'avatar', 'Orbit', 3, '{"glyph":"✦","gradient":"linear-gradient(135deg,#65d8ff,#5c55cf)"}'),
  ('midnight', 'avatar', 'Midnight', 4, '{"glyph":"☾","gradient":"linear-gradient(135deg,#8476ff,#24203f)"}'),
  ('prism', 'avatar', 'Prism', 5, '{"glyph":"◆","gradient":"linear-gradient(135deg,#ff69c8,#6c5cff,#55e6c1)"}'),
  ('voltage', 'avatar', 'Voltage', 7, '{"glyph":"⚡","gradient":"linear-gradient(135deg,#faff72,#10a7a1)"}')
on conflict (key) do update set
  name = excluded.name,
  required_level = excluded.required_level,
  metadata = excluded.metadata;

create table public.soundspin_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 32),
  bio text not null default '' check (char_length(bio) <= 160),
  avatar_key text not null default 'pulse' references public.soundspin_unlocks(key),
  xp bigint not null default 0 check (xp >= 0),
  songs_liked bigint not null default 0 check (songs_liked >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.soundspin_xp_events (
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  room_slug text not null,
  track_id uuid not null,
  reason text not null check (reason in ('track_liked')),
  amount smallint not null check (amount between 1 and 100),
  created_at timestamptz not null default now(),
  primary key (recipient_user_id, room_slug, track_id, reason)
);

create index soundspin_xp_events_user_created_idx
  on public.soundspin_xp_events(recipient_user_id, created_at desc);

alter table public.soundspin_unlocks enable row level security;
alter table public.soundspin_profiles enable row level security;
alter table public.soundspin_xp_events enable row level security;

revoke all on public.soundspin_unlocks, public.soundspin_profiles, public.soundspin_xp_events from anon, authenticated;
grant select on public.soundspin_unlocks, public.soundspin_profiles to authenticated;
grant select, insert, update on public.soundspin_unlocks, public.soundspin_profiles, public.soundspin_xp_events to service_role;

create policy "authenticated users can view unlocks"
  on public.soundspin_unlocks
  for select
  to authenticated
  using (true);

create policy "authenticated users can view profiles"
  on public.soundspin_profiles
  for select
  to authenticated
  using (true);

create or replace function private.create_soundspin_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.soundspin_profiles (user_id, display_name)
  values (
    new.id,
    left(
      coalesce(
        nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
        nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
        'Listener'
      ),
      32
    )
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke execute on function private.create_soundspin_profile() from public, anon, authenticated;

drop trigger if exists create_soundspin_profile_after_signup on auth.users;
create trigger create_soundspin_profile_after_signup
  after insert on auth.users
  for each row execute function private.create_soundspin_profile();

insert into public.soundspin_profiles (user_id, display_name)
select
  users.id,
  left(
    coalesce(
      nullif(trim(users.raw_user_meta_data ->> 'display_name'), ''),
      nullif(split_part(coalesce(users.email, ''), '@', 1), ''),
      'Listener'
    ),
    32
  )
from auth.users as users
on conflict (user_id) do nothing;

create or replace function private.apply_soundspin_xp_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.soundspin_profiles
  set
    xp = xp + new.amount,
    songs_liked = songs_liked + case when new.reason = 'track_liked' then 1 else 0 end,
    updated_at = now()
  where user_id = new.recipient_user_id;
  return new;
end;
$$;

revoke execute on function private.apply_soundspin_xp_event() from public, anon, authenticated;

create trigger apply_soundspin_xp_after_insert
  after insert on public.soundspin_xp_events
  for each row execute function private.apply_soundspin_xp_event();
