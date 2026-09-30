-- Central/outside-system payments intentionally use a null expense_location_id.
-- The approval RPC is still required; branch-backed adjustments remain protected
-- by financial_transactions_adjustment_expense_assignment.
create or replace function private.enforce_time_tracking_expense_relation()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_rpc_write boolean := coalesce(current_setting('app.time_tracking_expense_rpc', true), 'false') = 'true';
begin
  if tg_table_name = 'financial_transactions' then
    if old.status <> 'APPROVED'
      and new.status = 'APPROVED'
      and new.type in ('WITHDRAWAL', 'ADJUSTMENT') then
      if not v_rpc_write
        or new.approved_at is null
        or new.cancelled_at is not null then
        raise exception 'Time tracking financial approval must use the approval RPC';
      end if;
    end if;

    if old.status = 'APPROVED'
      and old.type in ('WITHDRAWAL', 'ADJUSTMENT')
      and (
        new.expense_location_id is distinct from old.expense_location_id
        or new.cancelled_at is distinct from old.cancelled_at
        or new.cancelled_by is distinct from old.cancelled_by
        or new.cancel_reason is distinct from old.cancel_reason
      )
      and not v_rpc_write then
      raise exception 'Time tracking financial relation must be changed through the approval RPC';
    end if;
  elsif tg_table_name = 'payroll_slips' then
    if old.status <> 'APPROVED' and new.status = 'APPROVED' then
      if not v_rpc_write
        or new.approved_at is null
        or new.cancelled_at is not null then
        raise exception 'Payroll approval must use the time tracking approval RPC';
      end if;
    end if;
    if old.status = 'APPROVED'
      and (
        new.expense_location_id is distinct from old.expense_location_id
        or new.cancelled_at is distinct from old.cancelled_at
        or new.cancelled_by is distinct from old.cancelled_by
        or new.cancel_reason is distinct from old.cancel_reason
      )
      and not v_rpc_write then
      raise exception 'Payroll expense relation must be changed at its source through the time tracking RPC';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_time_tracking_expense_relation() from public, anon, authenticated;
