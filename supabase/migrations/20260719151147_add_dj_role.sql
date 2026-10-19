alter table public.soundspin_room_members
  drop constraint if exists soundspin_room_members_role_check;

alter table public.soundspin_room_members
  add constraint soundspin_room_members_role_check
  check (role in ('owner', 'moderator', 'dj', 'member'));
