-- Device-local base numbers; a final suffix is allocated only by the business create.
create table private.rubber_bill_issuer_counters(location_id uuid primary key, last_code bigint not null);
create table private.rubber_bill_issuers(
  id uuid primary key default gen_random_uuid(), location_id uuid not null,
  code text not null, installation_id uuid not null, generation_id uuid not null,
  browser text not null, platform text not null, last_user_id uuid,
  created_at timestamptz not null default clock_timestamp(), last_seen_at timestamptz not null default clock_timestamp(),
  retired_at timestamptz, retired_by uuid, unique(location_id,code)
);
create table private.rubber_bill_issuer_heads(
  location_id uuid not null, installation_id uuid not null, generation_id uuid not null,
  issuer_id uuid not null references private.rubber_bill_issuers(id),
  primary key(location_id,installation_id,generation_id)
);
create table private.rubber_bill_suffix_counters(
  location_id uuid not null, base_number text not null, last_suffix bigint not null,
  primary key(location_id,base_number)
);
-- Retained independently of bill/queue-history deletion; never recycle issued numbers.
create table private.rubber_bill_number_bindings(
  client_temp_id text primary key, location_id uuid not null, base_number text not null,
  final_number text not null, metadata jsonb not null, unique(location_id,final_number)
);
revoke all on private.rubber_bill_issuer_counters, private.rubber_bill_issuers,
  private.rubber_bill_issuer_heads, private.rubber_bill_suffix_counters,
  private.rubber_bill_number_bindings from public,anon,authenticated;

create function public.register_rubber_bill_issuer(p_location_id uuid,p_installation_id uuid,p_generation_id uuid,
  p_browser text default '',p_platform text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare h private.rubber_bill_issuer_heads; i private.rubber_bill_issuers; n bigint;
begin
  if not private.rubber_actor_active() or not private.rubber_actor_location(p_location_id)
    or not exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','super_admin')) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if p_installation_id is null or p_generation_id is null or p_location_id is null
    or length(p_browser)>160 or length(p_platform)>80 then raise exception 'INVALID_ISSUER'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rubber-issuer:'||p_location_id::text,0));
  select * into h from private.rubber_bill_issuer_heads where location_id=p_location_id
    and installation_id=p_installation_id and generation_id=p_generation_id for update;
  select * into i from private.rubber_bill_issuers where id=h.issuer_id;
  if i.id is null or i.retired_at is not null then
    insert into private.rubber_bill_issuer_counters values(p_location_id,1)
      on conflict(location_id) do update set last_code=rubber_bill_issuer_counters.last_code+1
      returning last_code into n;
    insert into private.rubber_bill_issuers(location_id,code,installation_id,generation_id,browser,platform,last_user_id)
      values(p_location_id,'D'||lpad(n::text,greatest(2,length(n::text)),'0'),p_installation_id,p_generation_id,
        coalesce(p_browser,''),coalesce(p_platform,''),auth.uid()) returning * into i;
    insert into private.rubber_bill_issuer_heads values(p_location_id,p_installation_id,p_generation_id,i.id)
      on conflict(location_id,installation_id,generation_id) do update set issuer_id=excluded.issuer_id;
  else
    update private.rubber_bill_issuers set last_seen_at=clock_timestamp(),last_user_id=auth.uid(),
      browser=coalesce(p_browser,''),platform=coalesce(p_platform,'') where id=i.id;
  end if;
  return jsonb_build_object('id',i.id,'code',i.code,'locationId',p_location_id,'version',1);
end $$;
revoke all on function public.register_rubber_bill_issuer(uuid,uuid,uuid,text,text) from public,anon;
grant execute on function public.register_rubber_bill_issuer(uuid,uuid,uuid,text,text) to authenticated;

create function public.list_rubber_bill_issuers(p_location_id uuid default null,p_search text default '',
  p_offset integer default 0,p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.rubber_actor_active() or not private.rubber_actor_manager() then
    raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_offset<0 or p_limit not between 1 and 100 or length(p_search)>160 then raise exception 'INVALID_INPUT'; end if;
  with filtered as (
    select i.id,i.code,i.location_id as "locationId",l.name as "locationName",i.browser,i.platform,
      p.name as "lastUserName",i.created_at as "createdAt",i.last_seen_at as "lastSeenAt",
      i.retired_at as "retiredAt",r.name as "retiredByName"
    from private.rubber_bill_issuers i left join public.locations l on l.id=i.location_id
      left join public.profiles p on p.id=i.last_user_id left join public.profiles r on r.id=i.retired_by
    where (p_location_id is null or i.location_id=p_location_id)
      and (p_search='' or concat_ws(' ',i.code,l.name,i.browser,i.platform,p.name) ilike '%'||p_search||'%')
  ), page as (select * from filtered order by "createdAt" desc,id limit p_limit offset p_offset)
  select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce(
    (select jsonb_agg(to_jsonb(page) order by "createdAt" desc,id) from page),'[]'::jsonb)) into result;
  return result;
end $$;
revoke all on function public.list_rubber_bill_issuers(uuid,text,integer,integer) from public,anon;
grant execute on function public.list_rubber_bill_issuers(uuid,text,integer,integer) to authenticated;

create function public.retire_rubber_bill_issuer(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not private.rubber_actor_active() or not private.rubber_actor_manager() then
    raise exception 'FORBIDDEN' using errcode='42501'; end if;
  update private.rubber_bill_issuers set retired_at=clock_timestamp(),retired_by=auth.uid()
    where id=p_id and retired_at is null;
  if not exists(select 1 from private.rubber_bill_issuers where id=p_id) then raise exception 'ISSUER_NOT_FOUND'; end if;
  return jsonb_build_object('id',p_id,'retired',true);
end $$;
revoke all on function public.retire_rubber_bill_issuer(uuid) from public,anon;
grant execute on function public.retire_rubber_bill_issuer(uuid) to authenticated;

alter table public.rubber_bills add column numbering_metadata jsonb;
alter table public.rubber_bills drop constraint rubber_bills_location_id_local_bill_no_key;
create unique index rubber_bills_legacy_local_number_unique on public.rubber_bills(location_id,local_bill_no)
  where numbering_metadata is null;
create unique index rubber_bills_device_final_number_unique on public.rubber_bills(location_id,server_bill_no)
  where numbering_metadata is not null;

create function private.assert_rubber_bill_numbering(payload jsonb) returns void
language plpgsql set search_path='' as $$
declare m jsonb:=payload->'billNumbering'; i private.rubber_bill_issuers; d date; seq bigint;
  existing public.rubber_bills;
begin
  select * into existing from public.rubber_bills where client_temp_id=payload->>'clientTempId';
  if existing.numbering_metadata is not null and
    (m is distinct from existing.numbering_metadata or payload->>'localBillNo' is distinct from existing.local_bill_no) then
    raise exception 'BILL_NUMBER_CHANGED'; end if;
  if m is null then return; end if;
  if jsonb_typeof(m)<>'object' or m->>'version' is distinct from '1'
    or jsonb_typeof(m->'sequence') is distinct from 'number'
    or (m->>'date') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'INVALID_BILL_NUMBER'; end if;
  d:=(m->>'date')::date; seq:=(m->>'sequence')::bigint;
  select * into i from private.rubber_bill_issuers where id=(m->>'issuerId')::uuid;
  if i.id is null or i.location_id is distinct from (payload->>'locationId')::uuid or seq<1
    or (m->>'sequence')::numeric<>seq or seq>9007199254740991 or d::text is distinct from m->>'date'
    or payload->>'localBillNo' is distinct from to_char(d,'YYMMDD')||lpad(seq::text,greatest(4,length(seq::text)),'0')||'-'||i.code
    or coalesce(payload->>'billType','') not in ('weighing','บิลเครื่องชั่งเล็ก') then raise exception 'INVALID_BILL_NUMBER'; end if;
  -- Retired issuers remain valid for proposals created while their browser was offline.
end $$;
revoke all on function private.assert_rubber_bill_numbering(jsonb) from public,anon,authenticated;

create function private.allocate_rubber_bill_suffix(payload jsonb) returns text
language plpgsql set search_path='' as $$
declare b private.rubber_bill_number_bindings; n bigint; loc uuid:=(payload->>'locationId')::uuid;
  base text:=payload->>'localBillNo'; client text:=payload->>'clientTempId';
begin
  perform private.assert_rubber_bill_numbering(payload);
  select * into b from private.rubber_bill_number_bindings where client_temp_id=client;
  if b.client_temp_id is not null then
    if b.location_id<>loc or b.base_number<>base or b.metadata is distinct from payload->'billNumbering' then
      raise exception 'BILL_NUMBER_CHANGED'; end if;
    return b.final_number;
  end if;
  insert into private.rubber_bill_suffix_counters values(loc,base,1)
    on conflict(location_id,base_number) do update set last_suffix=rubber_bill_suffix_counters.last_suffix+1
    returning last_suffix into n;
  insert into private.rubber_bill_number_bindings values(client,loc,base,base||'-'||n::text,payload->'billNumbering');
  return base||'-'||n::text;
end $$;
revoke all on function private.allocate_rubber_bill_suffix(jsonb) from public,anon,authenticated;

create function private.preserve_rubber_bill_number() returns trigger
language plpgsql set search_path='' as $$
declare b private.rubber_bill_number_bindings;
begin
  if tg_op='INSERT' then
    select * into b from private.rubber_bill_number_bindings where client_temp_id=new.client_temp_id;
    if b.client_temp_id is not null then
      if new.location_id<>b.location_id or new.local_bill_no<>b.base_number or new.server_bill_no<>b.final_number then
        raise exception 'BILL_NUMBER_CHANGED'; end if;
      new.numbering_metadata:=b.metadata;
    end if;
  elsif old.numbering_metadata is not null and
    (new.local_bill_no is distinct from old.local_bill_no or new.server_bill_no is distinct from old.server_bill_no
      or new.numbering_metadata is distinct from old.numbering_metadata) then raise exception 'BILL_NUMBER_CHANGED';
  end if;
  return new;
end $$;
revoke all on function private.preserve_rubber_bill_number() from public,anon,authenticated;
create trigger rubber_bill_number_identity before insert or update on public.rubber_bills
  for each row execute function private.preserve_rubber_bill_number();

-- Patch only the allocation branch, leaving the legacy business/stock/approval core intact.
do $$ declare body text; old text; changed text; begin
  body:=pg_get_functiondef('public.sync_rubber_bill_legacy_core_20260824010000(jsonb)'::regprocedure);
  old:=$old$    if v_bill_id is null then
      v_date := to_char((payload->>'billDate')::date, 'YYMMDD');$old$;
  changed:=replace(body,old,$new$    if v_bill_id is null and payload ? 'billNumbering' then
      v_server_bill_no := private.allocate_rubber_bill_suffix(payload);
    elsif v_bill_id is null then
      v_date := to_char((payload->>'billDate')::date, 'YYMMDD');$new$);
  if changed=body then raise exception 'number allocation branch not found'; end if;
  execute changed;
  body:=pg_get_functiondef('public.sync_rubber_bill_core_20260725010000(jsonb)'::regprocedure);
  changed:=replace(body,'  v_normalized := private.normalize_rubber_bill_calculation_payload(payload);',
    '  perform private.assert_rubber_bill_numbering(payload);'||chr(10)||'  v_normalized := private.normalize_rubber_bill_calculation_payload(payload);');
  if changed=body then raise exception 'number validation boundary not found'; end if;
  execute changed;
  body:=pg_get_functiondef('public.get_rubber_bill_operational_feed_v2(uuid,text,text,text,timestamptz,text,integer)'::regprocedure);
  changed:=replace(body,'''local_bill_no'', coalesce(r.proposed_payload->>''localBillNo'', ''รอเลขบิล''),',
    '''numbering_metadata'',r.proposed_payload->''billNumbering'','||chr(10)||'''local_bill_no'', coalesce(r.proposed_payload->>''localBillNo'', ''รอเลขบิล''),');
  if changed=body then raise exception 'pending feed numbering boundary not found'; end if;
  execute changed;
end $$;
