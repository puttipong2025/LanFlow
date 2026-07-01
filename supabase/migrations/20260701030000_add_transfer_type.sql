ALTER TABLE money_transfers ADD COLUMN transfer_type text NOT NULL DEFAULT 'customer' CHECK (transfer_type IN ('customer', 'transport', 'branch'));
ALTER TABLE money_transfers ADD COLUMN transport_cost numeric(12,2) DEFAULT 0;
ALTER TABLE money_transfers ADD COLUMN transport_staff_id uuid REFERENCES public.transport_staffs(id);
ALTER TABLE money_transfers ADD COLUMN transport_staff_name text;
ALTER TABLE money_transfers ADD COLUMN target_location_id uuid REFERENCES public.locations(id);
ALTER TABLE money_transfers ADD COLUMN target_location_name text;