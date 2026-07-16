alter table public.soundspin_messages
  add column if not exists message_type text not null default 'text'
    check (message_type in ('text', 'image', 'gif')),
  add column if not exists media_url text,
  add column if not exists storage_path text;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'chat-media',
  'chat-media',
  true,
  6291456,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "authenticated users can view chat media metadata"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'chat-media');

create policy "users can upload their own chat media"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "users can delete their own chat media"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'chat-media'
    and owner_id = (select auth.uid()::text)
  );
