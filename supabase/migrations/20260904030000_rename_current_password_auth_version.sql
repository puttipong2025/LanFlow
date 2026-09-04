-- The paired value is an explicit password-copy UUID in Auth user metadata, not auth.users.updated_at.

alter table public.profiles
  rename column current_password_auth_updated_at to current_password_auth_version;

comment on column public.profiles.current_password_auth_version is
  'Opaque UUID mirrored in Auth user metadata and paired with current_password_plaintext for stale-copy detection.';

revoke select (current_password_auth_version) on public.profiles from public, anon, authenticated;

notify pgrst, 'reload schema';
