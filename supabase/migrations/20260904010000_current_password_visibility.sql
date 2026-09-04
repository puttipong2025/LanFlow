-- Store the user-confirmed current password for the single Super Admin display flow.
-- Supabase Auth remains the authentication source of truth.

alter table public.profiles
  add column if not exists current_password_plaintext text;

comment on column public.profiles.current_password_plaintext is
  'Current password display copy. Server-only, nullable, overwritten on password changes, never audited.';

revoke select (current_password_plaintext) on public.profiles from public, anon, authenticated;

create or replace function public.is_current_auth_session_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    auth.uid() is not null
    and nullif(auth.jwt() ->> 'session_id', '') is not null
    and exists (
      select 1
      from auth.sessions s
      where s.id = (auth.jwt() ->> 'session_id')::uuid
        and s.user_id = auth.uid()
        and (s.not_after is null or s.not_after > now())
    ),
    false
  )
$$;

revoke all on function public.is_current_auth_session_active() from public, anon;
grant execute on function public.is_current_auth_session_active() to authenticated;

notify pgrst, 'reload schema';
