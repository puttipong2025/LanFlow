insert into public.rubber_bill_approval_settings (id)
values (true)
on conflict (id) do nothing;

insert into public.income_expense_approval_settings (id)
values (true)
on conflict (id) do nothing;
