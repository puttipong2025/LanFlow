-- Preserve unknown coverage when an old source was moved before physical loss.
-- An absent source with any known gap of its branch/kind is conservative unknown:
-- a date-only gap cannot prove that a moved identity was deleted intentionally.
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
      where g.location_id=p_location and (d.new_source is null or g.business_date between b.period_start and b.period_end)
        and g.kind=split_part(d.source_key,':',1)),d.new_source,(d.old_source->>'included')::boolean,
    b.period_start,b.period_end,(d.old_source->>'date')::date,(d.new_source->>'date')::date
  from differences d join origins b on b.id=d.origin_id;
$$;

create or replace function private.capture_branch_bonus_source_loss()
returns trigger language plpgsql security definer set search_path='' as $$
declare j jsonb := to_jsonb(old); loc uuid; d date; kind text;
begin
  -- A lost weigh line can make an otherwise retained purchase disappear.
  if tg_table_name='rubber_bill_items' then
    if j->>'item_type'<>'weigh' then return old; end if;
    select to_jsonb(b) into j from public.rubber_bills b where b.id=(j->>'bill_id')::uuid;
    if j is null then return old; end if;
  end if;
  if j->>'record_status'='deleted' or j->>'status'='deleted' or j->>'cancelled_at' is not null then return old; end if;
  -- Authenticated business corrections retain their existing deletion semantics.
  -- A future bulk purge must call the explicit gap marker even with an actor.
  if auth.uid() is not null then return old; end if;
  if exists(select 1 from public.document_deletion_audits where source_id=(j->>'id')::uuid) then return old; end if;
  if tg_table_name='income_expense' and (j->>'type'<>'expense' or j->>'sync_status'<>'synced' or coalesce((j->>'cost')::numeric,0)<=0) then return old; end if;
  if tg_table_name in ('rubber_bills','rubber_bill_items') and (j->>'source_rubber_export_id' is not null
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
  kind := case tg_table_name when 'income_expense' then 'expense' when 'rubber_bills' then 'purchase' when 'rubber_bill_items' then 'purchase'
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

create trigger z_branch_bonus_source_loss before delete on public.rubber_bill_items
  for each row execute function private.capture_branch_bonus_source_loss();

-- PostgreSQL integer offsets remain valid at the upper boundary.
create or replace function public.get_branch_bonus_changes(p_location uuid,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.branch_bonus_require_manager(p_location);
  if p_offset is null or p_offset<0 then raise exception 'BONUS_INVALID: หน้ารายการไม่ถูกต้อง'; end if;
  with changes as (select * from private.branch_bonus_changes(p_location))
  select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(c)-'observed_source'),'[]'),
      'hasMore',(select count(*)>p_offset::bigint+50 from changes)) into result
    from (select * from changes order by bonus_id,source_key offset p_offset limit 50) c;
  return result;
end $$;

