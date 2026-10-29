-- Protected transaction context, never JWT impersonation. No browser can set it.
create table private.rubber_queue_jobs (
  command_id uuid primary key,
  location_id uuid not null references public.locations(id) on delete cascade,
  actor_user_id uuid not null,
  client_temp_id text not null check(length(client_temp_id) between 1 and 512),
  action text not null check(action in ('create','update','delete','approve','cancel')),
  fingerprint text not null,
  payload jsonb,
  target_request_id uuid,
  target_fingerprint text,
  accepted_at timestamptz not null default clock_timestamp(),
  policy jsonb not null,
  state text not null default 'queued' check(state in ('queued','retry_wait','paused','correction_required','done')),
  result jsonb,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default clock_timestamp(),
  error_code text,
  version bigint not null default 1,
  completed_at timestamptz,
  retired_by uuid
);
create index rubber_queue_due on private.rubber_queue_jobs(next_attempt_at,accepted_at)
  where state in ('queued','retry_wait','paused');
create index rubber_queue_branch on private.rubber_queue_jobs(location_id,accepted_at desc,command_id);
create table private.rubber_queue_heads (
  location_id uuid not null references public.locations(id) on delete cascade,
  client_temp_id text not null,
  version bigint not null default 0,
  primary key(location_id,client_temp_id)
);
create table private.rubber_queue_execution (
  backend_pid integer not null,
  transaction_id bigint not null,
  command_id uuid not null references private.rubber_queue_jobs(command_id) on delete cascade,
  primary key(backend_pid,transaction_id)
);
revoke all on private.rubber_queue_jobs,private.rubber_queue_heads,private.rubber_queue_execution from public,anon,authenticated;

create function private.rubber_execution_job() returns private.rubber_queue_jobs
language sql stable security definer set search_path='' as $$
  select j.* from private.rubber_queue_execution e join private.rubber_queue_jobs j using(command_id)
  where e.backend_pid=pg_backend_pid() and e.transaction_id=txid_current()
$$;
create function private.rubber_execution_actor() returns uuid
language sql stable security definer set search_path='' as $$
  select coalesce((private.rubber_execution_job()).actor_user_id,auth.uid())
$$;
create function private.rubber_actor_active() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles where id=private.rubber_execution_actor()
    and is_active and role in ('admin','super_admin'))
$$;
create function private.rubber_actor_manager() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles where id=private.rubber_execution_actor()
    and is_active and (role='super_admin' or (role='admin' and can_access_super_admin_features)))
$$;
create function private.rubber_actor_location(p_location uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.rubber_actor_active() and (private.rubber_actor_manager() or exists(
    select 1 from public.user_locations where user_id=private.rubber_execution_actor() and location_id=p_location))
$$;
create function private.rubber_evaluation_time() returns timestamptz
language sql stable security definer set search_path='' as $$
  select coalesce((private.rubber_execution_job()).accepted_at,clock_timestamp())
$$;
create function private.rubber_queue_acid_balance(p_location_id uuid,p_product_id uuid) returns numeric
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.rubber_actor_location(p_location_id) then raise exception 'Location access denied'; end if;
  return (select coalesce(sum(quantity_delta),0) from public.acid_stock_movements
    where location_id=p_location_id and product_id=p_product_id);
end $$;

alter function private.resolve_rubber_bill_price_policy_without_quota(uuid) rename to resolve_rubber_bill_price_policy_before_queue;
create function private.resolve_rubber_bill_price_policy_without_quota(p_location_id uuid)
returns table(group_id uuid,rule_source text,central_price numeric,price_allowance numeric,effective_price_cap numeric,
  edit_window_minutes integer,price_rule_revision bigint,updated_by_name text,updated_by_phone text,
  updated_at timestamptz,non_current_date_requires_approval boolean)
language plpgsql stable security definer set search_path='' as $$
declare j private.rubber_queue_jobs;
begin
  j:=private.rubber_execution_job();
  if j.command_id is not null and j.location_id=p_location_id then
    return query select p.* from jsonb_to_record(j.policy) as p(group_id uuid,rule_source text,central_price numeric,
      price_allowance numeric,effective_price_cap numeric,edit_window_minutes integer,price_rule_revision bigint,
      updated_by_name text,updated_by_phone text,updated_at timestamptz,non_current_date_requires_approval boolean);
  else
    return query select * from private.resolve_rubber_bill_price_policy_before_queue(p_location_id);
  end if;
end $$;

-- Restrict actor substitutions to the complete Rubber mutation call graph.
-- The helpers retain authenticated-user behavior outside a worker transaction.
do $patch$
declare f regprocedure; body text;
begin
  foreach f in array array[
    'public.sync_rubber_bill(jsonb)'::regprocedure,
    'public.sync_rubber_bill_before_commands_20261028010000(jsonb)'::regprocedure,
    'private.sync_rubber_bill_approval_20260823010000(jsonb)'::regprocedure,
    'public.sync_rubber_bill_core_20260725010000(jsonb)'::regprocedure,
    'public.sync_rubber_bill_core_before_price_adjustment_20261008018000(jsonb)'::regprocedure,
    'public.sync_rubber_bill_legacy_core_20260824010000(jsonb)'::regprocedure,
    'private.reserve_rubber_bill_ocr_source(jsonb)'::regprocedure,
    'private.rubber_bill_submission_decision(jsonb)'::regprocedure,
    'public.approve_rubber_bill_approval_request(uuid)'::regprocedure,
    'public.approve_rubber_bill_before_commands_20261028010000(uuid)'::regprocedure,
    'public.delete_rubber_bill_approval_request(uuid)'::regprocedure,
    'public.delete_rubber_bill_before_commands_20261028010000(uuid)'::regprocedure
  ] loop
    body:=pg_get_functiondef(f);
    body:=replace(body,'auth.uid()','private.rubber_execution_actor()');
    body:=replace(body,'private.is_active_user()','private.rubber_actor_active()');
    body:=replace(body,'public.can_access_location(','private.rubber_actor_location(');
    body:=replace(body,'private.can_access_super_admin_features()','private.rubber_actor_manager()');
    body:=replace(body,'public.can_access_super_admin_features()','private.rubber_actor_manager()');
    body:=replace(body,'public.get_acid_stock_balance(','private.rubber_queue_acid_balance(');
    if f in ('private.rubber_bill_submission_decision(jsonb)'::regprocedure,
      'public.sync_rubber_bill_before_commands_20261028010000(jsonb)'::regprocedure,
      'private.sync_rubber_bill_approval_20260823010000(jsonb)'::regprocedure) then
      body:=replace(body,'clock_timestamp()','private.rubber_evaluation_time()');
    end if;
    execute body;
  end loop;
end $patch$;

-- All helpers are private capabilities, including the renamed policy resolver.
do $$ declare f record; begin
  for f in select oid::regprocedure as id from pg_proc where pronamespace='private'::regnamespace
    and proname in ('rubber_execution_job','rubber_execution_actor','rubber_actor_active','rubber_actor_manager',
      'rubber_actor_location','rubber_evaluation_time','rubber_queue_acid_balance','resolve_rubber_bill_price_policy_before_queue',
      'resolve_rubber_bill_price_policy_without_quota')
  loop execute format('revoke all on function %s from public,anon,authenticated',f.id); end loop;
end $$;
