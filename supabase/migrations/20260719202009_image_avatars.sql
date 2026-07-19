alter table public.soundspin_profiles
  add column avatar_url text,
  add column avatar_path text,
  add constraint soundspin_profiles_avatar_source_check
    check ((avatar_url is null) = (avatar_path is null)),
  add constraint soundspin_profiles_avatar_path_owner_check
    check (
      avatar_path is null
      or avatar_path ~ ('^' || user_id::text || '/[0-9a-f-]{36}\.(jpg|png|webp|gif)$')
    );

update public.soundspin_unlocks
set metadata = metadata || jsonb_build_object('imageUrl', '/avatars/' || key || '.svg')
where kind = 'avatar';

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'profile-avatars',
  'profile-avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "users can upload their own avatars"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "users can delete their own avatars"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and owner_id = (select auth.uid()::text)
  );
