INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
VALUES
((SELECT id FROM public.customers WHERE legacy_rec_id = 'vendor-11' LIMIT 1), 'ไทยพาณิชย์', '4081225033', 'เอกยางพารา(เสี่ยเอก)', true),
((SELECT id FROM public.customers WHERE legacy_rec_id = 'vendor-52' LIMIT 1), 'ธ.ก.ส', '020217339645', 'เอกสิทธิ์ (ออย,แม็ก) อภิณัฐดา คงคูณ', true)
ON CONFLICT DO NOTHING;