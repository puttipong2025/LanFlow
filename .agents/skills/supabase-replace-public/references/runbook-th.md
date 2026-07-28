# Runbook: แทนที่ Supabase Cloud `public` โดยรักษา Auth

## สิ่งที่ workflow นี้ทำ

- replay migration ทั้งหมดจาก `supabase/migrations`
- รักษา Supabase Auth เดิม: users, identities, sessions และ refresh tokens
- รักษา `profiles`, `locations` และ `user_locations` เดิมของ Cloud
- แทนที่ลูกค้า ขนส่ง และพนักงานบน Cloud ด้วยข้อมูล local
- ล้างบิลยางและธุรกรรม seed
- ตรวจ count และ full-row hash หลังทำงาน

## สิ่งที่ต้องมี

`.env.production.local` ต้องมี:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_DB_PASSWORD`

เครื่องต้องมี Docker, local Supabase database container, Supabase CLI และ migration ที่ต้องการ deploy

ค่า Session Pooler เริ่มต้นของโปรเจกต์:

```text
host: aws-1-ap-south-1.pooler.supabase.com
port: 5432
user: postgres.<project-ref>
database: postgres
sslmode: require
```

เปลี่ยนด้วย `-Region`, `-PoolerIndex` หรือ `-PoolerHost` เมื่อโปรเจกต์ย้าย region

## คำสั่ง

ตรวจอย่างเดียว:

```powershell
& ".agents\skills\supabase-replace-public\scripts\replace-public-cloud.ps1" -Mode Preflight
```

สำรองอย่างเดียว:

```powershell
& ".agents\skills\supabase-replace-public\scripts\replace-public-cloud.ps1" -Mode Backup
```

ทำครบทุกขั้น:

```powershell
& ".agents\skills\supabase-replace-public\scripts\replace-public-cloud.ps1" `
  -Mode All `
  -ConfirmProjectRef "psxwhhwjmolqperxrlzj"
```

## ไฟล์ backup

- `auth-schema.sql`
- `auth-data.sql`
- `auth-data-restorable.sql`
- `public-schema.sql`
- `public-data.sql`
- `auth-bridge-data.sql`
- `local-master-data.sql`
- `migration-history.sql`
- `manifest.json`

`auth-data-restorable.sql` ตัดเฉพาะ COPY block ของ `auth.schema_migrations` ออก เพราะ connection ปกติอ่านได้แต่เขียนตารางนี้ไม่ได้ ข้อมูล Auth ตารางอื่นยังอยู่ครบ

## Recovery

หากหยุดหลัง reset ให้ใช้ backup เดิม:

```powershell
$script = ".agents\skills\supabase-replace-public\scripts\replace-public-cloud.ps1"
$backup = "C:\path\to\lanflow-cloud-before-public-replace-YYYYMMDD-HHMMSS"
$ref = "psxwhhwjmolqperxrlzj"

& $script -Mode RestoreAuth -BackupDirectory $backup -ConfirmProjectRef $ref
& $script -Mode RestorePublic -BackupDirectory $backup -ConfirmProjectRef $ref
& $script -Mode Verify -BackupDirectory $backup
```

ถ้า Auth บน Cloud ไม่ว่าง:

- hash ตรง manifest: ข้าม restore ได้
- hash ไม่ตรง: สคริปต์หยุด ห้าม truncate Auth เอง

## Master data ที่แทนที่

- `customers`
- `customer_contacts`
- `customer_bank_accounts`
- `customer_farms`
- `transport_staffs`
- `transport_staff_contacts`
- `transport_staff_bank_accounts`
- `transport_staff_plates`

## Gate สำเร็จ

- Auth และ profile/location bridge full-row hash ตรง backup
- master data full-row hash ตรง local dump
- migration count/latest ตรง local ก่อน reset
- public tables เปิด RLS ทุกตาราง
- `rubber_bills`, `rubber_bill_items`, `rubber_exports`, `report_batches` และ `money_transfers` เป็นศูนย์

## ข้อห้าม

- ห้าม reset ก่อน backup และ hash gate
- ห้ามพิมพ์ password หรือ URL ที่ฝัง password
- ห้าม pipe SQL dump ขนาดใหญ่เข้า `psql`
- ห้ามลบ backup อัตโนมัติ
- ห้าม commit backup, `.env*` หรือ `playwright/.auth`
- ห้ามตรวจเฉพาะ count ต้องตรวจ full-row hash
