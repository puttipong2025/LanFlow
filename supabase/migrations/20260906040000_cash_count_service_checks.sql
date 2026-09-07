-- Service-role maintenance and integration fixtures still evaluate table
-- CHECK expressions, so permit only the pure cash-count validators they call.

grant execute on function private.cash_count_total(jsonb) to service_role;
grant execute on function private.cash_count_counts_valid(jsonb) to service_role;
grant execute on function private.cash_count_difference_valid(jsonb) to service_role;
