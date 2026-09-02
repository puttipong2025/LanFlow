-- The Report Lock trigger serves multiple table row shapes. Read the payroll
-- fields through jsonb so unrelated reported entities never resolve missing
-- record fields while evaluating the trusted settlement exception.

create or replace function private.guard_reported_entity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_report_no text;
begin
  if tg_table_name = 'rubber_exports' and tg_op = 'UPDATE'
     and (to_jsonb(new) - 'sold_out_at' - 'sold_out_by_user_id' - 'sold_out_by_name')
       = (to_jsonb(old) - 'sold_out_at' - 'sold_out_by_user_id' - 'sold_out_by_name') then
    return new;
  end if;

  v_id := case when tg_op = 'DELETE' then old.id else new.id end;
  v_report_no := private.active_report_no(tg_argv[0], v_id);

  if v_report_no is not null then
    if tg_table_name = 'rubber_bills'
      and tg_op = 'UPDATE'
      and (to_jsonb(new)
        - 'print_status'
        - 'updated_at'
        - 'evidence_completion_id'
        - 'evidence_manual_correction_count'
        - 'net_rubber_value'
        - 'net_weight'
        - 'payable_before_rounding'
        - 'has_ocr_source_image')
        = (to_jsonb(old)
        - 'print_status'
        - 'updated_at'
        - 'evidence_completion_id'
        - 'evidence_manual_correction_count'
        - 'net_rubber_value'
        - 'net_weight'
        - 'payable_before_rounding'
        - 'has_ocr_source_image') then
      return new;
    end if;
    if tg_table_name = 'financial_transactions'
      and tg_op = 'UPDATE'
      and coalesce(current_setting('app.time_payroll_settlement_rpc', true), 'false') = 'true'
      and (to_jsonb(old) ->> 'type') in ('DEBT', 'WITHDRAWAL')
      and (to_jsonb(new) ->> 'type') = (to_jsonb(old) ->> 'type')
      and (to_jsonb(old) ->> 'status') = 'APPROVED'
      and (to_jsonb(new) ->> 'status') = (to_jsonb(old) ->> 'status')
      and (to_jsonb(new) ->> 'remaining_amount')::numeric between 0
        and (to_jsonb(new) ->> 'amount')::numeric
      and (to_jsonb(new) - array['remaining_amount', 'updated_at'])
        = (to_jsonb(old) - array['remaining_amount', 'updated_at']) then
      return new;
    end if;
    perform private.raise_report_lock(v_report_no);
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.guard_reported_entity()
  from public, anon, authenticated;
