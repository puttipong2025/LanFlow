-- 1. Add WITHDRAWAL_DEDUCTION to enum
ALTER TYPE financial_transaction_type ADD VALUE IF NOT EXISTS 'WITHDRAWAL_DEDUCTION';

-- 2. Update the deduct_debts_daily function
CREATE OR REPLACE FUNCTION public.deduct_debts_daily()
RETURNS void AS $$
DECLARE
  v_debt record;
  v_user_wage numeric;
  v_current_month_start timestamp with time zone;
  v_total_ms numeric;
  v_total_days numeric;
  v_gross_pay numeric;
  v_deduct_amount numeric;
  v_today date;
  v_deduction_type text;
  v_comment text;
BEGIN
  v_today := current_date;
  v_current_month_start := date_trunc('month', current_timestamp AT TIME ZONE 'Asia/Bangkok');
  
  -- Iterate through approved debts and withdrawals that still have remaining balance
  FOR v_debt IN 
    SELECT id, profile_id, remaining_amount, due_date, created_at, type 
    FROM public.financial_transactions 
    WHERE type IN ('DEBT', 'WITHDRAWAL') 
      AND status = 'APPROVED' 
      AND remaining_amount > 0 
  LOOP
    IF v_debt.type = 'DEBT' AND v_debt.due_date IS NOT NULL AND v_debt.due_date > v_today THEN
      CONTINUE;
    END IF;

    SELECT daily_wage INTO v_user_wage FROM public.profiles WHERE id = v_debt.profile_id;
    
    IF v_user_wage IS NULL OR v_user_wage <= 0 THEN
      CONTINUE;
    END IF;

    -- Calculate total time in ms for current month
    SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (end_time - start_time)) * 1000), 0)
    INTO v_total_ms
    FROM public.time_segments
    WHERE profile_id = v_debt.profile_id
      AND end_time IS NOT NULL
      AND start_time >= v_current_month_start;

    -- Calculate gross pay
    v_total_days := v_total_ms / (1000.0 * 60.0 * 60.0 * 8.0);
    v_gross_pay := v_total_days * v_user_wage;

    DECLARE
      v_already_used numeric;
      v_remaining_balance numeric;
    BEGIN
      -- Sum already deducted amounts this month
      SELECT COALESCE(SUM(amount), 0) INTO v_already_used
      FROM public.financial_transactions
      WHERE profile_id = v_debt.profile_id
        AND status = 'APPROVED'
        AND type IN ('WITHDRAWAL_DEDUCTION', 'DEBT_DEDUCTION', 'SALARY')
        AND created_at >= v_current_month_start;
        
      v_remaining_balance := v_gross_pay - v_already_used;

      IF v_remaining_balance <= 0 THEN
        CONTINUE; -- No wage left to deduct from
      END IF;

      -- Calculate deduction amount
      v_deduct_amount := LEAST(v_debt.remaining_amount, v_remaining_balance);
      v_deduct_amount := trunc(v_deduct_amount, 2);

      IF v_deduct_amount <= 0 THEN
        CONTINUE;
      END IF;

      -- Update remaining amount of the debt/withdrawal
      UPDATE public.financial_transactions
      SET remaining_amount = remaining_amount - v_deduct_amount
      WHERE id = v_debt.id;

      -- Determine type and comment
      IF v_debt.type = 'DEBT' THEN
        v_deduction_type := 'DEBT_DEDUCTION';
        v_comment := 'หักหนี้อัตโนมัติประจำวัน';
      ELSE
        v_deduction_type := 'WITHDRAWAL_DEDUCTION';
        v_comment := 'หักยอดเบิกเงินอัตโนมัติประจำวัน';
      END IF;

      -- Insert deduction transaction
      INSERT INTO public.financial_transactions (profile_id, type, amount, status, parent_debt_id, admin_comment)
      VALUES (v_debt.profile_id, v_deduction_type::financial_transaction_type, v_deduct_amount, 'APPROVED', v_debt.id, v_comment);

      -- Insert audit log
      INSERT INTO public.time_tracking_audit_logs (admin_id, action, target_table, record_id, new_data, comment)
      VALUES (
        v_debt.profile_id, 
        'AUTO_DEDUCTION', 
        'financial_transactions', 
        v_debt.id, 
        jsonb_build_object('deducted_amount', v_deduct_amount, 'remaining_amount', v_debt.remaining_amount - v_deduct_amount, 'type', v_deduction_type), 
        v_comment
      );
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
