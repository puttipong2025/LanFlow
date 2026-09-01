-- Generated columns are null in NEW during BEFORE triggers. Exclude the OCR
-- projection together with the isolated Weight Evidence fields so a reported
-- bill can still claim and persist evidence without weakening business locks.
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
    perform private.raise_report_lock(v_report_no);
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.guard_reported_entity()
  from public, anon, authenticated;
