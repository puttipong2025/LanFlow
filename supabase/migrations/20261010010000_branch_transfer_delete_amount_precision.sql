-- Keep deletion-request snapshots compatible with the source transfer amount.

alter table public.branch_transfer_delete_requests
  alter column amount type numeric(14,2);

notify pgrst, 'reload schema';
