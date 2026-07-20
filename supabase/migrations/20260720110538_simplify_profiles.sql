drop view if exists public.soundspin_profile_highlights;

alter table public.soundspin_profiles
  drop column if exists featured_badge_key,
  drop column if exists signature_tracks,
  drop column if exists xp,
  drop column if exists songs_liked;

delete from public.soundspin_unlocks
where kind = 'badge';

alter table public.soundspin_unlocks
  drop constraint if exists soundspin_unlocks_kind_check;

alter table public.soundspin_unlocks
  add constraint soundspin_unlocks_kind_check
  check (kind in ('avatar', 'theme'));

alter table public.soundspin_unlocks
  drop column if exists required_level;

alter table public.soundspin_unlocks
  rename to soundspin_profile_options;

alter table public.soundspin_profile_options
  rename constraint soundspin_unlocks_kind_check to soundspin_profile_options_kind_check;

alter policy "authenticated users can view unlocks"
  on public.soundspin_profile_options
  rename to "authenticated users can view profile options";

drop table if exists public.soundspin_xp_events;
drop function if exists private.apply_soundspin_xp_event();
