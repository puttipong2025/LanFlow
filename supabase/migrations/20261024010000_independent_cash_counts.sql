-- Preserve legacy counts, but new counts are independent ledger observations.
create sequence private.cash_count_number_seq;
alter table public.document_deletion_audits drop constraint document_deletion_audits_check1;
alter table public.document_deletion_audits add constraint document_deletion_audits_pair_kind
  check (document_kind='cash_count' or paired_source_id is null);
alter table public.cash_count_sessions add column system_balance numeric(14,2);
-- Old active forms have no ledger baseline and must restart after the cutover.
update public.cash_count_sessions set status='expired',ended_at=clock_timestamp() where status='active';
alter table public.cash_counts
  add column count_no text,
  add column system_balance numeric(14,2),
  add column account_balance numeric(14,2) not null default 0 check (account_balance >= 0),
  add column counted_total numeric(14,2),
  add column checked_by_user_id uuid references public.profiles(id),
  add column checked_by_name text,
  add column checked_at timestamptz;
update public.cash_counts c set count_no = r.report_no, counted_total = c.actual_total
from public.report_batches r where r.id = c.report_id;
update public.cash_counts set count_no = 'LEGACY-' || id::text where count_no is null;
update public.cash_counts set counted_total=actual_total where counted_total is null;
alter table public.cash_counts alter column count_no set not null;
alter table public.cash_counts alter column counted_total set not null;
alter table public.cash_counts add constraint cash_counts_counted_total_matches
  check(counted_total = actual_total + account_balance);
alter table public.cash_counts add constraint cash_counts_ledger_difference_matches
  check(system_balance is null or difference_total = counted_total - system_balance);
-- Legacy report numbers are unique within a branch, not across all branches.
create unique index cash_count_number_unique on public.cash_counts(location_id,count_no);
alter table public.cash_counts alter column report_id drop not null;
-- Old physical-cash analysis remains only as archived data until its dependencies are retired.
alter table public.cash_counts alter column expected_counts set default '{}'::jsonb;
alter table public.cash_counts alter column expected_total set default 0;
alter table public.cash_counts alter column difference_counts set default '{}'::jsonb;
alter table public.cash_counts drop constraint cash_counts_expected_shape;
alter table public.cash_counts drop constraint cash_counts_difference_shape;

create table public.cash_count_bank_evidence (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.cash_count_sessions(id),
  owner_user_id uuid not null references public.profiles(id),
  image_sha256 text not null check (image_sha256 ~ '^[a-f0-9]{64}$'),
  amount numeric(14,2) not null check (amount >= 0),
  balance_kind text not null check (balance_kind in ('balance','available')),
  drive_file_id text,
  drive_uploaded_at timestamptz,
  upload_started_at timestamptz,
  count_id uuid unique references public.cash_counts(id),
  created_at timestamptz not null default now(),
  unique(session_id, image_sha256)
);
alter table public.cash_count_bank_evidence enable row level security;
revoke all on public.cash_count_bank_evidence from anon, authenticated;
grant all on public.cash_count_bank_evidence to service_role;

-- Every source of financial_amounts, including child rows, must pass the same branch fence.
create function private.guard_cash_count_movement() returns trigger
language plpgsql security definer set search_path = '' as $$
declare j jsonb; ids uuid[] := '{}'; loc uuid; parent uuid;
begin
  for j in select value from jsonb_array_elements(jsonb_build_array(
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end)) where value <> 'null'::jsonb
  loop
    ids := ids || array[(j->>'location_id')::uuid, (j->>'target_location_id')::uuid,
      (j->>'expense_location_id')::uuid];
    if tg_table_name = 'rubber_bill_items' then
      select location_id into parent from public.rubber_bills where id=(j->>'bill_id')::uuid;
      ids := array_append(ids,parent);
    elsif tg_table_name in ('money_transfer_items','money_transfer_cash_details','money_transfer_slips') then
      select location_id into parent from public.money_transfers where id=(j->>'transfer_id')::uuid;
      ids := array_append(ids,parent);
      select target_location_id into parent from public.money_transfers where id=(j->>'transfer_id')::uuid;
      ids := array_append(ids,parent);
      if tg_table_name='money_transfer_items' and j->>'source_type'='rubber_bill' then
        select location_id into parent from public.rubber_bills where id=(j->>'source_id')::uuid;
        ids := array_append(ids,parent);
      end if;
    elsif tg_table_name='rubber_export_items' then
      select location_id into parent from public.rubber_exports where id=(j->>'export_id')::uuid;
      ids := array_append(ids,parent);
    end if;
  end loop;
  perform private.lock_report_locations(ids);
  for loc in select distinct x from unnest(ids) x where x is not null loop
    if exists(select 1 from public.cash_count_sessions where location_id=loc
      and status='active' and expires_at > clock_timestamp()) then
      raise exception 'CASH_COUNT_ACTIVE: สาขากำลังนับเงิน กรุณารอให้บันทึก ยกเลิก หรือหมดเวลา';
    end if;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['income_expense','rubber_bills','rubber_bill_items','rubber_exports',
    'rubber_export_items','money_transfers','money_transfer_items','money_transfer_cash_details',
    'money_transfer_slips','financial_transactions','payroll_slips'] loop
    execute format('create trigger cash_count_movement_guard before insert or update or delete on public.%I for each row execute function private.guard_cash_count_movement()',t);
  end loop;
end $$;

create or replace function public.get_cash_count_session(p_location_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.cash_count_sessions%rowtype;
begin
  if not private.can_use_cash_count(p_location_id) then raise exception 'ไม่มีสิทธิ์ตรวจนับเงินสดของสาขานี้'; end if;
  perform private.lock_report_locations(array[p_location_id]);
  update public.cash_count_sessions set status='expired',ended_at=clock_timestamp()
    where location_id=p_location_id and status='active' and expires_at<=clock_timestamp();
  select * into s from public.cash_count_sessions where location_id=p_location_id and status='active';
  if s.id is null then return jsonb_build_object('session',null); end if;
  return jsonb_build_object('session',jsonb_build_object('id',s.id,'locationId',s.location_id,
    'cutoffAt',s.cutoff_at,'expiresAt',s.expires_at,'startedAt',s.started_at,
    'startedByName',s.started_by_name,'isOwner',s.started_by_user_id=auth.uid(),'systemBalance',s.system_balance));
end $$;

create or replace function public.start_cash_count_session(p_location_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_now timestamptz; v_balance numeric; v_blockers jsonb;
begin
  if not private.can_use_cash_count(p_location_id) then raise exception 'ไม่มีสิทธิ์ตรวจนับเงินสดของสาขานี้'; end if;
  perform private.lock_report_locations(array[p_location_id]);
  v_now := clock_timestamp();
  update public.cash_count_sessions set status='expired',ended_at=v_now
    where location_id=p_location_id and status='active' and expires_at<=v_now;
  if exists(select 1 from public.cash_count_sessions where location_id=p_location_id and status='active') then
    raise exception 'CASH_COUNT_ACTIVE: มีผู้กำลังนับเงิน';
  end if;
  select jsonb_agg(jsonb_build_object('key',blocker_key,'count',item_count)) into v_blockers
    from private.cash_count_start_blockers(p_location_id,v_now);
  if v_blockers is not null then raise exception using message='PENDING_WORK_BLOCKED',
    detail=jsonb_build_object('blockers',v_blockers)::text; end if;
  -- This invokes the canonical live formula, never the cached dashboard snapshot.
  v_balance := (private.calculate_dashboard_summary(p_location_id)->>'netCashFlow')::numeric;
  if v_balance is null then raise exception 'คำนวณยอดระบบไม่สำเร็จ'; end if;
  insert into public.cash_count_sessions(location_id,cutoff_at,expires_at,started_at,
    started_by_user_id,started_by_name,started_by_phone,system_balance)
    select p_location_id,v_now,v_now+interval '30 minutes',v_now,id,name,phone,v_balance
    from public.profiles where id=auth.uid();
  return public.get_cash_count_session(p_location_id);
end $$;

-- Legacy two-argument caller uses the new no-bank flow too.
create function public.submit_cash_count_v2(p_session_id uuid,p_actual_counts jsonb,p_evidence_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.cash_count_sessions%rowtype; c public.cash_counts%rowtype;
  e public.cash_count_bank_evidence%rowtype; v_cash numeric; v_bank numeric:=0; v_id uuid:=gen_random_uuid(); v_sequence text;
begin
  select * into s from public.cash_count_sessions where id=p_session_id;
  if s.id is null or not private.can_use_cash_count(s.location_id) or s.started_by_user_id<>auth.uid() then
    raise exception 'ไม่มีสิทธิ์ส่งผลนับเงิน'; end if;
  perform private.lock_report_locations(array[s.location_id]);
  select * into s from public.cash_count_sessions where id=p_session_id for update;
  select * into c from public.cash_counts where session_id=s.id and status='active';
  if c.id is null then
    if s.status<>'active' or s.expires_at<=clock_timestamp() or s.system_balance is null then
      raise exception 'ช่วงนับเงินหมดเวลา กรุณาเริ่มใหม่'; end if;
    if not private.cash_count_counts_valid(p_actual_counts) then raise exception 'จำนวนเงินไม่ถูกต้อง'; end if;
    if p_evidence_id is not null then
      select * into e from public.cash_count_bank_evidence where id=p_evidence_id for update;
      if e.id is null or e.session_id<>s.id or e.owner_user_id<>auth.uid() or e.drive_uploaded_at is null
        or e.count_id is not null then raise exception 'หลักฐานบัญชีไม่พร้อม'; end if;
      v_bank:=e.amount;
    end if;
    v_cash:=private.cash_count_total(p_actual_counts);
    v_sequence:=nextval('private.cash_count_number_seq')::text;
    insert into public.cash_counts(id,session_id,location_id,cutoff_at,actual_counts,actual_total,
      difference_total,formula_version,created_by_user_id,created_by_name,created_by_phone,
      count_no,system_balance,account_balance,counted_total)
    values(v_id,s.id,s.location_id,s.cutoff_at,p_actual_counts,v_cash,
      v_cash+v_bank-s.system_balance,'ledger-v2',auth.uid(),s.started_by_name,s.started_by_phone,
      'CNT-'||to_char(s.cutoff_at at time zone 'Asia/Bangkok','YYYYMMDD')||'-'||lpad(v_sequence,greatest(6,length(v_sequence)),'0'),
      s.system_balance,v_bank,v_cash+v_bank) returning * into c;
    update public.cash_count_bank_evidence set count_id=c.id where id=e.id;
    update public.cash_count_sessions set status='submitted',ended_at=clock_timestamp() where id=s.id;
  end if;
  return jsonb_build_object('id',c.id,'reportNo',c.count_no,'countNo',c.count_no,'cutoffAt',c.cutoff_at,
    'submittedAt',c.created_at,'countedByName',c.created_by_name,'actualCounts',c.actual_counts,
    'actualTotal',c.actual_total,'accountBalance',c.account_balance,'countedTotal',c.counted_total,
    'systemBalance',c.system_balance,'differenceTotal',c.difference_total,
    'hasBankAccount',exists(select 1 from public.cash_count_bank_evidence where count_id=c.id));
end $$;
create or replace function public.submit_cash_count(p_session_id uuid,p_actual_counts jsonb) returns jsonb
language sql security definer set search_path='' as $$ select public.submit_cash_count_v2(p_session_id,p_actual_counts,null) $$;

create or replace function public.delete_cash_count(p_cash_count_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.cash_counts%rowtype;
begin
  if not private.can_delete_reports() then raise exception 'ไม่มีสิทธิ์ลบนับเงิน'; end if;
  select * into c from public.cash_counts where id=p_cash_count_id;
  if c.id is null then
    if exists(select 1 from public.document_deletion_audits where document_kind='cash_count' and source_id=p_cash_count_id) then
      return jsonb_build_object('id',p_cash_count_id,'status','deleted'); end if;
    raise exception 'ไม่พบผลนับเงิน';
  end if;
  perform private.lock_report_locations(array[c.location_id]);
  select * into c from public.cash_counts where id=p_cash_count_id for update;
  if c.status='deleted' then return jsonb_build_object('id',c.id,'status','deleted'); end if;
  insert into public.document_deletion_audits(document_kind,source_id,document_no,location_id,
    original_actor_user_id,original_actor_name,deleted_by_user_id,deleted_by_name,deleted_at)
    select 'cash_count',c.id,c.count_no,c.location_id,c.created_by_user_id,c.created_by_name,
      auth.uid(),name,clock_timestamp() from public.profiles where id=auth.uid();
  update public.cash_counts set status='deleted',deleted_at=clock_timestamp(),deleted_by_user_id=auth.uid()
    where id=c.id;
  return jsonb_build_object('id',c.id,'status','deleted');
end $$;

create function public.check_cash_count(p_count_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.cash_counts%rowtype;
begin
  if not public.can_access_super_admin_features() then raise exception 'ไม่มีสิทธิ์ตรวจสอบ'; end if;
  update public.cash_counts set checked_by_user_id=auth.uid(),
    checked_by_name=(select name from public.profiles where id=auth.uid()),checked_at=clock_timestamp()
    where id=p_count_id and status='active' and checked_at is null;
  select * into c from public.cash_counts where id=p_count_id and status='active';
  if c.id is null then raise exception 'ไม่พบผลนับเงิน'; end if;
  return jsonb_build_object('checkedByName',c.checked_by_name,'checkedAt',c.checked_at);
end $$;

-- Detach the FK so deleting a report never cascades or prevents independent count history.
alter table public.cash_counts drop constraint cash_counts_report_id_fkey;
alter table public.cash_counts drop constraint cash_counts_previous_cash_count_id_fkey;
update public.cash_counts set report_id=null,previous_cash_count_id=null,
  anomaly_score=null,confidence=null,analysis_status=null;
create or replace function public.has_cash_count(source_row public.report_batches) returns boolean
language sql stable security definer set search_path='' as $$ select false $$;
create or replace function public.cash_count_link_id(source_row public.report_batches) returns uuid
language sql stable security definer set search_path='' as $$ select null::uuid $$;
create or replace function public.cash_count_checker_name(source_row public.report_batches) returns text
language sql stable security definer set search_path='' as $$ select null::text $$;
create or replace function public.cash_count_submitted_at(source_row public.report_batches) returns timestamptz
language sql stable security definer set search_path='' as $$ select null::timestamptz $$;
revoke all on function private.guard_cash_count_movement() from public,anon,authenticated;
revoke all on function public.submit_cash_count_v2(uuid,jsonb,uuid),public.check_cash_count(uuid) from public,anon;
grant execute on function public.submit_cash_count_v2(uuid,jsonb,uuid),public.check_cash_count(uuid) to authenticated;
