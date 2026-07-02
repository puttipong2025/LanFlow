-- Harden: revoke default PUBLIC execute, keep only authenticated
revoke all on function public.delete_income_sale_item(uuid) from public;
grant execute on function public.delete_income_sale_item(uuid) to authenticated;
