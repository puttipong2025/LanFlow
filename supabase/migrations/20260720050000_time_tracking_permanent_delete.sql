-- User-requested permanent deletion for Time Tracking debt/withdrawal history
-- and payroll slips. This supersedes soft cancellation for deletion actions.

create or replace function private.prevent_hard_delete_of_linked_time_tracking_source()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if current_setting('app.time_tracking_permanent_delete_rpc', true) = 'true' then
    return old;
  end if;

  if tg_table_name = 'financial_transactions'
    and old.type = 'WITHDRAWAL'
    and old.status = 'APPROVED'
    and old.expense_location_id is not null then
    raise exception 'Approved withdrawal must be permanently deleted through the time tracking RPC';
  end if;

  if tg_table_name = 'payroll_slips'
    and old.status = 'APPROVED'
    and old.net_pay > 0
    and old.expense_location_id is not null then
    raise exception 'Approved payroll slip must be permanently deleted through the time tracking RPC';
  end if;

  return old;
end;
$$;

create or replace function public.delete_time_tracking_source_permanently(
  p_source_type text,
  p_source_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_tx public.financial_transactions%rowtype;
  v_slip public.payroll_slips%rowtype;
begin
  if v_actor_id is null or not private.is_active_user() then
    raise exception 'Authentication required';
  end if;
  if p_source_type not in ('transaction', 'payroll_slip') then
    raise exception 'Invalid deletion source';
  end if;

  select role::text into v_actor_role from public.profiles where id = v_actor_id;

  if p_source_type = 'transaction' then
    select * into v_tx from public.financial_transactions where id = p_source_id for update;
    if not found or v_tx.type not in ('DEBT', 'WITHDRAWAL') then
      raise exception 'Transaction not found';
    end if;

    if v_tx.status = 'APPROVED' and v_tx.type = 'WITHDRAWAL' and v_tx.expense_location_id is not null then
      if not private.can_approve_time_tracking_profile(v_tx.profile_id) then
        raise exception 'Forbidden';
      end if;
    elsif v_tx.status = 'APPROVED' and v_actor_role <> 'super_admin' then
      raise exception 'Only super_admin can delete approved records';
    elsif v_actor_role <> 'super_admin' and v_tx.profile_id <> v_actor_id then
      raise exception 'Forbidden';
    end if;

    if exists (
      select 1
      from public.payroll_slips
      where profile_id = v_tx.profile_id
        and month = to_char(v_tx.created_at, 'YYYY-MM')
    ) then
      raise exception 'ไม่สามารถลบได้เนื่องจากมีการออกสลิปเงินเดือนของเดือนนี้ไปแล้ว โปรดลบสลิปเงินเดือนก่อน';
    end if;

    delete from public.time_tracking_audit_logs
    where target_table = 'financial_transactions'
      and (
        record_id = v_tx.id
        or record_id in (select id from public.financial_transactions where parent_debt_id = v_tx.id)
      );

    perform set_config('app.time_tracking_permanent_delete_rpc', 'true', true);
    delete from public.financial_transactions where parent_debt_id = v_tx.id;
    delete from public.financial_transactions where id = v_tx.id;
  else
    select * into v_slip from public.payroll_slips where id = p_source_id for update;
    if not found then
      raise exception 'Payroll slip not found';
    end if;

    if v_slip.status = 'APPROVED' and v_slip.net_pay > 0 and v_slip.expense_location_id is not null then
      if not private.can_approve_time_tracking_profile(v_slip.profile_id) then
        raise exception 'Forbidden';
      end if;
    else
      if not private.can_approve_time_tracking_profile(v_slip.profile_id) then
        raise exception 'Forbidden';
      end if;
      if date_trunc('month', v_slip.created_at) <> date_trunc('month', now()) then
        raise exception 'Cannot delete slips from previous months';
      end if;
      if v_slip.status = 'APPROVED' and v_actor_role <> 'super_admin' then
        raise exception 'Only super_admin can delete approved records';
      end if;
    end if;

    delete from public.time_tracking_audit_logs
    where target_table = 'payroll_slips' and record_id = v_slip.id;

    perform set_config('app.time_tracking_permanent_delete_rpc', 'true', true);
    delete from public.payroll_slips where id = v_slip.id;
  end if;

  return jsonb_build_object('status', 'deleted', 'sourceType', p_source_type, 'sourceId', p_source_id);
end;
$$;

revoke all on function public.delete_time_tracking_source_permanently(text, uuid) from public, anon;
grant execute on function public.delete_time_tracking_source_permanently(text, uuid) to authenticated;
