-- Saved recordings contain metadata only, never room queues or contributor identities.
-- Retained until owner deletion; deleting the auth account cascades the library.
create table public.soundspin_private_libraries (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{"picks":[],"sets":[]}'::jsonb,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint library_object check (jsonb_typeof(data) = 'object'),
  constraint library_arrays check (data ? 'picks' and data ? 'sets' and jsonb_typeof(data->'picks') = 'array' and jsonb_typeof(data->'sets') = 'array'),
  constraint library_limits check (jsonb_array_length(data->'picks') <= 500 and jsonb_array_length(data->'sets') <= 30),
  constraint library_set_track_limits check (not jsonb_path_exists(data, '$.sets[*] ? (!exists(@.tracks) || @.tracks.type() != "array" || @.tracks.size() < 1 || @.tracks.size() > 50)')),
  constraint library_size check (octet_length(data::text) <= 4000000)
);
alter table public.soundspin_private_libraries enable row level security;
revoke all on public.soundspin_private_libraries from anon, authenticated;
grant select, insert, update, delete on public.soundspin_private_libraries to authenticated, service_role;
create policy library_owner_select on public.soundspin_private_libraries for select to authenticated
  using ((select auth.uid()) = user_id);
create policy library_owner_insert on public.soundspin_private_libraries for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy library_owner_update on public.soundspin_private_libraries for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy library_owner_delete on public.soundspin_private_libraries for delete to authenticated
  using ((select auth.uid()) = user_id);
comment on table public.soundspin_private_libraries is
  'Owner-private reusable picks and named sets, retained until owner deletion; auth-account deletion cascades. Server validates 50-track set bound and metadata schema; revision enables compare-and-swap writes.';
