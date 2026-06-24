-- Migration: Import legacy rubber bills from ป่ากุงใหญ่
-- 13 bills + 13 sub-items

BEGIN;

DO $$
DECLARE
  loc_id uuid := '00000000-0000-4000-8000-000000000103'; -- ป่ากุงใหญ่
  user_id uuid := '00000000-0000-4000-8000-000000000001'; -- ผู้ดูแลระบบ
  bill_id uuid;
BEGIN

  -- Ensure prerequisite records exist (seed.sql runs after migrations)
  INSERT INTO public.profiles (id, phone, name, role)
  VALUES (user_id, '0800000000', 'ผู้ดูแลระบบ', 'super_admin')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.locations (id, name, code, is_active, created_by)
  VALUES (loc_id, 'ป่ากุงใหญ่', 'PKY', true, user_id)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_locations (user_id, location_id, assigned_by)
  VALUES (user_id, loc_id, user_id)
  ON CONFLICT DO NOTHING;

  -- Bill 1: 260620-020 ติ้ก
  INSERT INTO public.rubber_bills (
    local_bill_no, bill_no, bill_date, location_id, customer_name, customer_type,
    bill_type, deduct_weight, weight, rubber_value, average_price,
    deduction_total, net_total, cash_payment, transfer_payment, acid_pack_count,
    print_status, sync_status, record_status, revision_no,
    created_by_user_id, created_by_name, created_by_phone, created_at
  ) VALUES (
    'L-260620-020', '260620-020', '2026-06-20', loc_id, 'ติ้ก', 'สาขานี้จ่าย',
    'บิลเครื่องชั่งเล็ก', 0, 122, 4941, 40.5,
    0, 4941, 4941, 0, 0,
    'ปริ้นแล้ว', 'synced', 'active', 0,
    user_id, 'ระบบนำเข้า', '0000000000', '2026-06-20 17:57:07+07'
  ) RETURNING id INTO bill_id;
  INSERT INTO public.rubber_bill_items (bill_id, item_type, description, weight_in, weight_out, net_weight, price, total)
  VALUES (bill_id, 'รายการยาง', 'ชั่ง1', 122, 0, 122, 40.5, 4941);

  -- Bill 2: 260621-001 ใหญ่ห มาน
  INSERT INTO public.rubber_bills (
    local_bill_no, bill_no, bill_date, location_id, customer_name, customer_type,
    bill_type, deduct_weight, weight, rubber_value, average_price,
    deduction_total, net_total, cash_payment, transfer_payment, acid_pack_count,
    print_status, sync_status, record_status, revision_no,
    created_by_user_id, created_by_name, created_by_phone, created_at
  ) VALUES (
    'L-260621-001', '260621-001', '2026-06-21', loc_id, 'ใหญ่ห มาน', 'สาขานี้จ่าย',
    'บิลเครื่องชั่งเล็ก', 0, 83, 3320, 40,
    0, 3320, 3320, 0, 0,
    'ปริ้นแล้ว', 'synced', 'active', 0,
    user_id, 'ระบบนำเข้า', '0000000000', '2026-06-21 07:23:59+07'
  ) RETURNING id INTO bill_id;
  INSERT INTO public.rubber_bill_items (bill_id, item_type, description, weight_in, weight_out, net_weight, price, total)
  VALUES (bill_id, 'รายการยาง', 'ชั่ง1', 83, 0, 83, 40, 3320);

  -- Bill 3: 260621-002 น้าจา
  INSERT INTO public.rubber_bills (
    local_bill_no, bill_no, bill_date, location_id, customer_name, customer_type,
    bill_type, deduct_weight, weight, rubber_value, average_price,
    deduction_total, net_total, cash_payment, transfer_payment, acid_pack_count,
    print_status, sync_status, record_status, revision_no,
    created_by_user_id, created_by_name, created_by_phone, created_at
  ) VALUES (
    'L-260621-002', '260621-002', '2026-06-21', loc_id, 'น้าจา', 'สาขานี้จ่าย',
    'บิลเครื่องชั่งเล็ก', 0, 171, 6925, 40.5,
    0, 6925, 6925, 0, 0,
    'ปริ้นแล้ว', 'synced', 'active', 0,
    user_id, 'ระบบนำเข้า', '0000000000', '2026-06-21 10:37:17+07'
  ) RETURNING id INTO bill_id;
  INSERT INTO public.rubber_bill_items (bill_id, item_type, description, weight_in, weight_out, net_weight, price, total)
  VALUES (bill_id, 'รายการยาง', 'ชั่ง1', 171, 0, 171, 40.5, 6925);

  -- Bill 4: 260621-003 เล่
  INSERT INTO public.rubber_bills (
    local_bill_no, bill_no, bill_date, location_id, customer_name, customer_type,
    bill_type, deduct_weight, weight, rubber_value, average_price,
    deduction_total, net_total, cash_payment, transfer_payment, acid_pack_count,
    print_status, sync_status, record_status, revision_no,
    created_by_user_id, created_by_name, created_by_phone, created_at
  ) VALUES (
    'L-260621-003', '260621-003', '2026-06-21', loc_id, 'เล่', 'สาขานี้จ่าย',
    'บิลเครื่องชั่งเล็ก', 0, 154, 6468, 42,
    0, 6468, 6468, 0, 0,
    'ปริ้นแล้ว', 'synced', 'active', 0,
    user_id, 'ระบบนำเข้า', '0000000000', '2026-06-21 10:37:54+07'
  ) RETURNING id INTO bill_id;
  INSERT INTO public.rubber_bill_items (bill_id, item_type, description, weight_in, weight_out, net_weight, price, total)
  VALUES (bill_id, 'รายการยาง', 'ชั่ง1', 154, 0, 154, 42, 6468);

  -- Bill 5: 260621-004 คำเตย
  INSERT INTO public.rubber_bills (
    local_bill_no, bill_no, bill_date, location_id, customer_name, customer_type,
    bill_type, deduct_weight, weight, rubber_value, average_price,
    deduction_total, net_total, cash_payment, transfer_payment, acid_pack_count,
    print_status, sync_status, record_status, revision_no,
    created_by_user_id, created_by_name, created_by_phone, created_at
  ) VALUES (
    'L-260621-004', '260621-004', '2026-06-21', loc_id, 'คำเตย', 'สาขานี้จ่าย',
    'บิลเครื่องชั่งเล็ก', 0, 285, 11970, 42,
    0, 11970, 11970, 0, 0,
    'ปริ้นแล้ว', 'synced', 'active', 0,
    user_id, 'ระบบนำเข้า', '0000000000', '2026-06-21 13:21:25+07'
  ) RETURNING id INTO bill_id;
  INSERT INTO public.rubber_bill_items (bill_id, item_type, description, weight_in, weight_out, net_weight, price, total)
  VALUES (bill_id, 'รายการยาง', 'ชั่ง1', 285, 0, 285, 42, 11970);

  -- Bill 6: 260622-001 น้าหลย
  INSERT INTO public.rubber_bills (
    local_bill_no, bill_no, bill_date, location_id, customer_name, customer_type,
    bill_type, deduct_weight, weight, rubber_value, average_price,
    deduction_total, net_total, cash_payment, transfer_payment, acid_pack_count,
    print_status, sync_status, record_status, revision_no,
    created_by_user_id, created_by_name, created_by_phone, created_at
  ) VALUES (
    'L-260622-001', '260622-001', '2026-06-22', loc_id, 'น้าหลย', 'สาขานี้จ่าย',
    'บิลเครื่องชั่งเล็ก', 0, 463, 18983, 41,
    0, 18983, 18983, 0, 0,
    'ปริ้นแล้ว', 'synced', 'active', 0,
    user_id, 'ระบบนำเข้า', '0000000000', '2026-06-22 08:38:40+07'
  ) RETURNING id INTO bill_id;
  INSERT INTO public.rubber_bill_items (bill_id, item_type, description, weight_in, weight_out, net_weight, price, total)
  VALUES (bill_id, 'รายการยาง', 'ชั่ง1', 463, 0, 463, 41, 18983);

  -- Bill 7: 260622-002 น้าโล่
  INSERT INTO public.rubber_bills (
    local_bill_no, bill_no, bill_date, location_id, customer_name, customer_type,
    bill_type, deduct_weight, weight, rubber_value, average_price,
    deduction_total, net_total, cash_payment, transfer_payment, acid_pack_count,
    print_status, sync_status, record_status, revision_no,
    created_by_user_id, created_by_name, created_by_phone, created_at
  ) VALUES (
    'L-260622-002', '260622-002', '2026-06-22', loc_id, 'น้าโล่', 'สาขานี้จ่าย',
    'บิลเครื่องชั่งเล็ก', 0, 83, 3486, 42,
    0, 3486, 3486, 0, 0,
    'ปริ้นแล้ว', 'synced', 'active', 0,
    user_id, 'ระบบนำเข้า', '0000000000', '2026-06-22 10:52:45+07'
  ) RETURNING id INTO bill_id;
  INSERT INTO public.rubber_bill_items (bill_id, item_type, description, weight_in, weight_out, net_weight, price, total)
  VALUES (bill_id, 'รายการยาง', 'ชั่ง1', 83, 0, 83, 42, 3486);

  -- Bill 8: 260622-003 แป้ม
  INSERT INTO public.rubber_bills (
    local_bill_no, bill_no, bill_date, location_id, customer_name, customer_type,
    bill_type, deduct_weight, weight, rubber_value, average_price,
    deduction_total, net_total, cash_payment, transfer_payment, acid_pack_count,
    print_status, sync_status, record_status, revision_no,
    created_by_user_id, created_by_name, created_by_phone, created_at
  ) VALUES (
    'L-260622-003', '260622-003', '2026-06-22', loc_id, 'แป้ม', 'สาขานี้จ่าย',
    'บิลเครื่องชั่งเล็ก', 0, 170, 6715, 39.5,
    0, 6715, 6715, 0, 0,
    'ปริ้นแล้ว', 'synced', 'active', 0,
    user_id, 'ระบบนำเข้า', '0000000000', '2026-06-22 12:17:02+07'
  ) RETURNING id INTO bill_id;
  INSERT INTO public.rubber_bill_items (bill_id, item_type, description, weight_in, weight_out, net_weight, price, total)
  VALUES (bill_id, 'รายการยาง', 'ชั่ง1', 170, 0, 170, 39.5, 6715);

  -- Bill 9: 260622-004 ฟ้าหว่น
  INSERT INTO public.rubber_bills (
    local_bill_no, bill_no, bill_date, location_id, customer_name, customer_type,
    bill_type, deduct_weight, weight, rubber_value, average_price,
    deduction_total, net_total, cash_payment, transfer_payment, acid_pack_count,
    print_status, sync_status, record_status, revision_no,
    created_by_user_id, created_by_name, created_by_phone, created_at
  ) VALUES (
    'L-260622-004', '260622-004', '2026-06-22', loc_id, 'ฟ้าหว่น', 'สาขานี้จ่าย',
    'บิลเครื่องชั่งเล็ก', 0, 82, 3444, 42,
    0, 3444, 3444, 0, 0,
    'ปริ้นแล้ว', 'synced', 'active', 0,
    user_id, 'ระบบนำเข้า', '0000000000', '2026-06-22 12:18:03+07'
  ) RETURNING id INTO bill_id;
  INSERT INTO public.rubber_bill_items (bill_id, item_type, description, weight_in, weight_out, net_weight, price, total)
  VALUES (bill_id, 'รายการยาง', 'ชั่ง1', 82, 0, 82, 42, 3444);

  -- Bill 10: 260622-005 แสง
  INSERT INTO public.rubber_bills (
    local_bill_no, bill_no, bill_date, location_id, customer_name, customer_type,
    bill_type, deduct_weight, weight, rubber_value, average_price,
    deduction_total, net_total, cash_payment, transfer_payment, acid_pack_count,
    print_status, sync_status, record_status, revision_no,
    created_by_user_id, created_by_name, created_by_phone, created_at
  ) VALUES (
    'L-260622-005', '260622-005', '2026-06-22', loc_id, 'แสง', 'สาขานี้จ่าย',
    'บิลเครื่องชั่งเล็ก', 0, 209, 8464, 40.5,
    0, 8464, 8464, 0, 0,
    'ปริ้นแล้ว', 'synced', 'active', 0,
    user_id, 'ระบบนำเข้า', '0000000000', '2026-06-22 12:39:29+07'
  ) RETURNING id INTO bill_id;
  INSERT INTO public.rubber_bill_items (bill_id, item_type, description, weight_in, weight_out, net_weight, price, total)
  VALUES (bill_id, 'รายการยาง', 'ชั่ง1', 209, 0, 209, 40.5, 8464);

  -- Bill 11: 260622-006 หนึ่ง
  INSERT INTO public.rubber_bills (
    local_bill_no, bill_no, bill_date, location_id, customer_name, customer_type,
    bill_type, deduct_weight, weight, rubber_value, average_price,
    deduction_total, net_total, cash_payment, transfer_payment, acid_pack_count,
    print_status, sync_status, record_status, revision_no,
    created_by_user_id, created_by_name, created_by_phone, created_at
  ) VALUES (
    'L-260622-006', '260622-006', '2026-06-22', loc_id, 'หนึ่ง', 'สาขานี้จ่าย',
    'บิลเครื่องชั่งเล็ก', 0, 98, 3773, 38.5,
    0, 3773, 3773, 0, 0,
    'ปริ้นแล้ว', 'synced', 'active', 0,
    user_id, 'ระบบนำเข้า', '0000000000', '2026-06-22 15:09:52+07'
  ) RETURNING id INTO bill_id;
  INSERT INTO public.rubber_bill_items (bill_id, item_type, description, weight_in, weight_out, net_weight, price, total)
  VALUES (bill_id, 'รายการยาง', 'ชั่ง1', 98, 0, 98, 38.5, 3773);

  -- Bill 12: 260622-007 เอก
  INSERT INTO public.rubber_bills (
    local_bill_no, bill_no, bill_date, location_id, customer_name, customer_type,
    bill_type, deduct_weight, weight, rubber_value, average_price,
    deduction_total, net_total, cash_payment, transfer_payment, acid_pack_count,
    print_status, sync_status, record_status, revision_no,
    created_by_user_id, created_by_name, created_by_phone, created_at
  ) VALUES (
    'L-260622-007', '260622-007', '2026-06-22', loc_id, 'เอก', 'สาขานี้จ่าย',
    'บิลเครื่องชั่งเล็ก', 0, 136.5, 5528, 40.5,
    0, 5528, 5528, 0, 0,
    'ปริ้นแล้ว', 'synced', 'active', 0,
    user_id, 'ระบบนำเข้า', '0000000000', '2026-06-22 15:11:21+07'
  ) RETURNING id INTO bill_id;
  INSERT INTO public.rubber_bill_items (bill_id, item_type, description, weight_in, weight_out, net_weight, price, total)
  VALUES (bill_id, 'รายการยาง', 'ชั่ง1', 136.5, 0, 136.5, 40.5, 5528);

  -- Bill 13: 260622-008 กาย
  INSERT INTO public.rubber_bills (
    local_bill_no, bill_no, bill_date, location_id, customer_name, customer_type,
    bill_type, deduct_weight, weight, rubber_value, average_price,
    deduction_total, net_total, cash_payment, transfer_payment, acid_pack_count,
    print_status, sync_status, record_status, revision_no,
    created_by_user_id, created_by_name, created_by_phone, created_at
  ) VALUES (
    'L-260622-008', '260622-008', '2026-06-22', loc_id, 'กาย', 'สาขานี้จ่าย',
    'บิลเครื่องชั่งเล็ก', 0, 108, 4320, 40,
    0, 4320, 4320, 0, 0,
    'ปริ้นแล้ว', 'synced', 'active', 0,
    user_id, 'ระบบนำเข้า', '0000000000', '2026-06-22 16:18:14+07'
  ) RETURNING id INTO bill_id;
  INSERT INTO public.rubber_bill_items (bill_id, item_type, description, weight_in, weight_out, net_weight, price, total)
  VALUES (bill_id, 'รายการยาง', 'ชั่ง1', 108, 0, 108, 40, 4320);

  RAISE NOTICE 'Imported 13 legacy rubber bills with sub-items for ป่ากุงใหญ่';
END $$;

COMMIT;
