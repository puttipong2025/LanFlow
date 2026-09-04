-- Prevent a delayed concurrent write from exposing a password that is no longer current in Supabase Auth.

alter table public.profiles
  add column if not exists current_password_auth_updated_at text;

comment on column public.profiles.current_password_auth_updated_at is
  'Opaque auth.users.updated_at value paired with current_password_plaintext for stale-copy detection.';

revoke select (current_password_auth_updated_at) on public.profiles from public, anon, authenticated;

notify pgrst, 'reload schema';
