begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(13);

select extensions.has_column(
  'public',
  'rubber_bills',
  'formula_version',
  'rubber bills record their calculation formula version'
);

select extensions.col_default_is(
  'public',
  'rubber_bills',
  'formula_version',
  '1',
  'legacy-compatible formula remains the table default'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.rubber_bills'::regclass
      and conname = 'rubber_bills_formula_version_check'
      and contype = 'c'
  ),
  'formula version is constrained'
);

select extensions.has_trigger(
  'public',
  'rubber_bills',
  'assign_rubber_bill_formula_version',
  'ordinary bill writes are upgraded to formula v2'
);

create temporary table normalized_payload as
select private.normalize_rubber_bill_calculation_payload(
  jsonb_build_object(
    'operation', 'create',
    'deductWeight', 10.01,
    'items', jsonb_build_array(
      jsonb_build_object('itemType', 'weigh', 'netWeight', 50, 'unitPrice', 20),
      jsonb_build_object('itemType', 'weigh', 'netWeight', 40.13, 'unitPrice', 13.75),
      jsonb_build_object('itemType', 'stock_deduction', 'quantity', 1, 'unitPrice', 75.25),
      jsonb_build_object('itemType', 'debt', 'totalAmount', 20.10)
    )
  )
) payload;

select extensions.is(
  (select (payload->>'formulaVersion')::integer from normalized_payload),
  2,
  'normalized writes declare formula v2'
);

select extensions.is(
  (select payload->'items'->0->>'totalAmount' from normalized_payload),
  '1000',
  'first weigh line is whole baht'
);

select extensions.is(
  (select payload->'items'->1->>'totalAmount' from normalized_payload),
  '551',
  'fractional weigh line is floored before summing'
);

select extensions.is(
  (select payload->'items'->2->>'totalAmount' from normalized_payload),
  '75',
  'stock deduction line is floored before summing'
);

select extensions.is(
  (select (payload->>'rubberValue')::numeric from normalized_payload),
  1551::numeric,
  'stored weigh value is the sum of whole-baht lines'
);

select extensions.is(
  (select (payload->>'netRubberValue')::numeric from normalized_payload),
  1378::numeric,
  'stored rubber value is floored after the weight proportion'
);

select extensions.is(
  (select (payload->>'deductionTotal')::numeric from normalized_payload),
  95.10::numeric,
  'direct debt precision remains after whole-baht stock deduction'
);

select extensions.is(
  (select jsonb_build_array(
    (payload->>'payableBeforeRounding')::numeric,
    (payload->>'netTotal')::numeric
  ) from normalized_payload),
  jsonb_build_array(1282.90::numeric, 1282::numeric),
  'payable values follow the normalized whole-baht formula'
);

select extensions.throws_ok(
  $$select private.normalize_rubber_bill_calculation_payload(
    '{"operation":"create","deductWeight":0,"items":[{"itemType":"weigh","inWeight":-10,"outWeight":-20,"unitPrice":10}]}'::jsonb
  )$$,
  'P0001',
  'weigh-row weights must be non-negative',
  'v2 keeps the existing negative weigh-input boundary'
);

select * from extensions.finish();
rollback;
