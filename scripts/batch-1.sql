
DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160122', '681001', 'ชาวสวน', 'นางอรนิตย์ สุภากรณ์', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0935516320');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นางอรนิตย์ สุภากรณ์', '3340701351821');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160123', '681002', 'ชาวสวน', 'นายสิมมา ตู้ทอง', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0874552245');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นายสิมมา ตู้ทอง', '3340701362687');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160124', '681003', 'ชาวสวน', 'นางบุญเพ็ง ประสานพิมพ์', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0936889004');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นางบุญเพ็ง ประสานพิมพ์', '3340701357179');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160125', '681004', 'ชาวสวน', 'นางหนูเสียน ทองเติม', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0646766932');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นางหนูเสียน ทองเติม', '3340701356130');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160126', '681005', 'ชาวสวน', 'นางสำราญ บุญปก #01', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0923498390');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นางสำราญ บุญปก #01', '3340701361125');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160127', '681006', 'ชาวสวน', 'นางวิไลวรรณ บุญปก', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0924006664');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นางวิไลวรรณ บุญปก', '3340701361150');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160128', '681007', 'ชาวสวน', 'นางคำไข บุญเลิศ', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0917024588');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นางคำไข บุญเลิศ', '3340701361940');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160129', '681008', 'ชาวสวน', 'นายสมหวัง สำราญ', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0939964544');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นายสมหวัง สำราญ', '3340701352134');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160130', '681009', 'ชาวสวน', 'นางทองพูล สุภากรณ์', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0648264207');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นางทองพูล สุภากรณ์', '3340701351138');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160131', '681010', 'ชาวสวน', 'นางคำ วรพิมพ์รัตน์', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0949228476');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นางคำ วรพิมพ์รัตน์', '3340701359287');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160132', '681011', 'ชาวสวน', 'นางสำรอง เรืองพล', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0918123961');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นางสำรอง เรืองพล', '3340701356946');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160133', '681012', 'ชาวสวน', 'นายถวาย เขียวขำ', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0946425198');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นายถวาย เขียวขำ', '3340701361923');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160134', '681013', 'ชาวสวน', 'นายจำปี สายวัน', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0951396887');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นายจำปี สายวัน', '3340701362539');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160135', '681014', 'ชาวสวน', 'นางสาวพรฉวี สายวัน', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0905903374');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นางสาวพรฉวี สายวัน', '1340700344531');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160136', '681015', 'ชาวสวน', 'นางสุภาพ แจ่มสกุล', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0804351146');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นางสุภาพ แจ่มสกุล', '3340701362717');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160137', '681016', 'ชาวสวน', 'นางบุษบา โสภี', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0623293240');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นางบุษบา โสภี', '3340701359295');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160138', '681017', 'ชาวสวน', 'นายสุบิน คำอุด', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0955149677');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นายสุบิน คำอุด', '3341901127267');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160139', '681018', 'ชาวสวน', 'นางแฮม ประเสริฐ', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0925349137');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นางแฮม ประเสริฐ', '3340701359414');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160140', '681019', 'ชาวสวน', 'นายเสถียร ฝากดี', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0830898521');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นายเสถียร ฝากดี', '3340701355265');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160141', '681020', 'ชาวสวน', 'นางอบศรี โสภี', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0904554759');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นางอบศรี โสภี', '3340700840216');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160142', '681021', 'ชาวสวน', 'นายสมใจ เขียวขำ', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0983172945');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นายสมใจ เขียวขำ', '3340701361958');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160143', '681022', 'ชาวสวน', 'นายสมศักดิ์ ศรีจันทร์', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0865837183');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นายสมศักดิ์ ศรีจันทร์', '3340700635256');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160144', '681023', 'ชาวสวน', 'นายสมบัติ ตู้ทอง', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0917317146');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นายสมบัติ ตู้ทอง', '3340701358388');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160145', '681024', 'ชาวสวน', 'นางวิลัย บุญอาจ', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0986196758');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นางวิลัย บุญอาจ', '3340701356571');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160146', '681025', 'ชาวสวน', 'นายหนูสิน โสภี', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0623293240');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นายหนูสิน โสภี', '3340700831055');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160147', '681026', 'ชาวสวน', 'นางสาววาสนา ดาวเรือง', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0859728896');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นางสาววาสนา ดาวเรือง', '1340700026059');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160148', '681027', 'ชาวสวน', 'นางยุพิน แท่นทอง', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0986735534');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นางยุพิน แท่นทอง', '1340700017271');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160149', '681028', 'ชาวสวน', 'นางเสงี่ยม ศิริคำ', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0855388888');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นางเสงี่ยม ศิริคำ', '3340700638000');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160150', '681029', 'ชาวสวน', 'นางอิ่มอัณกร ชายศรี', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0813377935');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นางอิ่มอัณกร ชายศรี', '3340701356628');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160151', '681030', 'ชาวสวน', 'นางทองศรี บุญปก', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0804832508');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นางทองศรี บุญปก', '3340701360901');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160152', '681031', 'ชาวสวน', 'นายเสถียร พิมา', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0952467218');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นายเสถียร พิมา', '3340701361737');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160153', '681032', 'ชาวสวน', 'นางหนูเบ็ง วงศ์อาจ', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0644494972');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นางหนูเบ็ง วงศ์อาจ', '3340701352151');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160154', '681033', 'ชาวสวน', 'นางสาวนกกูล วงษ์อาจ', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0925206603');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นางสาวนกกูล วงษ์อาจ', '1340700055288');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160155', '681034', 'ชาวสวน', 'นายมนตรี ศรีหัน', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0890404250');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นายมนตรี ศรีหัน', '3340700836162');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160156', '681035', 'ชาวสวน', 'นางพุฒธา นะโส', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0938623496');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นางพุฒธา นะโส', '3340701351570');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160157', '681036', 'ชาวสวน', 'นายพอง บุญธรรม', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0926559834');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นายพอง บุญธรรม', '3340700109953');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160158', '681037', 'ชาวสวน', 'นางประมวล โสภี', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0981479771');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นางประมวล โสภี', '3340701351031');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160159', '681038', 'ชาวสวน', 'นายสมชาย แสงสว่าง', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0896964950');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นายสมชาย แสงสว่าง', '1340700161819');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160160', '681039', 'ชาวสวน', 'นางรัตนา ดวงแก้ว', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0954655586');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นางรัตนา ดวงแก้ว', '3340700840224');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160161', '681040', 'ชาวสวน', 'นายหาญ ตู้ทอง', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0898473557');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นายหาญ ตู้ทอง', '3340701359554');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160162', '681041', 'ชาวสวน', 'นางธัญชนก ตู้ทอง', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0881927342');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นางธัญชนก ตู้ทอง', '3341501357087');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160163', '681042', 'ชาวสวน', 'นางลักษดา พุ่มจันทร์', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0821836285');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นางลักษดา พุ่มจันทร์', '1340700033128');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160164', '681043', 'ชาวสวน', 'นางหนูเวียง มิ่งด่าง', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0862619167');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นางหนูเวียง มิ่งด่าง', '3340701359686');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160165', '681044', 'ชาวสวน', 'นายบุญเพ็ง ชินโชติ', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0861417317');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นายบุญเพ็ง ชินโชติ', '3340701359643');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160166', '681045', 'ชาวสวน', 'นางสำลี ชินโชติ', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0841595989');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นางสำลี ชินโชติ', '3330800099551');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160167', '681046', 'ชาวสวน', 'นายจำรัส ตันแสง', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0985918580');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นายจำรัส ตันแสง', '3340700591488');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160168', '681047', 'ชาวสวน', 'นางคำตา พันธวงศ์', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0950828527');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นางคำตา พันธวงศ์', '3340701359457');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160169', '681048', 'ชาวสวน', 'นายเกิด ชินโชติ', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0906478427');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นายเกิด ชินโชติ', '3340700336968');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160170', '681049', 'ชาวสวน', 'นางบุญมี ฉัตรสุวรรณ', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0874270145');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นางบุญมี ฉัตรสุวรรณ', '3100201176339');
  END IF;
END $$;

DO $$ DECLARE _cust_id uuid; _loc_id uuid;
BEGIN
  SELECT id INTO _loc_id FROM public.locations WHERE name = 'เดชอุดม' LIMIT 1;
  INSERT INTO public.customers (legacy_rec_id, legacy_member_id, customer_type, main_name, fsc_status, default_location_id, created_by_name, created_by_phone, sync_status)
  VALUES ('1748933160171', '681050', 'ชาวสวน', 'นางสาวบุญโฮม บุญเยิ้ม', 'yes', _loc_id, 'system-import', '0000000000', 'synced')
  ON CONFLICT DO NOTHING
  RETURNING id INTO _cust_id;
  IF _cust_id IS NOT NULL THEN
    INSERT INTO public.customer_contacts (customer_id, phone) VALUES (_cust_id, '0878422276');
    INSERT INTO public.customer_farms (customer_id, owner_name, card_number) VALUES (_cust_id, 'นางสาวบุญโฮม บุญเยิ้ม', '3340701359970');
  END IF;
END $$;