alter table public.soundspin_feedback
  add column status text not null default 'new'
    check (status in ('new', 'reviewing', 'planned', 'resolved', 'closed')),
  add column admin_note text not null default ''
    check (char_length(admin_note) <= 2000),
  add column updated_at timestamptz not null default now();

create index soundspin_feedback_created_at_idx
  on public.soundspin_feedback(created_at desc);

create index soundspin_feedback_open_created_at_idx
  on public.soundspin_feedback(status, created_at desc)
  where status in ('new', 'reviewing', 'planned');

grant select on table
  public.soundspin_feedback,
  public.soundspin_profiles,
  public.soundspin_rooms,
  public.soundspin_messages
to service_role;

grant update (status, admin_note, updated_at)
  on table public.soundspin_feedback
  to service_role;

comment on column public.soundspin_feedback.status is
  'Admin-managed workflow state for the feedback inbox.';

comment on column public.soundspin_feedback.admin_note is
  'Private note visible only through the server-authorized admin dashboard.';
