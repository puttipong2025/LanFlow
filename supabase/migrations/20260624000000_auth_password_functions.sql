-- Auth password functions + seed super_admin password
-- ใช้ pgcrypto ที่ enable ไว้แล้วใน lanflow_schema.sql

-- ฟังก์ชัน hash password
CREATE OR REPLACE FUNCTION public.hash_password(raw_password text)
RETURNS text
LANGUAGE sql
AS $$
  SELECT crypt(raw_password, gen_salt('bf', 10))
$$;

-- ฟังก์ชัน verify password
CREATE OR REPLACE FUNCTION public.verify_password(raw_password text, hashed text)
RETURNS boolean
LANGUAGE sql
AS $$
  SELECT crypt(raw_password, hashed) = hashed
$$;

-- ตั้ง password ให้ super_admin (dev) ไว้ทดสอบ: admin1234
UPDATE public.profiles
SET password_hash = crypt('admin1234', gen_salt('bf', 10))
WHERE phone = '0800000000' AND password_hash IS NULL;
