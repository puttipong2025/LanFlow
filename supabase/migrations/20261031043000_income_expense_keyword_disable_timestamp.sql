-- Preserve the existing disable audit without trusting a browser timestamp.
create function private.stamp_income_expense_keyword_disable()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  if old.is_active and not new.is_active then new.deleted_at := clock_timestamp(); end if;
  return new;
end;
$$;
revoke all on function private.stamp_income_expense_keyword_disable() from public, anon, authenticated;
drop trigger income_expense_approval_keywords_updated_at on public.income_expense_approval_keywords;
create trigger income_expense_approval_keywords_updated_at
  before update on public.income_expense_approval_keywords
  for each row execute function private.stamp_income_expense_keyword_disable();
