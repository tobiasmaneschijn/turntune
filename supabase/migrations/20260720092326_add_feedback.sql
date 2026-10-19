create table public.soundspin_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message text check (message is null or char_length(message) between 1 and 4000),
  screenshot_paths text[] not null default '{}',
  room_slug text,
  page_path text not null,
  viewport jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (message is not null or cardinality(screenshot_paths) > 0),
  check (cardinality(screenshot_paths) <= 5)
);

create index soundspin_feedback_user_id_created_at_idx
  on public.soundspin_feedback(user_id, created_at desc);

alter table public.soundspin_feedback enable row level security;

grant insert on table public.soundspin_feedback to authenticated;

create policy "users can submit their own feedback"
  on public.soundspin_feedback
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'feedback-screenshots',
  'feedback-screenshots',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "users can upload their own feedback screenshots"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'feedback-screenshots'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "users can remove their own feedback screenshots"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'feedback-screenshots'
    and owner_id = (select auth.uid()::text)
  );
