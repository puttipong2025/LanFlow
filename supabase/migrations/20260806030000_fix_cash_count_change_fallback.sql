-- Keep Cash Count calculation functions warning-free and preserve the selected
-- overpayment amount after the bounded change-search loop.

create or replace function private.cash_exact_take(
  p_available bigint[],
  p_target bigint,
  p_position integer default 1
)
returns bigint[]
language plpgsql
immutable
set search_path = public, private
as $$
declare
  v_denoms constant bigint[] := array[1000,500,100,50,20,10,5,2,1];
  v_result bigint[];
  v_max_take bigint;
  v_min_take bigint;
  v_suffix_total bigint := 0;
  v_attempts integer := 0;
begin
  if p_target < 0 or p_position > 9 then return null; end if;
  if p_position = 9 then
    if p_target <= p_available[9] then
      v_result := array_fill(0::bigint, array[9]);
      v_result[9] := p_target;
      return v_result;
    end if;
    return null;
  end if;

  for v_i in (p_position + 1)..9 loop
    v_suffix_total := v_suffix_total + p_available[v_i] * v_denoms[v_i];
  end loop;
  v_max_take := least(p_available[p_position], p_target / v_denoms[p_position]);
  v_min_take := greatest(0, ceil(greatest(0, p_target - v_suffix_total)::numeric / v_denoms[p_position])::bigint);

  if v_min_take > v_max_take then return null; end if;
  for v_take in reverse v_max_take..v_min_take loop
    v_attempts := v_attempts + 1;
    exit when v_attempts > 256;
    v_result := private.cash_exact_take(
      p_available,
      p_target - v_take * v_denoms[p_position],
      p_position + 1
    );
    if v_result is not null then
      v_result[p_position] := v_take;
      return v_result;
    end if;
  end loop;
  return null;
end;
$$;

create or replace function private.cash_change_counts(p_amount bigint)
returns bigint[]
language plpgsql
immutable
set search_path = public, private
as $$
declare
  v_denoms constant bigint[] := array[1000,500,100,50,20,10,5,2,1];
  v_counts bigint[] := array_fill(0::bigint, array[9]);
  v_remaining bigint := p_amount;
begin
  if p_amount < 0 then return null; end if;
  for v_i in 1..9 loop
    v_counts[v_i] := v_remaining / v_denoms[v_i];
    v_remaining := v_remaining % v_denoms[v_i];
  end loop;
  return v_counts;
end;
$$;

create or replace function public.submit_cash_count(
  p_session_id uuid,
  p_actual_counts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_session public.cash_count_sessions%rowtype;
  v_previous public.cash_counts%rowtype;
  v_actor record;
  v_report jsonb;
  v_count_id uuid;
  v_actual_total numeric;
  v_expected_total numeric;
  v_expected bigint[];
  v_actual bigint[];
  v_take bigint[];
  v_event record;
  v_event_counts bigint[];
  v_target bigint;
  v_difference jsonb;
  v_difference_total numeric;
  v_positive_value numeric := 0;
  v_churn_value numeric := 0;
  v_total_component integer;
  v_denom_component integer;
  v_pattern_component integer;
  v_score integer;
  v_confidence integer := 100;
  v_status text;
  v_formula text := 'cash-v1';
  v_high_conf_history integer := 0;
  v_pattern_baseline numeric := 0;
  v_simulated_count integer := 0;
  v_unknown_count integer := 0;
  v_allocation_failures integer := 0;
  v_fractional_count integer := 0;
  v_change_count integer := 0;
  v_change_amount bigint := 0;
  v_selected_delta bigint;
  v_available_total bigint;
  v_change bigint[];
  v_highlights jsonb := '[]'::jsonb;
  v_limitations jsonb := '[]'::jsonb;
  v_references jsonb := '[]'::jsonb;
begin
  if not private.cash_count_counts_valid(p_actual_counts) then
    raise exception 'จำนวนเงินสดต้องมีครบ 9 ชนิดและเป็นจำนวนเต็มตั้งแต่ 0';
  end if;
  select * into v_session from public.cash_count_sessions where id = p_session_id for update;
  if v_session.id is null or not private.can_use_cash_count(v_session.location_id) then
    raise exception 'ไม่พบช่วงตรวจนับหรือไม่มีสิทธิ์';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_session.location_id::text, 0));
  if v_session.status <> 'active' then raise exception 'ช่วงตรวจนับนี้สิ้นสุดแล้ว'; end if;
  if v_session.started_by_user_id <> auth.uid() then
    raise exception 'เฉพาะผู้เริ่มตรวจนับเท่านั้นที่ส่งผลได้';
  end if;
  if v_session.expires_at <= v_now then
    update public.cash_count_sessions set status = 'expired', ended_at = v_now where id = p_session_id;
    raise exception 'ช่วงตรวจนับหมดเวลาแล้ว กรุณาเริ่มใหม่';
  end if;

  select * into v_previous from public.cash_counts c
  where c.location_id = v_session.location_id and c.status = 'active'
  order by c.created_at desc, c.id desc limit 1;
  select p.name, p.phone into v_actor from public.profiles p where p.id = auth.uid();
  v_report := private.create_report_batch_at(v_session.location_id, v_session.cutoff_at, auth.uid());
  v_actual := private.cash_json_to_array(p_actual_counts);
  v_actual_total := private.cash_count_total(p_actual_counts);

  if v_previous.id is null then
    insert into public.cash_counts (
      session_id, report_id, location_id, cutoff_at,
      actual_counts, actual_total, expected_counts, expected_total,
      difference_counts, difference_total, formula_version, evidence,
      created_by_user_id, created_by_name, created_by_phone, created_at
    ) values (
      v_session.id, (v_report->>'id')::uuid, v_session.location_id, v_session.cutoff_at,
      p_actual_counts, v_actual_total, p_actual_counts, v_actual_total,
      jsonb_build_object('1',0,'2',0,'5',0,'10',0,'20',0,'50',0,'100',0,'500',0,'1000',0),
      0, 'cash-v1-baseline',
      jsonb_build_object(
        'highlights', jsonb_build_array('รอบแรกใช้จำนวนที่นับเป็นฐานสำหรับรอบถัดไป'),
        'limitations', jsonb_build_array('ยังไม่มีฐานก่อนหน้าจึงไม่คำนวณคะแนนหรือความเชื่อมั่น'),
        'references', '[]'::jsonb,
        'components', jsonb_build_object('total', null, 'denomination', null, 'pattern', null)
      ), auth.uid(), coalesce(v_actor.name,''), coalesce(v_actor.phone,''), v_now
    ) returning id into v_count_id;
  else
    v_expected := private.cash_json_to_array(v_previous.actual_counts);
    v_expected_total := v_previous.actual_total;

    for v_event in
      select * from private.cash_count_events(v_session.location_id, v_previous.cutoff_at, v_session.cutoff_at)
      order by occurred_at, (reference->>'id')
    loop
      v_references := v_references || jsonb_build_array(v_event.reference || jsonb_build_object('kind', v_event.event_kind, 'occurredAt', v_event.occurred_at));
      if v_event.event_kind = 'known_in' then
        v_event_counts := private.cash_json_to_array(v_event.counts);
        for v_i in 1..9 loop v_expected[v_i] := v_expected[v_i] + v_event_counts[v_i]; end loop;
        v_expected_total := v_expected_total + v_event.amount;
      elsif v_event.event_kind = 'known_out' then
        v_event_counts := private.cash_json_to_array(v_event.counts);
        for v_i in 1..9 loop
          if v_expected[v_i] < v_event_counts[v_i] then v_allocation_failures := v_allocation_failures + 1; end if;
          v_expected[v_i] := greatest(0, v_expected[v_i] - v_event_counts[v_i]);
        end loop;
        v_expected_total := v_expected_total - v_event.amount;
      elsif v_event.event_kind = 'expense' then
        v_target := round(v_event.amount)::bigint;
        if v_event.amount <> v_target then v_fractional_count := v_fractional_count + 1; end if;
        v_take := private.cash_exact_take(v_expected, v_target);
        v_simulated_count := v_simulated_count + 1;
        if v_take is null then
          v_available_total := 0;
          v_selected_delta := null;
          for v_i in 1..9 loop
            v_available_total := v_available_total + v_expected[v_i] * (array[1000,500,100,50,20,10,5,2,1]::bigint[])[v_i];
          end loop;
          if v_available_total >= v_target then
            for v_try_delta in 1..least(999, v_available_total - v_target) loop
              v_take := private.cash_exact_take(v_expected, v_target + v_try_delta);
              if v_take is not null then
                v_selected_delta := v_try_delta;
                exit;
              end if;
            end loop;
          end if;
          if v_take is null then
            v_allocation_failures := v_allocation_failures + 1;
          else
            v_change := private.cash_change_counts(v_selected_delta);
            for v_i in 1..9 loop v_expected[v_i] := v_expected[v_i] - v_take[v_i] + v_change[v_i]; end loop;
            v_change_count := v_change_count + 1;
            v_change_amount := v_change_amount + v_selected_delta;
          end if;
        else
          for v_i in 1..9 loop v_expected[v_i] := v_expected[v_i] - v_take[v_i]; end loop;
        end if;
        v_expected_total := v_expected_total - v_event.amount;
      elsif v_event.event_kind = 'income' then
        v_expected_total := v_expected_total + v_event.amount;
        v_unknown_count := v_unknown_count + 1;
      end if;
    end loop;

    v_difference := jsonb_build_object(
      '1000', v_actual[1]-v_expected[1], '500', v_actual[2]-v_expected[2],
      '100', v_actual[3]-v_expected[3], '50', v_actual[4]-v_expected[4],
      '20', v_actual[5]-v_expected[5], '10', v_actual[6]-v_expected[6],
      '5', v_actual[7]-v_expected[7], '2', v_actual[8]-v_expected[8],
      '1', v_actual[9]-v_expected[9]
    );
    v_difference_total := v_actual_total - v_expected_total;
    for v_i in 1..9 loop
      v_churn_value := v_churn_value + abs(v_actual[v_i]-v_expected[v_i]) * (array[1000,500,100,50,20,10,5,2,1]::bigint[])[v_i];
      if v_actual[v_i] > v_expected[v_i] then
        v_positive_value := v_positive_value + (v_actual[v_i]-v_expected[v_i]) * (array[1000,500,100,50,20,10,5,2,1]::bigint[])[v_i];
      end if;
    end loop;
    v_total_component := least(70, round(abs(v_difference_total) / greatest(abs(v_expected_total) * 0.05, 500) * 70)::integer);
    v_denom_component := least(20, round(v_positive_value / greatest(abs(v_expected_total) * 0.10, 500) * 20)::integer);
    v_pattern_component := least(10, round(greatest(0, v_churn_value - abs(v_difference_total)) / greatest(abs(v_expected_total) * 0.20, 1000) * 10)::integer);

    select count(*), coalesce(avg((c.evidence->'components'->>'pattern')::numeric), 0)
    into v_high_conf_history, v_pattern_baseline from public.cash_counts c
    where c.location_id = v_session.location_id and c.status = 'active' and c.confidence >= 80;
    if v_high_conf_history >= 10 then
      v_pattern_component := least(10, round(greatest(0, v_pattern_component - v_pattern_baseline * 0.5))::integer);
      v_formula := 'cash-v1-adaptive';
    end if;
    v_score := least(100, v_total_component + v_denom_component + v_pattern_component);
    v_confidence := greatest(0,
      100 - least(30, v_simulated_count * 3) - least(30, v_unknown_count * 10)
      - least(36, v_change_count * 12) - least(50, v_allocation_failures * 20)
      - least(20, v_fractional_count * 5)
    );
    v_status := case
      when v_confidence < 50 then 'insufficient_data'
      when v_score < 25 then 'normal'
      when v_score < 60 then 'review'
      else 'high_anomaly'
    end;

    if v_difference_total <> 0 then
      v_highlights := v_highlights || jsonb_build_array(format('ยอดเงินจริงต่างจากยอดคาดการณ์ %s บาท', to_char(abs(v_difference_total), 'FM999G999G999G990D00')));
    end if;
    if v_positive_value > 0 and jsonb_array_length(v_highlights) < 3 then
      v_highlights := v_highlights || jsonb_build_array(format('พบเงินบางชนิดเพิ่มจากแบบจำลองรวม %s บาท', to_char(v_positive_value, 'FM999G999G999G990D00')));
    end if;
    if v_pattern_component > 0 and jsonb_array_length(v_highlights) < 3 then
      v_highlights := v_highlights || jsonb_build_array('สัดส่วนชนิดเงินเปลี่ยนจากลำดับจ่ายที่จำลองไว้');
    end if;
    if jsonb_array_length(v_highlights) = 0 then
      v_highlights := jsonb_build_array('ยอดรวมและชนิดเงินสอดคล้องกับข้อมูลที่คำนวณได้');
    end if;
    if v_simulated_count > 0 then v_limitations := v_limitations || jsonb_build_array(format('จำลองการจ่ายเงินสด %s รายการจากชนิดเงินตั้งต้น', v_simulated_count)); end if;
    if v_change_count > 0 then v_limitations := v_limitations || jsonb_build_array(format('จำลองรับเงินทอน %s ครั้ง รวม %s บาท', v_change_count, v_change_amount)); end if;
    if v_unknown_count > 0 then v_limitations := v_limitations || jsonb_build_array(format('มีเงินสดเข้า %s รายการที่ไม่ทราบชนิดเงิน', v_unknown_count)); end if;
    if v_allocation_failures > 0 then v_limitations := v_limitations || jsonb_build_array(format('จัดชนิดเงินให้ตรงยอดไม่ได้ %s จุด', v_allocation_failures)); end if;
    if v_fractional_count > 0 then v_limitations := v_limitations || jsonb_build_array(format('มี %s รายการที่ต้องปัดเป็นบาทเพื่อจำลองชนิดเงิน', v_fractional_count)); end if;
    if jsonb_array_length(v_limitations) = 0 then v_limitations := jsonb_build_array('ไม่พบข้อจำกัดสำคัญของข้อมูลรอบนี้'); end if;

    insert into public.cash_counts (
      session_id, report_id, location_id, previous_cash_count_id, cutoff_at,
      actual_counts, actual_total, expected_counts, expected_total,
      difference_counts, difference_total, anomaly_score, confidence, analysis_status,
      formula_version, evidence, created_by_user_id, created_by_name, created_by_phone, created_at
    ) values (
      v_session.id, (v_report->>'id')::uuid, v_session.location_id, v_previous.id, v_session.cutoff_at,
      p_actual_counts, v_actual_total, private.cash_array_to_json(v_expected), v_expected_total,
      v_difference, v_difference_total, v_score, v_confidence, v_status, v_formula,
      jsonb_build_object(
        'highlights', v_highlights, 'limitations', v_limitations, 'references', v_references,
        'components', jsonb_build_object('total',v_total_component,'denomination',v_denom_component,'pattern',v_pattern_component),
        'adaptiveHistoryCount', v_high_conf_history, 'adaptivePatternBaseline', v_pattern_baseline
      ), auth.uid(), coalesce(v_actor.name,''), coalesce(v_actor.phone,''), v_now
    ) returning id into v_count_id;
  end if;

  update public.cash_count_sessions set status = 'submitted', ended_at = v_now where id = v_session.id;
  return jsonb_build_object(
    'id', v_count_id, 'reportId', v_report->>'id', 'reportNo', v_report->>'reportNo',
    'cutoffAt', v_session.cutoff_at, 'submittedAt', v_now,
    'countedByName', coalesce(v_actor.name,''), 'actualCounts', p_actual_counts, 'actualTotal', v_actual_total
  );
end;
$$;
