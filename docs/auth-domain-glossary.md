# LanFlow Authentication Domain Glossary

เอกสารนี้กำหนดภาษากลางของระบบหลังย้ายไป Supabase Auth เพื่อไม่ให้คำว่า user, profile, role และ session ถูกใช้ปนกัน

## Core entities

### Auth User

แถวใน `auth.users` ที่ Supabase Auth ดูแล

รับผิดชอบ:

- identifier สำหรับล็อกอิน เช่น phone
- password hash
- session และ refresh token
- MFA identities
- Auth audit events

ไม่ใช่แหล่งข้อมูลหลักของชื่อพนักงาน สิทธิ์ธุรกิจ หรือสาขาที่ดูแล

### Profile

แถวใน `public.profiles` ที่แทน “บุคลากรใน LanFlow”

รับผิดชอบ:

- ชื่อที่แสดงในระบบ
- role ของธุรกิจ
- `is_active`
- attributes ของพนักงาน

Invariant:

```text
profiles.id = auth.users.id
```

### Role

ระดับสิทธิ์กว้างของผู้ใช้:

- `user`: ทำงานประจำวันในสาขาที่ได้รับมอบหมาย
- `admin`: จัดการผู้ใช้/การมอบหมายตามขอบเขตที่กำหนด
- `super_admin`: จัดการทั้งระบบ

Role ไม่แทน branch access ผู้ใช้ role เดียวกันอาจเห็นคนละสาขา

### Location

หน่วยแบ่งข้อมูลหลักของ LanFlow เช่น ลานหรือสาขา

record ที่เป็นของสาขาต้องมี `location_id` หรือมีความสัมพันธ์ที่สืบกลับไปยัง location ได้

### User Location Assignment

แถวใน `public.user_locations` ที่เชื่อม Profile กับ Location

เป็น source of truth ว่าผู้ใช้เข้าถึงสาขาใดได้ ไม่ควรถือรายการจาก client หรือ JWT เป็นข้อเท็จจริงสุดท้าย

### Session

Supabase Auth session ประกอบด้วย access token และ refresh token

Session พิสูจน์ว่า request มาจาก Auth User ใด แต่ไม่ได้ให้สิทธิ์เข้าถึงทุกข้อมูล สิทธิ์สุดท้ายต้องผ่าน RLS

### Authorization Context

ข้อมูลที่ใช้ตัดสินสิทธิ์ ณ เวลาที่ query:

- `auth.uid()`
- `profiles.is_active`
- `profiles.role`
- `user_locations`
- location ของ record เป้าหมาย

Authorization Context ต้อง derive ฝั่ง database/server ไม่รับจาก request body

### Service Role Client

Supabase client ที่ bypass RLS

ถือเป็น privileged infrastructure capability ไม่ใช่ client ปกติของ API route

การใช้ทุกครั้งต้องตอบได้ว่า:

1. เหตุใด user-scoped client ทำงานนี้ไม่ได้
2. ตรวจ authorization ก่อนเข้าถึง service role ที่จุดใด
3. มี audit log หรือไม่

### Offline Workspace

ข้อมูลและ state ที่เก็บบนอุปกรณ์เพื่อให้แอปทำงานได้เมื่อไม่มี network

Offline Workspace ไม่ได้พิสูจน์ว่าสิทธิ์บน server ยังมีอยู่

LanFlow อนุญาตเปิด Offline Workspace ได้สูงสุด 7 วันนับจากการยืนยันออนไลน์ครั้งล่าสุด
และต้อง partition cache ตาม Auth User ID

### Offline Mutation

คำสั่งเปลี่ยนข้อมูลที่สร้างตอน offline และรอ sync

ต้องมี:

- idempotency key
- actor/profile ID ที่ใช้แสดงผล
- target location
- client timestamps
- revision/conflict metadata

เมื่อ sync ต้องใช้ session ปัจจุบันและผ่าน RLS ใหม่

## Domain events

### User Provisioned

สร้าง Auth User และ Profile สำเร็จ พร้อมสถานะเริ่มต้นและการมอบหมายสาขา

### User Deactivated

ตั้ง `profiles.is_active=false`

ผลที่คาดหวัง:

- query ใหม่ทั้งหมดถูก RLS ปฏิเสธ
- refresh/session continuation ถูกปฏิเสธตามนโยบาย
- offline cache อาจยังอยู่บนอุปกรณ์จนกว่าจะ reconnect หรือ local lock ทำงาน

### Role Changed

เปลี่ยน `profiles.role`

ต้องมีผลกับ database query ใหม่ทันทีโดยไม่รอ JWT refresh

### Location Assigned

เพิ่ม `user_locations`

ผู้ใช้เข้าถึงข้อมูลสาขานั้นได้หลัง transaction commit

### Location Revoked

ลบ `user_locations`

query ใหม่และ offline sync ของสาขานั้นต้องถูกปฏิเสธทันที

### Session Revoked

ยุติ refresh token/session ใน Supabase Auth

ต่างจาก User Deactivated: การ deactivate เป็น business authorization ส่วน session revocation เป็น identity/session control

### Offline Mutation Rejected

server ปฏิเสธ mutation ที่สร้างตอน offline เพราะ:

- session หมดอายุ
- ผู้ใช้ถูก deactivate
- ถูกถอนสาขา
- record revision ใหม่กว่า
- policy ไม่อนุญาต operation

client ต้องเก็บข้อมูลไว้ให้ผู้ใช้แก้ conflict ห้ามทิ้งเงียบๆ

## Authorization invariants

1. ทุก active Profile ต้องมี Auth User ที่ UUID เดียวกัน
2. `is_active=false` ต้องทำให้ user-scoped database operation ทั้งหมดล้มเหลว
3. User data operation ห้ามใช้ service role เป็นค่าเริ่มต้น
4. Client ห้ามกำหนด actor identity ที่ server เชื่อโดยตรง
5. Role และ location assignment มี source of truth เดียวใน database
6. Location-scoped record ต้องไม่กลายเป็น global เพราะ field เป็น `NULL` โดยบังเอิญ
7. การ update ห้ามย้าย record ไป location ที่ไม่มีสิทธิ์
8. Child record ต้อง inherit authorization จาก parent
9. Offline mutation ทุกชิ้นต้อง re-authorize ตอน sync
10. มี `super_admin` ได้หนึ่งคนตาม business rule ปัจจุบัน และการเปลี่ยน role นี้ต้องเป็น privileged operation

## Bounded contexts

### Identity

Supabase Auth, credentials, sessions, MFA, password recovery

### Workforce

Profiles, roles, active status, admin provisioning

### Branch Access

Locations, user-location assignments, branch-scoped RLS

### Operations

Rubber bills, income/expense, OCR, transfers, customers และ transport staff

### Offline Sync

Queue, idempotency, optimistic concurrency, conflict resolution

### Integrations

Google Drive, OCR providers และ privileged background work

การแยก bounded context นี้ทำให้ “ล็อกอินสำเร็จ” ไม่ถูกตีความว่า “มีสิทธิ์ทำทุก operation”
