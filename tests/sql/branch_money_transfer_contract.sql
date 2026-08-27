\set ON_ERROR_STOP on
begin;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);

create temporary table branch_transfer_payloads (name text primary key, payload jsonb) on commit drop;
create temporary table branch_transfer_baseline (net_cash_flow numeric not null) on commit drop;

insert into branch_transfer_baseline
select (private.calculate_dashboard_summary(
  '00000000-0000-4000-8000-000000000102'
)->>'netCashFlow')::numeric;

insert into branch_transfer_payloads values (
  'first',
  jsonb_build_object(
    'id', '41000000-0000-4000-8000-000000000001',
    'clientTempId', 'branch-contract-first',
    'idempotencyKey', 'branch-contract-first-20260827',
    'locationId', '00000000-0000-4000-8000-000000000102',
    'targetLocationId', '00000000-0000-4000-8000-000000000102',
    'operation', 'create',
    'transferType', 'branch',
    'transferStatus', 'pending',
    'netAmountToPay', 999999,
    'revisionNo', 0,
    'items', '[]'::jsonb,
    'slips', jsonb_build_array(
      jsonb_build_object(
        'id', '42000000-0000-4000-8000-000000000001',
        'inputMethod', 'manual',
        'amount', 1000,
        'fee', 10,
        'transactionDate', '2026-08-27T02:30:00Z',
        'sortOrder', 0
      ),
      jsonb_build_object(
        'id', '42000000-0000-4000-8000-000000000002',
        'inputMethod', 'ocr',
        'referenceNumber', ' OCR-ABC 123 ',
        'amount', 500,
        'fee', 20,
        'transactionDate', '2026-08-27T03:30:00Z',
        'sortOrder', 1
      )
    )
  )
);

select public.save_money_transfer(payload)
from branch_transfer_payloads
where name = 'first';

do $created_contract$
declare
  v_transfer public.money_transfers;
begin
  select * into v_transfer
  from public.money_transfers
  where id = '41000000-0000-4000-8000-000000000001';

  if v_transfer.location_id <> '00000000-0000-4000-8000-000000000102'
    or v_transfer.target_location_id <> v_transfer.location_id then
    raise exception 'branch ownership is not same-target';
  end if;
  if v_transfer.transfer_status <> 'paid'
    or v_transfer.net_amount_to_pay <> 1500
    or v_transfer.branch_paid_amount <> 0 then
    raise exception 'server totals/status are not authoritative';
  end if;
  if v_transfer.accounting_date <> date '2026-08-27' then
    raise exception 'accounting_date is not the Bangkok slip date';
  end if;
  if exists (select 1 from public.money_transfer_items where transfer_id = v_transfer.id) then
    raise exception 'same-target branch transfer has source items';
  end if;
  if not exists (
    select 1
    from public.money_transfer_slips
    where transfer_id = v_transfer.id
      and input_method = 'manual'
      and reference_number is null
      and ocr_fingerprint is null
  ) then
    raise exception 'manual slip provenance is invalid';
  end if;
  if not exists (
    select 1
    from public.money_transfer_slips
    where transfer_id = v_transfer.id
      and input_method = 'ocr'
      and reference_number = ' OCR-ABC 123 '
      and ocr_fingerprint is not null
  ) then
    raise exception 'OCR slip provenance is invalid';
  end if;
end
$created_contract$;

do $downstream_projections$
declare
  v_row jsonb;
  v_feed jsonb;
  v_history jsonb;
  v_with_transfer numeric;
  v_without_transfer numeric := (select net_cash_flow from branch_transfer_baseline);
begin
  v_row := private.income_expense_operational_row(
    '00000000-0000-4000-8000-000000000102',
    'branch_income',
    '41000000-0000-4000-8000-000000000001',
    null
  );
  if v_row->>'txDate' <> '2026-08-27'
    or v_row->>'title' <> 'โอนให้สาขา'
    or (v_row->>'cost')::numeric <> 1500
    or v_row->>'relationLabel' <> 'โอนให้สาขา'
  then
    raise exception 'income/expense branch projection is invalid: %', v_row;
  end if;

  v_feed := public.get_income_expense_operational_feed_on_demand(
    '00000000-0000-4000-8000-000000000102',
    'latest',
    'โอนให้สาขา',
    null
  );
  if not exists (
    select 1
    from jsonb_array_elements(v_feed->'rows') item
    where item->>'id' = 'money-transfer-income:41000000-0000-4000-8000-000000000001'
      and item->>'txDate' = '2026-08-27'
      and (item->>'cost')::numeric = 1500
  ) then
    raise exception 'on-demand income/expense feed omitted same-target branch income';
  end if;

  if not exists (
    select 1 from private.reportable_items(
      '00000000-0000-4000-8000-000000000102', clock_timestamp()
    )
    where entity_type = 'bank_transfer_target'
      and entity_id = '41000000-0000-4000-8000-000000000001'
  ) or exists (
    select 1 from private.reportable_items(
      '00000000-0000-4000-8000-000000000102', clock_timestamp()
    )
    where entity_type = 'bank_transfer_source'
      and entity_id = '41000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'report candidates do not contain exactly one target income';
  end if;

  v_history := private.dashboard_money_source_entries(
    'money_transfer', '41000000-0000-4000-8000-000000000001'
  );
  if jsonb_array_length(v_history) <> 1
    or v_history->0->>'eventKey' <> 'branch-transfer-in:41000000-0000-4000-8000-000000000001'
    or v_history->0->>'eventDate' <> '2026-08-27'
    or (v_history->0->>'amount')::numeric <> 1500
  then
    raise exception 'dashboard history projection is invalid: %', v_history;
  end if;

  select (private.calculate_dashboard_summary(
    '00000000-0000-4000-8000-000000000102'
  )->>'netCashFlow')::numeric into v_with_transfer;

  if v_with_transfer - v_without_transfer <> 1500 then
    raise exception 'dashboard net cash flow did not count exactly the slip total';
  end if;
end
$downstream_projections$;

insert into public.report_batches (
  id, report_no, report_date, sequence_no, location_id, cutoff_at,
  created_by_user_id, created_by_name, created_by_phone
) values (
  '43000000-0000-4000-8000-000000000001',
  'RPT-BRANCH-CONTRACT', date '2026-08-27', 999,
  '00000000-0000-4000-8000-000000000102', clock_timestamp(),
  '00000000-0000-4000-8000-000000000001', 'contract', 'contract'
);

insert into public.report_items (
  id, report_id, location_id, entity_type, entity_id, eligibility_at
) values (
  '44000000-0000-4000-8000-000000000001',
  '43000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000102',
  'bank_transfer_target',
  '41000000-0000-4000-8000-000000000001',
  clock_timestamp()
);

do $report_presentation$
declare
  v_count integer;
begin
  select count(*) into v_count
  from private.report_income_expense_period_rows(
    '43000000-0000-4000-8000-000000000001'
  )
  where tx_date = date '2026-08-27'
    and entry_type = 'income'
    and title = 'โอนให้สาขา'
    and amount = 1500;

  if v_count <> 1 then
    raise exception 'report presentation did not contain one accounting-date income row';
  end if;
end
$report_presentation$;

delete from public.report_items
where report_id = '43000000-0000-4000-8000-000000000001';

delete from public.report_batches
where id = '43000000-0000-4000-8000-000000000001';

-- Exact create replay is allowed and does not rewrite the parent.
select public.save_money_transfer(payload)
from branch_transfer_payloads
where name = 'first';

do $idempotency_mismatch$
begin
  begin
    perform public.save_money_transfer(
      (select payload || jsonb_build_object('netAmountToPay', 1)
       from branch_transfer_payloads where name = 'first')
    );
    raise exception 'expected idempotency payload mismatch';
  exception when others then
    if position('MT_IDEMPOTENCY_PAYLOAD_MISMATCH' in sqlerrm) = 0 then raise; end if;
  end;
end
$idempotency_mismatch$;

do $invalid_branch_payloads$
declare
  v_payload jsonb := (select payload from branch_transfer_payloads where name = 'first');
begin
  begin
    perform public.save_money_transfer(
      jsonb_set(
        v_payload || jsonb_build_object(
          'id', '41000000-0000-4000-8000-000000000011',
          'clientTempId', 'branch-contract-mismatch',
          'idempotencyKey', 'branch-contract-mismatch-20260827',
          'slips', '[]'::jsonb
        ),
        '{targetLocationId}',
        '"00000000-0000-4000-8000-000000000103"'::jsonb
      )
    );
    raise exception 'expected target mismatch';
  exception when others then
    if position('MT_BRANCH_TARGET_MISMATCH' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    perform public.save_money_transfer(
      v_payload || jsonb_build_object(
        'id', '41000000-0000-4000-8000-000000000012',
        'clientTempId', 'branch-contract-empty',
        'idempotencyKey', 'branch-contract-empty-20260827',
        'slips', '[]'::jsonb
      )
    );
    raise exception 'expected slip requirement';
  exception when others then
    if position('MT_SLIP_REQUIRED' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    perform public.save_money_transfer(
      v_payload || jsonb_build_object(
        'id', '41000000-0000-4000-8000-000000000013',
        'clientTempId', 'branch-contract-date',
        'idempotencyKey', 'branch-contract-date-20260827',
        'slips', jsonb_build_array(
          jsonb_build_object(
            'id', '42000000-0000-4000-8000-000000000013',
            'inputMethod', 'manual', 'amount', 1, 'fee', 0,
            'transactionDate', '2026-08-27T16:59:00Z'
          ),
          jsonb_build_object(
            'id', '42000000-0000-4000-8000-000000000014',
            'inputMethod', 'manual', 'amount', 1, 'fee', 0,
            'transactionDate', '2026-08-27T17:01:00Z'
          )
        )
      )
    );
    raise exception 'expected Bangkok date mismatch';
  exception when others then
    if position('MT_SLIP_DATE_MISMATCH' in sqlerrm) = 0 then raise; end if;
  end;
end
$invalid_branch_payloads$;

do $duplicate_ocr$
declare
  v_payload jsonb;
begin
  v_payload := jsonb_build_object(
    'id', '41000000-0000-4000-8000-000000000002',
    'clientTempId', 'branch-contract-second',
    'idempotencyKey', 'branch-contract-second-20260827',
    'locationId', '00000000-0000-4000-8000-000000000102',
    'targetLocationId', '00000000-0000-4000-8000-000000000102',
    'operation', 'create', 'transferType', 'branch', 'revisionNo', 0,
    'items', '[]'::jsonb,
    'slips', jsonb_build_array(jsonb_build_object(
      'id', '42000000-0000-4000-8000-000000000003',
      'inputMethod', 'ocr', 'referenceNumber', 'ocr abc-123',
      'amount', 500, 'fee', 0,
      'transactionDate', '2026-08-27T03:30:00Z', 'sortOrder', 0
    ))
  );
  insert into branch_transfer_payloads values ('second', v_payload);

  begin
    perform public.save_money_transfer(v_payload);
    raise exception 'expected active-parent OCR duplicate';
  exception when others then
    if position('MT_OCR_DUPLICATE' in sqlerrm) = 0 then raise; end if;
  end;
end
$duplicate_ocr$;

-- Deleted parents release their OCR fingerprint for a new active transfer.
select public.delete_money_transfer(
  '41000000-0000-4000-8000-000000000001',
  0
);
select public.save_money_transfer(payload)
from branch_transfer_payloads
where name = 'second';

-- Updating increments revision; a stale delete is rejected and a fresh delete succeeds.
select public.save_money_transfer(
  payload || jsonb_build_object('operation', 'update', 'revisionNo', 0)
)
from branch_transfer_payloads
where name = 'second';

do $stale_delete$
begin
  begin
    perform public.delete_money_transfer(
      '41000000-0000-4000-8000-000000000002',
      0
    );
    raise exception 'expected stale delete conflict';
  exception when others then
    if position('MT_REVISION_CONFLICT' in sqlerrm) = 0 then raise; end if;
  end;
end
$stale_delete$;

select public.delete_money_transfer(
  '41000000-0000-4000-8000-000000000002',
  1
);

-- Authenticated browser clients cannot bypass the RPC contract with direct DML.
set local role authenticated;
do $direct_write_denied$
begin
  begin
    insert into public.money_transfers (
      id, location_id, transfer_type, transfer_status, created_by_name, created_by_phone
    ) values (
      '41000000-0000-4000-8000-000000000099',
      '00000000-0000-4000-8000-000000000102',
      'branch', 'paid', 'direct', 'direct'
    );
    raise exception 'expected direct DML denial';
  exception when insufficient_privilege then
    null;
  end;
end
$direct_write_denied$;
reset role;

-- True legacy inter-branch rows remain readable but cannot be rewritten through the RPC.
insert into public.money_transfers (
  id, client_temp_id, idempotency_key, location_id, target_location_id,
  transfer_type, transfer_status, created_by_name, created_by_phone
) values (
  '41000000-0000-4000-8000-000000000090',
  'branch-contract-legacy', 'branch-contract-legacy-20260827',
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000103',
  'branch', 'paid', 'legacy', 'legacy'
);

do $legacy_read_only$
begin
  begin
    perform public.save_money_transfer(jsonb_build_object(
      'id', '41000000-0000-4000-8000-000000000090',
      'idempotencyKey', 'branch-contract-legacy-20260827',
      'locationId', '00000000-0000-4000-8000-000000000102',
      'targetLocationId', '00000000-0000-4000-8000-000000000103',
      'operation', 'update', 'transferType', 'branch', 'revisionNo', 0,
      'items', '[]'::jsonb, 'slips', '[]'::jsonb
    ));
    raise exception 'expected legacy branch read-only guard';
  exception when others then
    if position('MT_LEGACY_BRANCH_READ_ONLY' in sqlerrm) = 0 then raise; end if;
  end;
end
$legacy_read_only$;

do $legacy_delete_read_only$
begin
  begin
    perform public.delete_money_transfer(
      '41000000-0000-4000-8000-000000000090',
      0
    );
    raise exception 'expected legacy branch delete read-only guard';
  exception when others then
    if position('MT_LEGACY_BRANCH_READ_ONLY' in sqlerrm) = 0 then raise; end if;
  end;
end
$legacy_delete_read_only$;

rollback;
select 'branch-money-transfer-contract-ok' as result;
