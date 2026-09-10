-- The public wrapper delegates to legacy feed functions whose volatility is
-- VOLATILE. Do not promise STABLE semantics across that call boundary.
alter function public.get_income_expense_operational_feed(uuid, text, text, text)
  volatile;

comment on function public.get_income_expense_operational_feed(uuid, text, text, text) is
  'Authenticated Income/Expense operational feed. VOLATILE matches its delegated feed functions.';

notify pgrst, 'reload schema';
