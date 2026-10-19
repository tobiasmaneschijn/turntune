alter table public.soundspin_feedback
  add column category text not null default 'other'
    check (category in ('bug', 'idea', 'playback', 'chat', 'account', 'other')),
  add column impact text not null default 'minor'
    check (impact in ('minor', 'blocking', 'unusable')),
  add column diagnostics jsonb not null default '{}'::jsonb
    check (jsonb_typeof(diagnostics) = 'object')
    check (pg_column_size(diagnostics) <= 16384);

comment on column public.soundspin_feedback.diagnostics is
  'User-approved, sanitized technical context. Must not contain tokens, cookies, query strings, clipboard text, or message history.';

create index soundspin_feedback_category_created_at_idx
  on public.soundspin_feedback(category, created_at desc);
