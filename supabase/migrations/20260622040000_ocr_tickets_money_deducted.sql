-- Add money_deducted column to ocr_tickets
alter table public.ocr_tickets add column if not exists money_deducted numeric default 0;
