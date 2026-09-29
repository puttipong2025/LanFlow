-- RLS does not protect server-only columns when a role keeps table-level SELECT.
-- Anonymous callers do not need any readable profile columns.

revoke select on table public.profiles from public, anon;

revoke select (
  current_password_plaintext,
  current_password_auth_version
) on table public.profiles from public, anon, authenticated;

notify pgrst, 'reload schema';
