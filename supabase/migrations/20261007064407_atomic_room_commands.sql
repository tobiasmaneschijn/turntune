-- The service commits radio state, metadata and an optional role change together.
-- Client roles have no EXECUTE permission; this function does not elevate privileges.
create function public.soundspin_commit_room(
  p_slug text,
  p_state jsonb,
  p_metadata jsonb default '{}'::jsonb,
  p_member jsonb default null
) returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  committed_slug text;
begin
  update public.soundspin_rooms
  set state = p_state,
      name = case when p_metadata ? 'name' then p_metadata->>'name' else name end,
      is_public = case when p_metadata ? 'is_public' then (p_metadata->>'is_public')::boolean else is_public end,
      password_hash = case when p_metadata ? 'password_hash' then p_metadata->>'password_hash' else password_hash end,
      settings = case when p_metadata ? 'settings' then p_metadata->'settings' else settings end,
      updated_at = now()
  where slug = p_slug
  returning slug into committed_slug;
  if committed_slug is null then return null; end if;

  if p_member is not null then
    insert into public.soundspin_room_members (room_slug, user_id, role, updated_at)
    values (p_slug, (p_member->>'user_id')::uuid, p_member->>'role', now())
    on conflict (room_slug, user_id) do update
      set role = excluded.role, updated_at = excluded.updated_at;
  end if;
  return committed_slug;
end;
$$;

revoke all on function public.soundspin_commit_room(text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.soundspin_commit_room(text, jsonb, jsonb, jsonb) to service_role;
