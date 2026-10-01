-- Cancelled Time/Payroll sources are immutable audit history. Reject them at
-- the public decision boundary before the legacy internal mutator is reached.
create or replace function public.decide_time_tracking_approval(
  p_source_type text,
  p_source_id uuid,
  p_decision text,
  p_comment text default null,
  p_expense_location_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.has_time_payroll_manager_access() then
    raise exception 'Forbidden';
  end if;

  if (
    p_source_type = 'transaction'
    and exists (
      select 1
      from public.financial_transactions source
      where source.id = p_source_id
        and source.cancelled_at is not null
    )
  ) or (
    p_source_type = 'payroll_slip'
    and exists (
      select 1
      from public.payroll_slips source
      where source.id = p_source_id
        and source.cancelled_at is not null
    )
  ) then
    raise exception 'Approval has already been decided';
  end if;

  return public.decide_time_tracking_approval_internal_20260829(
    p_source_type,
    p_source_id,
    p_decision,
    p_comment,
    p_expense_location_id
  );
end
$$;

revoke all on function public.decide_time_tracking_approval(text, uuid, text, text, uuid)
  from public, anon;
grant execute on function public.decide_time_tracking_approval(text, uuid, text, text, uuid)
  to authenticated;

notify pgrst, 'reload schema';
