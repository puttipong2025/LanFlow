-- Allow a branch to see branch-transfer records that target that branch.
-- This powers derived incoming income rows in the income/expense module.

drop policy if exists "money_transfers_branch_target_select_scope" on public.money_transfers;

create policy "money_transfers_branch_target_select_scope"
  on public.money_transfers for select to authenticated
  using (
    transfer_type = 'branch'
    and target_location_id is not null
    and private.can_access_location(target_location_id)
  );

