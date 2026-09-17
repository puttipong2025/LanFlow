begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.replace_time_payroll_attendance_exceptions(uuid,text,jsonb)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'public.correct_time_payroll_period_start(uuid,uuid,date)',
    'EXECUTE'
  ),
  'authenticated managers retain the two public attendance correction RPCs'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'private.rebuild_open_deductions_after_attendance(uuid,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'private.assert_attendance_range_without_payroll_slip(uuid,date,date)',
    'EXECUTE'
  ),
  'attendance settlement helpers remain private'
);

select extensions.ok(
  to_regprocedure('private.plan_time_tracking_deductions(uuid,numeric,date,boolean)') is not null
  and to_regprocedure('private.apply_time_tracking_deductions(uuid,date)') is not null
  and to_regprocedure('public.commit_time_tracking_wage_recalculation(uuid,numeric,text)') is not null,
  'attendance recalculation keeps the existing planner, additive engine, and wage commit contracts'
);

select * from extensions.finish();
rollback;
