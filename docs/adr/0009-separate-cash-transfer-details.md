# Separate cash transfer details

Cash-specific denomination and receipt data lives in a one-to-one `money_transfer_cash_details` table linked to `money_transfers`, rather than adding those fields to every transfer. The detail table stores each sent and received Thai denomination as a separate column, keeping bank transfers free of irrelevant nullable fields while retaining straightforward SQL reporting and database validation.
