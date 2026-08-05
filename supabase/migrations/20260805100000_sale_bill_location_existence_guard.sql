-- A super admin can access every real location, but an unknown UUID must never
-- reach stock preflight or expose product balances.
create or replace function public.create_income_expense_approval_request(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_location_id uuid := nullif(payload->>'locationId', '')::uuid;
begin
  if payload->>'billOption' = 'บิลขาย'
     and payload->>'operation' in ('create', 'update') then
    if not coalesce(private.is_active_user(), false) then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'Unauthorized or inactive user');
    end if;
    if v_location_id is null
       or not exists (select 1 from public.locations where id = v_location_id)
       or not public.can_access_location(v_location_id) then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'Location access denied');
    end if;
    return jsonb_build_object('status', 'no_approval');
  end if;

  return private.create_income_expense_approval_request_20260805080000(payload);
exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$$;

revoke all on function public.create_income_expense_approval_request(jsonb) from public, anon;
grant execute on function public.create_income_expense_approval_request(jsonb) to authenticated;
