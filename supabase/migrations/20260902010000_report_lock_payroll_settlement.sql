-- Keep reported source facts immutable while allowing the private payroll
-- deduction engine to advance an approved debt or withdrawal balance.

alter function private.apply_time_tracking_deductions(uuid, date)
  rename to apply_time_tracking_deductions_internal_20260902;

revoke all on function private.apply_time_tracking_deductions_internal_20260902(uuid, date)
  from public, anon, authenticated;

create or replace function private.apply_time_tracking_deductions(
  p_profile_id uuid,
  p_through_month date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_flag text := current_setting('app.time_payroll_settlement_rpc', true);
  v_result jsonb;
begin
  perform set_config('app.time_payroll_settlement_rpc', 'true', true);
  begin
    v_result := private.apply_time_tracking_deductions_internal_20260902(
      p_profile_id,
      p_through_month
    );
  exception when others then
    perform set_config(
      'app.time_payroll_settlement_rpc',
      coalesce(nullif(v_previous_flag, ''), 'false'),
      true
    );
    raise;
  end;
  perform set_config(
    'app.time_payroll_settlement_rpc',
    coalesce(nullif(v_previous_flag, ''), 'false'),
    true
  );
  return v_result;
end;
$$;

revoke all on function private.apply_time_tracking_deductions(uuid, date)
  from public, anon, authenticated;
