begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(5);

select extensions.ok(
  not private.time_payroll_day_earned_at('2026-09-02 08:59:59+00'::timestamptz, time '16:00'),
  'END one second before the Bangkok workday cutoff does not earn the day'
);

select extensions.ok(
  private.time_payroll_day_earned_at('2026-09-02 09:00:00+00'::timestamptz, time '16:00'),
  'END at the exact Bangkok workday cutoff earns the day'
);

select extensions.ok(
  private.time_payroll_day_earned_at('2026-09-02 09:00:01+00'::timestamptz, time '16:00'),
  'END after the Bangkok workday cutoff earns the day'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'private.time_payroll_day_earned_at(timestamp with time zone,time without time zone)',
    'execute'
  ),
  'Authenticated clients cannot choose the cutoff timestamp'
);

select extensions.throws_ok(
  $$select public.set_time_payroll_active_period(
    '00000000-0000-0000-0000-000000000001'::uuid,
    'END',
    ((now() at time zone 'Asia/Bangkok')::date - 1)
  )$$,
  'P0001',
  'Forbidden',
  'The public RPC remains manager-only before validating a backdated END'
);

select * from extensions.finish();

rollback;
