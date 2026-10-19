alter table public.soundspin_messages
  add column mentions jsonb not null default '[]'::jsonb,
  add constraint soundspin_messages_mentions_array_check
    check (jsonb_typeof(mentions) = 'array'),
  add constraint soundspin_messages_mentions_count_check
    check (jsonb_array_length(mentions) <= 20),
  add constraint soundspin_messages_mentions_size_check
    check (octet_length(mentions::text) <= 4096);
