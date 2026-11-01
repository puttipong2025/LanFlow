-- A browser installation has one code. Branch rows are authorized usage links only.
begin;
lock table private.rubber_bill_issuers,private.rubber_bill_issuer_heads in access exclusive mode;
create table private.bill_issuer_devices(
  id uuid primary key default gen_random_uuid(), code text not null unique,
  installation_id uuid not null, generation_id uuid not null,
  created_at timestamptz not null default clock_timestamp(), retired_at timestamptz, retired_by uuid
);
create table private.bill_issuer_device_heads(
  installation_id uuid not null, generation_id uuid not null,
  device_id uuid not null references private.bill_issuer_devices(id),
  primary key(installation_id,generation_id)
);
alter table private.rubber_bill_issuers add column device_id uuid references private.bill_issuer_devices(id);
create unique index rubber_bill_issuer_device_branch_unique on private.rubber_bill_issuers(device_id,location_id) where device_id is not null;
drop index private.rubber_bill_issuers_global_code_unique;
revoke all on private.bill_issuer_devices,private.bill_issuer_device_heads from public,anon,authenticated;

create or replace function public.register_rubber_bill_issuer(p_location_id uuid,p_installation_id uuid,p_generation_id uuid,
  p_browser text default '',p_platform text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare d private.bill_issuer_devices; i private.rubber_bill_issuers; n bigint;
begin
  if not private.rubber_actor_active() or not private.rubber_actor_location(p_location_id)
    or not exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','super_admin')) then
    raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_installation_id is null or p_generation_id is null or p_location_id is null
    or length(p_browser)>160 or length(p_platform)>80 then raise exception 'INVALID_ISSUER'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bill-device:'||p_installation_id::text||':'||p_generation_id::text,0));
  select device.* into d from private.bill_issuer_device_heads h join private.bill_issuer_devices device on device.id=h.device_id
    where h.installation_id=p_installation_id and h.generation_id=p_generation_id;
  if d.id is null or d.retired_at is not null then
    update private.bill_issuer_global_counter set last_code=last_code+1
      where id=true and last_code<999999999999999999 returning last_code into n;
    if n is null then raise exception 'ISSUER_CODE_EXHAUSTED'; end if;
    insert into private.bill_issuer_devices(code,installation_id,generation_id)
      values('D'||lpad(n::text,greatest(2,length(n::text)),'0'),p_installation_id,p_generation_id) returning * into d;
    insert into private.bill_issuer_device_heads values(p_installation_id,p_generation_id,d.id)
      on conflict(installation_id,generation_id) do update set device_id=excluded.device_id;
  end if;
  select * into i from private.rubber_bill_issuers where device_id=d.id and location_id=p_location_id;
  if i.id is null then
    update private.rubber_bill_issuers old set retired_at=clock_timestamp(),retired_by=auth.uid()
      from private.rubber_bill_issuer_heads h where h.issuer_id=old.id and h.location_id=p_location_id
      and h.installation_id=p_installation_id and h.generation_id=p_generation_id and old.retired_at is null;
    insert into private.rubber_bill_issuers(location_id,code,installation_id,generation_id,browser,platform,last_user_id,device_id)
      values(p_location_id,d.code,p_installation_id,p_generation_id,coalesce(p_browser,''),coalesce(p_platform,''),auth.uid(),d.id) returning * into i;
    insert into private.rubber_bill_issuer_heads values(p_location_id,p_installation_id,p_generation_id,i.id)
      on conflict(location_id,installation_id,generation_id) do update set issuer_id=excluded.issuer_id;
    insert into private.rubber_bill_issuer_counters values(p_location_id,substring(d.code from 2)::bigint)
      on conflict(location_id) do update set last_code=greatest(rubber_bill_issuer_counters.last_code,excluded.last_code);
  else
    update private.rubber_bill_issuers set last_seen_at=clock_timestamp(),last_user_id=auth.uid(),
      browser=coalesce(p_browser,''),platform=coalesce(p_platform,'') where id=i.id;
  end if;
  return jsonb_build_object('id',i.id,'code',d.code,'locationId',p_location_id,'deviceId',d.id,'version',1);
end $$;

create or replace function public.retire_rubber_bill_issuer(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i private.rubber_bill_issuers; d private.bill_issuer_devices;
begin
  if not private.rubber_actor_active() or not private.rubber_actor_manager() then
    raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select * into i from private.rubber_bill_issuers where id=p_id;
  if i.id is null then raise exception 'ISSUER_NOT_FOUND'; end if;
  if i.device_id is not null then
    select * into d from private.bill_issuer_devices where id=i.device_id;
    perform pg_advisory_xact_lock(hashtextextended('bill-device:'||d.installation_id::text||':'||d.generation_id::text,0));
    update private.bill_issuer_devices set retired_at=clock_timestamp(),retired_by=auth.uid() where id=d.id and retired_at is null;
    update private.rubber_bill_issuers set retired_at=clock_timestamp(),retired_by=auth.uid() where device_id=d.id and retired_at is null;
  else
    update private.rubber_bill_issuers set retired_at=clock_timestamp(),retired_by=auth.uid() where id=p_id and retired_at is null;
  end if;
  return jsonb_build_object('id',p_id,'retired',true);
end $$;

-- One Admin row per device; branch filtering describes usage, not device identity.
create or replace function public.list_rubber_bill_issuers(p_location_id uuid default null,p_search text default '',
  p_offset integer default 0,p_limit integer default 20,p_status text default 'all') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.rubber_actor_active() or not private.rubber_actor_manager() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_limit is null or p_offset is null or p_status is null or p_search is null or p_status not in ('all','active','retired')
    or p_offset<0 or p_limit not between 1 and 100 or length(p_search)>160 then raise exception 'INVALID_INPUT'; end if;
  with candidates as (
    select i.*,coalesce(i.device_id,i.id) device_key,
      case when i.device_id is null then l.name else (select string_agg(distinct loc.name,', ' order by loc.name)
        from private.rubber_bill_issuers link join public.locations loc on loc.id=link.location_id where link.device_id=i.device_id) end location_names
    from private.rubber_bill_issuers i left join public.locations l on l.id=i.location_id
    where (p_location_id is null or i.location_id=p_location_id)
      and (p_status='all' or (p_status='active' and i.retired_at is null) or (p_status='retired' and i.retired_at is not null))
  ), chosen as (
    select distinct on(c.device_key) c.* from candidates c left join public.profiles p on p.id=c.last_user_id
    where p_search='' or concat_ws(' ',c.code,c.location_names,c.browser,c.platform,p.name) ilike '%'||p_search||'%'
    order by c.device_key,c.last_seen_at desc,c.id
  ), filtered as (
    select c.id,c.code,c.location_id as "locationId",c.location_names as "locationName",c.browser,c.platform,
      p.name as "lastUserName",c.created_at as "createdAt",c.last_seen_at as "lastSeenAt",c.retired_at as "retiredAt",r.name as "retiredByName"
    from chosen c left join public.profiles p on p.id=c.last_user_id left join public.profiles r on r.id=c.retired_by
  ), page as (select * from filtered order by "createdAt" desc,id limit p_limit offset p_offset)
  select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce(
    (select jsonb_agg(to_jsonb(page) order by "createdAt" desc,id) from page),'[]'::jsonb)) into result;
  return result;
end $$;
revoke all on function public.register_rubber_bill_issuer(uuid,uuid,uuid,text,text),public.retire_rubber_bill_issuer(uuid),
  public.list_rubber_bill_issuers(uuid,text,integer,integer,text) from public,anon;
grant execute on function public.register_rubber_bill_issuer(uuid,uuid,uuid,text,text),public.retire_rubber_bill_issuer(uuid),
  public.list_rubber_bill_issuers(uuid,text,integer,integer,text) to authenticated;
notify pgrst,'reload schema';
commit;
