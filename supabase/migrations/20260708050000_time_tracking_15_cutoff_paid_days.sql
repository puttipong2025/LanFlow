create or replace function public.calculate_time_segment_paid_days(
  p_start_time timestamptz,
  p_end_time timestamptz
)
returns numeric
language plpgsql
stable
as $$
declare
  v_start_bangkok timestamp;
  v_end_bangkok timestamp;
  v_cutoff_bangkok timestamp;
  v_cutoff_days numeric := 0;
  v_duration_days numeric;
begin
  if p_start_time is null or p_end_time is null or p_end_time <= p_start_time then
    return 0;
  end if;

  v_duration_days := extract(epoch from (p_end_time - p_start_time)) / (8.0 * 60.0 * 60.0);
  v_start_bangkok := p_start_time at time zone 'Asia/Bangkok';
  v_end_bangkok := p_end_time at time zone 'Asia/Bangkok';
  v_cutoff_bangkok := date_trunc('day', v_start_bangkok) + interval '15 hours';

  if v_cutoff_bangkok <= v_start_bangkok then
    v_cutoff_bangkok := v_cutoff_bangkok + interval '1 day';
  end if;

  while v_cutoff_bangkok <= v_end_bangkok loop
    v_cutoff_days := v_cutoff_days + 1;
    v_cutoff_bangkok := v_cutoff_bangkok + interval '1 day';
  end loop;

  if v_cutoff_days > 0 then
    return v_cutoff_days;
  end if;

  return v_duration_days;
end;
$$;

create or replace function public.calculate_paid_work_days(
  p_profile_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz default null
)
returns numeric
language sql
stable
as $$
  select coalesce(sum(public.calculate_time_segment_paid_days(start_time, end_time)), 0)
  from public.time_segments
  where profile_id = p_profile_id
    and end_time is not null
    and start_time >= p_period_start
    and (p_period_end is null or start_time < p_period_end);
$$;

revoke all on function public.calculate_time_segment_paid_days(timestamptz, timestamptz) from public, anon;
revoke all on function public.calculate_paid_work_days(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.calculate_time_segment_paid_days(timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.calculate_paid_work_days(uuid, timestamptz, timestamptz) to authenticated, service_role;

create or replace function public.deduct_debts_daily()
returns void as $$
declare
  v_debt record;
  v_user_wage numeric;
  v_current_month_start timestamp with time zone;
  v_total_days numeric;
  v_gross_pay numeric;
  v_deduct_amount numeric;
  v_today date;
  v_deduction_type text;
  v_comment text;
begin
  v_today := current_date;
  v_current_month_start := date_trunc('month', current_timestamp at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok';

  for v_debt in
    select id, profile_id, remaining_amount, due_date, created_at, type
    from public.financial_transactions
    where type in ('DEBT', 'WITHDRAWAL')
      and status = 'APPROVED'
      and remaining_amount > 0
  loop
    if v_debt.type = 'DEBT' and v_debt.due_date is not null and v_debt.due_date > v_today then
      continue;
    end if;

    select daily_wage into v_user_wage from public.profiles where id = v_debt.profile_id;

    if v_user_wage is null or v_user_wage <= 0 then
      continue;
    end if;

    v_total_days := public.calculate_paid_work_days(v_debt.profile_id, v_current_month_start, null);
    v_gross_pay := v_total_days * v_user_wage;

    declare
      v_already_used numeric;
      v_remaining_balance numeric;
    begin
      select coalesce(sum(amount), 0) into v_already_used
      from public.financial_transactions
      where profile_id = v_debt.profile_id
        and status = 'APPROVED'
        and type in ('WITHDRAWAL_DEDUCTION', 'DEBT_DEDUCTION', 'SALARY')
        and created_at >= v_current_month_start;

      v_remaining_balance := v_gross_pay - v_already_used;

      if v_remaining_balance <= 0 then
        continue;
      end if;

      v_deduct_amount := least(v_debt.remaining_amount, v_remaining_balance);
      v_deduct_amount := trunc(v_deduct_amount, 2);

      if v_deduct_amount <= 0 then
        continue;
      end if;

      update public.financial_transactions
      set remaining_amount = remaining_amount - v_deduct_amount
      where id = v_debt.id;

      if v_debt.type = 'DEBT' then
        v_deduction_type := 'DEBT_DEDUCTION';
        v_comment := 'หักหนี้อัตโนมัติประจำวัน';
      else
        v_deduction_type := 'WITHDRAWAL_DEDUCTION';
        v_comment := 'หักยอดเบิกเงินอัตโนมัติประจำวัน';
      end if;

      insert into public.financial_transactions (profile_id, type, amount, status, parent_debt_id, admin_comment)
      values (v_debt.profile_id, v_deduction_type::financial_transaction_type, v_deduct_amount, 'APPROVED', v_debt.id, v_comment);

      insert into public.time_tracking_audit_logs (admin_id, action, target_table, record_id, new_data, comment)
      values (
        v_debt.profile_id,
        'AUTO_DEDUCTION',
        'financial_transactions',
        v_debt.id,
        jsonb_build_object('deducted_amount', v_deduct_amount, 'remaining_amount', v_debt.remaining_amount - v_deduct_amount, 'type', v_deduction_type),
        v_comment
      );
    end;
  end loop;
end;
$$ language plpgsql security definer;
