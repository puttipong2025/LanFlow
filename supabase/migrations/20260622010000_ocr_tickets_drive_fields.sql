-- Add Google Drive fields to ocr_tickets
alter table public.ocr_tickets add column if not exists drive_file_id text;
alter table public.ocr_tickets add column if not exists drive_url text;
