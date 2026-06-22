-- Add customer_name column to ocr_tickets
alter table public.ocr_tickets add column if not exists customer_name text;
