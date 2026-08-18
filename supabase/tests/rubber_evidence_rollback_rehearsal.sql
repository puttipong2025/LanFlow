\set ON_ERROR_STOP on

create temporary table rubber_evidence_rollback_snapshot as
select
  md5(pg_get_functiondef(p.oid)) as definition_hash,
  p.proacl,
  (select count(*) from public.rubber_bill_evidence_reviews) as review_count
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'get_actionable_badge_counts'
  and pg_get_function_identity_arguments(p.oid) = '';

do $$
begin
  if (select count(*) from rubber_evidence_rollback_snapshot) <> 1 then
    raise exception 'expected one actionable badge function snapshot';
  end if;
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('rubber_bill_evidence_review_periods', 'rubber_bill_evidence_reviews')
      and c.relrowsecurity
    group by n.nspname
    having count(*) = 2
  ) then
    raise exception 'rubber evidence review RLS is not enabled on both tables';
  end if;
  if not has_function_privilege('authenticated', 'public.get_actionable_badge_counts()', 'EXECUTE')
     or has_function_privilege('anon', 'public.get_actionable_badge_counts()', 'EXECUTE') then
    raise exception 'actionable badge grants do not match the authenticated-only contract';
  end if;
end;
$$;

begin;

create or replace function public.get_actionable_badge_counts()
returns table(location_id uuid, module_id text, item_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select null::uuid, null::text, null::bigint where false;
$$;

revoke all on function public.get_actionable_badge_counts() from public, anon;
grant execute on function public.get_actionable_badge_counts() to authenticated;

do $$
begin
  if pg_get_functiondef('public.get_actionable_badge_counts()'::regprocedure)
     not like '%where false%' then
    raise exception 'temporary rollback function body was not installed';
  end if;
end;
$$;

rollback;

do $$
declare
  current_hash text;
  current_acl aclitem[];
  current_review_count bigint;
begin
  select md5(pg_get_functiondef(p.oid)), p.proacl
  into current_hash, current_acl
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'get_actionable_badge_counts'
    and pg_get_function_identity_arguments(p.oid) = '';

  select count(*) into current_review_count from public.rubber_bill_evidence_reviews;

  if current_hash is distinct from (select definition_hash from rubber_evidence_rollback_snapshot)
     or current_acl is distinct from (select proacl from rubber_evidence_rollback_snapshot)
     or current_review_count is distinct from (select review_count from rubber_evidence_rollback_snapshot) then
    raise exception 'rollback did not restore function definition, grants, and review data';
  end if;
end;
$$;

drop table rubber_evidence_rollback_snapshot;
