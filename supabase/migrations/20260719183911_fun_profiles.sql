alter table public.soundspin_unlocks
  drop constraint if exists soundspin_unlocks_kind_check;

alter table public.soundspin_unlocks
  add constraint soundspin_unlocks_kind_check
  check (kind in ('avatar', 'theme', 'badge'));

insert into public.soundspin_unlocks (key, kind, name, required_level, metadata)
values
  ('studio', 'theme', 'Studio', 1, '{"description":"The classic SoundSpin look."}'),
  ('afterglow', 'theme', 'Afterglow', 2, '{"description":"Warm sunset color with a late-night glow."}'),
  ('deep-space', 'theme', 'Deep Space', 4, '{"description":"Cool violet tones from the outer orbit."}'),
  ('laser-lime', 'theme', 'Laser Lime', 6, '{"description":"High-voltage club energy."}'),
  ('first-spin', 'badge', 'First Spin', 1, '{"glyph":"♪","description":"Ready to take a turn behind the decks."}'),
  ('crowd-pleaser', 'badge', 'Crowd Pleaser', 2, '{"glyph":"♥","description":"Your picks are landing with the room."}'),
  ('room-shaker', 'badge', 'Room Shaker', 4, '{"glyph":"✦","description":"A proven source of room-wide energy."}'),
  ('headliner', 'badge', 'Headliner', 7, '{"glyph":"★","description":"A SoundSpin DJ at the top of their game."}')
on conflict (key) do update set
  kind = excluded.kind,
  name = excluded.name,
  required_level = excluded.required_level,
  metadata = excluded.metadata;

alter table public.soundspin_profiles
  add column theme_key text not null default 'studio' references public.soundspin_unlocks(key),
  add column featured_badge_key text not null default 'first-spin' references public.soundspin_unlocks(key),
  add column signature_tracks jsonb not null default '[]'::jsonb,
  add constraint soundspin_profiles_signature_tracks_array_check
    check (jsonb_typeof(signature_tracks) = 'array'),
  add constraint soundspin_profiles_signature_tracks_count_check
    check (jsonb_array_length(signature_tracks) <= 3);

alter table public.soundspin_xp_events
  add column track_title text,
  add column track_artist text;

create or replace view public.soundspin_profile_highlights
with (security_invoker = true)
as
with track_totals as (
  select
    recipient_user_id,
    track_title,
    track_artist,
    count(*)::integer as crowd_wins,
    max(created_at) as last_win
  from public.soundspin_xp_events
  where track_title is not null
  group by recipient_user_id, track_title, track_artist
), ranked_tracks as (
  select
    track_totals.*,
    row_number() over (
      partition by recipient_user_id
      order by crowd_wins desc, last_win desc, track_title
    ) as rank
  from track_totals
), room_totals as (
  select recipient_user_id, count(distinct room_slug)::integer as rooms_played
  from public.soundspin_xp_events
  group by recipient_user_id
)
select
  profiles.user_id,
  coalesce(room_totals.rooms_played, 0)::integer as rooms_played,
  ranked_tracks.track_title as favorite_track_title,
  ranked_tracks.track_artist as favorite_track_artist,
  coalesce(ranked_tracks.crowd_wins, 0)::integer as favorite_track_wins
from public.soundspin_profiles as profiles
left join room_totals on room_totals.recipient_user_id = profiles.user_id
left join ranked_tracks
  on ranked_tracks.recipient_user_id = profiles.user_id
  and ranked_tracks.rank = 1;

revoke all on public.soundspin_profile_highlights from public, anon, authenticated;
grant select on public.soundspin_profile_highlights to service_role;
