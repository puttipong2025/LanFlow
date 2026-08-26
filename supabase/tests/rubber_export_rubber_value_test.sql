begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(20);

select extensions.has_column('public', 'rubber_exports', 'rubber_value_total',
  'export header stores rubber-value snapshot');
select extensions.has_column('public', 'rubber_export_items', 'rubber_value_amount',
  'export item stores rubber-value snapshot');

select extensions.ok(
  (select attnotnull from pg_attribute
   where attrelid = 'public.rubber_exports'::regclass and attname = 'rubber_value_total'),
  'header rubber-value snapshot is not null'
);
select extensions.ok(
  (select attnotnull from pg_attribute
   where attrelid = 'public.rubber_export_items'::regclass and attname = 'rubber_value_amount'),
  'item rubber-value snapshot is not null'
);
select extensions.ok(
  (select count(*) = 2 and bool_and(convalidated) from pg_constraint
   where conname in ('rubber_exports_rubber_value_total_check',
     'rubber_export_items_rubber_value_amount_check')),
  'positive-value constraints are validated'
);

select extensions.ok(
  pg_get_functiondef('private.rubber_export_candidates(uuid,uuid[],uuid)'::regprocedure)
    like '%then b.rubber_value else b.net_total end%'
  and pg_get_functiondef('private.rubber_export_candidates(uuid,uuid[],uuid)'::regprocedure)
    like '%then b.rubber_value else b.net_rubber_value end%',
  'candidate mapping preserves paid compatibility and separates rubber value'
);
select extensions.ok(
  (select pg_get_constraintdef(oid) like '%paid_amount >=%'
   from pg_constraint
   where conrelid = 'public.rubber_export_items'::regclass
     and conname = 'rubber_export_items_paid_amount_check'),
  'item paid snapshot allows zero'
);
select extensions.ok(
  (select pg_get_constraintdef(oid) like '%paid_total >=%'
   from pg_constraint
   where conrelid = 'public.rubber_exports'::regclass
     and conname = 'rubber_exports_paid_total_check'),
  'header paid snapshot allows zero'
);
select extensions.ok(
  pg_get_functiondef('private.validate_rubber_export_selection(uuid,uuid[],uuid)'::regprocedure)
    like '%c.paid_amount < 0%'
  and pg_get_functiondef('private.validate_rubber_export_selection(uuid,uuid[],uuid)'::regprocedure)
    not like '%c.paid_amount <= 0%',
  'selection accepts zero payable and rejects negative payable'
);
select extensions.ok(
  pg_get_functiondef('public.preview_rubber_export(uuid,uuid[],uuid)'::regprocedure)
    like '%round(sum(rubber_value_amount) / sum(net_weight), 2)%',
  'preview average uses rubber value'
);
select extensions.ok(
  pg_get_functiondef('public.create_rubber_export(uuid,uuid[])'::regprocedure)
    like '%round(v_rubber_value_total / v_original_weight, 2)%'
  and pg_get_functiondef('public.replace_rubber_export_items(uuid,uuid[])'::regprocedure)
    like '%round(v_rubber_value_total / v_original_weight, 2)%'
  and not exists (
    select 1 from public.rubber_exports e
    where e.average_price is distinct from round(e.rubber_value_total / e.original_weight_total, 2)
  ),
  'new, edited, and historical export averages use rubber value'
);
select extensions.ok(
  to_regprocedure('private.rubber_bill_is_export_reportable(uuid)') is not null
  and (select prosecdef and proconfig = array['search_path=""']
       from pg_proc where oid = 'private.rubber_bill_is_export_reportable(uuid)'::regprocedure),
  'zero-payable export-reportable helper is private and search-path locked'
);
select extensions.ok(
  pg_get_functiondef('private.reportable_items(uuid,timestamptz)'::regprocedure)
    like '%private.rubber_bill_is_export_reportable(b.id)%',
  'Report Batch includes positive-value zero-payable rubber bills'
);
select extensions.ok(
  pg_get_functiondef('private.guard_pending_rubber_bill_relation()'::regprocedure)
    like '%private.rubber_bill_is_export_reportable(v_bill_id)%',
  'Report Batch relation guard allows export-reportable rubber without opening money transfer'
);
select extensions.ok(
  pg_get_functiondef('public.create_rubber_export(uuid,uuid[])'::regprocedure)
    like '%private.next_document_sequence%'
  and pg_get_functiondef('public.create_rubber_export(uuid,uuid[])'::regprocedure)
    like '%rubber_value_amount%',
  'create preserves durable numbering and snapshots rubber value'
);
select extensions.ok(
  pg_get_functiondef('public.replace_rubber_export_items(uuid,uuid[])'::regprocedure)
    like '%rubber_value_total = v_rubber_value_total%'
  and pg_get_functiondef('public.replace_rubber_export_items(uuid,uuid[])'::regprocedure)
    like '%rubberValueTotal%',
  'replace recomputes and returns rubber-value total'
);
select extensions.ok(
  pg_get_functiondef('public.get_receivable_rubber_exports(uuid)'::regprocedure)
    like '%e.rubber_value_total + e.work_total%',
  'legacy receipt candidates use rubber value plus work cost'
);
select extensions.ok(
  pg_get_functiondef('public.get_receivable_rubber_exports_page(uuid,text,boolean,timestamptz,uuid,integer)'::regprocedure)
    like '%e.rubber_value_total + e.work_total%',
  'paged receipt candidates use rubber value plus work cost'
);
select extensions.ok(
  pg_get_functiondef('public.receive_rubber_export(uuid,uuid)'::regprocedure)
    like '%v_source.rubber_value_total + v_source.work_total%'
  and pg_get_functiondef('public.receive_rubber_export(uuid,uuid)'::regprocedure)
    like '%pg_advisory_xact_lock%'
  and pg_get_functiondef('public.receive_rubber_export(uuid,uuid)'::regprocedure)
    like '%BRANCH_RECEIPT_ALREADY_EXISTS%',
  'receive uses the new cost basis while preserving lock and idempotency guard'
);
select extensions.is(
  (select count(*)::integer from pg_trigger
   where tgrelid = 'public.rubber_exports'::regclass
     and tgname in ('guard_rubber_export_state', 'report_lock_rubber_exports')
     and tgenabled = 'O'),
  2,
  'backfill restores exactly the two guarded triggers'
);

select * from extensions.finish();
rollback;
