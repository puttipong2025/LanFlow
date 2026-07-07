-- Income/expense writes must go through sync_income_expense() so offline replay,
-- idempotency, bill-number allocation, and revision checks stay atomic.

drop policy if exists "income expense location scoped" on public.income_expense;
drop policy if exists "income_expense_location_scope" on public.income_expense;
drop policy if exists "income_expense_select_location_scope" on public.income_expense;

revoke all on table public.income_expense from anon, authenticated;
grant select on table public.income_expense to authenticated;

create policy "income_expense_select_location_scope"
  on public.income_expense for select to authenticated
  using (public.can_access_location(location_id));

grant execute on function public.sync_income_expense(jsonb) to authenticated;
