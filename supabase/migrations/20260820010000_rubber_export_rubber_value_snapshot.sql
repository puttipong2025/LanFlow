-- Snapshot rubber value separately from actual paid cost for Rubber Exports.

begin;

alter table public.rubber_exports
  add column rubber_value_total numeric(14,2);

alter table public.rubber_export_items
  add column rubber_value_amount numeric(14,2);

comment on column public.rubber_exports.rubber_value_total is
  'Immutable selected-bill rubber value snapshot; distinct from actual paid_total.';
comment on column public.rubber_export_items.rubber_value_amount is
  'Immutable source bill rubber value snapshot; distinct from actual paid_amount.';

lock table public.rubber_bills, public.rubber_export_items, public.rubber_exports
  in access exclusive mode;

create temporary table rubber_export_paid_snapshot_before
on commit drop
as
select
  (select count(*) from public.rubber_exports) export_count,
  (select md5(coalesce(string_agg(
     e.id::text || ':' || e.paid_total::text,
     ',' order by e.id
   ), '')) from public.rubber_exports e) export_checksum,
  (select count(*) from public.rubber_export_items) item_count,
  (select md5(coalesce(string_agg(
     i.id::text || ':' || i.paid_amount::text,
     ',' order by i.id
   ), '')) from public.rubber_export_items i) item_checksum;

create temporary table rubber_export_receipt_snapshot_before
on commit drop
as
select
  count(*) receipt_count,
  md5(coalesce(string_agg(
    concat_ws(':',
      b.id::text,
      b.rubber_value::text,
      b.average_price::text,
      b.deduction_total::text,
      b.net_total::text,
      b.source_rubber_export_id::text,
      b.source_export_no,
      b.received_at::text,
      b.received_age_hours::text,
      b.received_age_is_estimated::text
    ), ',' order by b.id
  ), '')) receipt_checksum
from public.rubber_bills b
where b.source_rubber_export_id is not null;

do $$
declare
  v_count bigint;
  v_ids text;
begin
  select count(*), (
    select string_agg(format('%s/%s', drift.export_id, drift.item_id), ', ')
    from (
      select i.export_id, i.id item_id
      from public.rubber_export_items i
      left join public.rubber_bills b on b.id = i.source_bill_id
      where b.id is null
      order by i.export_id, i.id
      limit 10
    ) drift
  )
  into v_count, v_ids
  from public.rubber_export_items i
  left join public.rubber_bills b on b.id = i.source_bill_id
  where b.id is null;
  if v_count > 0 then
    raise exception 'RUBBER_EXPORT_RUBBER_VALUE_SOURCE_MISSING count=% ids=%', v_count, v_ids;
  end if;

  select count(*), (
    select string_agg(format('%s/%s', drift.export_id, drift.item_id), ', ')
    from (
      select i.export_id, i.id item_id
      from public.rubber_export_items i
      join public.rubber_bills b on b.id = i.source_bill_id
      where i.paid_amount is distinct from round(
        case when b.source_rubber_export_id is not null
          then b.rubber_value else b.net_total end,
        2
      )
      order by i.export_id, i.id
      limit 10
    ) drift
  )
  into v_count, v_ids
  from public.rubber_export_items i
  join public.rubber_bills b on b.id = i.source_bill_id
  where i.paid_amount is distinct from round(
    case when b.source_rubber_export_id is not null
      then b.rubber_value else b.net_total end,
    2
  );
  if v_count > 0 then
    raise exception 'RUBBER_EXPORT_PAID_SOURCE_DRIFT count=% ids=%', v_count, v_ids;
  end if;

  select count(*), (
    select string_agg(drift.id::text, ', ')
    from (
      select e.id
      from public.rubber_exports e
      left join (
        select i.export_id, round(sum(i.paid_amount), 2) paid_total
        from public.rubber_export_items i
        group by i.export_id
      ) totals on totals.export_id = e.id
      where totals.export_id is null
        or e.paid_total is distinct from totals.paid_total
      order by e.id
      limit 10
    ) drift
  )
  into v_count, v_ids
  from public.rubber_exports e
  left join (
    select i.export_id, round(sum(i.paid_amount), 2) paid_total
    from public.rubber_export_items i
    group by i.export_id
  ) totals on totals.export_id = e.id
  where totals.export_id is null
    or e.paid_total is distinct from totals.paid_total;
  if v_count > 0 then
    raise exception 'RUBBER_EXPORT_PAID_TOTAL_DRIFT count=% ids=%', v_count, v_ids;
  end if;

  select count(*), (
    select string_agg(format('%s/%s', drift.export_id, drift.item_id), ', ')
    from (
      select i.export_id, i.id item_id
      from public.rubber_export_items i
      join public.rubber_bills b on b.id = i.source_bill_id
      where case when b.source_rubber_export_id is not null
          then b.rubber_value else b.net_rubber_value end is null
        or round(
          case when b.source_rubber_export_id is not null
            then b.rubber_value else b.net_rubber_value end,
          2
        ) <= 0
      order by i.export_id, i.id
      limit 10
    ) drift
  )
  into v_count, v_ids
  from public.rubber_export_items i
  join public.rubber_bills b on b.id = i.source_bill_id
  where case when b.source_rubber_export_id is not null
      then b.rubber_value else b.net_rubber_value end is null
    or round(
      case when b.source_rubber_export_id is not null
        then b.rubber_value else b.net_rubber_value end,
      2
    ) <= 0;
  if v_count > 0 then
    raise exception 'RUBBER_EXPORT_RUBBER_VALUE_INVALID count=% ids=%', v_count, v_ids;
  end if;

  if exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'rubber_exports'
      and t.tgname in ('guard_rubber_export_state', 'report_lock_rubber_exports')
      and t.tgenabled <> 'O'
  ) or (
    select count(*)
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'rubber_exports'
      and t.tgname in ('guard_rubber_export_state', 'report_lock_rubber_exports')
  ) <> 2 then
    raise exception 'RUBBER_EXPORT_BACKFILL_TRIGGER_STATE_INVALID';
  end if;
end;
$$;


update public.rubber_export_items i
set rubber_value_amount = round(
  case when b.source_rubber_export_id is not null
    then b.rubber_value else b.net_rubber_value end,
  2
)
from public.rubber_bills b
where b.id = i.source_bill_id;

alter table public.rubber_exports disable trigger guard_rubber_export_state;
alter table public.rubber_exports disable trigger report_lock_rubber_exports;

update public.rubber_exports e
set rubber_value_total = totals.rubber_value_total
from (
  select i.export_id, round(sum(i.rubber_value_amount), 2) rubber_value_total
  from public.rubber_export_items i
  group by i.export_id
) totals
where totals.export_id = e.id;

do $$
begin
  if exists (
    select 1 from public.rubber_export_items i
    where i.rubber_value_amount is null or i.rubber_value_amount <= 0
  ) then
    raise exception 'RUBBER_EXPORT_RUBBER_VALUE_ITEM_BACKFILL_INCOMPLETE';
  end if;
  if exists (
    select 1
    from public.rubber_exports e
    left join (
      select i.export_id, round(sum(i.rubber_value_amount), 2) rubber_value_total
      from public.rubber_export_items i
      group by i.export_id
    ) totals on totals.export_id = e.id
    where e.rubber_value_total is null
      or e.rubber_value_total <= 0
      or e.rubber_value_total is distinct from totals.rubber_value_total
  ) then
    raise exception 'RUBBER_EXPORT_RUBBER_VALUE_TOTAL_BACKFILL_INCOMPLETE';
  end if;
  if exists (
    select 1
    from rubber_export_paid_snapshot_before before
    where before.export_count <> (select count(*) from public.rubber_exports)
      or before.export_checksum <> (
        select md5(coalesce(string_agg(
          e.id::text || ':' || e.paid_total::text,
          ',' order by e.id
        ), '')) from public.rubber_exports e
      )
      or before.item_count <> (select count(*) from public.rubber_export_items)
      or before.item_checksum <> (
        select md5(coalesce(string_agg(
          i.id::text || ':' || i.paid_amount::text,
          ',' order by i.id
        ), '')) from public.rubber_export_items i
      )
  ) then
    raise exception 'RUBBER_EXPORT_PAID_SNAPSHOT_CHANGED';
  end if;
  if exists (
    select 1
    from rubber_export_receipt_snapshot_before before
    cross join lateral (
      select
        count(*) receipt_count,
        md5(coalesce(string_agg(
          concat_ws(':',
            b.id::text,
            b.rubber_value::text,
            b.average_price::text,
            b.deduction_total::text,
            b.net_total::text,
            b.source_rubber_export_id::text,
            b.source_export_no,
            b.received_at::text,
            b.received_age_hours::text,
            b.received_age_is_estimated::text
          ), ',' order by b.id
        ), '')) receipt_checksum
      from public.rubber_bills b
      where b.source_rubber_export_id is not null
    ) after
    where before.receipt_count <> after.receipt_count
       or before.receipt_checksum <> after.receipt_checksum
  ) then
    raise exception 'RUBBER_EXPORT_EXISTING_RECEIPT_CHANGED';
  end if;
end;
$$;

-- Flush deferred dashboard/report constraint-trigger events queued by the
-- header backfill before ALTER TABLE. The two mutation guards stay disabled
-- until the immutable snapshot guard has been updated below.
set constraints all immediate;

-- Capture the exact dependency/definition inventory before changing a TABLE return shape.
-- Exact RESTRICT drops below remain the enforcement mechanism; CASCADE is intentionally forbidden.
create temporary table rubber_export_candidate_definition_inventory
on commit drop
as
select p.oid::regprocedure::text identity, pg_get_functiondef(p.oid) definition
from pg_proc p
where p.oid in (
  'private.rubber_export_candidates(uuid,uuid[],uuid)'::regprocedure,
  'private.rubber_export_candidates(uuid,uuid[])'::regprocedure,
  'private.validate_rubber_export_selection(uuid,uuid[],uuid)'::regprocedure,
  'private.validate_rubber_export_selection(uuid,uuid[])'::regprocedure,
  'public.get_rubber_export_available_bills(uuid)'::regprocedure,
  'public.preview_rubber_export(uuid,uuid[],uuid)'::regprocedure,
  'public.preview_rubber_export(uuid,uuid[])'::regprocedure,
  'public.create_rubber_export(uuid,uuid[])'::regprocedure,
  'public.replace_rubber_export_items(uuid,uuid[])'::regprocedure
);

create temporary table rubber_export_candidate_dependency_inventory
on commit drop
as
select
  pg_describe_object(d.classid, d.objid, d.objsubid) dependent_object,
  pg_describe_object(d.refclassid, d.refobjid, d.refobjsubid) referenced_object,
  d.deptype
from pg_depend d
where d.refclassid = 'pg_proc'::regclass
  and d.refobjid in (
    'private.rubber_export_candidates(uuid,uuid[],uuid)'::regprocedure,
    'private.rubber_export_candidates(uuid,uuid[])'::regprocedure
  );

drop function public.get_rubber_export_available_bills(uuid) restrict;
drop function public.preview_rubber_export(uuid, uuid[]) restrict;
drop function public.preview_rubber_export(uuid, uuid[], uuid) restrict;
drop function public.create_rubber_export(uuid, uuid[]) restrict;
drop function public.replace_rubber_export_items(uuid, uuid[]) restrict;
drop function private.validate_rubber_export_selection(uuid, uuid[]) restrict;
drop function private.validate_rubber_export_selection(uuid, uuid[], uuid) restrict;
drop function private.rubber_export_candidates(uuid, uuid[]) restrict;
drop function private.rubber_export_candidates(uuid, uuid[], uuid) restrict;

create function private.rubber_export_candidates(
  p_location_id uuid,
  p_selected_report_item_ids uuid[],
  p_current_export_id uuid
)
returns table (
  report_item_id uuid, bill_id uuid, bill_date date, bill_no text,
  customer_name text, eligibility_at timestamptz, net_weight numeric,
  paid_amount numeric, rubber_value_amount numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.id,
    b.id,
    b.bill_date,
    coalesce(b.server_bill_no, nullif(b.local_bill_no, ''), nullif(b.bill_no, ''), left(b.id::text, 8)),
    coalesce(b.customer_name, ''),
    i.eligibility_at,
    b.net_weight,
    round(case when b.source_rubber_export_id is not null then b.rubber_value else b.net_total end, 2),
    round(case when b.source_rubber_export_id is not null then b.rubber_value else b.net_rubber_value end, 2)
  from public.report_items i
  join public.report_batches r on r.id = i.report_id
  join public.rubber_bills b on b.id = i.entity_id
  where i.location_id = p_location_id
    and i.entity_type = 'rubber_bill'
    and i.active = true
    and (p_selected_report_item_ids is null or i.id = any(p_selected_report_item_ids))
    and r.status = 'active'
    and b.location_id = p_location_id
    and b.record_status = 'active'
    and not exists (
      select 1
      from public.rubber_export_items x
      where x.location_id = p_location_id
        and x.source_bill_id = b.id
        and x.active = true
        and (p_current_export_id is null or x.export_id <> p_current_export_id)
    )
  order by i.eligibility_at, b.id;
$$;

create function private.rubber_export_candidates(
  p_location_id uuid,
  p_selected_report_item_ids uuid[]
)
returns table (
  report_item_id uuid, bill_id uuid, bill_date date, bill_no text,
  customer_name text, eligibility_at timestamptz, net_weight numeric,
  paid_amount numeric, rubber_value_amount numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select *
  from private.rubber_export_candidates(
    p_location_id, p_selected_report_item_ids, null::uuid
  );
$$;

create function private.validate_rubber_export_selection(
  p_location_id uuid,
  p_selected_report_item_ids uuid[],
  p_current_export_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_selected_count integer;
  v_candidate_count integer;
  v_invalid text;
begin
  v_selected_count := coalesce(cardinality(p_selected_report_item_ids), 0);
  if v_selected_count = 0 then
    raise exception 'RUBBER_EXPORT_SELECTION_EMPTY: กรุณาเลือกบิลอย่างน้อย 1 ใบ'
      using errcode = 'P0001';
  end if;
  if (select count(distinct selected_id) from unnest(p_selected_report_item_ids) selected_id)
    <> v_selected_count then
    raise exception 'RUBBER_EXPORT_SELECTION_DUPLICATE: พบบิลที่เลือกซ้ำ'
      using errcode = 'P0001';
  end if;

  select count(*)::integer into v_candidate_count
  from private.rubber_export_candidates(
    p_location_id, p_selected_report_item_ids, p_current_export_id
  );
  if v_candidate_count <> v_selected_count then
    raise exception 'RUBBER_EXPORT_SELECTION_STALE: บิลที่เลือกบางรายการไม่พร้อมส่งออกแล้ว'
      using errcode = 'P0001', hint = 'รีเฟรชรายการบิลแล้วเลือกใหม่';
  end if;

  select string_agg(c.bill_no, ', ' order by c.eligibility_at, c.bill_id)
  into v_invalid
  from private.rubber_export_candidates(
    p_location_id, p_selected_report_item_ids, p_current_export_id
  ) c
  where c.net_weight <= 0 or c.paid_amount <= 0 or c.rubber_value_amount <= 0;
  if v_invalid is not null then
    raise exception 'INVALID_RUBBER_BILL:%', v_invalid
      using errcode = 'P0001', hint = 'น้ำหนักสุทธิ ยอดจ่ายจริง และมูลค่ายางต้องมากกว่า 0';
  end if;

  select string_agg(c.bill_no, ', ' order by c.eligibility_at, c.bill_id)
  into v_invalid
  from private.rubber_export_candidates(
    p_location_id, p_selected_report_item_ids, p_current_export_id
  ) c
  where c.bill_date > (clock_timestamp() at time zone 'Asia/Bangkok')::date;
  if v_invalid is not null then
    raise exception 'RUBBER_EXPORT_FUTURE_BILL:%', v_invalid
      using errcode = 'P0001', hint = 'วันที่บิลต้องไม่เกินวันที่ปัจจุบันตามประเทศไทย';
  end if;
end;
$$;

create function private.validate_rubber_export_selection(
  p_location_id uuid,
  p_selected_report_item_ids uuid[]
)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.validate_rubber_export_selection(
    p_location_id, p_selected_report_item_ids, null::uuid
  );
$$;

create function public.get_rubber_export_available_bills(p_location_id uuid)
returns table (
  report_item_id uuid, bill_id uuid, bill_date date, bill_no text,
  customer_name text, eligibility_at timestamptz, net_weight numeric,
  paid_amount numeric, rubber_value_amount numeric
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_location_id is null or not private.can_manage_reports(p_location_id) then
    raise exception 'ไม่มีสิทธิ์ดูบิลส่งออกของสาขานี้';
  end if;
  return query
  select c.report_item_id, c.bill_id, c.bill_date, c.bill_no, c.customer_name,
    c.eligibility_at, c.net_weight, c.paid_amount, c.rubber_value_amount
  from private.rubber_export_candidates(p_location_id, null) c
  where c.bill_date <= (clock_timestamp() at time zone 'Asia/Bangkok')::date;
end;
$$;

create function public.preview_rubber_export(
  p_location_id uuid,
  p_selected_report_item_ids uuid[],
  p_current_export_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
  v_current public.rubber_exports%rowtype;
begin
  if p_location_id is null or not private.can_manage_reports(p_location_id) then
    raise exception 'ไม่มีสิทธิ์สร้างรายการส่งออกของสาขานี้';
  end if;
  if p_current_export_id is not null then
    select * into v_current
    from public.rubber_exports e
    where e.id = p_current_export_id;
    if v_current.id is null or v_current.location_id <> p_location_id then
      raise exception 'ไม่พบรายการส่งออกฉบับร่าง';
    end if;
    if v_current.status <> 'draft' then
      raise exception 'แก้ไขสมาชิกได้เฉพาะรายการฉบับร่าง';
    end if;
  end if;

  perform private.validate_rubber_export_selection(
    p_location_id, p_selected_report_item_ids, p_current_export_id
  );

  with candidates as (
    select c.*,
      case when b.source_rubber_export_id is not null then b.received_at
        else coalesce(b.client_created_at, b.created_at) end as age_source_at,
      case when b.source_rubber_export_id is not null then b.received_age_hours
        else null end as carried_age_hours,
      case when b.source_rubber_export_id is not null then b.received_age_is_estimated
        else b.client_created_at is null
          or (coalesce(b.client_created_at, b.created_at) at time zone 'Asia/Bangkok')::date <> c.bill_date
        end as age_is_estimated
    from private.rubber_export_candidates(
      p_location_id, p_selected_report_item_ids, p_current_export_id
    ) c
    join public.rubber_bills b on b.id = c.bill_id
  ), aged as (
    select c.*, private.rubber_export_item_age_hours(
      c.bill_date, c.age_source_at, c.carried_age_hours, v_now
    ) age_hours
    from candidates c
  )
  select jsonb_build_object(
    'itemCount', count(*)::integer,
    'originalWeightTotal', round(sum(net_weight), 2),
    'paidTotal', round(sum(paid_amount), 2),
    'rubberValueTotal', round(sum(rubber_value_amount), 2),
    'averagePrice', round(sum(paid_amount) / sum(net_weight), 2),
    'calculatedAt', v_now,
    'averageAgeHours', round(sum(net_weight * age_hours) / sum(net_weight), 2),
    'oldestAgeHours', round(max(age_hours), 2),
    'estimatedAgeItemCount', count(*) filter (where age_is_estimated)::integer,
    'items', jsonb_agg(jsonb_build_object(
      'reportItemId', report_item_id, 'billId', bill_id, 'billDate', bill_date,
      'billNo', bill_no, 'customerName', customer_name, 'eligibilityAt', eligibility_at,
      'netWeight', net_weight, 'paidAmount', paid_amount,
      'rubberValueAmount', rubber_value_amount,
      'ageHours', round(age_hours, 2), 'ageIsEstimated', age_is_estimated
    ) order by eligibility_at, bill_id)
  ) into v_result from aged;
  if coalesce((v_result->>'itemCount')::integer, 0) = 0 then
    raise exception 'ไม่มีบิลที่พร้อมสร้างรายการส่งออก';
  end if;
  return v_result;
end;
$$;

create function public.preview_rubber_export(
  p_location_id uuid,
  p_selected_report_item_ids uuid[]
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.preview_rubber_export(
    p_location_id, p_selected_report_item_ids, null::uuid
  );
$$;

alter table public.rubber_export_items
  alter column rubber_value_amount set not null,
  add constraint rubber_export_items_rubber_value_amount_check
    check (rubber_value_amount > 0);

alter table public.rubber_exports
  alter column rubber_value_total set not null,
  add constraint rubber_exports_rubber_value_total_check
    check (rubber_value_total > 0);

create or replace function private.guard_rubber_export_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'deleted' then
    raise exception 'รายการส่งออกที่ลบแล้วแก้ไขไม่ได้';
  end if;
  if old.status = 'verified' and new.status <> 'deleted'
     and (to_jsonb(new) - array['sold_out_at', 'sold_out_by_user_id', 'sold_out_by_name'])
       is distinct from
       (to_jsonb(old) - array['sold_out_at', 'sold_out_by_user_id', 'sold_out_by_name']) then
    raise exception 'รายการส่งออกที่ตรวจสอบแล้วแก้ไขไม่ได้';
  end if;
  if (
    new.export_no, new.export_date, new.sequence_no, new.location_id,
    new.created_by_user_id, new.created_at
  ) is distinct from (
    old.export_no, old.export_date, old.sequence_no, old.location_id,
    old.created_by_user_id, old.created_at
  ) then
    raise exception 'ข้อมูลระบุตัวตนของรายการส่งออกแก้ไขไม่ได้';
  end if;
  if (old.status <> 'draft' or new.status <> 'draft') and (
    new.original_weight_total, new.paid_total, new.rubber_value_total, new.average_price
  ) is distinct from (
    old.original_weight_total, old.paid_total, old.rubber_value_total, old.average_price
  ) then
    raise exception 'snapshot สมาชิกของรายการส่งออกแก้ไขไม่ได้';
  end if;
  if old.status <> 'draft' and (
    new.age_cutoff_at, new.average_age_hours, new.oldest_age_hours,
    new.estimated_age_item_count
  ) is distinct from (
    old.age_cutoff_at, old.average_age_hours, old.oldest_age_hours,
    old.estimated_age_item_count
  ) then
    raise exception 'snapshot อายุยางหลังตรวจสอบแก้ไขไม่ได้';
  end if;
  if old.status = 'draft' and new.status <> 'verified' and (
    new.age_cutoff_at is not null or new.average_age_hours is not null
    or new.oldest_age_hours is not null or new.estimated_age_item_count is not null
  ) then
    raise exception 'ฉบับร่างไม่มี snapshot อายุยางอย่างเป็นทางการ';
  end if;
  return new;
end;
$$;

alter table public.rubber_exports enable trigger report_lock_rubber_exports;
alter table public.rubber_exports enable trigger guard_rubber_export_state;

do $$
begin
  if (
    select count(*)
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'rubber_exports'
      and t.tgname in ('guard_rubber_export_state', 'report_lock_rubber_exports')
      and t.tgenabled = 'O'
  ) <> 2 then
    raise exception 'RUBBER_EXPORT_BACKFILL_TRIGGER_RESTORE_FAILED';
  end if;
end;
$$;

-- Rebuild write and receipt RPCs only after the candidate return-shape replacement is complete.
create or replace function public.receive_rubber_export(
  p_destination_location_id uuid, p_source_rubber_export_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_source public.rubber_exports%rowtype; v_source_location_name text;
  v_actor_name text; v_actor_phone text; v_now timestamptz := clock_timestamp();
  v_bill_date date; v_date_key text; v_next_seq integer; v_bill_no text;
  v_bill_id uuid; v_client_temp_id text; v_customer_name text; v_debt_description text;
  v_age record; v_age_hours numeric; v_rubber_value numeric; v_average_price numeric;
begin
  if p_destination_location_id is null or p_source_rubber_export_id is null
     or not public.can_access_location(p_destination_location_id)
     or not exists (select 1 from public.locations l where l.id = p_destination_location_id and l.is_active) then
    raise exception 'ไม่มีสิทธิ์รับยางเข้าสาขานี้';
  end if;
  select * into v_source from public.rubber_exports e
  where e.id = p_source_rubber_export_id for update;
  if v_source.id is null then raise exception 'BRANCH_RECEIPT_SOURCE_NOT_FOUND'; end if;
  if exists (select 1 from public.rubber_bills b
    where b.source_rubber_export_id = v_source.id and b.record_status = 'active') then
    raise exception 'BRANCH_RECEIPT_ALREADY_EXISTS:%', v_source.export_no using errcode = 'P0001';
  end if;
  if v_source.status <> 'verified' or v_source.sold_out_at is not null
     or v_source.verified_at is null or v_source.current_weight is null
     or v_source.current_weight <= 0 or v_source.rubber_value_total <= 0
     or v_source.work_total is null or v_source.work_total < 0
     or not exists (select 1 from public.rubber_export_items i where i.export_id = v_source.id)
     or not exists (select 1 from public.locations l where l.id = v_source.location_id and l.is_active) then
    raise exception 'BRANCH_RECEIPT_SOURCE_STALE:%', v_source.export_no
      using errcode = 'P0001', hint = 'รีเฟรชรายการแล้วเลือกใหม่';
  end if;
  select l.name into v_source_location_name from public.locations l where l.id = v_source.location_id;
  select p.name, p.phone into v_actor_name, v_actor_phone
  from public.profiles p where p.id = auth.uid() and p.is_active;
  if v_actor_name is null then raise exception 'บัญชีผู้ใช้ไม่พร้อมใช้งาน'; end if;
  select * into v_age from private.rubber_export_raw_age_summary(v_source.id, v_now);
  v_age_hours := round(v_age.average_age_hours, 6);
  v_bill_date := (v_now at time zone 'Asia/Bangkok')::date;
  v_date_key := to_char(v_bill_date, 'YYMMDD');
  perform pg_advisory_xact_lock(hashtext(p_destination_location_id::text || v_date_key));
  select count(*) + 1 into v_next_seq from public.rubber_bills b
  where b.location_id = p_destination_location_id
    and to_char(b.bill_date, 'YYMMDD') = v_date_key and b.server_bill_no is not null;
  v_bill_no := v_date_key || lpad(v_next_seq::text, 4, '0');
  v_client_temp_id := 'branch-receipt:' || v_source.id::text || ':' || gen_random_uuid()::text;
  if v_source.location_id = p_destination_location_id then
    v_customer_name := 'ยางคงเหลือภายในสาขา';
    v_debt_description := 'หักมูลค่ายางคงเหลือภายในสาขา';
  else
    v_customer_name := 'รับยางจากสาขา ' || v_source_location_name;
    v_debt_description := 'หักมูลค่ายางรับจากสาขา ' || v_source_location_name;
  end if;
  v_rubber_value := round(v_source.rubber_value_total + v_source.work_total, 2);
  v_average_price := round(v_rubber_value / v_source.current_weight, 2);
  insert into public.rubber_bills (
    client_temp_id, local_bill_no, server_bill_no, idempotency_key,
    sync_status, record_status, location_id, bill_no, bill_date,
    customer_id, customer_name, bill_type, deduct_weight, weight,
    rubber_value, average_price, deduction_total, net_total,
    acid_pack_count, client_recorded_at, client_created_at,
    server_received_at, revision_no, created_by_user_id,
    created_by_name, created_by_phone, source_rubber_export_id,
    source_export_no, received_at, received_age_hours, received_age_is_estimated
  ) values (
    v_client_temp_id, v_bill_no, v_bill_no, v_client_temp_id,
    'synced', 'active', p_destination_location_id, v_bill_no, v_bill_date,
    null, v_customer_name, 'บิลเครื่องชั่งเล็ก', 0, v_source.current_weight,
    v_rubber_value, v_average_price, v_rubber_value, 0,
    0, v_now, v_now, v_now, 1, auth.uid(), coalesce(v_actor_name, ''),
    coalesce(v_actor_phone, ''), v_source.id, v_source.export_no, v_now,
    v_age_hours, v_age.estimated_age_item_count > 0
  ) returning id into v_bill_id;
  insert into public.rubber_bill_items (
    bill_id, item_type, description, weight_in, weight_out, net_weight,
    quantity, unit, price, total, sequence_no
  ) values
    (v_bill_id, 'weigh', v_customer_name, v_source.current_weight, 0,
      v_source.current_weight, v_source.current_weight, 'kg', v_average_price, v_rubber_value, 1),
    (v_bill_id, 'debt', v_debt_description, null, null, null, null, null, null, v_rubber_value, 2);
  return jsonb_build_object('status', 'received', 'billId', v_bill_id, 'billNo', v_bill_no,
    'sourceExportId', v_source.id, 'sourceExportNo', v_source.export_no,
    'receivedAt', v_now, 'receivedAgeHours', v_age_hours);
exception when unique_violation then
  raise exception 'BRANCH_RECEIPT_ALREADY_EXISTS:%', coalesce(v_source.export_no, '') using errcode = 'P0001';
end; $$;

create or replace function public.get_receivable_rubber_exports(p_destination_location_id uuid)
returns table (
  source_rubber_export_id uuid, source_export_no text, source_location_id uuid,
  source_location_name text, verified_at timestamptz, current_weight numeric,
  rubber_value numeric, source_average_age_hours numeric, received_age_hours numeric,
  age_is_estimated boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare v_now timestamptz := clock_timestamp();
begin
  if p_destination_location_id is null
     or not public.can_access_location(p_destination_location_id)
     or not exists (select 1 from public.locations l where l.id = p_destination_location_id and l.is_active) then
    raise exception 'ไม่มีสิทธิ์รับยางเข้าสาขานี้';
  end if;
  return query
  select e.id, e.export_no, e.location_id, l.name, e.verified_at, e.current_weight,
    round(e.rubber_value_total + e.work_total, 2), round(age.average_age_hours, 2),
    round(age.average_age_hours, 6), age.estimated_age_item_count > 0
  from public.rubber_exports e
  join public.locations l on l.id = e.location_id and l.is_active
  cross join lateral private.rubber_export_raw_age_summary(e.id, v_now) age
  where e.status = 'verified' and e.sold_out_at is null and e.verified_at is not null
    and e.current_weight > 0 and e.rubber_value_total > 0
    and e.work_total is not null and e.work_total >= 0
    and exists (select 1 from public.rubber_export_items i where i.export_id = e.id)
    and not exists (select 1 from public.rubber_bills b
      where b.source_rubber_export_id = e.id and b.record_status = 'active')
  order by (e.location_id = p_destination_location_id) desc, e.verified_at desc, e.export_no, e.id;
end; $$;

create or replace function public.get_receivable_rubber_exports_page(
  p_destination_location_id uuid, p_search text default '',
  p_cursor_same_location boolean default null, p_cursor_verified_at timestamptz default null,
  p_cursor_id uuid default null, p_page_size integer default 50
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_now timestamptz := clock_timestamp(); v_search text := lower(trim(coalesce(p_search, ''))); v_result jsonb;
begin
  if p_destination_location_id is null or not public.can_access_location(p_destination_location_id)
    or not exists (select 1 from public.locations l where l.id = p_destination_location_id and l.is_active) then
    raise exception 'ไม่มีสิทธิ์รับยางเข้าสาขานี้';
  end if;
  if p_page_size < 1 or p_page_size > 50 then raise exception 'BRANCH_RECEIPT_INVALID_PAGE_SIZE'; end if;
  if (p_cursor_verified_at is null) <> (p_cursor_id is null)
    or (p_cursor_verified_at is null) <> (p_cursor_same_location is null) then
    raise exception 'BRANCH_RECEIPT_CURSOR_INCOMPLETE';
  end if;
  with candidates as (
    select e.id, e.export_no, e.location_id, l.name location_name, e.verified_at,
      e.current_weight, round(e.rubber_value_total + e.work_total, 2) rubber_value,
      e.location_id = p_destination_location_id is_same_location
    from public.rubber_exports e join public.locations l on l.id = e.location_id and l.is_active
    where e.status = 'verified' and e.sold_out_at is null and e.verified_at is not null
      and e.current_weight > 0 and e.rubber_value_total > 0 and e.work_total >= 0
      and exists (select 1 from public.rubber_export_items i where i.export_id = e.id)
      and not exists (select 1 from public.rubber_bills b where b.source_rubber_export_id = e.id and b.record_status = 'active')
      and (v_search = '' or position(v_search in lower(concat_ws(' ', e.export_no, l.name))) > 0)
      and (p_cursor_verified_at is null or
        (e.location_id = p_destination_location_id, e.verified_at, e.id)
          < (p_cursor_same_location, p_cursor_verified_at, p_cursor_id))
    order by is_same_location desc, e.verified_at desc, e.id desc limit p_page_size + 1
  ), visible as (
    select * from candidates order by is_same_location desc, verified_at desc, id desc limit p_page_size
  ), rows as (
    select v.*, age.average_age_hours source_average_age_hours,
      round(age.average_age_hours, 6) received_age_hours,
      age.estimated_age_item_count > 0 age_is_estimated
    from visible v cross join lateral private.rubber_export_raw_age_summary(v.id, v_now) age
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'source_rubber_export_id', id, 'source_export_no', export_no,
      'source_location_id', location_id, 'source_location_name', location_name,
      'verified_at', verified_at, 'current_weight', current_weight,
      'rubber_value', rubber_value, 'source_average_age_hours', round(source_average_age_hours, 2),
      'received_age_hours', received_age_hours, 'age_is_estimated', age_is_estimated,
      'is_same_location', is_same_location
    ) order by is_same_location desc, verified_at desc, id desc) from rows), '[]'::jsonb),
    'hasMore', (select count(*) > p_page_size from candidates),
    'nextSameLocation', (select is_same_location from visible order by is_same_location, verified_at, id limit 1),
    'nextVerifiedAt', (select verified_at from visible order by is_same_location, verified_at, id limit 1),
    'nextId', (select id from visible order by is_same_location, verified_at, id limit 1)
  ) into v_result;
  return v_result;
end; $$;

create function public.create_rubber_export(p_location_id uuid, p_selected_report_item_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor_id uuid := auth.uid(); v_actor_name text; v_actor_phone text;
  v_now timestamptz := clock_timestamp(); v_export_date date; v_sequence_no integer;
  v_export_no text; v_export_id uuid; v_item_count integer;
  v_original_weight numeric; v_paid_total numeric; v_rubber_value_total numeric;
begin
  if p_location_id is null or not private.can_manage_reports(p_location_id) then
    raise exception 'ไม่มีสิทธิ์สร้างรายการส่งออกของสาขานี้';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rubber-export:' || p_location_id::text, 0));
  perform private.validate_rubber_export_selection(p_location_id, p_selected_report_item_ids);
  select count(*)::integer, round(sum(c.net_weight), 2), round(sum(c.paid_amount), 2),
    round(sum(c.rubber_value_amount), 2)
  into v_item_count, v_original_weight, v_paid_total, v_rubber_value_total
  from private.rubber_export_candidates(p_location_id, p_selected_report_item_ids) c;
  if coalesce(v_item_count, 0) = 0 then raise exception 'ไม่มีบิลที่พร้อมสร้างรายการส่งออก'; end if;
  select p.name, p.phone into v_actor_name, v_actor_phone from public.profiles p where p.id = v_actor_id;
  v_export_date := (v_now at time zone 'Asia/Bangkok')::date;
  v_sequence_no := private.next_document_sequence('REX', p_location_id, v_export_date);
  v_export_no := 'REX-' || to_char(v_export_date, 'YYYYMMDD') || '-' || lpad(v_sequence_no::text, 3, '0');
  insert into public.rubber_exports (
    export_no, export_date, sequence_no, location_id, original_weight_total,
    paid_total, rubber_value_total, average_price, created_by_user_id,
    created_by_name, created_by_phone, created_at
  ) values (
    v_export_no, v_export_date, v_sequence_no, p_location_id, v_original_weight,
    v_paid_total, v_rubber_value_total, round(v_paid_total / v_original_weight, 2),
    v_actor_id, coalesce(v_actor_name, ''), coalesce(v_actor_phone, ''), v_now
  ) returning id into v_export_id;
  insert into public.rubber_export_items (
    export_id, location_id, source_report_item_id, source_bill_id, bill_date,
    bill_no, customer_name, eligibility_at, net_weight, paid_amount,
    rubber_value_amount, age_source_at, age_is_estimated, carried_age_hours
  )
  select v_export_id, p_location_id, c.report_item_id, c.bill_id, c.bill_date,
    c.bill_no, c.customer_name, c.eligibility_at, c.net_weight, c.paid_amount,
    c.rubber_value_amount,
    case when b.source_rubber_export_id is not null then b.received_at else coalesce(b.client_created_at, b.created_at) end,
    case when b.source_rubber_export_id is not null then b.received_age_is_estimated
      else b.client_created_at is null
        or (coalesce(b.client_created_at, b.created_at) at time zone 'Asia/Bangkok')::date <> c.bill_date end,
    case when b.source_rubber_export_id is not null then b.received_age_hours else null end
  from private.rubber_export_candidates(p_location_id, p_selected_report_item_ids) c
  join public.rubber_bills b on b.id = c.bill_id;
  get diagnostics v_item_count = row_count;
  return jsonb_build_object('id', v_export_id, 'exportNo', v_export_no, 'itemCount', v_item_count);
end; $$;

create function public.replace_rubber_export_items(p_export_id uuid, p_selected_report_item_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_export public.rubber_exports%rowtype; v_item_count integer;
  v_original_weight numeric; v_paid_total numeric; v_rubber_value_total numeric;
begin
  select * into v_export from public.rubber_exports e where e.id = p_export_id for update;
  if v_export.id is null or not private.can_manage_reports(v_export.location_id) then
    raise exception 'ไม่มีสิทธิ์แก้ไขรายการส่งออกนี้';
  end if;
  if v_export.status <> 'draft' then raise exception 'แก้ไขสมาชิกได้เฉพาะรายการฉบับร่าง'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rubber-export:' || v_export.location_id::text, 0));
  perform private.validate_rubber_export_selection(v_export.location_id, p_selected_report_item_ids, v_export.id);
  delete from public.rubber_export_items i where i.export_id = v_export.id;
  insert into public.rubber_export_items (
    export_id, location_id, source_report_item_id, source_bill_id, bill_date,
    bill_no, customer_name, eligibility_at, net_weight, paid_amount,
    rubber_value_amount, age_source_at, age_is_estimated, carried_age_hours
  )
  select v_export.id, v_export.location_id, c.report_item_id, c.bill_id, c.bill_date,
    c.bill_no, c.customer_name, c.eligibility_at, c.net_weight, c.paid_amount,
    c.rubber_value_amount,
    case when b.source_rubber_export_id is not null then b.received_at else coalesce(b.client_created_at, b.created_at) end,
    case when b.source_rubber_export_id is not null then b.received_age_is_estimated
      else b.client_created_at is null
        or (coalesce(b.client_created_at, b.created_at) at time zone 'Asia/Bangkok')::date <> c.bill_date end,
    case when b.source_rubber_export_id is not null then b.received_age_hours else null end
  from private.rubber_export_candidates(v_export.location_id, p_selected_report_item_ids, v_export.id) c
  join public.rubber_bills b on b.id = c.bill_id;
  select count(*)::integer, round(sum(i.net_weight), 2), round(sum(i.paid_amount), 2),
    round(sum(i.rubber_value_amount), 2)
  into v_item_count, v_original_weight, v_paid_total, v_rubber_value_total
  from public.rubber_export_items i where i.export_id = v_export.id;
  update public.rubber_exports set original_weight_total = v_original_weight,
    paid_total = v_paid_total, rubber_value_total = v_rubber_value_total,
    average_price = round(v_paid_total / v_original_weight, 2), current_weight = null,
    weight_loss_percent = null, work_rate = null, other_operating_cost = 0, work_total = null
  where id = v_export.id;
  return jsonb_build_object('id', v_export.id, 'status', 'draft', 'itemCount', v_item_count,
    'originalWeightTotal', v_original_weight, 'paidTotal', v_paid_total,
    'rubberValueTotal', v_rubber_value_total);
end; $$;

revoke all on function private.rubber_export_candidates(uuid,uuid[],uuid),
  private.rubber_export_candidates(uuid,uuid[]),
  private.validate_rubber_export_selection(uuid,uuid[],uuid),
  private.validate_rubber_export_selection(uuid,uuid[])
  from public, anon, authenticated;

revoke all on function public.get_rubber_export_available_bills(uuid),
  public.preview_rubber_export(uuid,uuid[]),
  public.preview_rubber_export(uuid,uuid[],uuid),
  public.create_rubber_export(uuid,uuid[]),
  public.replace_rubber_export_items(uuid,uuid[]),
  public.get_receivable_rubber_exports(uuid),
  public.get_receivable_rubber_exports_page(uuid,text,boolean,timestamptz,uuid,integer),
  public.receive_rubber_export(uuid,uuid)
  from public, anon;

grant execute on function public.get_rubber_export_available_bills(uuid),
  public.preview_rubber_export(uuid,uuid[]),
  public.preview_rubber_export(uuid,uuid[],uuid),
  public.create_rubber_export(uuid,uuid[]),
  public.replace_rubber_export_items(uuid,uuid[]),
  public.get_receivable_rubber_exports(uuid),
  public.get_receivable_rubber_exports_page(uuid,text,boolean,timestamptz,uuid,integer),
  public.receive_rubber_export(uuid,uuid)
  to authenticated;

comment on function public.replace_rubber_export_items(uuid,uuid[]) is
  'Atomically replaces draft Rubber Export members and recomputes paid/rubber-value snapshots.';

notify pgrst, 'reload schema';

commit;
