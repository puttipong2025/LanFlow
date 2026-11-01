-- One shared issuer code namespace across all branches and bill modules.
-- Preserve historical branch-local codes and proposals; replace them on registration.
begin;
lock table private.rubber_bill_issuers, private.rubber_bill_issuer_counters,
  private.rubber_bill_issuer_heads in access exclusive mode;

alter table private.rubber_bill_issuers add column global_code boolean not null default false;
alter table private.rubber_bill_issuers alter column global_code set default true;
create unique index rubber_bill_issuers_global_code_unique
  on private.rubber_bill_issuers(code) where global_code;

create table private.bill_issuer_global_counter(
  id boolean primary key default true check(id),
  last_code bigint not null check(last_code between 0 and 999999999999999999)
);
insert into private.bill_issuer_global_counter(id,last_code)
select true,greatest(
  coalesce((select max(last_code) from private.rubber_bill_issuer_counters),0),
  coalesce((select max(substring(code from 2)::bigint) from private.rubber_bill_issuers),0));
revoke all on private.bill_issuer_global_counter from public,anon,authenticated;

create or replace function public.register_rubber_bill_issuer(p_location_id uuid,p_installation_id uuid,p_generation_id uuid,
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
  if i.id is null or i.retired_at is not null or not i.global_code then
    -- Retain the previous registration for frozen offline proposals and audit history.
    if i.id is not null and i.retired_at is null then
      update private.rubber_bill_issuers set retired_at=clock_timestamp(),retired_by=auth.uid() where id=i.id;
    end if;
    update private.bill_issuer_global_counter set last_code=last_code+1
      where id=true and last_code<999999999999999999 returning last_code into n;
    if n is null then raise exception 'ISSUER_CODE_EXHAUSTED'; end if;
    -- Keep the old branch high-water marks conservative for operational history.
    insert into private.rubber_bill_issuer_counters values(p_location_id,n)
      on conflict(location_id) do update set last_code=greatest(rubber_bill_issuer_counters.last_code,excluded.last_code);
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
notify pgrst,'reload schema';
commit;
