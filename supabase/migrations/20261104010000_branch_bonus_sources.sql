-- Branch bonus source projection (2026-11-04). Reads costs, never cash movements.
create table public.branch_bonuses (
  id uuid primary key,
  location_id uuid not null references public.locations(id),
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  input jsonb not null,
  request_fingerprint text not null,
  snapshot jsonb not null,
  created_by_user_id uuid not null,
  created_by_name text not null,
  created_at timestamptz not null default clock_timestamp()
);
create index branch_bonuses_location_period on public.branch_bonuses(location_id, period_start, period_end);
alter table public.branch_bonuses enable row level security;
create policy branch_bonuses_manager_read on public.branch_bonuses for select to authenticated
  using (public.can_access_super_admin_features());
revoke all on public.branch_bonuses from public, anon, authenticated;
grant select on public.branch_bonuses to authenticated;
grant all on public.branch_bonuses to service_role;

-- Intentionally no FK to business sources: saved evidence survives source removal.
create table private.branch_bonus_exports (
  bonus_id uuid not null references public.branch_bonuses(id) on delete cascade,
  export_id uuid not null unique,
  primary key (bonus_id, export_id)
);
create table private.branch_bonus_source_gaps (
  location_id uuid not null references public.locations(id),
  business_date date not null,
  kind text not null,
  detected_at timestamptz not null default clock_timestamp(),
  primary key (location_id, business_date, kind)
);
create table private.branch_bonus_observations (
  bonus_id uuid not null references public.branch_bonuses(id) on delete cascade,
  origin_bonus_id uuid not null references public.branch_bonuses(id) on delete cascade,
  source_key text not null,
  observed_source jsonb,
  primary key (bonus_id,origin_bonus_id,source_key)
);
create index branch_bonus_observations_origin on private.branch_bonus_observations(origin_bonus_id,source_key);
create table private.branch_bonus_sources (
  bonus_id uuid not null references public.branch_bonuses(id) on delete cascade,
  origin_bonus_id uuid not null references public.branch_bonuses(id) on delete cascade,
  location_id uuid not null references public.locations(id),
  source_key text not null,
  primary key (location_id,source_key)
);
create index branch_bonus_sources_bonus on private.branch_bonus_sources(bonus_id);
create index branch_bonus_sources_origin on private.branch_bonus_sources(origin_bonus_id);
revoke all on private.branch_bonus_exports, private.branch_bonus_source_gaps, private.branch_bonus_observations,private.branch_bonus_sources from public, anon, authenticated;

create or replace function private.branch_bonus_require_manager(p_location uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce(public.can_access_super_admin_features(), false) then
    raise exception 'BONUS_FORBIDDEN: ไม่มีสิทธิ์จัดการโบนัส';
  end if;
  if not exists(select 1 from public.locations where id=p_location) then
    raise exception 'BONUS_INVALID: ไม่พบสาขา';
  end if;
end $$;

create or replace function private.branch_bonus_history(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.rubber_exports e where e.id=p_id and e.status='verified'
    and (e.sold_out_at is not null or exists(select 1 from public.rubber_bills b
      where b.source_rubber_export_id=e.id and b.record_status='active')));
$$;

-- A private UNION ALL view permits date/location predicates to reach source indexes.
create view private.branch_bonus_source_rows as
select 'expense:'||e.id::text as key, 'expense'::text as kind, e.id, e.location_id,
  e.tx_date as business_date, e.created_at as recorded_at, e.tx_date::timestamp at time zone 'Asia/Bangkok' as occurred_at,
  e.title as label, e.cost as amount
from public.income_expense e
where e.record_status='active' and e.sync_status='synced' and e.type='expense' and e.cost>0
union all
select 'withdrawal:'||f.id, 'withdrawal', f.id, f.expense_location_id,
  (f.approved_at at time zone 'Asia/Bangkok')::date, f.created_at, f.approved_at,
  coalesce(nullif(f.description,''),'เงินเบิก'), f.amount
from public.financial_transactions f
where f.type='WITHDRAWAL' and f.status='APPROVED' and f.cancelled_at is null and f.amount>0
union all
select 'payroll:'||p.id, 'payroll', p.id, p.expense_location_id,
  (p.approved_at at time zone 'Asia/Bangkok')::date, p.created_at, p.approved_at,
  'เงินเดือน '||p.month, p.net_pay
from public.payroll_slips p where p.status='APPROVED' and p.cancelled_at is null and p.net_pay>0
union all
select 'transport:'||m.id, 'transport', m.id, m.location_id,
  (m.created_at at time zone 'Asia/Bangkok')::date, m.created_at, m.created_at,
  'ขนส่ง '||coalesce(m.transport_staff_name,''), m.transport_cost
from public.money_transfers m
where m.transfer_type='transport' and m.record_status='active' and m.transfer_status<>'cancelled' and m.transport_cost>0
union all
select 'work:'||e.id, 'work', e.id, e.location_id,
  (e.verified_at at time zone 'Asia/Bangkok')::date, e.created_at, e.verified_at,
  'ค่าทำงาน '||e.export_no, e.work_total
from public.rubber_exports e where e.status='verified' and e.work_total>0
union all
select 'fee:'||s.id, 'fee', s.id, m.location_id,
  (s.transaction_date at time zone 'Asia/Bangkok')::date, s.created_at, s.transaction_date,
  'ค่าธรรมเนียม '||coalesce(s.reference_number,s.id::text), s.fee
from public.money_transfer_slips s join public.money_transfers m on m.id=s.transfer_id
where m.record_status='active' and m.transfer_status<>'cancelled' and s.fee>0
union all
select 'purchase:'||b.id, 'purchase', b.id, b.location_id, b.bill_date, b.created_at,
  b.bill_date::timestamp at time zone 'Asia/Bangkok', coalesce(b.server_bill_no,b.bill_no), b.net_total
from public.rubber_bills b where b.source_rubber_export_id is null
  and private.rubber_bill_is_payable(b.id) and not private.rubber_bill_has_pending_approval(b.id)
union all
select 'count:'||c.id, 'count', c.id, c.location_id, (c.created_at at time zone 'Asia/Bangkok')::date,
  c.created_at, c.created_at, c.count_no, 1::numeric
from public.cash_counts c where c.status='active';
revoke all on private.branch_bonus_source_rows from public, anon, authenticated;

-- Compare against the last considered value, not forever against the original
-- amount. Deleting an assessment removes its observations and restores the prior baseline.
create or replace function private.branch_bonus_changes(p_location uuid)
returns table(bonus_id uuid,source_key text,label text,old_amount numeric,new_amount numeric,
  unknown boolean,observed_source jsonb,old_included boolean,period_start date,period_end date,old_date date,new_date date)
language sql stable security definer set search_path='' as $$
  with origins as (select * from public.branch_bonuses where location_id=p_location),
  original as (select b.id origin_id,v->>'key' source_key,v source
    from origins b cross join lateral jsonb_array_elements(b.snapshot->'allSources') v),
  observed as (select distinct on(o.origin_bonus_id,o.source_key) o.origin_bonus_id origin_id,o.source_key,o.observed_source source
    from private.branch_bonus_observations o join public.branch_bonuses b on b.id=o.bonus_id
    where b.location_id=p_location order by o.origin_bonus_id,o.source_key,b.created_at desc,b.id desc),
  baseline as (select coalesce(a.origin_id,o.origin_id) origin_id,coalesce(a.source_key,o.source_key) source_key,
    case when o.origin_id is not null then o.source else a.source end source
    from original a full join observed o using(origin_id,source_key)),
  current_sources as (select b.id origin_id,r.key source_key,jsonb_build_object('key',r.key,'id',r.id,'kind',r.kind,
    'date',r.business_date,'occurredAt',r.occurred_at,'label',r.label,'amount',r.amount,
    'included',r.kind in ('purchase','count') or not (b.input->'excludedKeys' ? r.key or b.input->'excludedGroups' ? r.kind)) source
    from origins b join private.branch_bonus_source_rows r on r.location_id=p_location
      and (r.business_date between b.period_start and b.period_end
        or exists(select 1 from baseline a where a.origin_id=b.id and a.source_key=r.key))
      and not exists(select 1 from private.branch_bonus_sources seen where seen.location_id=p_location
        and seen.source_key=r.key and seen.origin_bonus_id<>b.id)),
  differences as (select coalesce(a.origin_id,c.origin_id) origin_id,coalesce(a.source_key,c.source_key) source_key,
    a.source old_source,c.source new_source from baseline a full join current_sources c using(origin_id,source_key)
    where (a.source->>'amount')::numeric is distinct from (c.source->>'amount')::numeric
      or a.source->>'date' is distinct from c.source->>'date')
  select d.origin_id,d.source_key,coalesce(d.new_source->>'label',d.old_source->>'label',d.source_key),
    (d.old_source->>'amount')::numeric,(d.new_source->>'amount')::numeric,
    (d.old_source is null or d.new_source is null) and exists(select 1 from private.branch_bonus_source_gaps g join origins b on b.id=d.origin_id
      where g.location_id=p_location and g.business_date between b.period_start and b.period_end
        and g.kind=split_part(d.source_key,':',1)),d.new_source,(d.old_source->>'included')::boolean,
    b.period_start,b.period_end,(d.old_source->>'date')::date,(d.new_source->>'date')::date
  from differences d join origins b on b.id=d.origin_id;
$$;

-- Future bulk erasure must mark every affected source kind/day before deletion.
create or replace function private.mark_branch_bonus_source_gap(p_location uuid,p_day date,p_kind text)
returns void language sql volatile security definer set search_path='' as $$
  insert into private.branch_bonus_source_gaps(location_id,business_date,kind)
  values(p_location,p_day,p_kind) on conflict do nothing;
$$;

-- App deletion RPCs create durable deletion audits. Unaudited physical source loss
-- is conservatively unknown coverage, never an apparent zero-valued period.
create or replace function private.capture_branch_bonus_source_loss()
returns trigger language plpgsql security definer set search_path='' as $$
declare j jsonb := to_jsonb(old); loc uuid; d date; kind text;
begin
  if j->>'record_status'='deleted' or j->>'status'='deleted' or j->>'cancelled_at' is not null then return old; end if;
  -- Authenticated business corrections retain their existing deletion semantics.
  -- A future bulk purge must call the explicit gap marker even with an actor.
  if auth.uid() is not null then return old; end if;
  if exists(select 1 from public.document_deletion_audits where source_id=(j->>'id')::uuid) then return old; end if;
  if tg_table_name='income_expense' and (j->>'type'<>'expense' or j->>'sync_status'<>'synced' or coalesce((j->>'cost')::numeric,0)<=0) then return old; end if;
  if tg_table_name='rubber_bills' and (j->>'source_rubber_export_id' is not null
    or not private.rubber_bill_is_payable((j->>'id')::uuid) or private.rubber_bill_has_pending_approval((j->>'id')::uuid)) then return old; end if;
  if tg_table_name='financial_transactions' and (j->>'type'<>'WITHDRAWAL' or j->>'status'<>'APPROVED') then return old; end if;
  if tg_table_name='payroll_slips' and j->>'status'<>'APPROVED' then return old; end if;
  if tg_table_name='rubber_exports' and (j->>'status'<>'verified' or coalesce((j->>'work_total')::numeric,0)<=0) then return old; end if;
  if tg_table_name='money_transfer_slips' and coalesce((j->>'fee')::numeric,0)<=0 then return old; end if;
  if tg_table_name='money_transfers' then
    if j->>'transfer_status'='cancelled' then return old; end if;
    insert into private.branch_bonus_source_gaps(location_id,business_date,kind)
      select (j->>'location_id')::uuid,(transaction_date at time zone 'Asia/Bangkok')::date,'fee'
      from public.money_transfer_slips where transfer_id=(j->>'id')::uuid and fee>0 on conflict do nothing;
    if j->>'transfer_type'<>'transport' or coalesce((j->>'transport_cost')::numeric,0)<=0 then return old; end if;
  end if;
  loc := coalesce((j->>'location_id')::uuid,(j->>'expense_location_id')::uuid);
  kind := case tg_table_name when 'income_expense' then 'expense' when 'rubber_bills' then 'purchase'
    when 'cash_counts' then 'count' when 'financial_transactions' then 'withdrawal'
    when 'payroll_slips' then 'payroll' when 'rubber_exports' then 'work'
    when 'money_transfers' then 'transport' else 'fee' end;
  d := coalesce((j->>'tx_date')::date,(j->>'bill_date')::date,
    (coalesce((j->>'approved_at')::timestamptz,(j->>'verified_at')::timestamptz,
      (j->>'transaction_date')::timestamptz,(j->>'created_at')::timestamptz) at time zone 'Asia/Bangkok')::date);
  if tg_table_name='money_transfer_slips' then
    select location_id into loc from public.money_transfers where id=(j->>'transfer_id')::uuid;
  end if;
  if loc is not null and d is not null then perform private.mark_branch_bonus_source_gap(loc,d,kind); end if;
  return old;
end $$;

-- TRUNCATE does not fire row triggers. Preserve the same history invariant and
-- record coverage before any bulk source erasure, including purchase line loss.
create or replace function private.guard_branch_bonus_truncate()
returns trigger language plpgsql security definer set search_path='' as $$
declare kinds text[];
begin
  if (tg_table_name='rubber_exports' and exists(select 1 from private.branch_bonus_exports))
    or (tg_table_name='rubber_bills' and exists(select 1 from private.branch_bonus_exports x
      join public.rubber_exports e on e.id=x.export_id where e.sold_out_at is null)) then
    raise exception 'BONUS_HISTORY_LOCKED: กรุณาลบผลโบนัสที่เกี่ยวข้องก่อนล้างรายการที่ทำให้ REX ออกจากประวัติ';
  end if;
  kinds:=case tg_table_name when 'income_expense' then array['expense'] when 'rubber_bills' then array['purchase']
    when 'rubber_bill_items' then array['purchase'] when 'cash_counts' then array['count']
    when 'financial_transactions' then array['withdrawal'] when 'payroll_slips' then array['payroll']
    when 'rubber_exports' then array['work'] when 'money_transfers' then array['transport','fee'] else array['fee'] end;
  insert into private.branch_bonus_source_gaps(location_id,business_date,kind)
    select distinct location_id,business_date,kind from private.branch_bonus_source_rows
    where kind=any(kinds) and location_id is not null on conflict do nothing;
  return null;
end $$;
do $$ declare t text; begin
  foreach t in array array['income_expense','rubber_bills','cash_counts','financial_transactions','payroll_slips',
    'rubber_exports','money_transfers','money_transfer_slips'] loop
    execute format('create trigger z_branch_bonus_source_loss before delete on public.%I for each row execute function private.capture_branch_bonus_source_loss()',t);
    execute format('create trigger branch_bonus_truncate before truncate on public.%I for each statement execute function private.guard_branch_bonus_truncate()',t);
  end loop;
  create trigger branch_bonus_truncate before truncate on public.rubber_bill_items for each statement execute function private.guard_branch_bonus_truncate();
end $$;

revoke all on function private.branch_bonus_require_manager(uuid),private.branch_bonus_history(uuid),
  private.mark_branch_bonus_source_gap(uuid,date,text),private.capture_branch_bonus_source_loss(),private.guard_branch_bonus_truncate() from public,anon,authenticated;
revoke all on function private.branch_bonus_changes(uuid) from public,anon,authenticated;
