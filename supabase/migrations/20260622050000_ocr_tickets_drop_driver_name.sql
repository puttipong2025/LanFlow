-- Drop driver_name column from ocr_tickets
alter table public.ocr_tickets drop column if exists driver_name;
