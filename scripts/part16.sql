INSERT INTO public.customers (legacy_rec_id, customer_type, main_name, created_by_name, created_by_phone, sync_status)
VALUES
('vendor-11', 'ผู้ค้าขาย', 'เอกยางพารา(เสี่ยเอก)', 'system-import', '0000000000', 'synced'),
('vendor-52', 'ผู้ค้าขาย', 'เอกสิทธิ์ (ออย,แม็ก) อภิณัฐดา คงคูณ', 'system-import', '0000000000', 'synced')
ON CONFLICT DO NOTHING;