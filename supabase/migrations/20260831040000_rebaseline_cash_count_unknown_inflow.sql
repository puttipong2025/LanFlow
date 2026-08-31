-- Rebaseline a cash count when its interval contains an inflow without denominations.

begin;

do $migration$
declare
  v_definition text := pg_get_functiondef(
    'public.submit_cash_count(uuid,jsonb)'::regprocedure
  );
  v_branch_start_old text := $old$  else
    v_expected := private.cash_json_to_array(v_previous.actual_counts);$old$;
  v_branch_start_new text := $new$  else
    select coalesce(
      jsonb_agg(
        event.reference || jsonb_build_object(
          'kind', event.event_kind,
          'occurredAt', event.occurred_at
        )
        order by event.occurred_at, event.reference->>'id'
      ),
      '[]'::jsonb
    )
    into v_references
    from private.cash_count_events(
      v_session.location_id,
      v_previous.cutoff_at,
      v_session.cutoff_at
    ) event
    where event.event_kind = 'income'
      and event.amount > 0
      and event.counts is null;

    if jsonb_array_length(v_references) > 0 then
      insert into public.cash_counts (
        session_id, report_id, location_id, cutoff_at,
        actual_counts, actual_total, expected_counts, expected_total,
        difference_counts, difference_total, formula_version, evidence,
        created_by_user_id, created_by_name, created_by_phone, created_at
      ) values (
        v_session.id, (v_report->>'id')::uuid, v_session.location_id, v_session.cutoff_at,
        p_actual_counts, v_actual_total, p_actual_counts, v_actual_total,
        jsonb_build_object('1',0,'2',0,'5',0,'10',0,'20',0,'50',0,'100',0,'500',0,'1000',0),
        0, 'cash-v1-rebaseline',
        jsonb_build_object(
          'highlights', jsonb_build_array('ตั้งฐานเงินสดใหม่จากผลนับจริง เนื่องจากมีเงินเข้าที่ไม่ทราบชนิดเงิน'),
          'limitations', jsonb_build_array('ไม่คำนวณส่วนต่าง คะแนนพิรุธ หรือความเชื่อมั่นในรอบตั้งฐานใหม่'),
          'references', v_references,
          'components', jsonb_build_object('total', null, 'denomination', null, 'pattern', null)
        ), auth.uid(), coalesce(v_actor.name,''), coalesce(v_actor.phone,''), v_now
      ) returning id into v_count_id;
    else
      v_expected := private.cash_json_to_array(v_previous.actual_counts);$new$;
  v_branch_end_old text := $old$    ) returning id into v_count_id;
  end if;

  update public.cash_count_sessions set status = 'submitted', ended_at = v_now where id = v_session.id;$old$;
  v_branch_end_new text := $new$    ) returning id into v_count_id;
    end if;
  end if;

  update public.cash_count_sessions set status = 'submitted', ended_at = v_now where id = v_session.id;$new$;
begin
  -- pg_get_functiondef() stores the function body's original line endings.
  -- Normalize both the live definition and migration anchors so this guarded
  -- replacement behaves the same for LF and CRLF checkouts.
  v_definition := replace(v_definition, chr(13) || chr(10), chr(10));
  v_branch_start_old := replace(v_branch_start_old, chr(13) || chr(10), chr(10));
  v_branch_start_new := replace(v_branch_start_new, chr(13) || chr(10), chr(10));
  v_branch_end_old := replace(v_branch_end_old, chr(13) || chr(10), chr(10));
  v_branch_end_new := replace(v_branch_end_new, chr(13) || chr(10), chr(10));

  if (length(v_definition) - length(replace(v_definition, v_branch_start_old, ''))) / length(v_branch_start_old) <> 1 then
    raise exception 'CASH_COUNT_REBASELINE_START_ANCHOR_MISMATCH';
  end if;
  if (length(v_definition) - length(replace(v_definition, v_branch_end_old, ''))) / length(v_branch_end_old) <> 1 then
    raise exception 'CASH_COUNT_REBASELINE_END_ANCHOR_MISMATCH';
  end if;

  v_definition := replace(v_definition, v_branch_start_old, v_branch_start_new);
  execute replace(v_definition, v_branch_end_old, v_branch_end_new);
end
$migration$;

notify pgrst, 'reload schema';

commit;
