INSERT INTO public.customer_contacts (customer_id, phone)
VALUES
((SELECT id FROM public.customers WHERE legacy_rec_id = '1771922627284' LIMIT 1), '0949922799'),
((SELECT id FROM public.customers WHERE legacy_rec_id = '1772005308488' LIMIT 1), '0936729319'),
((SELECT id FROM public.customers WHERE legacy_rec_id = '1772005379221' LIMIT 1), '0801459535'),
((SELECT id FROM public.customers WHERE legacy_rec_id = '1772005463148' LIMIT 1), '0987873329'),
((SELECT id FROM public.customers WHERE legacy_rec_id = '1772005561218' LIMIT 1), '0803712249'),
((SELECT id FROM public.customers WHERE legacy_rec_id = '1772252716196' LIMIT 1), '06554885689'),
((SELECT id FROM public.customers WHERE legacy_rec_id = '1772254223593' LIMIT 1), '0804905477'),
((SELECT id FROM public.customers WHERE legacy_rec_id = '1772256758781' LIMIT 1), '0950938024'),
((SELECT id FROM public.customers WHERE legacy_rec_id = '1772273198494' LIMIT 1), '0804905477'),
((SELECT id FROM public.customers WHERE legacy_rec_id = '1772273311144' LIMIT 1), '0950938024')
ON CONFLICT DO NOTHING;