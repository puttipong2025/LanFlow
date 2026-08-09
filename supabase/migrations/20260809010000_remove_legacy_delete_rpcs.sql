begin;

revoke all on function public.cancel_time_tracking_expense_source(text, uuid, text)
from public, anon, authenticated, service_role;

revoke all on function public.delete_income_sale_item(uuid)
from public, anon, authenticated, service_role;

drop function public.cancel_time_tracking_expense_source(text, uuid, text);
drop function public.delete_income_sale_item(uuid);

commit;
