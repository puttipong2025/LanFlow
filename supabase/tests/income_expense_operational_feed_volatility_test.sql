begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(5);

select extensions.is(
  (
    select p.provolatile::text
    from pg_proc p
    where p.oid = 'public.get_income_expense_operational_feed(uuid,text,text,text)'::regprocedure
  ),
  'v',
  'public operational feed volatility matches its delegated functions'
);

select extensions.is(
  (
    select p.provolatile::text
    from pg_proc p
    where p.oid = 'public.get_income_expense_operational_feed_20260907010000_base(uuid,text,text,text)'::regprocedure
  ),
  'v',
  'delegated operational feed base remains volatile'
);

select extensions.ok(
  exists (
    select 1
    from pg_proc p
    where p.oid = 'public.get_income_expense_operational_feed(uuid,text,text,text)'::regprocedure
      and p.prosecdef
      and exists (
        select 1
        from unnest(p.proconfig) setting
        where setting = 'search_path=""'
      )
  ),
  'public operational feed remains SECURITY DEFINER with an empty search_path'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.get_income_expense_operational_feed(uuid,text,text,text)',
    'execute'
  ),
  'authenticated clients can execute the public operational feed'
);

select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.get_income_expense_operational_feed(uuid,text,text,text)',
    'execute'
  ),
  'anonymous clients cannot execute the public operational feed'
);

select * from extensions.finish();

rollback;
