alter table public.soundspin_profiles
  add column is_app_admin boolean not null default false;

comment on column public.soundspin_profiles.is_app_admin is
  'Trusted application-admin marker. Manage only through the dashboard or another service-role context.';
