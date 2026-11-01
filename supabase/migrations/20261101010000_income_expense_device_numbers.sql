-- Shared issuer registry; Income/Expense owns its numbers and durable create receipts.
alter table public.income_expense add column numbering_metadata jsonb;
create unique index income_expense_numbered_final_unique on public.income_expense(location_id,server_bill_no)
  where numbering_metadata is not null;
create table private.income_expense_number_bindings(
  client_temp_id text primary key, location_id uuid not null, base_number text not null,
  final_number text not null, metadata jsonb not null, unique(location_id,final_number)
);
create table private.income_expense_suffix_counters(
  location_id uuid not null, base_number text not null, last_suffix bigint not null,
  primary key(location_id,base_number)
);
create table private.income_expense_create_receipts(
  client_temp_id text primary key, location_id uuid not null, actor_user_id uuid not null,
  fingerprint text not null, result jsonb not null
);
revoke all on private.income_expense_number_bindings,private.income_expense_suffix_counters,
  private.income_expense_create_receipts from public,anon,authenticated;

create function private.assert_income_expense_numbering(payload jsonb) returns void
language plpgsql set search_path='' as $$
declare m jsonb:=payload->'billNumbering'; i private.rubber_bill_issuers; d date; n bigint;
  b private.income_expense_number_bindings; prefix text;
begin
  select * into b from private.income_expense_number_bindings where client_temp_id=payload->>'clientTempId';
  if b.client_temp_id is not null and (m is distinct from b.metadata
    or payload->>'localBillNo' is distinct from b.base_number
    or payload->>'locationId' is distinct from b.location_id::text) then raise exception 'BILL_NUMBER_CHANGED'; end if;
  if m is null then return; end if;
  if jsonb_typeof(m)<>'object' or m->>'version' is distinct from '1'
    or jsonb_typeof(m->'sequence') is distinct from 'number'
    or (m->>'date') is null or (m->>'date') !~ '^\d{4}-\d{2}-\d{2}$'
    or payload->>'billOption' not in ('รายรับ','ค่าใช้จ่าย') then raise exception 'INVALID_BILL_NUMBER'; end if;
  d:=(m->>'date')::date; n:=(m->>'sequence')::bigint;
  prefix:=case payload->>'type' when 'income' then 'I' when 'expense' then 'E' end;
  select * into i from private.rubber_bill_issuers where id=(m->>'issuerId')::uuid;
  if i.id is null or i.location_id is distinct from (payload->>'locationId')::uuid
    or n<1 or n>9007199254740991 or (m->>'sequence')::numeric<>n or d::text is distinct from m->>'date'
    or prefix is null or (prefix='I' and payload->>'billOption'<>'รายรับ')
    or (prefix='E' and payload->>'billOption'<>'ค่าใช้จ่าย')
    or (b.client_temp_id is null and payload->>'operation'='create' and m->>'date' is distinct from payload->>'txDate')
    or payload->>'localBillNo' is distinct from prefix||'-'||lpad(n::text,greatest(4,length(n::text)),'0')||'-'||to_char(d,'YYMMDD')||'-'||i.code
    then raise exception 'INVALID_BILL_NUMBER'; end if;
exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
  raise exception 'INVALID_BILL_NUMBER';
end $$;

create function private.allocate_income_expense_suffix(payload jsonb) returns text
language plpgsql set search_path='' as $$
declare b private.income_expense_number_bindings; n bigint; loc uuid:=(payload->>'locationId')::uuid;
  base text:=payload->>'localBillNo'; client text:=payload->>'clientTempId';
begin
  perform private.assert_income_expense_numbering(payload);
  select * into b from private.income_expense_number_bindings where client_temp_id=client;
  if found then return b.final_number; end if;
  insert into private.income_expense_suffix_counters values(loc,base,1)
    on conflict(location_id,base_number) do update set last_suffix=income_expense_suffix_counters.last_suffix+1
    returning last_suffix into n;
  insert into private.income_expense_number_bindings values(client,loc,base,base||'-'||n::text,payload->'billNumbering');
  return base||'-'||n::text;
end $$;

create function private.preserve_income_expense_number() returns trigger
language plpgsql set search_path='' as $$
declare b private.income_expense_number_bindings;
begin
  if tg_op='INSERT' then
    select * into b from private.income_expense_number_bindings where client_temp_id=new.client_temp_id;
    if found then
      if new.location_id<>b.location_id or new.local_bill_no<>b.base_number or new.server_bill_no<>b.final_number
        then raise exception 'BILL_NUMBER_CHANGED'; end if;
      new.numbering_metadata:=b.metadata; new.number:=b.final_number;
    elsif new.numbering_metadata is not null then raise exception 'UNBOUND_BILL_NUMBER'; end if;
  elsif old.numbering_metadata is not null and
    (new.local_bill_no is distinct from old.local_bill_no or new.server_bill_no is distinct from old.server_bill_no
      or new.number is distinct from old.number or new.numbering_metadata is distinct from old.numbering_metadata
      or new.location_id<>old.location_id or new.type<>old.type or new.bill_option<>old.bill_option) then
    raise exception 'BILL_NUMBER_CHANGED';
  end if;
  return new;
end $$;
create trigger income_expense_number_identity before insert or update on public.income_expense
  for each row execute function private.preserve_income_expense_number();

-- Allocation happens inside the existing core exception scope, immediately before INSERT.
-- Any SQL failure rolls back both binding and business row; ordinary validation returns precede it.
do $$ declare body text; changed text; old text:='v_server_bill_no := v_date || lpad(v_next_seq::text, 4, ''0'');'; begin
  body:=pg_get_functiondef('public.sync_income_expense_core(jsonb)'::regprocedure);
  changed:=replace(body,old,'if payload ? ''billNumbering'' then'||chr(10)||
    'v_server_bill_no := private.allocate_income_expense_suffix(payload);'||chr(10)||'else '||old||' end if;');
  if changed=body then raise exception 'Income expense allocation boundary missing'; end if;
  execute changed;
end $$;

alter function public.sync_income_expense(jsonb) rename to sync_income_expense_before_numbering_20261101;
alter function public.sync_income_expense_before_numbering_20261101(jsonb) set schema private;
revoke all on function private.sync_income_expense_before_numbering_20261101(jsonb) from public,anon,authenticated;

create function public.sync_income_expense(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare saved private.income_expense_create_receipts; r jsonb; identity jsonb;
  bypass boolean:=coalesce(current_setting('app.bypass_income_expense_approval',true),'false')='true';
  client text:=payload->>'clientTempId'; loc uuid:=(payload->>'locationId')::uuid;
  fp text:=private.income_expense_submission_fingerprint(payload);
begin
  if not payload ? 'billNumbering' and not exists(select 1 from private.income_expense_number_bindings where client_temp_id=client)
    then return private.sync_income_expense_before_numbering_20261101(payload); end if;
  if not coalesce(private.is_active_user(),false) or not public.can_access_location(loc) then
    return jsonb_build_object('status','failed','errorMessage','Location access denied'); end if;
  perform private.assert_income_expense_numbering(payload);
  identity:=jsonb_build_object('clientTempId',client,'operation',payload->>'operation','locationId',loc,
    'billNumbering',payload->'billNumbering','localBillNo',payload->>'localBillNo');
  -- Approval decision already owns the request row. Serialize only submissions here;
  -- replay reads receipt without row locking, avoiding request/receipt lock inversion.
  if not bypass then perform pg_advisory_xact_lock(hashtextextended('income-number-create:'||client,0)); end if;
  if payload->>'operation'='create' then
    select * into saved from private.income_expense_create_receipts where client_temp_id=client;
    if found then
      if saved.location_id<>loc or saved.fingerprint<>fp or (not bypass and saved.actor_user_id<>auth.uid())
        then return identity||jsonb_build_object('status','conflict','errorMessage','ข้อมูลคำขอไม่ตรงกับคำขอเดิม'); end if;
      if not bypass then
        r:=saved.result;
        if r->>'status'='synced' and exists(select 1 from public.income_expense where client_temp_id=client and record_status<>'active')
          then r:=identity||jsonb_build_object('status','discarded'); end if;
        return r;
      end if;
    elsif bypass then
      raise exception 'NUMBERED_APPROVAL_RECEIPT_MISSING';
    end if;
  end if;
  r:=private.sync_income_expense_before_numbering_20261101(payload)||identity;
  if payload->>'operation'='create' and r->>'status' in ('synced','pending_approval') then
    insert into private.income_expense_create_receipts values(client,loc,auth.uid(),fp,r)
      on conflict(client_temp_id) do update set result=excluded.result;
  end if;
  return r;
exception when raise_exception then
  if sqlerrm in ('INVALID_BILL_NUMBER','BILL_NUMBER_CHANGED','NUMBERED_APPROVAL_RECEIPT_MISSING') then
    return jsonb_build_object('status','failed','errorCode','NUMBERING_REJECTED','errorMessage','เลขบิลไม่ตรงกับทะเบียน กรุณาตรวจสอบกับผู้ดูแล',
      'clientTempId',client,'operation',payload->>'operation','locationId',loc,'localBillNo',payload->>'localBillNo','billNumbering',payload->'billNumbering');
  end if;
  raise;
end $$;
revoke all on function public.sync_income_expense(jsonb) from public,anon;
grant execute on function public.sync_income_expense(jsonb) to authenticated;

create function public.sync_numbered_income_expense(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not payload ? 'billNumbering' then raise exception 'INVALID_BILL_NUMBER'; end if;
  return public.sync_income_expense(payload);
end $$;
revoke all on function public.sync_numbered_income_expense(jsonb) from public,anon;
grant execute on function public.sync_numbered_income_expense(jsonb) to authenticated;

create function private.capture_income_create_approval_outcome() returns trigger
language plpgsql set search_path='' as $$
declare client text:=new.requested_payload->>'clientTempId'; row public.income_expense; r jsonb;
begin
  if new.requested_operation='create' and new.requested_payload ? 'billNumbering' and new.request_status in ('approved','rejected') then
    if new.request_status='rejected' then r:=jsonb_build_object('status','rejected','requestId',new.id);
    else
      select * into row from public.income_expense where id=new.approved_income_expense_id;
      r:=jsonb_build_object('status','synced','id',row.id,'serverBillNo',row.server_bill_no,
        'revisionNo',row.revision_no,'serverReceivedAt',row.server_received_at);
    end if;
    update private.income_expense_create_receipts set result=result||r where client_temp_id=client;
  end if;
  return new;
end $$;
create trigger income_create_approval_outcome after update of request_status on public.income_expense_approval_requests
  for each row execute function private.capture_income_create_approval_outcome();

-- Metadata is read back through the existing bounded operational feed, including pending creates.
alter function public.get_income_expense_operational_feed(uuid,text,text,text) rename to get_income_expense_feed_before_numbering_20261101;
alter function public.get_income_expense_feed_before_numbering_20261101(uuid,text,text,text) set schema private;
revoke all on function private.get_income_expense_feed_before_numbering_20261101(uuid,text,text,text) from public,anon,authenticated;
create function public.get_income_expense_operational_feed(p_location_id uuid,p_mode text default 'latest',p_search text default '',p_cursor text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb; rows jsonb;
begin
  r:=private.get_income_expense_feed_before_numbering_20261101(p_location_id,p_mode,p_search,p_cursor);
  select coalesce(jsonb_agg(item.value || case when metadata.m is not null then jsonb_build_object('billNumbering',metadata.m) else '{}'::jsonb end order by item.ordinality),'[]'::jsonb)
    into rows from jsonb_array_elements(r->'rows') with ordinality item(value,ordinality)
    left join lateral (
      select coalesce((select numbering_metadata from public.income_expense where client_temp_id=item.value->>'clientTempId'),
        (select requested_payload->'billNumbering' from public.income_expense_approval_requests
          where requested_payload->>'clientTempId'=item.value->>'clientTempId' and location_id=p_location_id
          order by created_at desc limit 1)) m
    ) metadata on true;
  return jsonb_set(r,'{rows}',rows);
end $$;
revoke all on function public.get_income_expense_operational_feed(uuid,text,text,text) from public,anon;
grant execute on function public.get_income_expense_operational_feed(uuid,text,text,text) to authenticated;
revoke all on function private.assert_income_expense_numbering(jsonb),private.allocate_income_expense_suffix(jsonb),
  private.preserve_income_expense_number(),private.capture_income_create_approval_outcome() from public,anon,authenticated;
