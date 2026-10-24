-- Extend existing evidence rows, not a separate bank-account master module.
alter table public.cash_count_bank_evidence drop constraint cash_count_bank_evidence_count_id_key;
alter table public.cash_count_bank_evidence drop constraint cash_count_bank_evidence_session_id_image_sha256_key;
alter table public.cash_count_bank_evidence add column slot_id uuid not null default gen_random_uuid(),
  add column account_position integer check(account_position between 1 and 4);
update public.cash_count_bank_evidence set account_position=1 where count_id is not null;
alter table public.cash_count_bank_evidence add constraint cash_count_bank_attached_position
  check((count_id is null and account_position is null) or (count_id is not null and account_position is not null));
create unique index cash_count_bank_slot_image on public.cash_count_bank_evidence(session_id,slot_id,image_sha256);
create unique index cash_count_bank_position on public.cash_count_bank_evidence(count_id,account_position) where count_id is not null;
create unique index cash_count_bank_attached_slot on public.cash_count_bank_evidence(count_id,slot_id) where count_id is not null;

create function public.submit_cash_count_v3(p_session_id uuid,p_actual_counts jsonb,p_evidence_ids uuid[] default array[]::uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.cash_count_sessions%rowtype; c public.cash_counts%rowtype;
  e public.cash_count_bank_evidence%rowtype; v_cash numeric; v_bank numeric:=0; v_id uuid:=gen_random_uuid(); v_sequence text; v_evidence_id uuid; v_position integer:=0;
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
    if p_evidence_ids is null or cardinality(p_evidence_ids)>4
      or exists(select 1 from unnest(p_evidence_ids) x where x is null)
      or (select count(distinct x) from unnest(p_evidence_ids) x)<>cardinality(p_evidence_ids) then
      raise exception 'เลือกหลักฐานบัญชีได้สูงสุด 4 ช่องและห้ามอ้างหลักฐานแถวเดิมซ้ำ'; end if;
    foreach v_evidence_id in array p_evidence_ids loop
      select * into e from public.cash_count_bank_evidence where id=v_evidence_id for update;
      if e.id is null or e.session_id<>s.id or e.owner_user_id<>auth.uid() or e.drive_uploaded_at is null
        or e.count_id is not null then raise exception 'หลักฐานบัญชีไม่พร้อม'; end if;
      if exists(select 1 from public.cash_count_bank_evidence where id=any(p_evidence_ids) and slot_id=e.slot_id and id<>e.id) then
        raise exception 'หนึ่งช่องใช้ได้หนึ่งรูป'; end if;
      v_bank:=v_bank+e.amount;
    end loop;
    v_cash:=private.cash_count_total(p_actual_counts);
    v_sequence:=nextval('private.cash_count_number_seq')::text;
    insert into public.cash_counts(id,session_id,location_id,cutoff_at,actual_counts,actual_total,
      difference_total,formula_version,created_by_user_id,created_by_name,created_by_phone,
      count_no,system_balance,account_balance,counted_total)
    values(v_id,s.id,s.location_id,s.cutoff_at,p_actual_counts,v_cash,
      v_cash+v_bank-s.system_balance,'ledger-v2',auth.uid(),s.started_by_name,s.started_by_phone,
      'CNT-'||to_char(s.cutoff_at at time zone 'Asia/Bangkok','YYYYMMDD')||'-'||lpad(v_sequence,greatest(6,length(v_sequence)),'0'),
      s.system_balance,v_bank,v_cash+v_bank) returning * into c;
    foreach v_evidence_id in array p_evidence_ids loop
      v_position:=v_position+1;
      update public.cash_count_bank_evidence set count_id=c.id,account_position=v_position where id=v_evidence_id;
    end loop;
    update public.cash_count_sessions set status='submitted',ended_at=clock_timestamp() where id=s.id;
  end if;
  return jsonb_build_object('id',c.id,'reportNo',c.count_no,'countNo',c.count_no,'cutoffAt',c.cutoff_at,
    'submittedAt',c.created_at,'countedByName',c.created_by_name,'actualCounts',c.actual_counts,
    'actualTotal',c.actual_total,'accountBalance',c.account_balance,'countedTotal',c.counted_total,
    'systemBalance',c.system_balance,'differenceTotal',c.difference_total,
    'hasBankAccount',exists(select 1 from public.cash_count_bank_evidence where count_id=c.id),
    'bankAccounts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'position',account_position,'amount',amount) order by account_position) from public.cash_count_bank_evidence where count_id=c.id),'[]'::jsonb));
end $$;

-- Keep old one-bank/no-bank callers valid without a second implementation.
create or replace function public.submit_cash_count_v2(p_session_id uuid,p_actual_counts jsonb,p_evidence_id uuid default null)
returns jsonb language sql security definer set search_path='' as $$
 select public.submit_cash_count_v3(p_session_id,p_actual_counts,case when p_evidence_id is null then array[]::uuid[] else array[p_evidence_id] end)
$$;
revoke all on function public.submit_cash_count_v3(uuid,jsonb,uuid[]) from public,anon;
grant execute on function public.submit_cash_count_v3(uuid,jsonb,uuid[]) to authenticated;
