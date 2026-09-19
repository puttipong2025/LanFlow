begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(9);

create temporary table adjustment_fixture as
select
  profile.id as profile_id,
  location.id as location_id,
  gen_random_uuid() as withdrawal_id,
  gen_random_uuid() as income_adjustment_id,
  gen_random_uuid() as expense_adjustment_id,
  gen_random_uuid() as report_id
from public.profiles profile
cross join public.locations location
where profile.is_active = true and location.is_active = true
order by profile.id, location.id
limit 1;

insert into public.financial_transactions (
  id, profile_id, type, amount, remaining_amount, status,
  effective_date, expense_location_id, approved_by, approved_at
)
select withdrawal_id, profile_id, 'WITHDRAWAL', 1000, 1000, 'APPROVED',
  '2030-01-01', location_id, profile_id, '2030-01-01 10:00+07'
from adjustment_fixture;

insert into public.financial_transactions (
  id, profile_id, type, amount, adjustment_base_amount, remaining_amount,
  status, parent_debt_id, effective_date, expense_location_id,
  approved_by, approved_at
)
select income_adjustment_id, profile_id, 'ADJUSTMENT'::public.financial_transaction_type, 600, 1000, 0,
  'APPROVED'::public.approval_status, withdrawal_id, '2030-01-01'::date, location_id,
  profile_id, '2030-01-01 11:00+07'::timestamptz
from adjustment_fixture
union all
select expense_adjustment_id, profile_id, 'ADJUSTMENT'::public.financial_transaction_type, 900, 600, 0,
  'APPROVED'::public.approval_status, withdrawal_id, '2030-01-01'::date, location_id,
  profile_id, '2030-01-01 12:00+07'::timestamptz
from adjustment_fixture;

insert into public.report_batches (
  id, report_no, report_date, sequence_no, location_id, cutoff_at,
  created_by_user_id, created_by_name, created_by_phone
)
select report_id, 'RPT-WADJ-' || left(report_id::text, 8), '2030-01-01',
  987654, location_id, '2030-01-01 16:00+07',
  profile_id, 'Adjustment test', '0000000000'
from adjustment_fixture;

insert into public.report_items (
  report_id, location_id, entity_type, entity_id, eligibility_at
)
select report_id, location_id, 'financial_transaction', income_adjustment_id,
  '2030-01-01 13:00+07'::timestamptz
from adjustment_fixture
union all
select report_id, location_id, 'financial_transaction', expense_adjustment_id,
  '2030-01-01 14:00+07'::timestamptz
from adjustment_fixture;

insert into public.report_items (
  report_id, location_id, entity_type, entity_id, eligibility_at
)
select report_id, location_id, 'financial_transaction', withdrawal_id,
  '2030-01-01 12:30+07'::timestamptz
from adjustment_fixture;

select extensions.is(
  (select count(*)::integer from adjustment_fixture),
  1,
  'cash-count fixture has one active profile and branch'
);

select extensions.is(
  (
    select coalesce(sum(event.amount), 0)
    from adjustment_fixture fixture
    cross join lateral private.cash_count_events(
      fixture.location_id,
      '2030-01-01 12:00+07',
      '2030-01-01 16:00+07'
    ) event
    where event.reference ->> 'id' = fixture.income_adjustment_id::text
      and event.event_kind = 'income'
  ),
  400::numeric,
  'cash count receives the decrease delta, not the target amount'
);

select extensions.is(
  (
    select coalesce(sum(event.amount), 0)
    from adjustment_fixture fixture
    cross join lateral private.cash_count_events(
      fixture.location_id,
      '2030-01-01 12:00+07',
      '2030-01-01 16:00+07'
    ) event
    where event.reference ->> 'id' = fixture.expense_adjustment_id::text
      and event.event_kind = 'expense'
  ),
  300::numeric,
  'cash count pays the increase delta, not the target amount'
);

select extensions.is(
  (
    select count(*)::integer
    from adjustment_fixture fixture
    cross join lateral private.cash_count_events(
      fixture.location_id,
      '2030-01-01 12:00+07',
      '2030-01-01 16:00+07'
    ) event
    where event.reference ->> 'id' in (
      fixture.income_adjustment_id::text,
      fixture.expense_adjustment_id::text
    )
  ),
  2,
  'cash count includes each report-locked adjustment exactly once'
);

select set_config('app.time_payroll_settlement_rpc', 'true', true);
select extensions.throws_like(
  format(
    'update public.financial_transactions set remaining_amount = 1000 where id = %L',
    fixture.withdrawal_id
  ),
  'REPORT_LOCKED:%',
  'reported withdrawal cannot exceed its latest approved target'
)
from adjustment_fixture fixture;

select extensions.lives_ok(
  format(
    'update public.financial_transactions set remaining_amount = 900 where id = %L',
    fixture.withdrawal_id
  ),
  'reported withdrawal can settle up to its latest approved target'
)
from adjustment_fixture fixture;

select extensions.is(
  private.income_expense_feed_row_sort_key(jsonb_build_object(
    'id', 'cash-transfer-income:11111111-1111-4111-8111-111111111111'
  )),
  'cash-transfer-income:11111111-1111-4111-8111-111111111111',
  'feed cursor preserves the established cash-transfer sort key'
);

select extensions.is(
  private.income_expense_feed_row_sort_key(jsonb_build_object(
    'id', 'rubber-export-expense:22222222-2222-4222-8222-222222222222'
  )),
  'rubber-export-expense:22222222-2222-4222-8222-222222222222',
  'feed cursor preserves the established rubber-export sort key'
);

select extensions.is(
  (
    select routine.provolatile::text
    from pg_proc routine
    where routine.oid = 'public.get_income_expense_operational_feed(uuid,text,text,text)'::regprocedure
  ),
  'v',
  'operational feed wrapper preserves the established volatile contract'
);

select * from extensions.finish();
rollback;
