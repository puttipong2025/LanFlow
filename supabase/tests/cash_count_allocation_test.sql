begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(8);

select extensions.has_function(
  'private',
  'cash_take_with_change',
  array['bigint[]', 'bigint', 'bigint'],
  'bounded cash allocator exists'
);

select extensions.is(
  (
    select jsonb_build_object('take', take_counts, 'change', change_amount)
    from private.cash_take_with_change(
      array[1,1,4,0,0,0,0,0,0]::bigint[],
      900,
      999
    )
  ),
  jsonb_build_object(
    'take', array[0,1,4,0,0,0,0,0,0]::bigint[],
    'change', 0::bigint
  ),
  'exact payment preserves the existing high-denomination preference'
);

select extensions.is(
  (
    select jsonb_build_object('take', take_counts, 'change', change_amount)
    from private.cash_take_with_change(
      array[1,0,0,0,0,0,0,0,0]::bigint[],
      100,
      999
    )
  ),
  jsonb_build_object(
    'take', array[1,0,0,0,0,0,0,0,0]::bigint[],
    'change', 900::bigint
  ),
  'minimum overpayment is selected when exact payment is impossible'
);

select extensions.is(
  (
    select take_counts
    from private.cash_take_with_change(
      array[0,0,1,2,0,0,0,0,0]::bigint[],
      100,
      999
    )
  ),
  array[0,0,1,0,0,0,0,0,0]::bigint[],
  'tie-break still prefers the highest available denomination'
);

select extensions.is(
  (
    select jsonb_build_object(
      'takeIsNull', take_counts is null,
      'changeIsNull', change_amount is null,
      'exhausted', search_exhausted
    )
    from private.cash_take_with_change(
      array[1,0,0,0,0,0,0,0,0]::bigint[],
      1001,
      999
    )
  ),
  jsonb_build_object(
    'takeIsNull', true,
    'changeIsNull', true,
    'exhausted', false
  ),
  'impossible allocation returns not-found without exhausting the search budget'
);

set local statement_timeout = '1s';

select extensions.is(
  (
    select search_exhausted
    from private.cash_take_with_change(
      array[100,100,100,100,100,0,0,0,0]::bigint[],
      10001,
      999
    )
  ),
  false,
  'pathological no-small-cash input finishes within one second'
);

select extensions.is(
  (
    select change_amount
    from private.cash_take_with_change(
      array[100,100,100,100,100,0,0,0,0]::bigint[],
      10001,
      999
    )
  ),
  9::bigint,
  'pathological input selects the minimum representable overpayment'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'private.cash_take_with_change(bigint[],bigint,bigint)',
    'EXECUTE'
  ),
  'authenticated cannot execute the private allocator directly'
);

select * from extensions.finish();
rollback;
