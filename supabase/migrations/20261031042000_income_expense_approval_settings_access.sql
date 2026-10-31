-- Keep management reads (including disabled keywords), restrict configuration writes.
drop policy if exists income_expense_approval_settings_system_manager_write on public.income_expense_approval_settings;
drop policy if exists income_expense_approval_keywords_system_manager_write on public.income_expense_approval_keywords;

create policy income_expense_approval_keywords_manager_read
  on public.income_expense_approval_keywords for select to authenticated
  using (public.can_access_super_admin_features());

create policy income_expense_approval_settings_super_admin_insert
  on public.income_expense_approval_settings for insert to authenticated
  with check (public.is_super_admin());
create policy income_expense_approval_settings_super_admin_update
  on public.income_expense_approval_settings for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy income_expense_approval_keywords_super_admin_insert
  on public.income_expense_approval_keywords for insert to authenticated
  with check (public.is_super_admin());
create policy income_expense_approval_keywords_super_admin_update
  on public.income_expense_approval_keywords for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- Configuration audit timestamps come from PostgreSQL, including direct REST writes.
create trigger income_expense_approval_settings_updated_at
  before update on public.income_expense_approval_settings
  for each row execute function extensions.moddatetime(updated_at);
create trigger income_expense_approval_keywords_updated_at
  before update on public.income_expense_approval_keywords
  for each row execute function extensions.moddatetime(updated_at);
