-- Keep cash transfers out of the bank branch-transfer feed. Cash ledger rows
-- are rendered only after their cash-specific receipt state is known.

alter table public.money_transfers
  drop constraint money_transfers_transfer_type_check,
  add constraint money_transfers_transfer_type_check check (transfer_type in ('customer', 'transport', 'branch', 'cash'));

update public.money_transfers
set transfer_type = 'cash'
where transfer_method = 'cash' and transfer_type = 'branch';

create policy "money_transfers_cash_target_select_scope"
  on public.money_transfers for select to authenticated
  using (
    transfer_type = 'cash'
    and target_location_id is not null
    and private.can_access_location(target_location_id)
  );
