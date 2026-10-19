alter table public.soundspin_rooms
  add column if not exists is_public boolean not null default true,
  add column if not exists password_hash text,
  add column if not exists settings jsonb not null default '{}'::jsonb;

create index if not exists soundspin_rooms_public_updated_idx
  on public.soundspin_rooms (updated_at desc)
  where is_public = true;

create table if not exists public.soundspin_room_members (
  room_slug text not null references public.soundspin_rooms(slug) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'moderator', 'member')),
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_slug, user_id)
);

create index if not exists soundspin_room_members_user_id_idx
  on public.soundspin_room_members (user_id, role);

create table if not exists public.soundspin_room_favorites (
  room_slug text not null references public.soundspin_rooms(slug) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_slug, user_id)
);

create index if not exists soundspin_room_favorites_user_id_idx
  on public.soundspin_room_favorites (user_id, created_at desc);

insert into public.soundspin_room_members (room_slug, user_id, role)
select slug, owner_id, 'owner'
from public.soundspin_rooms
on conflict (room_slug, user_id) do update set
  role = 'owner',
  updated_at = now();

create schema if not exists private;

create or replace function private.soundspin_sync_room_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.owner_id is distinct from new.owner_id then
    update public.soundspin_room_members
    set role = 'member', updated_at = now()
    where room_slug = new.slug and user_id = old.owner_id and role = 'owner';
  end if;

  insert into public.soundspin_room_members (room_slug, user_id, role)
  values (new.slug, new.owner_id, 'owner')
  on conflict (room_slug, user_id) do update set
    role = 'owner',
    updated_at = now();

  return new;
end;
$$;

revoke execute on function private.soundspin_sync_room_owner() from public, anon, authenticated;

drop trigger if exists soundspin_sync_room_owner on public.soundspin_rooms;
create trigger soundspin_sync_room_owner
after insert or update of owner_id on public.soundspin_rooms
for each row execute function private.soundspin_sync_room_owner();

alter table public.soundspin_room_members enable row level security;
alter table public.soundspin_room_favorites enable row level security;

revoke all on public.soundspin_rooms from anon, authenticated;
revoke all on public.soundspin_room_members from anon, authenticated;
revoke all on public.soundspin_room_favorites from anon, authenticated;

grant select, insert, update, delete on public.soundspin_rooms to service_role;
grant select, insert, update, delete on public.soundspin_room_members to service_role;
grant select, insert, update, delete on public.soundspin_room_favorites to service_role;
