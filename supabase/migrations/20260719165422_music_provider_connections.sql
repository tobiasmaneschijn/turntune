create table public.soundspin_music_connections (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('spotify')),
  refresh_token_ciphertext text not null,
  scopes text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

alter table public.soundspin_music_connections enable row level security;

-- Provider credentials are an app-server concern. Even the owning browser
-- must use authenticated server endpoints and never read token rows directly.
revoke all on public.soundspin_music_connections from anon, authenticated;
grant select, insert, update, delete on public.soundspin_music_connections to service_role;
