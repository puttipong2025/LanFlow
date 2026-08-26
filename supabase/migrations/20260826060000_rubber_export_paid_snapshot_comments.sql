-- Clarify the compatibility semantics of paid snapshots after the cost-basis change.

begin;

comment on column public.rubber_export_items.paid_amount is
  'Immutable legacy paid/carry snapshot: customer payable for ordinary bills and carried rubber value for branch receipts; retained for compatibility and reference, never a Rubber Export cost basis.';
comment on column public.rubber_exports.paid_total is
  'Sum of immutable legacy paid/carry item snapshots; retained for compatibility and reference, never a Rubber Export cost basis.';

commit;
