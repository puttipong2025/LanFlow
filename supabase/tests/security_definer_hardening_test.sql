begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(6);

select extensions.ok(
  exists (
    select 1
    from pg_proc p
    where p.oid = 'public.deduct_debts_daily()'::regprocedure
      and p.prosecdef
      and exists (
        select 1 from unnest(p.proconfig) setting where setting like 'search_path=%'
      )
  ),
  'deduct_debts_daily is SECURITY DEFINER with a pinned search_path'
);

select extensions.ok(
  exists (
    select 1
    from pg_proc p
    where p.oid = 'public.sync_money_transfer_item_source_fks()'::regprocedure
      and p.prosecdef
      and exists (
        select 1 from unnest(p.proconfig) setting where setting like 'search_path=%'
      )
  ),
  'sync_money_transfer_item_source_fks is SECURITY DEFINER with a pinned search_path'
);

select extensions.ok(
  exists (
    select 1
    from pg_proc p
    where p.oid = 'public.sync_income_expense_core(jsonb)'::regprocedure
      and p.prosecdef
      and exists (
        select 1 from unnest(p.proconfig) setting where setting like 'search_path=%'
      )
  ),
  'sync_income_expense_core is SECURITY DEFINER with a pinned search_path'
);

select extensions.ok(
  exists (
    select 1
    from pg_proc p
    where p.oid = 'public.sync_rubber_bill_core_20260725010000(jsonb)'::regprocedure
      and p.prosecdef
      and exists (
        select 1 from unnest(p.proconfig) setting where setting like 'search_path=%'
      )
  ),
  'sync_rubber_bill_core is SECURITY DEFINER with a pinned search_path'
);

select extensions.is(
  (
    select count(*)
    from pg_proc p
    where p.oid in (
      'public.deduct_debts_daily()'::regprocedure,
      'public.sync_money_transfer_item_source_fks()'::regprocedure,
      'public.sync_income_expense_core(jsonb)'::regprocedure,
      'public.sync_rubber_bill_core_20260725010000(jsonb)'::regprocedure
    )
      and not has_function_privilege('anon', p.oid, 'execute')
  ),
  4::bigint,
  'anon cannot execute any warned SECURITY DEFINER function'
);

select extensions.is(
  (
    select count(*)
    from pg_proc p
    where p.oid in (
      'public.deduct_debts_daily()'::regprocedure,
      'public.sync_money_transfer_item_source_fks()'::regprocedure,
      'public.sync_income_expense_core(jsonb)'::regprocedure,
      'public.sync_rubber_bill_core_20260725010000(jsonb)'::regprocedure
    )
      and not has_function_privilege('authenticated', p.oid, 'execute')
  ),
  4::bigint,
  'authenticated clients cannot execute any warned internal SECURITY DEFINER function'
);

select * from extensions.finish();

rollback;
