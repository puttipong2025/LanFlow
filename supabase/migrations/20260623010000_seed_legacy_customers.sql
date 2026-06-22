-- Migration: Import legacy customers and transport vehicles
-- Auto-generated at 2026-06-22T18:52:11.708Z
-- Total: 185 customers + 28 transport vehicles

BEGIN;

-- ═══════════════════════════════════════════════════════════
-- PART 1: INSERT CUSTOMERS (เรียง ก-ฮ, legacy_member_id ต่อจาก 690522)
-- ═══════════════════════════════════════════════════════════

-- 690523: กรรณิการ์ ทองคำตอน(น้องบิว) ลูกเจ๊พร
DO $$
DECLARE
  cust_690523_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '163', '690523', 'สาขานี้จ่าย', 'กรรณิการ์ ทองคำตอน(น้องบิว) ลูกเจ๊พร',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690523_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690523_id, 'ไทยพาณิชย์', '4191769422', 'กรรณิการ์ ทองคำตอน(น้องบิว) ลูกเจ๊พร', true);

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690523_id, 'ออมสิน', '020454285519', 'ชัชชน ยางศรี', false);

END $$;

-- 690524: กฤษฎากรณ์  ทาดำ (โบ้ตะบ่าย)
DO $$
DECLARE
  cust_690524_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '1754291773163', '690524', 'สาขานี้จ่าย', 'กฤษฎากรณ์  ทาดำ (โบ้ตะบ่าย)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690524_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690524_id, 'กสิกรไทย', '0671246039', 'กฤษฎากรณ์  ทาดำ (โบ้ตะบ่าย)', true);

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690524_id, 'กสิกรไทย', '2253161925', 'กฤษฎากรณ์ ทาดำ', false);

END $$;

-- 690525: กฤษณะ ทองสาตร์(เสี่ยต้า)
DO $$
DECLARE
  cust_690525_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '141', '690525', 'สาขานี้จ่าย', 'กฤษณะ ทองสาตร์(เสี่ยต้า)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690525_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690525_id, 'กรุงศรีอยุธยา', '7091208980', 'กฤษณะ ทองสาตร์(เสี่ยต้า)', true);

END $$;

-- 690526: กวินนา หนูนาค(เจ๊กิม)
DO $$
DECLARE
  cust_690526_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '129', '690526', 'สาขานี้จ่าย', 'กวินนา หนูนาค(เจ๊กิม)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690526_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690526_id, 'กสิกรไทย', '3662447624', 'กวินนา หนูนาค(เจ๊กิม)', true);

END $$;

-- 690527: กัญญาภัค ไชยคำ(น้ำขิง)
DO $$
DECLARE
  cust_690527_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '140', '690527', 'สาขานี้จ่าย', 'กัญญาภัค ไชยคำ(น้ำขิง)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690527_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690527_id, 'กรุงไทย', '6627353911', 'กัญญาภัค ไชยคำ(น้ำขิง)', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690527_id, '0638078055');

END $$;

-- 690528: กัญญารัตน์ บุตรมาต (ร้านทวีสุวรรณ) ชานุมาน
DO $$
DECLARE
  cust_690528_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '182', '690528', 'สาขานี้จ่าย', 'กัญญารัตน์ บุตรมาต (ร้านทวีสุวรรณ) ชานุมาน',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690528_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690528_id, 'ไทยพาณิชย์', '4091953139', 'กัญญารัตน์ บุตรมาต (ร้านทวีสุวรรณ) ชานุมาน', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690528_id, '0991700261');

END $$;

-- 690529: กาญจณาพร ดีดวงพันธ์ (เสี่ยเบียร์)
DO $$
DECLARE
  cust_690529_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '119', '690529', 'สาขานี้จ่าย', 'กาญจณาพร ดีดวงพันธ์ (เสี่ยเบียร์)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690529_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690529_id, 'กสิกรไทย', '498990355', 'กาญจณาพร ดีดวงพันธ์ (เสี่ยเบียร์)', true);

END $$;

-- 690530: ขนิษฐา นวนขันธ์ (เสี่ยกุ้ง)
DO $$
DECLARE
  cust_690530_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '28', '690530', 'สาขานี้จ่าย', 'ขนิษฐา นวนขันธ์ (เสี่ยกุ้ง)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690530_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690530_id, 'กสิกรไทย', '0471903744', 'ขนิษฐา นวนขันธ์ (เสี่ยกุ้ง)', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690530_id, '928811042');

END $$;

-- 690531: ขุมคำ ยางพารา
DO $$
DECLARE
  cust_690531_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '180', '690531', 'สาขานี้จ่าย', 'ขุมคำ ยางพารา',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690531_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690531_id, 'กสิกรไทย', '1992242864', 'ขุมคำ ยางพารา', true);

END $$;

-- 690532: ไข่เพชร ชบาศรี (แม่ไข่)
DO $$
DECLARE
  cust_690532_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '15', '690532', 'สาขานี้จ่าย', 'ไข่เพชร ชบาศรี (แม่ไข่)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690532_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690532_id, 'ออมสิน', '020362871269', 'ไข่เพชร ชบาศรี (แม่ไข่)', true);

END $$;

-- 690533: คนึงนิจ เค้าไธสง(เจ๊ปุ้ย) ชานุมาน
DO $$
DECLARE
  cust_690533_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '1754291773175', '690533', 'สาขานี้จ่าย', 'คนึงนิจ เค้าไธสง(เจ๊ปุ้ย) ชานุมาน',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690533_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690533_id, 'กรุงไทย', '6643541875', 'คนึงนิจ เค้าไธสง(เจ๊ปุ้ย) ชานุมาน', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690533_id, '0835454635');

END $$;

-- 690534: คำพันศักดิ์ บุตตะวัง(คำพัน)
DO $$
DECLARE
  cust_690534_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '49', '690534', 'สาขานี้จ่าย', 'คำพันศักดิ์ บุตตะวัง(คำพัน)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690534_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690534_id, 'ออมสิน', '20371835560', 'คำพันศักดิ์ บุตตะวัง(คำพัน)', true);

END $$;

-- 690535: จักรพรรณ ทองเทพ(โน๊ต)
DO $$
DECLARE
  cust_690535_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '83', '690535', 'สาขานี้จ่าย', 'จักรพรรณ ทองเทพ(โน๊ต)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690535_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690535_id, 'ออมสิน', '20244292296', 'จักรพรรณ ทองเทพ(โน๊ต)', true);

END $$;

-- 690536: จารุพงษ์ มณีกันท์ (สมหวัง)
DO $$
DECLARE
  cust_690536_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '90', '690536', 'สาขานี้จ่าย', 'จารุพงษ์ มณีกันท์ (สมหวัง)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690536_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690536_id, 'กสิกรไทย', '693109272', 'จารุพงษ์ มณีกันท์ (สมหวัง)', true);

END $$;

-- 690537: จำปี จันทร์ไชยแก้ว  (เสี่ยนพ)
DO $$
DECLARE
  cust_690537_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '60', '690537', 'สาขานี้จ่าย', 'จำปี จันทร์ไชยแก้ว  (เสี่ยนพ)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690537_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690537_id, 'กสิกรไทย', '0372534400', 'จำปี จันทร์ไชยแก้ว  (เสี่ยนพ)', true);

END $$;

-- 690538: จิรตรี หนูนาค(เจ๊ตรี)
DO $$
DECLARE
  cust_690538_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '150', '690538', 'สาขานี้จ่าย', 'จิรตรี หนูนาค(เจ๊ตรี)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690538_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690538_id, 'กรุงไทย', '3380512206', 'จิรตรี หนูนาค(เจ๊ตรี)', true);

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690538_id, 'ไทยพาณิชย์', '4092175302', 'จิรัญตรี', false);

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690538_id, 'กรุงไทย', '3380512206', 'จิรตรี หนูนาค(เจ๊ตรี)', false);

END $$;

-- 690539: จิราภรณ์ จำปานนท์(เจ๊บุ๋ม)  ชานุมาน
DO $$
DECLARE
  cust_690539_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '1754291773172', '690539', 'สาขานี้จ่าย', 'จิราภรณ์ จำปานนท์(เจ๊บุ๋ม)  ชานุมาน',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690539_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690539_id, 'กรุงเทพ', '3624377242', 'จิราภรณ์ จำปานนท์(เจ๊บุ๋ม)  ชานุมาน', true);

END $$;

-- 690540: จุฑามาศ ผลจันทร์ (มีมาศ)
DO $$
DECLARE
  cust_690540_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '136', '690540', 'สาขานี้จ่าย', 'จุฑามาศ ผลจันทร์ (มีมาศ)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690540_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690540_id, 'กสิกรไทย', '0531900057', 'จุฑามาศ ผลจันทร์ (มีมาศ)', true);

END $$;

-- 690541: จุฑาลักษณ์ หนันตะ (เสี่ยบอย)
DO $$
DECLARE
  cust_690541_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '34', '690541', 'สาขานี้จ่าย', 'จุฑาลักษณ์ หนันตะ (เสี่ยบอย)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690541_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690541_id, 'กสิกรไทย', '348097970', 'จุฑาลักษณ์ หนันตะ (เสี่ยบอย)', true);

END $$;

-- 690542: เจตพล ทองไทย(จ่าเดียร์) ดงแถบ
DO $$
DECLARE
  cust_690542_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '175', '690542', 'สาขานี้จ่าย', 'เจตพล ทองไทย(จ่าเดียร์) ดงแถบ',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690542_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690542_id, 'กสิกรไทย', '1603985768', 'เจตพล ทองไทย(จ่าเดียร์) ดงแถบ', true);

END $$;

-- 690543: เจ๊ถวิล
DO $$
DECLARE
  cust_690543_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '7', '690543', 'สาขานี้จ่าย', 'เจ๊ถวิล',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690543_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690543_id, 'กสิกรไทย', '2702438708', 'เจ๊ถวิล', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690543_id, '815442683');

END $$;

-- 690544: เจ๊วิว(จารุภา สมตัว)
DO $$
DECLARE
  cust_690544_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '123', '690544', 'สาขานี้จ่าย', 'เจ๊วิว(จารุภา สมตัว)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690544_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690544_id, 'กรุงไทย', '3386004695', 'เจ๊วิว(จารุภา สมตัว)', true);

END $$;

-- 690545: เฉลิมวุฒิ ศรีบัวเทพ(เสี่ยดุ๊ก)
DO $$
DECLARE
  cust_690545_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '9', '690545', 'สาขานี้จ่าย', 'เฉลิมวุฒิ ศรีบัวเทพ(เสี่ยดุ๊ก)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690545_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690545_id, 'กสิกรไทย', '0113758562', 'เฉลิมวุฒิ ศรีบัวเทพ(เสี่ยดุ๊ก)', true);

END $$;

-- 690546: ชนกนันท์ พรมเวียง(เมียคำพัน)
DO $$
DECLARE
  cust_690546_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '91', '690546', 'สาขานี้จ่าย', 'ชนกนันท์ พรมเวียง(เมียคำพัน)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690546_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690546_id, 'กสิกรไทย', '5392785454', 'ชนกนันท์ พรมเวียง(เมียคำพัน)', true);

END $$;

-- 690547: ช้วน แวดระเว (เจ๊พร)
DO $$
DECLARE
  cust_690547_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '146', '690547', 'สาขานี้จ่าย', 'ช้วน แวดระเว (เจ๊พร)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690547_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690547_id, 'กรุงไทย', '3380559881', 'ช้วน แวดระเว (เจ๊พร)', true);

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690547_id, 'กรุงไทย', '0170331571', 'บริษัท ส.เจริญกิจการค้า จำกัด (เจ๊พร)', false);

END $$;

-- 690548: ชัยชาญ กมลพันธ์(เฮียเก่ง)
DO $$
DECLARE
  cust_690548_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '1', '690548', 'สาขานี้จ่าย', 'ชัยชาญ กมลพันธ์(เฮียเก่ง)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690548_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690548_id, 'กสิกรไทย', '1261667947', 'ชัยชาญ กมลพันธ์(เฮียเก่ง)', true);

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690548_id, 'กสิกรไทย', '1261667947', 'ชัยชาญ กมลพันธ์(เฮียเก่ง)', false);

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690548_id, 'กสิกรไทย', '0158543281', 'จิดาภา กมลพันธ์(เฮียเก่ง)', false);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690548_id, '0984801071');

END $$;

-- 690549: ชูชาติ ถาริวร (แม่แต้ม)
DO $$
DECLARE
  cust_690549_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '33', '690549', 'สาขานี้จ่าย', 'ชูชาติ ถาริวร (แม่แต้ม)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690549_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690549_id, 'กสิกรไทย', '243310849', 'ชูชาติ ถาริวร (แม่แต้ม)', true);

END $$;

-- 690550: ณรงศักดิ์ จันทราช (นาวายาง)
DO $$
DECLARE
  cust_690550_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '43', '690550', 'สาขานี้จ่าย', 'ณรงศักดิ์ จันทราช (นาวายาง)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690550_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690550_id, 'กสิกรไทย', '0722611489', 'ณรงศักดิ์ จันทราช (นาวายาง)', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690550_id, '864911020');

END $$;

-- 690551: ณัฐคชานัลก์ ศรีประสงค์ (ปิยะ) ชานุมาน
DO $$
DECLARE
  cust_690551_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '169', '690551', 'สาขานี้จ่าย', 'ณัฐคชานัลก์ ศรีประสงค์ (ปิยะ) ชานุมาน',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690551_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690551_id, 'กรุงไทย', '4201831612', 'ณัฐคชานัลก์ ศรีประสงค์ (ปิยะ) ชานุมาน', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690551_id, '0961614322');

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690551_id, '0964149432');

END $$;

-- 690552: ณัฐวุฒิ ยาพระจันทร์(เสี่ยเจมส์)
DO $$
DECLARE
  cust_690552_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '1750763126120', '690552', 'สาขานี้จ่าย', 'ณัฐวุฒิ ยาพระจันทร์(เสี่ยเจมส์)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690552_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690552_id, 'กสิกรไทย', '1808643053', 'ณัฐวุฒิ ยาพระจันทร์(เสี่ยเจมส์)', true);

END $$;

-- 690553: ณัฐสุภา สมตัว(เจ๊นัท)
DO $$
DECLARE
  cust_690553_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '149', '690553', 'สาขานี้จ่าย', 'ณัฐสุภา สมตัว(เจ๊นัท)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690553_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690553_id, 'กรุงไทย', '3380381578', 'ณัฐสุภา สมตัว(เจ๊นัท)', true);

END $$;

-- 690554: ดอกรัก แว่นระเว (เสี่ยรัก)
DO $$
DECLARE
  cust_690554_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '37', '690554', 'สาขานี้จ่าย', 'ดอกรัก แว่นระเว (เสี่ยรัก)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690554_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690554_id, 'กรุงไทย', '3380264040', 'ดอกรัก แว่นระเว (เสี่ยรัก)', true);

END $$;

-- 690555: ดาราภรณ์ ผลทวี (ลานเจริญทรัพย์) ชานุมาน
DO $$
DECLARE
  cust_690555_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '1754291773181', '690555', 'สาขานี้จ่าย', 'ดาราภรณ์ ผลทวี (ลานเจริญทรัพย์) ชานุมาน',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690555_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690555_id, 'กสิกรไทย', '0471491608', 'ดาราภรณ์ ผลทวี (ลานเจริญทรัพย์) ชานุมาน', true);

END $$;

-- 690556: ตุ๊กตา กุระจินดา(เจ๊ตุ๊กตา)   ชานุมาน (ตุ๊กตา กุระจินดา กสิกรไทย 1992255672)
DO $$
DECLARE
  cust_690556_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '103', '690556', 'สาขานี้จ่าย', 'ตุ๊กตา กุระจินดา(เจ๊ตุ๊กตา)   ชานุมาน (ตุ๊กตา กุระจินดา กสิกรไทย 1992255672)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690556_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690556_id, 'กรุงเทพ', '5070624373', 'ตุ๊กตา กุระจินดา(เจ๊ตุ๊กตา)   ชานุมาน (ตุ๊กตา กุระจินดา กสิกรไทย 1992255672)', true);

END $$;

-- 690557: แตงอ่อน บุญเนตร
DO $$
DECLARE
  cust_690557_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '41', '690557', 'สาขานี้จ่าย', 'แตงอ่อน บุญเนตร',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690557_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690557_id, 'ออมสิน', '20060779962', 'แตงอ่อน บุญเนตร', true);

END $$;

-- 690558: ถนอมจิตร เชื้อกุณะ
DO $$
DECLARE
  cust_690558_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '53', '690558', 'สาขานี้จ่าย', 'ถนอมจิตร เชื้อกุณะ',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690558_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690558_id, 'กสิกรไทย', '152564899', 'ถนอมจิตร เชื้อกุณะ', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690558_id, '922743188');

END $$;

-- 690559: ทนงศักดิ์ วงศ์ทองนิล
DO $$
DECLARE
  cust_690559_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '38', '690559', 'สาขานี้จ่าย', 'ทนงศักดิ์ วงศ์ทองนิล',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690559_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690559_id, 'ธ.ก.ส.', '017508085051', 'ทนงศักดิ์ วงศ์ทองนิล', true);

END $$;

-- 690560: ทองสอน ภูชุม (หนองผือ)
DO $$
DECLARE
  cust_690560_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '55', '690560', 'สาขานี้จ่าย', 'ทองสอน ภูชุม (หนองผือ)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690560_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690560_id, 'กรุงไทย', '5910082345', 'ทองสอน ภูชุม (หนองผือ)', true);

END $$;

-- 690561: ทัพพสาร นามสมดี (เสี่ยอั้น)
DO $$
DECLARE
  cust_690561_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '173', '690561', 'สาขานี้จ่าย', 'ทัพพสาร นามสมดี (เสี่ยอั้น)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690561_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690561_id, 'ออมสิน', '020350121172', 'ทัพพสาร นามสมดี (เสี่ยอั้น)', true);

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690561_id, 'พร้อมเพย์', '0931265580', 'ทัพพสาร นามสมดี (เสี่ยอั้น)', false);

END $$;

-- 690562: เทพสุริยา ลาลา (เสี่ยเทพ)
DO $$
DECLARE
  cust_690562_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '45', '690562', 'สาขานี้จ่าย', 'เทพสุริยา ลาลา (เสี่ยเทพ)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690562_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690562_id, 'กสิกรไทย', '0398100131', 'เทพสุริยา ลาลา (เสี่ยเทพ)', true);

END $$;

-- 690563: ธนกร จันทร์สาขะ (ศรีสมหวัง)
DO $$
DECLARE
  cust_690563_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '1750763126121', '690563', 'สาขานี้จ่าย', 'ธนกร จันทร์สาขะ (ศรีสมหวัง)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690563_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690563_id, 'ออมสิน', '020307295079', 'ธนกร จันทร์สาขะ (ศรีสมหวัง)', true);

END $$;

-- 690564: ธนะชัย สาวันดี (เฮียเอ กดเงิน ถอนเงิน)
DO $$
DECLARE
  cust_690564_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '1754291773173', '690564', 'สาขานี้จ่าย', 'ธนะชัย สาวันดี (เฮียเอ กดเงิน ถอนเงิน)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690564_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690564_id, 'ออมสิน', '020477388316', 'ธนะชัย สาวันดี (เฮียเอ กดเงิน ถอนเงิน)', true);

END $$;

-- 690565: ธวัชชัย นอพิมาย (กอบกำ)
DO $$
DECLARE
  cust_690565_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '98', '690565', 'สาขานี้จ่าย', 'ธวัชชัย นอพิมาย (กอบกำ)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690565_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690565_id, 'กรุงไทย', '5980557105', 'ธวัชชัย นอพิมาย (กอบกำ)', true);

END $$;

-- 690566: ธวัช  เซ่งพัด(เจ๊เหมียว)
DO $$
DECLARE
  cust_690566_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '71', '690566', 'สาขานี้จ่าย', 'ธวัช  เซ่งพัด(เจ๊เหมียว)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690566_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690566_id, 'กรุงไทย', '6797181917', 'ธวัช  เซ่งพัด(เจ๊เหมียว)', true);

END $$;

-- 690567: ธวัช  เซ่งพัด(เจ๊เหมียว)
DO $$
DECLARE
  cust_690567_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '72', '690567', 'สาขานี้จ่าย', 'ธวัช  เซ่งพัด(เจ๊เหมียว)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690567_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690567_id, 'กรุงไทย', '6797181917', 'ธวัช  เซ่งพัด(เจ๊เหมียว)', true);

END $$;

-- 690568: ธัญวรัตน์ หนูนาค (เจ๊เจี๊ยบ)
DO $$
DECLARE
  cust_690568_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '14', '690568', 'สาขานี้จ่าย', 'ธัญวรัตน์ หนูนาค (เจ๊เจี๊ยบ)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690568_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690568_id, 'ออมสิน', '020402637688', 'ธัญวรัตน์ หนูนาค (เจ๊เจี๊ยบ)', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690568_id, '981040604');

END $$;

-- 690569: นครศรี ห่อดี(เสี่ยหนุ่ย)
DO $$
DECLARE
  cust_690569_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '152', '690569', 'สาขานี้จ่าย', 'นครศรี ห่อดี(เสี่ยหนุ่ย)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690569_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690569_id, 'ออมสิน', '020417599857', 'นครศรี ห่อดี(เสี่ยหนุ่ย)', true);

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690569_id, 'ธ.ก.ส.', '020035441513', 'นครศรี ห่อดี', false);

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690569_id, 'ไทยพาณิชย์', '7522337650', 'วิทยา', false);

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690569_id, 'กสิกรไทย', '0071363821', 'นครศรี ห่อดี(เสี่ยหนุ่ย)', false);

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690569_id, 'ไทยพาณิชย์', '6522571949', 'นส.มณีสรณ์ คำใต้', false);

END $$;

-- 690570: นงลักษณ์ แผนพนา (แม่นงค์)
DO $$
DECLARE
  cust_690570_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '6', '690570', 'สาขานี้จ่าย', 'นงลักษณ์ แผนพนา (แม่นงค์)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690570_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690570_id, 'กสิกรไทย', '2702434931', 'นงลักษณ์ แผนพนา (แม่นงค์)', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690570_id, '895695532');

END $$;

-- 690571: นภัสวรรณ (น้าเล็ก ลูกน้อง แม่ดอกแก้ว)
DO $$
DECLARE
  cust_690571_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '107', '690571', 'สาขานี้จ่าย', 'นภัสวรรณ (น้าเล็ก ลูกน้อง แม่ดอกแก้ว)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690571_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690571_id, 'ออมสิน', '20363799717', 'นภัสวรรณ (น้าเล็ก ลูกน้อง แม่ดอกแก้ว)', true);

END $$;

-- 690572: นราทิพย์ สุวิมล (โป่งน้อย)
DO $$
DECLARE
  cust_690572_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '36', '690572', 'สาขานี้จ่าย', 'นราทิพย์ สุวิมล (โป่งน้อย)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690572_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690572_id, 'กสิกรไทย', '2011876156', 'นราทิพย์ สุวิมล (โป่งน้อย)', true);

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690572_id, 'กสิกรไทย', '1328349015', 'นราทิพย์ สุวิมล (โป่งน้อย)', false);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690572_id, '619194168');

END $$;

-- 690573: นฤเบศ ชาลือ(เดี่ยว)    ชานุมาน
DO $$
DECLARE
  cust_690573_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '162', '690573', 'สาขานี้จ่าย', 'นฤเบศ ชาลือ(เดี่ยว)    ชานุมาน',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690573_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690573_id, 'ไทยพาณิชย์', '6522443950', 'นฤเบศ ชาลือ(เดี่ยว)    ชานุมาน', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690573_id, '0986090112');

END $$;

-- 690574: น.ส จิราภรณ์ สุวรรณคำ(พริกเสี่ยเป้)
DO $$
DECLARE
  cust_690574_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '178', '690574', 'สาขานี้จ่าย', 'น.ส จิราภรณ์ สุวรรณคำ(พริกเสี่ยเป้)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690574_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690574_id, 'กสิกรไทย', '7262255936', 'น.ส จิราภรณ์ สุวรรณคำ(พริกเสี่ยเป้)', true);

END $$;

-- 690575: นส.มณีสรณ์ คำใต้ (แม่กลม) ชานุมาน
DO $$
DECLARE
  cust_690575_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '186', '690575', 'สาขานี้จ่าย', 'นส.มณีสรณ์ คำใต้ (แม่กลม) ชานุมาน',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690575_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690575_id, 'ไทยพาณิชย์', '6522571949', 'นส.มณีสรณ์ คำใต้ (แม่กลม) ชานุมาน', true);

END $$;

-- 690576: นางขันทอง  สิงห์เชื้อ  (ขันทอง)
DO $$
DECLARE
  cust_690576_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '63', '690576', 'สาขานี้จ่าย', 'นางขันทอง  สิงห์เชื้อ  (ขันทอง)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690576_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690576_id, 'กสิกรไทย', '291357067', 'นางขันทอง  สิงห์เชื้อ  (ขันทอง)', true);

END $$;

-- 690577: นางชลนภา วันหนา(เจ๊หญิง)  ลานนาโพธิ์กลาง
DO $$
DECLARE
  cust_690577_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '1754291773182', '690577', 'สาขานี้จ่าย', 'นางชลนภา วันหนา(เจ๊หญิง)  ลานนาโพธิ์กลาง',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690577_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690577_id, 'กรุงไทย', '3380432067', 'นางชลนภา วันหนา(เจ๊หญิง)  ลานนาโพธิ์กลาง', true);

END $$;

-- 690578: นาง ดาวประกาย พนาสนธ์(เสี่ยไผ่) ร้านไผ่ทอง
DO $$
DECLARE
  cust_690578_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '10', '690578', 'สาขานี้จ่าย', 'นาง ดาวประกาย พนาสนธ์(เสี่ยไผ่) ร้านไผ่ทอง',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690578_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690578_id, 'ออมสิน', '020225571031', 'นาง ดาวประกาย พนาสนธ์(เสี่ยไผ่) ร้านไผ่ทอง', true);

END $$;

-- 690579: นาง นุจรีย์ เรืองบุญ(เจ๊ตุ้มสิงโต)
DO $$
DECLARE
  cust_690579_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '135', '690579', 'สาขานี้จ่าย', 'นาง นุจรีย์ เรืองบุญ(เจ๊ตุ้มสิงโต)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690579_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690579_id, 'ธ.ก.ส.', '012772363327', 'นาง นุจรีย์ เรืองบุญ(เจ๊ตุ้มสิงโต)', true);

END $$;

-- 690580: นางประยูร บุตรราช (น้องตาล)
DO $$
DECLARE
  cust_690580_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '144', '690580', 'สาขานี้จ่าย', 'นางประยูร บุตรราช (น้องตาล)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690580_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690580_id, 'กสิกรไทย', '3662464006', 'นางประยูร บุตรราช (น้องตาล)', true);

END $$;

-- 690581: นางพิศมัย ทุนมาก (เสี่ยเดช)
DO $$
DECLARE
  cust_690581_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '65', '690581', 'สาขานี้จ่าย', 'นางพิศมัย ทุนมาก (เสี่ยเดช)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690581_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690581_id, 'ไทยพาณิชย์', '4065731373', 'นางพิศมัย ทุนมาก (เสี่ยเดช)', true);

END $$;

-- 690582: นางเพ็ญศรี เกษวัต (เจ๊บีบี)
DO $$
DECLARE
  cust_690582_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '31', '690582', 'สาขานี้จ่าย', 'นางเพ็ญศรี เกษวัต (เจ๊บีบี)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690582_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690582_id, 'กรุงเทพ', '6737271376', 'นางเพ็ญศรี เกษวัต (เจ๊บีบี)', true);

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690582_id, 'กสิกรไทย', '1953166476', 'อุมาพร เกษวัต', false);

END $$;

-- 690583: นางรจณา  เดชะคำภู (ศรีรุ่ง)
DO $$
DECLARE
  cust_690583_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '68', '690583', 'สาขานี้จ่าย', 'นางรจณา  เดชะคำภู (ศรีรุ่ง)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690583_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690583_id, 'กสิกรไทย', '1053184797', 'นางรจณา  เดชะคำภู (ศรีรุ่ง)', true);

END $$;

-- 690584: นางลุนนี อนุสนธ์ (เสี่ยนุช)
DO $$
DECLARE
  cust_690584_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '1754291773170', '690584', 'สาขานี้จ่าย', 'นางลุนนี อนุสนธ์ (เสี่ยนุช)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690584_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690584_id, 'กรุงไทย', '6647721584', 'นางลุนนี อนุสนธ์ (เสี่ยนุช)', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690584_id, '0892862094');

END $$;

-- 690585: นางวริษฐา เกษชาติ (นะโม)
DO $$
DECLARE
  cust_690585_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '23', '690585', 'สาขานี้จ่าย', 'นางวริษฐา เกษชาติ (นะโม)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690585_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690585_id, 'กรุงเทพ', '6737272747', 'นางวริษฐา เกษชาติ (นะโม)', true);

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690585_id, 'กสิกรไทย', '0128841954', 'ณิชาภา ประชุมสุข', false);

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690585_id, 'กสิกรไทย', '3612511135', 'บัญชา ประชุมสุข (นะโม)', false);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690585_id, '0804514628');

END $$;

-- 690586: นางศิริลักษณ์ ก้องเสียง(แม่บี) ชานุมาน
DO $$
DECLARE
  cust_690586_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '1754291773177', '690586', 'สาขานี้จ่าย', 'นางศิริลักษณ์ ก้องเสียง(แม่บี) ชานุมาน',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690586_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690586_id, 'ไทยพาณิชย์', '6523009018', 'นางศิริลักษณ์ ก้องเสียง(แม่บี) ชานุมาน', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690586_id, '0833442054');

END $$;

-- 690587: นางสาวฐิติมา จิตมั่น (หนองผือน้อย)
DO $$
DECLARE
  cust_690587_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '1754291773167', '690587', 'สาขานี้จ่าย', 'นางสาวฐิติมา จิตมั่น (หนองผือน้อย)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690587_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690587_id, 'ออมสิน', '020285058135', 'นางสาวฐิติมา จิตมั่น (หนองผือน้อย)', true);

END $$;

-- 690588: นางสาวพิศมัย ถุระพันน์(เจ๊ไหม) ดงแถบ
DO $$
DECLARE
  cust_690588_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '1754291773165', '690588', 'สาขานี้จ่าย', 'นางสาวพิศมัย ถุระพันน์(เจ๊ไหม) ดงแถบ',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690588_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690588_id, 'ทหารไทยธนชาต (ttb)', '3057007720', 'นางสาวพิศมัย ถุระพันน์(เจ๊ไหม) ดงแถบ', true);

END $$;

-- 690589: นางสาว สมพิศ ไชยวัน(เจ๊สมพิศ)   ชานุมาน
DO $$
DECLARE
  cust_690589_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '156', '690589', 'สาขานี้จ่าย', 'นางสาว สมพิศ ไชยวัน(เจ๊สมพิศ)   ชานุมาน',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690589_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690589_id, 'กสิกรไทย', '1992264000', 'นางสาว สมพิศ ไชยวัน(เจ๊สมพิศ)   ชานุมาน', true);

END $$;

-- 690590: นางสาวอ้อย ดิษฐเจริญ (ลานสหกรณ์โขงเจียม)
DO $$
DECLARE
  cust_690590_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '131', '690590', 'สาขานี้จ่าย', 'นางสาวอ้อย ดิษฐเจริญ (ลานสหกรณ์โขงเจียม)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690590_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690590_id, 'กรุงไทย', '3380103403', 'นางสาวอ้อย ดิษฐเจริญ (ลานสหกรณ์โขงเจียม)', true);

END $$;

-- 690591: นาตยา อุบลพิทักษ์(พิมพ์ชนก)
DO $$
DECLARE
  cust_690591_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '148', '690591', 'สาขานี้จ่าย', 'นาตยา อุบลพิทักษ์(พิมพ์ชนก)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690591_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690591_id, 'กสิกรไทย', '1582857748', 'นาตยา อุบลพิทักษ์(พิมพ์ชนก)', true);

END $$;

-- 690592: นายกิตติพงษ์ คำมุงคุณ (เสี่ยหนุ่ย 2) ลูกค้าชานุมาน
DO $$
DECLARE
  cust_690592_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '1754291773179', '690592', 'สาขานี้จ่าย', 'นายกิตติพงษ์ คำมุงคุณ (เสี่ยหนุ่ย 2) ลูกค้าชานุมาน',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690592_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690592_id, 'กรุงไทย', '6645225954', 'นายกิตติพงษ์ คำมุงคุณ (เสี่ยหนุ่ย 2) ลูกค้าชานุมาน', true);

END $$;

-- 690593: นายคำ  วงเวียน  (เสี่ยคำ)
DO $$
DECLARE
  cust_690593_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '67', '690593', 'สาขานี้จ่าย', 'นายคำ  วงเวียน  (เสี่ยคำ)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690593_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690593_id, 'ไทยพาณิชย์', '7522281671', 'นายคำ  วงเวียน  (เสี่ยคำ)', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690593_id, '833826691');

END $$;

-- 690594: นายคูณ ป้องพิมพ์ (ครูทรัพย์การเกษตร)(พิไลวรรณ)(พ่อคูณ)
DO $$
DECLARE
  cust_690594_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '120', '690594', 'สาขานี้จ่าย', 'นายคูณ ป้องพิมพ์ (ครูทรัพย์การเกษตร)(พิไลวรรณ)(พ่อคูณ)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690594_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690594_id, 'กรุงไทย', '3380457507', 'นายคูณ ป้องพิมพ์ (ครูทรัพย์การเกษตร)(พิไลวรรณ)(พ่อคูณ)', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690594_id, '0981705245');

END $$;

-- 690595: นายตันติกร เห็มวัง(ร้านต้นกล้า) ชานุมาน
DO $$
DECLARE
  cust_690595_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '174', '690595', 'สาขานี้จ่าย', 'นายตันติกร เห็มวัง(ร้านต้นกล้า) ชานุมาน',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690595_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690595_id, 'กรุงไทย', '3193059978', 'นายตันติกร เห็มวัง(ร้านต้นกล้า) ชานุมาน', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690595_id, '0932599438');

END $$;

-- 690596: นายนวลจันทร์ เหลียวสูง (ลุงป้อม)
DO $$
DECLARE
  cust_690596_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '132', '690596', 'สาขานี้จ่าย', 'นายนวลจันทร์ เหลียวสูง (ลุงป้อม)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690596_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690596_id, 'กสิกรไทย', '3162201726', 'นายนวลจันทร์ เหลียวสูง (ลุงป้อม)', true);

END $$;

-- 690597: นายประสิทธิ์ สีชมพู (พ่อแก้ว)
DO $$
DECLARE
  cust_690597_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '64', '690597', 'สาขานี้จ่าย', 'นายประสิทธิ์ สีชมพู (พ่อแก้ว)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690597_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690597_id, 'กรุงไทย', '4270323582', 'นายประสิทธิ์ สีชมพู (พ่อแก้ว)', true);

END $$;

-- 690598: นายประเสริฐ คำลอย(ประเสริฐ)
DO $$
DECLARE
  cust_690598_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '115', '690598', 'สาขานี้จ่าย', 'นายประเสริฐ คำลอย(ประเสริฐ)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690598_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690598_id, 'ออมสิน', '000000767103', 'นายประเสริฐ คำลอย(ประเสริฐ)', true);

END $$;

-- 690599: นายเรืองศักดิ์ ขันแก้ว(ลุงเคน) ลานบะไห
DO $$
DECLARE
  cust_690599_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '1754291773185', '690599', 'สาขานี้จ่าย', 'นายเรืองศักดิ์ ขันแก้ว(ลุงเคน) ลานบะไห',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690599_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690599_id, 'ออมสิน', '020368780662', 'นายเรืองศักดิ์ ขันแก้ว(ลุงเคน) ลานบะไห', true);

END $$;

-- 690600: นาย ศักดิ์สิทธิ์  เหมือนเหลา
DO $$
DECLARE
  cust_690600_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '138', '690600', 'สาขานี้จ่าย', 'นาย ศักดิ์สิทธิ์  เหมือนเหลา',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690600_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690600_id, 'กรุงเทพ', '7760112404', 'นาย ศักดิ์สิทธิ์  เหมือนเหลา', true);

END $$;

-- 690601: นายสิทธิพัฒน์ ห่อรัตนาเรือง (สตีฟซื้อยาง)
DO $$
DECLARE
  cust_690601_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '1754291773183', '690601', 'สาขานี้จ่าย', 'นายสิทธิพัฒน์ ห่อรัตนาเรือง (สตีฟซื้อยาง)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690601_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690601_id, 'กสิกรไทย', '1551973499', 'นายสิทธิพัฒน์ ห่อรัตนาเรือง (สตีฟซื้อยาง)', true);

END $$;

-- 690602: นายอนิวรรตน์ จันทบุตร(ตูมตาม) ดงแถบ
DO $$
DECLARE
  cust_690602_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '184', '690602', 'สาขานี้จ่าย', 'นายอนิวรรตน์ จันทบุตร(ตูมตาม) ดงแถบ',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690602_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690602_id, 'ไทยพาณิชย์', '3832806913', 'นายอนิวรรตน์ จันทบุตร(ตูมตาม) ดงแถบ', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690602_id, '0956149254');

END $$;

-- 690603: นาย อลงกรณ์ บันตะบอน (ลานอลงกรณ์) ชานุมาน
DO $$
DECLARE
  cust_690603_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '1754291773180', '690603', 'สาขานี้จ่าย', 'นาย อลงกรณ์ บันตะบอน (ลานอลงกรณ์) ชานุมาน',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690603_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690603_id, 'กสิกรไทย', '1622947915', 'นาย อลงกรณ์ บันตะบอน (ลานอลงกรณ์) ชานุมาน', true);

END $$;

-- 690604: นิตยา ยืนยง(เจ๊นิตติยา)
DO $$
DECLARE
  cust_690604_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '8', '690604', 'สาขานี้จ่าย', 'นิตยา ยืนยง(เจ๊นิตติยา)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690604_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690604_id, 'กสิกรไทย', '2702523802', 'นิตยา ยืนยง(เจ๊นิตติยา)', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690604_id, '875537330');

END $$;

-- 690605: นิภาพร ผ่องศรี(บุ๋มบิ๋ม)
DO $$
DECLARE
  cust_690605_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '105', '690605', 'สาขานี้จ่าย', 'นิภาพร ผ่องศรี(บุ๋มบิ๋ม)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690605_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690605_id, 'กสิกรไทย', '3612587352', 'นิภาพร ผ่องศรี(บุ๋มบิ๋ม)', true);

END $$;

-- 690606: นิภาพร วิชพล(เจ๊ลินดา)    ชานุมาน
DO $$
DECLARE
  cust_690606_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '159', '690606', 'สาขานี้จ่าย', 'นิภาพร วิชพล(เจ๊ลินดา)    ชานุมาน',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690606_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690606_id, 'กรุงเทพ', '3624358408', 'นิภาพร วิชพล(เจ๊ลินดา)    ชานุมาน', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690606_id, '0811836554');

END $$;

-- 690607: นิยม เห็มวัง(ร้านนิยม)  ชานุมาน
DO $$
DECLARE
  cust_690607_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '172', '690607', 'สาขานี้จ่าย', 'นิยม เห็มวัง(ร้านนิยม)  ชานุมาน',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690607_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690607_id, 'ธ.ก.ส.', '020130072457', 'นิยม เห็มวัง(ร้านนิยม)  ชานุมาน', true);

END $$;

-- 690608: นิลาวัลย์ ทองหยิบ (แม่เทียม)
DO $$
DECLARE
  cust_690608_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '22', '690608', 'สาขานี้จ่าย', 'นิลาวัลย์ ทองหยิบ (แม่เทียม)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690608_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690608_id, 'กสิกรไทย', '0733886781', 'นิลาวัลย์ ทองหยิบ (แม่เทียม)', true);

END $$;

-- 690609: นิสสัย หนักแน่น (พ่อตึ๋ง)
DO $$
DECLARE
  cust_690609_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '40', '690609', 'สาขานี้จ่าย', 'นิสสัย หนักแน่น (พ่อตึ๋ง)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690609_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690609_id, 'ทหารไทยธนชาต (ttb)', '19658004081', 'นิสสัย หนักแน่น (พ่อตึ๋ง)', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690609_id, '6066204949');

END $$;

-- 690610: นุชจรี ทองประมูล (นุช)
DO $$
DECLARE
  cust_690610_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '50', '690610', 'สาขานี้จ่าย', 'นุชจรี ทองประมูล (นุช)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690610_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690610_id, 'กสิกรไทย', '1243161920', 'นุชจรี ทองประมูล (นุช)', true);

END $$;

-- 690611: บังวิทย์
DO $$
DECLARE
  cust_690611_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '2', '690611', 'สาขานี้จ่าย', 'บังวิทย์',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690611_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690611_id, 'กสิกรไทย', '1481835301', 'บังวิทย์', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690611_id, '0653178626');

END $$;

-- 690612: บัวผัน ล้านศรี(พ่อโฮม)
DO $$
DECLARE
  cust_690612_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '13', '690612', 'สาขานี้จ่าย', 'บัวผัน ล้านศรี(พ่อโฮม)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690612_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690612_id, 'ออมสิน', '20257855690', 'บัวผัน ล้านศรี(พ่อโฮม)', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690612_id, '864123182');

END $$;

-- 690613: บัวลอย อ้วนล่ำ (อัยรดา)
DO $$
DECLARE
  cust_690613_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '1754291773162', '690613', 'สาขานี้จ่าย', 'บัวลอย อ้วนล่ำ (อัยรดา)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690613_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690613_id, 'กรุงไทย', '1210628414', 'บัวลอย อ้วนล่ำ (อัยรดา)', true);

END $$;

-- 690614: บุญเลิศ แรมฤทธิ์(สองพี่น้อง)
DO $$
DECLARE
  cust_690614_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '139', '690614', 'สาขานี้จ่าย', 'บุญเลิศ แรมฤทธิ์(สองพี่น้อง)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690614_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690614_id, 'กสิกรไทย', '1188084806', 'บุญเลิศ แรมฤทธิ์(สองพี่น้อง)', true);

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690614_id, 'กสิกรไทย', '1678536810', 'มุกดา เนตรหาร', false);

END $$;

-- 690615: ประดิพัทธ์ วรรักษ์ธารา(เสี่ยฮาท)     ชานุมาน
DO $$
DECLARE
  cust_690615_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '183', '690615', 'สาขานี้จ่าย', 'ประดิพัทธ์ วรรักษ์ธารา(เสี่ยฮาท)     ชานุมาน',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690615_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690615_id, 'ไทยพาณิชย์', '5202725422', 'ประดิพัทธ์ วรรักษ์ธารา(เสี่ยฮาท)     ชานุมาน', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690615_id, '0875453508');

END $$;

-- 690616: ประดิษฐ พิมพ์พันธ์ ชาวสวนดงแถบ(3141)
DO $$
DECLARE
  cust_690616_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '1754291773178', '690616', 'สาขานี้จ่าย', 'ประดิษฐ พิมพ์พันธ์ ชาวสวนดงแถบ(3141)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690616_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690616_id, 'ธ.ก.ส.', '020069623849', 'ประดิษฐ พิมพ์พันธ์ ชาวสวนดงแถบ(3141)', true);

END $$;

-- 690617: ประภาส กาฬหว้า(พ่อมนต์)
DO $$
DECLARE
  cust_690617_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '54', '690617', 'สาขานี้จ่าย', 'ประภาส กาฬหว้า(พ่อมนต์)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690617_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690617_id, 'ไทยพาณิชย์', '4050988799', 'ประภาส กาฬหว้า(พ่อมนต์)', true);

END $$;

-- 690618: ประยูร บุตรราช
DO $$
DECLARE
  cust_690618_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '143', '690618', 'สาขานี้จ่าย', 'ประยูร บุตรราช',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690618_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690618_id, 'กสิกรไทย', '3662464006', 'ประยูร บุตรราช', true);

END $$;

-- 690619: ประสงค์ สัจธรรม (แม่จ่อย)
DO $$
DECLARE
  cust_690619_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '19', '690619', 'สาขานี้จ่าย', 'ประสงค์ สัจธรรม (แม่จ่อย)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690619_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690619_id, 'กสิกรไทย', '0353545914', 'ประสงค์ สัจธรรม (แม่จ่อย)', true);

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690619_id, 'กสิกรไทย', '1641750189', 'ชญานี สัจธรรม(ลูกสาวแม่จ่อย)', false);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690619_id, '898254306');

END $$;

-- 690620: ปราณี บุญจวบ (แม่ณี)
DO $$
DECLARE
  cust_690620_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '24', '690620', 'สาขานี้จ่าย', 'ปราณี บุญจวบ (แม่ณี)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690620_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690620_id, 'กสิกรไทย', '3662447594', 'ปราณี บุญจวบ (แม่ณี)', true);

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690620_id, 'กสิกรไทย', '0542875011', 'ฐานิภรณ์ เรืองประเสริฐ(แอน)', false);

END $$;

-- 690621: ปิยะวรรณ สีคำมา (พ่อคิด)
DO $$
DECLARE
  cust_690621_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '18', '690621', 'สาขานี้จ่าย', 'ปิยะวรรณ สีคำมา (พ่อคิด)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690621_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690621_id, 'ออมสิน', '020101233557', 'ปิยะวรรณ สีคำมา (พ่อคิด)', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690621_id, '636218523');

END $$;

-- 690622: พงศ์สิทธิ์ มีชัย(วันเพ็ญ)  ชานุมาน
DO $$
DECLARE
  cust_690622_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '168', '690622', 'สาขานี้จ่าย', 'พงศ์สิทธิ์ มีชัย(วันเพ็ญ)  ชานุมาน',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690622_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690622_id, 'กสิกรไทย', '0133602119', 'พงศ์สิทธิ์ มีชัย(วันเพ็ญ)  ชานุมาน', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690622_id, '0809988454');

END $$;

-- 690623: พ่มพวง  ปัฐมา(ช่างเสา)  ดงตาหวัง
DO $$
DECLARE
  cust_690623_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '1754291773187', '690623', 'สาขานี้จ่าย', 'พ่มพวง  ปัฐมา(ช่างเสา)  ดงตาหวัง',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690623_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690623_id, 'ธ.ก.ส.', '015508052416', 'พ่มพวง  ปัฐมา(ช่างเสา)  ดงตาหวัง', true);

END $$;

-- 690624: พรนภา แก้วทอง (พรนภา)
DO $$
DECLARE
  cust_690624_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '25', '690624', 'สาขานี้จ่าย', 'พรนภา แก้วทอง (พรนภา)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690624_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690624_id, 'กสิกรไทย', '0411654451', 'พรนภา แก้วทอง (พรนภา)', true);

END $$;

-- 690625: พัชนิดา โคตรสาลี(เสี่ยคอยพัชนิดา)
DO $$
DECLARE
  cust_690625_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '147', '690625', 'สาขานี้จ่าย', 'พัชนิดา โคตรสาลี(เสี่ยคอยพัชนิดา)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690625_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690625_id, 'กสิกรไทย', '1834082868', 'พัชนิดา โคตรสาลี(เสี่ยคอยพัชนิดา)', true);

END $$;

-- 690626: พัชราภรณ์ ด้วงเงิน (เสี่ยเกลือ)      ชานุมาน
DO $$
DECLARE
  cust_690626_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '158', '690626', 'สาขานี้จ่าย', 'พัชราภรณ์ ด้วงเงิน (เสี่ยเกลือ)      ชานุมาน',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690626_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690626_id, 'กสิกรไทย', '0221601378', 'พัชราภรณ์ ด้วงเงิน (เสี่ยเกลือ)      ชานุมาน', true);

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690626_id, 'กรุงไทย', '9814795623', 'พัชราภรณ์ ด้วงเงิน (เสี่ยเกลือ)', false);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690626_id, '0878197352');

END $$;

-- 690627: พัฒยา ชาดา(เจ๊เป้) (พัฒยา ชาดา(เจ๊เป้) กรุงเทพ 3624361667)
DO $$
DECLARE
  cust_690627_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '155', '690627', 'สาขานี้จ่าย', 'พัฒยา ชาดา(เจ๊เป้) (พัฒยา ชาดา(เจ๊เป้) กรุงเทพ 3624361667)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690627_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690627_id, 'กรุงเทพ', '3624361667', 'พัฒยา ชาดา(เจ๊เป้) (พัฒยา ชาดา(เจ๊เป้) กรุงเทพ 3624361667)', true);

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690627_id, 'กสิกรไทย', '1382614417', 'พัฒยา ชาดา(เจ๊เป้)', false);

END $$;

-- 690628: พี่เล็กถอนเงินชานุมาน
DO $$
DECLARE
  cust_690628_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '166', '690628', 'สาขานี้จ่าย', 'พี่เล็กถอนเงินชานุมาน',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690628_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690628_id, 'ออมสิน', '020444797862', 'พี่เล็กถอนเงินชานุมาน', true);

END $$;

-- 690629: พุฒ  ภูคำ (เสี่ยคอย)
DO $$
DECLARE
  cust_690629_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '164', '690629', 'สาขานี้จ่าย', 'พุฒ  ภูคำ (เสี่ยคอย)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690629_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690629_id, 'ออมสิน', '020344755697', 'พุฒ  ภูคำ (เสี่ยคอย)', true);

END $$;

-- 690630: พุฒิพงศ์ แซ่คู (โด้)
DO $$
DECLARE
  cust_690630_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '1754291773176', '690630', 'สาขานี้จ่าย', 'พุฒิพงศ์ แซ่คู (โด้)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690630_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690630_id, 'กรุงไทย', '9866541444', 'พุฒิพงศ์ แซ่คู (โด้)', true);

END $$;

-- 690631: เพชร จันดา (แม่เพชร)
DO $$
DECLARE
  cust_690631_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '26', '690631', 'สาขานี้จ่าย', 'เพชร จันดา (แม่เพชร)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690631_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690631_id, 'กสิกรไทย', '3612522390', 'เพชร จันดา (แม่เพชร)', true);

END $$;

-- 690632: เพชรพรกิจ  สีแสด (เสี่ยอ๊อด) (เพชรพรกิจ สีแสด กสิกร 1283637332)
DO $$
DECLARE
  cust_690632_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '161', '690632', 'สาขานี้จ่าย', 'เพชรพรกิจ  สีแสด (เสี่ยอ๊อด) (เพชรพรกิจ สีแสด กสิกร 1283637332)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690632_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690632_id, 'ออมสิน', '020447588540', 'เพชรพรกิจ  สีแสด (เสี่ยอ๊อด) (เพชรพรกิจ สีแสด กสิกร 1283637332)', true);

END $$;

-- 690633: เพ็ญศรี เกดวัด(แม่น้องบี)
DO $$
DECLARE
  cust_690633_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '151', '690633', 'สาขานี้จ่าย', 'เพ็ญศรี เกดวัด(แม่น้องบี)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690633_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690633_id, 'กสิกรไทย', '1868930965', 'เพ็ญศรี เกดวัด(แม่น้องบี)', true);

END $$;

-- 690634: ไพโรจน์ ร่วมทรัพย์(เสี่ยไพโรจน์)
DO $$
DECLARE
  cust_690634_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '157', '690634', 'สาขานี้จ่าย', 'ไพโรจน์ ร่วมทรัพย์(เสี่ยไพโรจน์)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690634_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690634_id, 'ไทยพาณิชย์', '5202690287', 'ไพโรจน์ ร่วมทรัพย์(เสี่ยไพโรจน์)', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690634_id, '0925411863');

END $$;

-- 690635: ภาคภูมิ ปราณี(ภาคภูมิ)
DO $$
DECLARE
  cust_690635_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '108', '690635', 'สาขานี้จ่าย', 'ภาคภูมิ ปราณี(ภาคภูมิ)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690635_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690635_id, 'กสิกรไทย', '0148148619', 'ภาคภูมิ ปราณี(ภาคภูมิ)', true);

END $$;

-- 690636: มงคล ศรีสุข(เสี่ยมงคล)
DO $$
DECLARE
  cust_690636_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '85', '690636', 'สาขานี้จ่าย', 'มงคล ศรีสุข(เสี่ยมงคล)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690636_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690636_id, 'กสิกรไทย', '2702515559', 'มงคล ศรีสุข(เสี่ยมงคล)', true);

END $$;

-- 690637: มณิศรา ตาทอง(แม่ตุ๊)
DO $$
DECLARE
  cust_690637_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '1754291773166', '690637', 'สาขานี้จ่าย', 'มณิศรา ตาทอง(แม่ตุ๊)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690637_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690637_id, 'กสิกรไทย', '0053500285', 'มณิศรา ตาทอง(แม่ตุ๊)', true);

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690637_id, 'กสิกรไทย', '0053500285', 'มณิศรา ตาทอง(แม่ตุ๊)', false);

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690637_id, 'กสิกรไทย', '0308615243', 'มณิศรา ตาทอง(แม่ตุ๊)', false);

END $$;

-- 690638: มะไลพร เขียวคำรพ(เจ๊พรเข็มราช)
DO $$
DECLARE
  cust_690638_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '3', '690638', 'สาขานี้จ่าย', 'มะไลพร เขียวคำรพ(เจ๊พรเข็มราช)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690638_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690638_id, 'กสิกรไทย', '1992245642', 'มะไลพร เขียวคำรพ(เจ๊พรเข็มราช)', true);

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690638_id, 'กรุงเทพ', '6380367539', 'นายภานุพันธ์ เขียวคำรพ', false);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690638_id, '823128721');

END $$;

-- 690639: แม่อึ่ง ลมัย ศรีลาเลิศ
DO $$
DECLARE
  cust_690639_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '116', '690639', 'สาขานี้จ่าย', 'แม่อึ่ง ลมัย ศรีลาเลิศ',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690639_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690639_id, 'กสิกรไทย', '0708484946', 'แม่อึ่ง ลมัย ศรีลาเลิศ', true);

END $$;

-- 690640: ยุพิน เจริญสุข,JS (เจ๊จอย)
DO $$
DECLARE
  cust_690640_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '134', '690640', 'สาขานี้จ่าย', 'ยุพิน เจริญสุข,JS (เจ๊จอย)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690640_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690640_id, 'กสิกรไทย', '1182812117', 'ยุพิน เจริญสุข,JS (เจ๊จอย)', true);

END $$;

-- 690641: เยาวลักษณ์ เหล่าเต็ม (น้องฟลุ๊ค)
DO $$
DECLARE
  cust_690641_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '111', '690641', 'สาขานี้จ่าย', 'เยาวลักษณ์ เหล่าเต็ม (น้องฟลุ๊ค)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690641_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690641_id, 'กสิกรไทย', '0738049470', 'เยาวลักษณ์ เหล่าเต็ม (น้องฟลุ๊ค)', true);

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690641_id, 'กรุงไทย', '6610421153', 'เยาวลักษณ์ เหล่าเต็ม (น้องฟลุ๊ค)', false);

END $$;

-- 690642: รจนา  สุพร (พ่อบิ้ง)
DO $$
DECLARE
  cust_690642_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '58', '690642', 'สาขานี้จ่าย', 'รจนา  สุพร (พ่อบิ้ง)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690642_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690642_id, 'กสิกรไทย', '0591677268', 'รจนา  สุพร (พ่อบิ้ง)', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690642_id, '806896131');

END $$;

-- 690643: รัชนี  พิทักษ์วงษ์จินดา(เมียเสี่ยดุ๊ก)
DO $$
DECLARE
  cust_690643_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '142', '690643', 'สาขานี้จ่าย', 'รัชนี  พิทักษ์วงษ์จินดา(เมียเสี่ยดุ๊ก)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690643_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690643_id, 'กรุงไทย', '4161318642', 'รัชนี  พิทักษ์วงษ์จินดา(เมียเสี่ยดุ๊ก)', true);

END $$;

-- 690644: รัฐศาสตร์ รัตนโสภา(ลานสุวรรณ)   ชานุมาน
DO $$
DECLARE
  cust_690644_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '1750763126119', '690644', 'สาขานี้จ่าย', 'รัฐศาสตร์ รัตนโสภา(ลานสุวรรณ)   ชานุมาน',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690644_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690644_id, 'ไทยพาณิชย์', '5202478596', 'รัฐศาสตร์ รัตนโสภา(ลานสุวรรณ)   ชานุมาน', true);

END $$;

-- 690645: รัตนา ผางทอง(พ่อวิเชียร) ชานุมาน
DO $$
DECLARE
  cust_690645_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '177', '690645', 'สาขานี้จ่าย', 'รัตนา ผางทอง(พ่อวิเชียร) ชานุมาน',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690645_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690645_id, 'ธ.ก.ส.', '014772303658', 'รัตนา ผางทอง(พ่อวิเชียร) ชานุมาน', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690645_id, '0954213878');

END $$;

-- 690646: รัตนาภรณ์ รัตนสกล (แม่แก้ว) (แนน)
DO $$
DECLARE
  cust_690646_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '113', '690646', 'สาขานี้จ่าย', 'รัตนาภรณ์ รัตนสกล (แม่แก้ว) (แนน)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690646_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690646_id, 'ออมสิน', '020407065844', 'รัตนาภรณ์ รัตนสกล (แม่แก้ว) (แนน)', true);

END $$;

-- 690647: ลานน้องอ้อม
DO $$
DECLARE
  cust_690647_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '5', '690647', 'สาขานี้จ่าย', 'ลานน้องอ้อม',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690647_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690647_id, 'กสิกรไทย', '0691817946', 'ลานน้องอ้อม', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690647_id, '913500463');

END $$;

-- 690648: ลำไย แสนเจริญสุข(ออเจริญสุข)
DO $$
DECLARE
  cust_690648_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '128', '690648', 'สาขานี้จ่าย', 'ลำไย แสนเจริญสุข(ออเจริญสุข)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690648_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690648_id, 'กสิกรไทย', '1333134671', 'ลำไย แสนเจริญสุข(ออเจริญสุข)', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690648_id, '0895720541');

END $$;

-- 690649: วนิดา บูชายันต์(เจ๊อิ๋ว)
DO $$
DECLARE
  cust_690649_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '86', '690649', 'สาขานี้จ่าย', 'วนิดา บูชายันต์(เจ๊อิ๋ว)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690649_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690649_id, 'กสิกรไทย', '221751736', 'วนิดา บูชายันต์(เจ๊อิ๋ว)', true);

END $$;

-- 690650: วนิดา สมพร (มาซื้อแทนพรนภา)
DO $$
DECLARE
  cust_690650_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '1754291773174', '690650', 'สาขานี้จ่าย', 'วนิดา สมพร (มาซื้อแทนพรนภา)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690650_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690650_id, 'ธ.ก.ส.', '019658710953', 'วนิดา สมพร (มาซื้อแทนพรนภา)', true);

END $$;

-- 690651: วรพรต โคตะ (เสี่ยโดน)
DO $$
DECLARE
  cust_690651_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '21', '690651', 'สาขานี้จ่าย', 'วรพรต โคตะ (เสี่ยโดน)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690651_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690651_id, 'กรุงไทย', '3380415480', 'วรพรต โคตะ (เสี่ยโดน)', true);

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690651_id, 'ออมสิน', '020192651162', 'วรพรต โคตะ', false);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690651_id, '613532824');

END $$;

-- 690652: วรวุฒิ  ทองไทย (แม่วราภรณ์ ครูหมวย ย่าน้องบี)
DO $$
DECLARE
  cust_690652_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '130', '690652', 'สาขานี้จ่าย', 'วรวุฒิ  ทองไทย (แม่วราภรณ์ ครูหมวย ย่าน้องบี)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690652_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690652_id, 'ธ.ก.ส.', '016502565675', 'วรวุฒิ  ทองไทย (แม่วราภรณ์ ครูหมวย ย่าน้องบี)', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690652_id, '0640874627');

END $$;

-- 690653: วรัญญา แสงชมภู
DO $$
DECLARE
  cust_690653_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '39', '690653', 'สาขานี้จ่าย', 'วรัญญา แสงชมภู',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690653_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690653_id, 'กรุงเทพ', '4154085718', 'วรัญญา แสงชมภู', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690653_id, '981523851');

END $$;

-- 690654: วราภรณ์ แสวงผล  (ลานยางบ้านนาทอย) ไว้เติมเงิน
DO $$
DECLARE
  cust_690654_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '1754291773190', '690654', 'สาขานี้จ่าย', 'วราภรณ์ แสวงผล  (ลานยางบ้านนาทอย) ไว้เติมเงิน',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690654_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690654_id, 'กสิกรไทย', '0468036584', 'วราภรณ์ แสวงผล  (ลานยางบ้านนาทอย) ไว้เติมเงิน', true);

END $$;

-- 690655: วราภรภรณ์ รินทร(รุ้ง) ลานโนนสวรรค์โอนเงิน
DO $$
DECLARE
  cust_690655_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '1754291773188', '690655', 'สาขานี้จ่าย', 'วราภรภรณ์ รินทร(รุ้ง) ลานโนนสวรรค์โอนเงิน',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690655_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690655_id, 'ออมสิน', '020484447535', 'วราภรภรณ์ รินทร(รุ้ง) ลานโนนสวรรค์โอนเงิน', true);

END $$;

-- 690656: วันทอง พากเพียร (พ่อวันทอง)
DO $$
DECLARE
  cust_690656_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '20', '690656', 'สาขานี้จ่าย', 'วันทอง พากเพียร (พ่อวันทอง)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690656_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690656_id, 'ออมสิน', '020164597385', 'วันทอง พากเพียร (พ่อวันทอง)', true);

END $$;

-- 690657: วาทศิลป์ ล้านศรี(แจ็ค ลูก พ่อโฮม)
DO $$
DECLARE
  cust_690657_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '100', '690657', 'สาขานี้จ่าย', 'วาทศิลป์ ล้านศรี(แจ็ค ลูก พ่อโฮม)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690657_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690657_id, 'ออมสิน', '020325640306', 'วาทศิลป์ ล้านศรี(แจ็ค ลูก พ่อโฮม)', true);

END $$;

-- 690658: วารินี เคนโสภา
DO $$
DECLARE
  cust_690658_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '117', '690658', 'สาขานี้จ่าย', 'วารินี เคนโสภา',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690658_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690658_id, 'กรุงไทย', '6622080461', 'วารินี เคนโสภา', true);

END $$;

-- 690659: วาสนา อินทร์ทอง (เจ๊วาส)  หุ่งหลวงรุ่งเจริญ
DO $$
DECLARE
  cust_690659_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '16', '690659', 'สาขานี้จ่าย', 'วาสนา อินทร์ทอง (เจ๊วาส)  หุ่งหลวงรุ่งเจริญ',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690659_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690659_id, 'ออมสิน', '020177229885', 'วาสนา อินทร์ทอง (เจ๊วาส)  หุ่งหลวงรุ่งเจริญ', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690659_id, '864510344');

END $$;

-- 690660: วิชัย พงศนีย์(วิชัย)
DO $$
DECLARE
  cust_690660_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '145', '690660', 'สาขานี้จ่าย', 'วิชัย พงศนีย์(วิชัย)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690660_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690660_id, 'กสิกรไทย', '0368625256', 'วิชัย พงศนีย์(วิชัย)', true);

END $$;

-- 690661: วิมลรัตน์ โดงกูล(เจ๊อัน)
DO $$
DECLARE
  cust_690661_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '109', '690661', 'สาขานี้จ่าย', 'วิมลรัตน์ โดงกูล(เจ๊อัน)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690661_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690661_id, 'กรุงไทย', '8620526456', 'วิมลรัตน์ โดงกูล(เจ๊อัน)', true);

END $$;

-- 690662: ไวยากรณ์ เสียงเย็น(เจ๊ไว)
DO $$
DECLARE
  cust_690662_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '70', '690662', 'สาขานี้จ่าย', 'ไวยากรณ์ เสียงเย็น(เจ๊ไว)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690662_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690662_id, 'ไทยพาณิชย์', '4076288258', 'ไวยากรณ์ เสียงเย็น(เจ๊ไว)', true);

END $$;

-- 690663: ศดานนท์ สมพร (เสี่ยก๊อฟ)
DO $$
DECLARE
  cust_690663_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '44', '690663', 'สาขานี้จ่าย', 'ศดานนท์ สมพร (เสี่ยก๊อฟ)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690663_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690663_id, 'ทหารไทยธนชาต (ttb)', '3742769577', 'ศดานนท์ สมพร (เสี่ยก๊อฟ)', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690663_id, '611530634');

END $$;

-- 690664: ศราวุฒิ อุตราวัน(โอ๊กภูหล่น)
DO $$
DECLARE
  cust_690664_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '99', '690664', 'สาขานี้จ่าย', 'ศราวุฒิ อุตราวัน(โอ๊กภูหล่น)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690664_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690664_id, 'ออมสิน', '020392525810', 'ศราวุฒิ อุตราวัน(โอ๊กภูหล่น)', true);

END $$;

-- 690665: ศุภกร เนติวรวัฒน์(เสี่ยเอ)
DO $$
DECLARE
  cust_690665_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '69', '690665', 'สาขานี้จ่าย', 'ศุภกร เนติวรวัฒน์(เสี่ยเอ)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690665_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690665_id, 'กสิกรไทย', '6852072618', 'ศุภกร เนติวรวัฒน์(เสี่ยเอ)', true);

END $$;

-- 690666: สตี๊ฟ
DO $$
DECLARE
  cust_690666_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '4', '690666', 'สาขานี้จ่าย', 'สตี๊ฟ',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690666_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690666_id, 'ไทยพาณิชย์', '4320212810', 'สตี๊ฟ', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690666_id, '945687415');

END $$;

-- 690667: สมใจ มารักษ์(มีชัยการเกษตร)  ชานุมาน
DO $$
DECLARE
  cust_690667_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '170', '690667', 'สาขานี้จ่าย', 'สมใจ มารักษ์(มีชัยการเกษตร)  ชานุมาน',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690667_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690667_id, 'กสิกรไทย', '0508454457', 'สมใจ มารักษ์(มีชัยการเกษตร)  ชานุมาน', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690667_id, '0937726888');

END $$;

-- 690668: สมร ชุมพร
DO $$
DECLARE
  cust_690668_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '93', '690668', 'สาขานี้จ่าย', 'สมร ชุมพร',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690668_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690668_id, 'กสิกรไทย', '313883612', 'สมร ชุมพร', true);

END $$;

-- 690669: สม สายเสมา(ลานโตมร)  ชานมุมาน
DO $$
DECLARE
  cust_690669_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '1754291773186', '690669', 'สาขานี้จ่าย', 'สม สายเสมา(ลานโตมร)  ชานมุมาน',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690669_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690669_id, 'ออมสิน', '020446780296', 'สม สายเสมา(ลานโตมร)  ชานมุมาน', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690669_id, '0650700182');

END $$;

-- 690670: สรชัช ทองเกิด
DO $$
DECLARE
  cust_690670_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '127', '690670', 'สาขานี้จ่าย', 'สรชัช ทองเกิด',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690670_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690670_id, 'กสิกรไทย', '0343285671', 'สรชัช ทองเกิด', true);

END $$;

-- 690671: สรัญญา  รักเนตร (เสี่ยศักดิ์) (ทนงศักดิ์ วงค์ทองนิล (เสี่ยศักดิ์))
DO $$
DECLARE
  cust_690671_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '57', '690671', 'สาขานี้จ่าย', 'สรัญญา  รักเนตร (เสี่ยศักดิ์) (ทนงศักดิ์ วงค์ทองนิล (เสี่ยศักดิ์))',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690671_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690671_id, 'ออมสิน', '020390224093', 'สรัญญา  รักเนตร (เสี่ยศักดิ์) (ทนงศักดิ์ วงค์ทองนิล (เสี่ยศักดิ์))', true);

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690671_id, 'ธ.ก.ส.', '017508085051', 'สรัญญา  รักเนตร (เสี่ยศักดิ์)', false);

END $$;

-- 690672: สหกรณ์ดอนตาล(เจ๊พรดอนตาล)
DO $$
DECLARE
  cust_690672_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '179', '690672', 'สาขานี้จ่าย', 'สหกรณ์ดอนตาล(เจ๊พรดอนตาล)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690672_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690672_id, 'กรุงไทย', '4201401081', 'สหกรณ์ดอนตาล(เจ๊พรดอนตาล)', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690672_id, '0933242813');

END $$;

-- 690673: สายัญ แสนศิริปัญญา(ลานแสนศิริ)
DO $$
DECLARE
  cust_690673_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '1754291773168', '690673', 'สาขานี้จ่าย', 'สายัญ แสนศิริปัญญา(ลานแสนศิริ)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690673_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690673_id, 'กสิกรไทย', '0333925575', 'สายัญ แสนศิริปัญญา(ลานแสนศิริ)', true);

END $$;

-- 690674: สำราญ แก้วเนตร (เจ๊เมย์)
DO $$
DECLARE
  cust_690674_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '27', '690674', 'สาขานี้จ่าย', 'สำราญ แก้วเนตร (เจ๊เมย์)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690674_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690674_id, 'กรุงไทย', '3130898034', 'สำราญ แก้วเนตร (เจ๊เมย์)', true);

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690674_id, 'กสิกรไทย', '1992270329', 'ภัสราภรณ์ แก้วเนตร', false);

END $$;

-- 690675: สิริกาญจน์ ห่อรัตนาเรือง (สตีฟค่าทำงาน)
DO $$
DECLARE
  cust_690675_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '1754291773184', '690675', 'สาขานี้จ่าย', 'สิริกาญจน์ ห่อรัตนาเรือง (สตีฟค่าทำงาน)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690675_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690675_id, 'ไทยพาณิชย์', '4073991103', 'สิริกาญจน์ ห่อรัตนาเรือง (สตีฟค่าทำงาน)', true);

END $$;

-- 690676: สุชาติ ปะโมนะตา (นัท ลูก แม่จอย)
DO $$
DECLARE
  cust_690676_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '104', '690676', 'สาขานี้จ่าย', 'สุชาติ ปะโมนะตา (นัท ลูก แม่จอย)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690676_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690676_id, 'กรุงไทย', '6600079088', 'สุชาติ ปะโมนะตา (นัท ลูก แม่จอย)', true);

END $$;

-- 690677: สุธิพงษ์ หลักคำ
DO $$
DECLARE
  cust_690677_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '118', '690677', 'สาขานี้จ่าย', 'สุธิพงษ์ หลักคำ',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690677_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690677_id, 'กสิกรไทย', '478098847', 'สุธิพงษ์ หลักคำ', true);

END $$;

-- 690678: สุนทร สารคณา (เสี่ยทร)
DO $$
DECLARE
  cust_690678_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '153', '690678', 'สาขานี้จ่าย', 'สุนทร สารคณา (เสี่ยทร)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690678_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690678_id, 'กสิกรไทย', '1261765868', 'สุนทร สารคณา (เสี่ยทร)', true);

END $$;

-- 690679: สุบิน เจริญสุข(เจ๊จอย)(JS)
DO $$
DECLARE
  cust_690679_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '95', '690679', 'สาขานี้จ่าย', 'สุบิน เจริญสุข(เจ๊จอย)(JS)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690679_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690679_id, 'กสิกรไทย', '0171934656', 'สุบิน เจริญสุข(เจ๊จอย)(JS)', true);

END $$;

-- 690680: สุภาพร  พระสุรัตน์ (แม่ดอกแก้ว)
DO $$
DECLARE
  cust_690680_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '48', '690680', 'สาขานี้จ่าย', 'สุภาพร  พระสุรัตน์ (แม่ดอกแก้ว)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690680_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690680_id, 'กรุงไทย', '3380290475', 'สุภาพร  พระสุรัตน์ (แม่ดอกแก้ว)', true);

END $$;

-- 690681: สุมาลี แกัวกัญญา (เข็ม ซื้อยางบ้านไฮหย่อง)
DO $$
DECLARE
  cust_690681_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '1754291773164', '690681', 'สาขานี้จ่าย', 'สุมาลี แกัวกัญญา (เข็ม ซื้อยางบ้านไฮหย่อง)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690681_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690681_id, 'ธ.ก.ส.', '020235448543', 'สุมาลี แกัวกัญญา (เข็ม ซื้อยางบ้านไฮหย่อง)', true);

END $$;

-- 690682: สุรชัย  แสงเขตร(เสี่ยหมี) ลานบ้านพะเนียด
DO $$
DECLARE
  cust_690682_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '1754291773189', '690682', 'สาขานี้จ่าย', 'สุรชัย  แสงเขตร(เสี่ยหมี) ลานบ้านพะเนียด',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690682_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690682_id, 'กสิกรไทย', '0638452928', 'สุรชัย  แสงเขตร(เสี่ยหมี) ลานบ้านพะเนียด', true);

END $$;

-- 690683: สุรพล ไกรสินธุ์(เจ๊เมย์ มนัส)    ชานุมาน
DO $$
DECLARE
  cust_690683_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '165', '690683', 'สาขานี้จ่าย', 'สุรพล ไกรสินธุ์(เจ๊เมย์ มนัส)    ชานุมาน',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690683_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690683_id, 'ไทยพาณิชย์', '6522605463', 'สุรพล ไกรสินธุ์(เจ๊เมย์ มนัส)    ชานุมาน', true);

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690683_id, 'ออมสิน', '020330073824', 'มนัสวี ไกรสินธุ์(มนัส)', false);

END $$;

-- 690684: สุริยา ชมภูจันทร์ (สุริยา)
DO $$
DECLARE
  cust_690684_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '1754291773169', '690684', 'สาขานี้จ่าย', 'สุริยา ชมภูจันทร์ (สุริยา)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690684_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690684_id, 'กสิกรไทย', '1423784217', 'สุริยา ชมภูจันทร์ (สุริยา)', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690684_id, '0947078265');

END $$;

-- 690685: สุรีวรรณ ภูงอก (เจ๊หลิน)
DO $$
DECLARE
  cust_690685_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '30', '690685', 'สาขานี้จ่าย', 'สุรีวรรณ ภูงอก (เจ๊หลิน)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690685_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690685_id, 'ออมสิน', '020024180596', 'สุรีวรรณ ภูงอก (เจ๊หลิน)', true);

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690685_id, 'กสิกรไทย', '0251584524', 'คณพศ ดาวเรือง', false);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690685_id, '899316439');

END $$;

-- 690686: แสงอร่าม ยาตรา (เสี่ยหน่อย)
DO $$
DECLARE
  cust_690686_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '29', '690686', 'สาขานี้จ่าย', 'แสงอร่าม ยาตรา (เสี่ยหน่อย)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690686_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690686_id, 'กสิกรไทย', '1182801190', 'แสงอร่าม ยาตรา (เสี่ยหน่อย)', true);

END $$;

-- 690687: ไสว มีคำ(แสนสุข เจริญทรัพย์)
DO $$
DECLARE
  cust_690687_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '87', '690687', 'สาขานี้จ่าย', 'ไสว มีคำ(แสนสุข เจริญทรัพย์)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690687_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690687_id, 'กสิกรไทย', '1182771364', 'ไสว มีคำ(แสนสุข เจริญทรัพย์)', true);

END $$;

-- 690688: หนูเพียร ผ่องศรี(หนูเพียร)
DO $$
DECLARE
  cust_690688_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '94', '690688', 'สาขานี้จ่าย', 'หนูเพียร ผ่องศรี(หนูเพียร)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690688_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690688_id, 'กสิกรไทย', '228777188', 'หนูเพียร ผ่องศรี(หนูเพียร)', true);

END $$;

-- 690689: หนูรำพันธ์ โลหะกุล (พ่อสำลี) (แม่หนู) ป่ากุงใหญ่
DO $$
DECLARE
  cust_690689_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '46', '690689', 'สาขานี้จ่าย', 'หนูรำพันธ์ โลหะกุล (พ่อสำลี) (แม่หนู) ป่ากุงใหญ่',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690689_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690689_id, 'กสิกรไทย', '1651542126', 'หนูรำพันธ์ โลหะกุล (พ่อสำลี) (แม่หนู) ป่ากุงใหญ่', true);

END $$;

-- 690690: อณุวัฒน์ บุปผาวงศ์(เสี่ยต้อม) ชานุมาน
DO $$
DECLARE
  cust_690690_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '171', '690690', 'สาขานี้จ่าย', 'อณุวัฒน์ บุปผาวงศ์(เสี่ยต้อม) ชานุมาน',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690690_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690690_id, 'ออมสิน', '020291027033', 'อณุวัฒน์ บุปผาวงศ์(เสี่ยต้อม) ชานุมาน', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690690_id, '0649853927');

END $$;

-- 690691: อดุล เจริญทัศน์(เสี่ยเข่ง)
DO $$
DECLARE
  cust_690691_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '92', '690691', 'สาขานี้จ่าย', 'อดุล เจริญทัศน์(เสี่ยเข่ง)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690691_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690691_id, 'กสิกรไทย', '0403814423', 'อดุล เจริญทัศน์(เสี่ยเข่ง)', true);

END $$;

-- 690692: อดุลย์ วรรณคำ (วาสนา ยางพารา)
DO $$
DECLARE
  cust_690692_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '101', '690692', 'สาขานี้จ่าย', 'อดุลย์ วรรณคำ (วาสนา ยางพารา)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690692_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690692_id, 'กสิกรไทย', '1992265791', 'อดุลย์ วรรณคำ (วาสนา ยางพารา)', true);

END $$;

-- 690693: อนงค์ วงฤทธิ์ (เจ๊นงค์)
DO $$
DECLARE
  cust_690693_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '42', '690693', 'สาขานี้จ่าย', 'อนงค์ วงฤทธิ์ (เจ๊นงค์)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690693_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690693_id, 'กสิกรไทย', '6852294300', 'อนงค์ วงฤทธิ์ (เจ๊นงค์)', true);

END $$;

-- 690694: อนุรัก พิมพ์พันธ์(เจ๊ชู) ชานุมาน
DO $$
DECLARE
  cust_690694_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '176', '690694', 'สาขานี้จ่าย', 'อนุรัก พิมพ์พันธ์(เจ๊ชู) ชานุมาน',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690694_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690694_id, 'ธ.ก.ส.', '020241598422', 'อนุรัก พิมพ์พันธ์(เจ๊ชู) ชานุมาน', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690694_id, '0637407598');

END $$;

-- 690695: อนุสรณ์ สายแก้ว
DO $$
DECLARE
  cust_690695_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '17', '690695', 'สาขานี้จ่าย', 'อนุสรณ์ สายแก้ว',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690695_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690695_id, 'กรุงเทพ', '3334277609', 'อนุสรณ์ สายแก้ว', true);

END $$;

-- 690696: อนุสรณ์ สุมาลุ(ทอฝัน) ลูกค้าดงแถบ
DO $$
DECLARE
  cust_690696_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '122', '690696', 'สาขานี้จ่าย', 'อนุสรณ์ สุมาลุ(ทอฝัน) ลูกค้าดงแถบ',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690696_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690696_id, 'ออมสิน', '020459818132', 'อนุสรณ์ สุมาลุ(ทอฝัน) ลูกค้าดงแถบ', true);

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690696_id, 'กสิกรไทย', '1371152527', 'อนุสรณ์ สุมาลุ,หนิง', false);

END $$;

-- 690697: อพินใจ คนไว(แม่อ๋อย)
DO $$
DECLARE
  cust_690697_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '154', '690697', 'สาขานี้จ่าย', 'อพินใจ คนไว(แม่อ๋อย)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690697_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690697_id, 'ออมสิน', '051161006138', 'อพินใจ คนไว(แม่อ๋อย)', true);

END $$;

-- 690698: อภิรดี ผิวทน
DO $$
DECLARE
  cust_690698_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '51', '690698', 'สาขานี้จ่าย', 'อภิรดี ผิวทน',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690698_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690698_id, 'กสิกรไทย', '073714885', 'อภิรดี ผิวทน', true);

END $$;

-- 690699: อรนิตย์  สุภากรณ์ (น้าอี๊ด ประมูลยางบ้านคำน้ำแซง เดชอุดม)
DO $$
DECLARE
  cust_690699_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '1754291773171', '690699', 'สาขานี้จ่าย', 'อรนิตย์  สุภากรณ์ (น้าอี๊ด ประมูลยางบ้านคำน้ำแซง เดชอุดม)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690699_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690699_id, 'กรุงไทย', '8490893306', 'อรนิตย์  สุภากรณ์ (น้าอี๊ด ประมูลยางบ้านคำน้ำแซง เดชอุดม)', true);

END $$;

-- 690700: อรรถพล คงพิรัตน์
DO $$
DECLARE
  cust_690700_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '110', '690700', 'สาขานี้จ่าย', 'อรรถพล คงพิรัตน์',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690700_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690700_id, 'กรุงเทพ', '4447209877', 'อรรถพล คงพิรัตน์', true);

END $$;

-- 690701: อรัญชญา นามฮุง(นิค เจ๊วัน)   ชานุมาน
DO $$
DECLARE
  cust_690701_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '59', '690701', 'สาขานี้จ่าย', 'อรัญชญา นามฮุง(นิค เจ๊วัน)   ชานุมาน',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690701_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690701_id, 'กรุงไทย', '6631345901', 'อรัญชญา นามฮุง(นิค เจ๊วัน)   ชานุมาน', true);

END $$;

-- 690702: อาพร สีหา(อาพร)
DO $$
DECLARE
  cust_690702_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '124', '690702', 'สาขานี้จ่าย', 'อาพร สีหา(อาพร)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690702_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690702_id, 'กรุงไทย', '3380431745', 'อาพร สีหา(อาพร)', true);

END $$;

-- 690703: อิสระ วรรณทวี
DO $$
DECLARE
  cust_690703_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '32', '690703', 'สาขานี้จ่าย', 'อิสระ วรรณทวี',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690703_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690703_id, 'กรุงไทย', '8620452991', 'อิสระ วรรณทวี', true);

END $$;

-- 690704: อึ่ง ละมัย
DO $$
DECLARE
  cust_690704_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '114', '690704', 'สาขานี้จ่าย', 'อึ่ง ละมัย',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690704_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690704_id, 'กสิกรไทย', '708484946', 'อึ่ง ละมัย', true);

END $$;

-- 690705: อุบล จินะศรี (เจ๊บน)
DO $$
DECLARE
  cust_690705_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '61', '690705', 'สาขานี้จ่าย', 'อุบล จินะศรี (เจ๊บน)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690705_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690705_id, 'กสิกรไทย', '‘0973752278', 'อุบล จินะศรี (เจ๊บน)', true);

END $$;

-- 690706: เอกยางพารา(เสี่ยเอก)
DO $$
DECLARE
  cust_690706_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '11', '690706', 'สาขานี้จ่าย', 'เอกยางพารา(เสี่ยเอก)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690706_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690706_id, 'ไทยพาณิชย์', '4081225033', 'เอกยางพารา(เสี่ยเอก)', true);

  INSERT INTO public.customer_contacts (customer_id, phone)
  VALUES (cust_690706_id, '898429589');

END $$;

-- 690707: เอกสิทธิ์ (ออย,แม็ก) อภิณัฐดา คงคูณ
DO $$
DECLARE
  cust_690707_id uuid;
BEGIN
  INSERT INTO public.customers (
    legacy_rec_id, legacy_member_id, class, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '52', '690707', 'สาขานี้จ่าย', 'เอกสิทธิ์ (ออย,แม็ก) อภิณัฐดา คงคูณ',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO cust_690707_id;

  INSERT INTO public.customer_bank_accounts (customer_id, bank_name, account_number, account_name, is_primary)
  VALUES (cust_690707_id, 'ธ.ก.ส.', '020217339645', 'เอกสิทธิ์ (ออย,แม็ก) อภิณัฐดา คงคูณ', true);

END $$;


-- ═══════════════════════════════════════════════════════════
-- PART 2: INSERT TRANSPORT VEHICLES (28 records, legacy_member_id 690001+, เรียง ก-ฮ)
-- ═══════════════════════════════════════════════════════════

-- TV 690001: จิรโชติ นนท์ศิริ(พ่วงจิรโชติ)
DO $$
DECLARE
  tv_690001_id uuid;
BEGIN
  INSERT INTO public.transport_staffs (
    legacy_rec_id, legacy_member_id, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    'DT-13', '690001', 'จิรโชติ นนท์ศิริ(พ่วงจิรโชติ)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO tv_690001_id;

  INSERT INTO public.transport_staff_bank_accounts (staff_id, bank_name, account_number, account_name, is_primary)
  VALUES (tv_690001_id, 'กรุงไทย', '8490142548', 'จิรโชติ นนท์ศิริ(พ่วงจิรโชติ)', true);

END $$;

-- TV 690002: ไชยทิตย์ ทุมรัตน์(พ่วงไชยทิตย์)
DO $$
DECLARE
  tv_690002_id uuid;
BEGIN
  INSERT INTO public.transport_staffs (
    legacy_rec_id, legacy_member_id, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '97', '690002', 'ไชยทิตย์ ทุมรัตน์(พ่วงไชยทิตย์)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO tv_690002_id;

  INSERT INTO public.transport_staff_bank_accounts (staff_id, bank_name, account_number, account_name, is_primary)
  VALUES (tv_690002_id, 'กสิกรไทย', '6642270166', 'ไชยทิตย์ ทุมรัตน์(พ่วงไชยทิตย์)', true);

END $$;

-- TV 690003: เดชาเสมอใจ
DO $$
DECLARE
  tv_690003_id uuid;
BEGIN
  INSERT INTO public.transport_staffs (
    legacy_rec_id, legacy_member_id, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    'DT-25', '690003', 'เดชาเสมอใจ',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO tv_690003_id;

  INSERT INTO public.transport_staff_bank_accounts (staff_id, bank_name, account_number, account_name, is_primary)
  VALUES (tv_690003_id, 'กรุงเทพ', '5140282830', 'เดชาเสมอใจ', true);

END $$;

-- TV 690004: ถาวร พุ่มจันทร์ (พ่วงโยธิน)
DO $$
DECLARE
  tv_690004_id uuid;
BEGIN
  INSERT INTO public.transport_staffs (
    legacy_rec_id, legacy_member_id, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '77', '690004', 'ถาวร พุ่มจันทร์ (พ่วงโยธิน)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO tv_690004_id;

  INSERT INTO public.transport_staff_bank_accounts (staff_id, bank_name, account_number, account_name, is_primary)
  VALUES (tv_690004_id, 'กรุงศรีอยุธยา', '791561076', 'ถาวร พุ่มจันทร์ (พ่วงโยธิน)', true);

END $$;

-- TV 690005: นายจักรชัย รุ่งชลชวลิต(น้ำมันคนส่ง)
DO $$
DECLARE
  tv_690005_id uuid;
BEGIN
  INSERT INTO public.transport_staffs (
    legacy_rec_id, legacy_member_id, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    'DT-29', '690005', 'นายจักรชัย รุ่งชลชวลิต(น้ำมันคนส่ง)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO tv_690005_id;

  INSERT INTO public.transport_staff_bank_accounts (staff_id, bank_name, account_number, account_name, is_primary)
  VALUES (tv_690005_id, 'กรุงเทพ', '4154139770', 'นายจักรชัย รุ่งชลชวลิต(น้ำมันคนส่ง)', true);

END $$;

-- TV 690006: นายไมตรี ภูสีดิน(พ่วงไมตรี)
DO $$
DECLARE
  tv_690006_id uuid;
BEGIN
  INSERT INTO public.transport_staffs (
    legacy_rec_id, legacy_member_id, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    'DT-11', '690006', 'นายไมตรี ภูสีดิน(พ่วงไมตรี)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO tv_690006_id;

  INSERT INTO public.transport_staff_bank_accounts (staff_id, bank_name, account_number, account_name, is_primary)
  VALUES (tv_690006_id, 'กสิกรไทย', '1028785697', 'นายไมตรี ภูสีดิน(พ่วงไมตรี)', true);

END $$;

-- TV 690007: ปกังกร ลวดชัยภูมิ (พ่วงไปร์นก)
DO $$
DECLARE
  tv_690007_id uuid;
BEGIN
  INSERT INTO public.transport_staffs (
    legacy_rec_id, legacy_member_id, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    'DT-17', '690007', 'ปกังกร ลวดชัยภูมิ (พ่วงไปร์นก)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO tv_690007_id;

  INSERT INTO public.transport_staff_bank_accounts (staff_id, bank_name, account_number, account_name, is_primary)
  VALUES (tv_690007_id, 'กสิกรไทย', '2572695975', 'ปกังกร ลวดชัยภูมิ (พ่วงไปร์นก)', true);

END $$;

-- TV 690008: พ่วงพันทิพา
DO $$
DECLARE
  tv_690008_id uuid;
BEGIN
  INSERT INTO public.transport_staffs (
    legacy_rec_id, legacy_member_id, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '126', '690008', 'พ่วงพันทิพา',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO tv_690008_id;

  INSERT INTO public.transport_staff_bank_accounts (staff_id, bank_name, account_number, account_name, is_primary)
  VALUES (tv_690008_id, 'กสิกรไทย', '1682485880', 'พ่วงพันทิพา', true);

  INSERT INTO public.transport_staff_contacts (staff_id, phone)
  VALUES (tv_690008_id, '0984927949');

END $$;

-- TV 690009: ภูมิใจ ธนอิสสโร(พ่วงภูมิใจ)
DO $$
DECLARE
  tv_690009_id uuid;
BEGIN
  INSERT INTO public.transport_staffs (
    legacy_rec_id, legacy_member_id, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '106', '690009', 'ภูมิใจ ธนอิสสโร(พ่วงภูมิใจ)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO tv_690009_id;

  INSERT INTO public.transport_staff_bank_accounts (staff_id, bank_name, account_number, account_name, is_primary)
  VALUES (tv_690009_id, 'กสิกรไทย', '8652043411', 'ภูมิใจ ธนอิสสโร(พ่วงภูมิใจ)', true);

END $$;

-- TV 690010: มณิศรา ตาทอง(แม่ตุ๊)
DO $$
DECLARE
  tv_690010_id uuid;
BEGIN
  INSERT INTO public.transport_staffs (
    legacy_rec_id, legacy_member_id, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    'DT-19', '690010', 'มณิศรา ตาทอง(แม่ตุ๊)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO tv_690010_id;

  INSERT INTO public.transport_staff_bank_accounts (staff_id, bank_name, account_number, account_name, is_primary)
  VALUES (tv_690010_id, 'กสิกรไทย', '0053500285', 'มณิศรา ตาทอง(แม่ตุ๊)', true);

END $$;

-- TV 690011: มนัส  สาระวารี  (พ่วงบังซีส)
DO $$
DECLARE
  tv_690011_id uuid;
BEGIN
  INSERT INTO public.transport_staffs (
    legacy_rec_id, legacy_member_id, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '81', '690011', 'มนัส  สาระวารี  (พ่วงบังซีส)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO tv_690011_id;

  INSERT INTO public.transport_staff_bank_accounts (staff_id, bank_name, account_number, account_name, is_primary)
  VALUES (tv_690011_id, 'กสิกรไทย', '523251341', 'มนัส  สาระวารี  (พ่วงบังซีส)', true);

END $$;

-- TV 690012: รัตติกุล งามเลิศ (ก๊อฟ สหายโดโด้)
DO $$
DECLARE
  tv_690012_id uuid;
BEGIN
  INSERT INTO public.transport_staffs (
    legacy_rec_id, legacy_member_id, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    'DT-30', '690012', 'รัตติกุล งามเลิศ (ก๊อฟ สหายโดโด้)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO tv_690012_id;

  INSERT INTO public.transport_staff_bank_accounts (staff_id, bank_name, account_number, account_name, is_primary)
  VALUES (tv_690012_id, 'ไทยพาณิชย์', '4231130486', 'รัตติกุล งามเลิศ (ก๊อฟ สหายโดโด้)', true);

END $$;

-- TV 690013: วราสิทธิ์ สมบัติ(พ่วงโต้งน้ำยืน)
DO $$
DECLARE
  tv_690013_id uuid;
BEGIN
  INSERT INTO public.transport_staffs (
    legacy_rec_id, legacy_member_id, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    'DT-12', '690013', 'วราสิทธิ์ สมบัติ(พ่วงโต้งน้ำยืน)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO tv_690013_id;

  INSERT INTO public.transport_staff_bank_accounts (staff_id, bank_name, account_number, account_name, is_primary)
  VALUES (tv_690013_id, 'กสิกรไทย', '3662528411', 'วราสิทธิ์ สมบัติ(พ่วงโต้งน้ำยืน)', true);

END $$;

-- TV 690014: วาสนา รอดนัคเรศน์(พ่วงบังทอย)
DO $$
DECLARE
  tv_690014_id uuid;
BEGIN
  INSERT INTO public.transport_staffs (
    legacy_rec_id, legacy_member_id, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    'DT-23', '690014', 'วาสนา รอดนัคเรศน์(พ่วงบังทอย)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO tv_690014_id;

  INSERT INTO public.transport_staff_bank_accounts (staff_id, bank_name, account_number, account_name, is_primary)
  VALUES (tv_690014_id, 'กสิกรไทย', '0093344170', 'วาสนา รอดนัคเรศน์(พ่วงบังทอย)', true);

END $$;

-- TV 690015: วีรเดช ดุจตา(วีรเดช) พ่อใหญ่เตี้ย
DO $$
DECLARE
  tv_690015_id uuid;
BEGIN
  INSERT INTO public.transport_staffs (
    legacy_rec_id, legacy_member_id, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    'DT-18', '690015', 'วีรเดช ดุจตา(วีรเดช) พ่อใหญ่เตี้ย',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO tv_690015_id;

  INSERT INTO public.transport_staff_bank_accounts (staff_id, bank_name, account_number, account_name, is_primary)
  VALUES (tv_690015_id, 'กสิกรไทย', '0268941959', 'วีรเดช ดุจตา(วีรเดช) พ่อใหญ่เตี้ย', true);

END $$;

-- TV 690016: สมพร จันทรา (พ่วงสมพร)
DO $$
DECLARE
  tv_690016_id uuid;
BEGIN
  INSERT INTO public.transport_staffs (
    legacy_rec_id, legacy_member_id, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    'DT-27', '690016', 'สมพร จันทรา (พ่วงสมพร)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO tv_690016_id;

  INSERT INTO public.transport_staff_bank_accounts (staff_id, bank_name, account_number, account_name, is_primary)
  VALUES (tv_690016_id, 'กสิกรไทย', '1943599080', 'สมพร จันทรา (พ่วงสมพร)', true);

END $$;

-- TV 690017: สมัคร   แก้วสำโรง (พ่วงสมัคร)
DO $$
DECLARE
  tv_690017_id uuid;
BEGIN
  INSERT INTO public.transport_staffs (
    legacy_rec_id, legacy_member_id, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '78', '690017', 'สมัคร   แก้วสำโรง (พ่วงสมัคร)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO tv_690017_id;

  INSERT INTO public.transport_staff_bank_accounts (staff_id, bank_name, account_number, account_name, is_primary)
  VALUES (tv_690017_id, 'กรุงไทย', '4230155573', 'สมัคร   แก้วสำโรง (พ่วงสมัคร)', true);

END $$;

-- TV 690018: สำรวย
DO $$
DECLARE
  tv_690018_id uuid;
BEGIN
  INSERT INTO public.transport_staffs (
    legacy_rec_id, legacy_member_id, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    'DT-21', '690018', 'สำรวย',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO tv_690018_id;

  INSERT INTO public.transport_staff_bank_accounts (staff_id, bank_name, account_number, account_name, is_primary)
  VALUES (tv_690018_id, 'กสิกรไทย', '0798241168', 'สำรวย', true);

END $$;

-- TV 690019: สำราญ เสาเวียง
DO $$
DECLARE
  tv_690019_id uuid;
BEGIN
  INSERT INTO public.transport_staffs (
    legacy_rec_id, legacy_member_id, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    'DT-20', '690019', 'สำราญ เสาเวียง',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO tv_690019_id;

  INSERT INTO public.transport_staff_bank_accounts (staff_id, bank_name, account_number, account_name, is_primary)
  VALUES (tv_690019_id, 'กสิกรไทย', '4452185488', 'สำราญ เสาเวียง', true);

END $$;

-- TV 690020: สิทธิพร ฉู้วงศ์ (พ่วงแก๊ป)
DO $$
DECLARE
  tv_690020_id uuid;
BEGIN
  INSERT INTO public.transport_staffs (
    legacy_rec_id, legacy_member_id, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    'DT-15', '690020', 'สิทธิพร ฉู้วงศ์ (พ่วงแก๊ป)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO tv_690020_id;

  INSERT INTO public.transport_staff_bank_accounts (staff_id, bank_name, account_number, account_name, is_primary)
  VALUES (tv_690020_id, 'ไทยพาณิชย์', '4064716061', 'สิทธิพร ฉู้วงศ์ (พ่วงแก๊ป)', true);

END $$;

-- TV 690021: สุกัญญา ลวดชัยภูมิ(พ่วงนก)
DO $$
DECLARE
  tv_690021_id uuid;
BEGIN
  INSERT INTO public.transport_staffs (
    legacy_rec_id, legacy_member_id, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '89', '690021', 'สุกัญญา ลวดชัยภูมิ(พ่วงนก)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO tv_690021_id;

  INSERT INTO public.transport_staff_bank_accounts (staff_id, bank_name, account_number, account_name, is_primary)
  VALUES (tv_690021_id, 'กรุงไทย', '6612954558', 'สุกัญญา ลวดชัยภูมิ(พ่วงนก)', true);

END $$;

-- TV 690022: สุมาลี แซ่ฮ้อ (บังทอย)
DO $$
DECLARE
  tv_690022_id uuid;
BEGIN
  INSERT INTO public.transport_staffs (
    legacy_rec_id, legacy_member_id, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    'DT-28', '690022', 'สุมาลี แซ่ฮ้อ (บังทอย)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO tv_690022_id;

  INSERT INTO public.transport_staff_bank_accounts (staff_id, bank_name, account_number, account_name, is_primary)
  VALUES (tv_690022_id, 'ไทยพาณิชย์', '4015424285', 'สุมาลี แซ่ฮ้อ (บังทอย)', true);

END $$;

-- TV 690023: เสน่ห์ ผันสำโรง (พ่วงเสน่ห์)
DO $$
DECLARE
  tv_690023_id uuid;
BEGIN
  INSERT INTO public.transport_staffs (
    legacy_rec_id, legacy_member_id, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    'DT-16', '690023', 'เสน่ห์ ผันสำโรง (พ่วงเสน่ห์)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO tv_690023_id;

  INSERT INTO public.transport_staff_bank_accounts (staff_id, bank_name, account_number, account_name, is_primary)
  VALUES (tv_690023_id, 'ทหารไทยธนชาต (ttb)', '3037795782', 'เสน่ห์ ผันสำโรง (พ่วงเสน่ห์)', true);

END $$;

-- TV 690024: หงส์ทองแก้วกมลรัตน์ ไมตรี
DO $$
DECLARE
  tv_690024_id uuid;
BEGIN
  INSERT INTO public.transport_staffs (
    legacy_rec_id, legacy_member_id, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    'DT-22', '690024', 'หงส์ทองแก้วกมลรัตน์ ไมตรี',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO tv_690024_id;

  INSERT INTO public.transport_staff_bank_accounts (staff_id, bank_name, account_number, account_name, is_primary)
  VALUES (tv_690024_id, 'กรุงไทย', '4960751096', 'หงส์ทองแก้วกมลรัตน์ ไมตรี', true);

END $$;

-- TV 690025: อนนท์  ปลอดทุกข์ (พ่วงบาส)
DO $$
DECLARE
  tv_690025_id uuid;
BEGIN
  INSERT INTO public.transport_staffs (
    legacy_rec_id, legacy_member_id, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '75', '690025', 'อนนท์  ปลอดทุกข์ (พ่วงบาส)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO tv_690025_id;

  INSERT INTO public.transport_staff_bank_accounts (staff_id, bank_name, account_number, account_name, is_primary)
  VALUES (tv_690025_id, 'กรุงไทย', '670057983', 'อนนท์  ปลอดทุกข์ (พ่วงบาส)', true);

END $$;

-- TV 690026: อมรเทพ โลจิสติกส์ (พ่วงน้องหนุ่ม)
DO $$
DECLARE
  tv_690026_id uuid;
BEGIN
  INSERT INTO public.transport_staffs (
    legacy_rec_id, legacy_member_id, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    '74', '690026', 'อมรเทพ โลจิสติกส์ (พ่วงน้องหนุ่ม)',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO tv_690026_id;

  INSERT INTO public.transport_staff_bank_accounts (staff_id, bank_name, account_number, account_name, is_primary)
  VALUES (tv_690026_id, 'กสิกรไทย', '0718323398', 'อมรเทพ โลจิสติกส์ (พ่วงน้องหนุ่ม)', true);

END $$;

-- TV 690027: เอกชัย เจริญผล,ลุงโต่ง
DO $$
DECLARE
  tv_690027_id uuid;
BEGIN
  INSERT INTO public.transport_staffs (
    legacy_rec_id, legacy_member_id, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    'DT-14', '690027', 'เอกชัย เจริญผล,ลุงโต่ง',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO tv_690027_id;

  INSERT INTO public.transport_staff_bank_accounts (staff_id, bank_name, account_number, account_name, is_primary)
  VALUES (tv_690027_id, 'กสิกรไทย', '0371335587', 'เอกชัย เจริญผล,ลุงโต่ง', true);

END $$;

-- TV 690028: โอ๊ต
DO $$
DECLARE
  tv_690028_id uuid;
BEGIN
  INSERT INTO public.transport_staffs (
    legacy_rec_id, legacy_member_id, main_name,
    sync_status, record_status, revision_no,
    created_by_name, created_by_phone, created_at
  ) VALUES (
    'DT-5', '690028', 'โอ๊ต',
    'synced', 'active', 0,
    'ระบบนำเข้า', '0000000000', now()
  ) RETURNING id INTO tv_690028_id;

  INSERT INTO public.transport_staff_bank_accounts (staff_id, bank_name, account_number, account_name, is_primary)
  VALUES (tv_690028_id, 'กสิกรไทย', '1008557965', 'โอ๊ต', true);

END $$;

COMMIT;

