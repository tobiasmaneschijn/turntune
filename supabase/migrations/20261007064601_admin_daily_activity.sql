-- Aggregate in PostgreSQL so API row caps never truncate activity totals.
create index if not exists soundspin_messages_created_at_idx
  on public.soundspin_messages (created_at);
create index if not exists soundspin_profiles_created_at_idx
  on public.soundspin_profiles (created_at);

create function public.soundspin_admin_activity(start_at timestamptz)
returns table (day date, users bigint, feedback bigint, messages bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select activity.day, sum(activity.users)::bigint, sum(activity.feedback)::bigint, sum(activity.messages)::bigint
  from (
    select (created_at at time zone 'UTC')::date as day, count(*) as users, 0::bigint as feedback, 0::bigint as messages
      from public.soundspin_profiles where created_at >= start_at group by 1
    union all
    select (created_at at time zone 'UTC')::date, 0::bigint, count(*), 0::bigint
      from public.soundspin_feedback where created_at >= start_at group by 1
    union all
    select (created_at at time zone 'UTC')::date, 0::bigint, 0::bigint, count(*)
      from public.soundspin_messages where created_at >= start_at group by 1
  ) as activity
  group by activity.day order by activity.day;
$$;
revoke all on function public.soundspin_admin_activity(timestamptz) from public, anon, authenticated;
grant execute on function public.soundspin_admin_activity(timestamptz) to service_role;
