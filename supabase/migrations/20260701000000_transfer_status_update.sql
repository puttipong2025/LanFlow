ALTER TABLE money_transfers DROP CONSTRAINT IF EXISTS money_transfers_transfer_status_check;
ALTER TABLE money_transfers ADD CONSTRAINT money_transfers_transfer_status_check CHECK (transfer_status IN ('pending', 'paid', 'partial', 'overpaid', 'branch_and_transfer', 'cancelled'));
UPDATE money_transfers SET transfer_status = 'paid' WHERE transfer_status = 'completed';