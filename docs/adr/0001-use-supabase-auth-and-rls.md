# ADR-0001: ย้าย LanFlow ไปใช้ Supabase Auth และบังคับสิทธิ์ด้วย RLS

- Status: Proposed
- Date: 2026-06-24
- Owners: LanFlow team
- Decision scope: Authentication, session management, authorization, branch isolation, offline sync

## Context

LanFlow ใช้ Supabase PostgreSQL อยู่แล้ว แต่ระบบยืนยันตัวตนปัจจุบันสร้าง JWT เอง:

- ค้นผู้ใช้จาก `public.profiles`
- ตรวจ `password_hash` ด้วย bcrypt
- สร้าง JWT อายุ 7 วันด้วย `jose`
- ใส่ `role` และ `locationIds` ลง token
- เก็บ token ใน `localStorage` และ cookie ที่ JavaScript เขียนได้
- API ตรวจ token แล้วใช้ `SUPABASE_SERVICE_ROLE_KEY` อ่าน/เขียนฐานข้อมูล

โครงสร้างนี้พิสูจน์ตัวตนได้ แต่ database ไม่เห็นผู้ใช้ Supabase Auth จึงบังคับ RLS ไม่ได้ใน request จริง การแยกข้อมูลสาขาจึงขึ้นกับว่าแต่ละ API route จำได้หรือไม่ว่าต้องตรวจ `locationId`

จากการตรวจโค้ดพบว่ามี route หลายจุดที่รับ `locationId` หรือ record ID จาก client แล้วทำงานผ่าน service role โดยไม่มี branch authorization และ `GET /api/lanflow` อ่านข้อมูลหลายตารางโดยไม่จำกัดสาขา

## Decision

### 1. ใช้ Supabase Auth เป็น identity provider

ใช้ phone + password ใน UX เดิม โดย normalize เบอร์เป็น E.164 แล้วแปลงเป็น email alias ภายในรูปแบบ
`66xxxxxxxxx@phone.lanflow.invalid` ก่อนเรียก Supabase Auth วิธีนี้ทำให้ไม่ต้องเปิด SMS provider
ขณะที่ credentials, password hash และ session ยังคงอยู่ใน Supabase Auth

การเปิด self-signup จะปิดไว้โดยปริยาย ระบบเป็น internal business application และผู้ใช้ที่ยังไม่มีสาขาไม่ควรสร้างบัญชีเองได้ การสร้างบัญชีทำผ่าน admin provisioning flow

### 2. รักษา UUID เดิม

สร้าง `auth.users` โดยกำหนด:

```text
auth.users.id = public.profiles.id
```

ผลคือ foreign key เดิม เช่น `created_by_user_id -> profiles.id` ไม่ต้อง rewrite และ RLS ใช้ `auth.uid()` เทียบกับ `profiles.id` ได้ตรงๆ

Supabase Auth client ที่ติดตั้งในโปรเจกต์รองรับ `AdminUserAttributes.id` และ `password_hash` รวมถึง bcrypt จึงย้าย hash เดิมได้โดยไม่ต้องรู้ plaintext และไม่บังคับ reset password ทันที

หลัง cutover ให้เพิ่ม foreign key จาก `profiles.id` ไป `auth.users.id` แบบ `NOT VALID` แล้ว validate หลังตรวจ orphan records

### 3. ให้ฐานข้อมูลเป็น source of truth ของ authorization

เก็บข้อมูลต่อไปนี้ใน relational tables:

- `profiles.role`
- `profiles.is_active`
- `user_locations`

ไม่ใส่ `locationIds` ลง custom claim เพราะ:

- รายการสาขาเปลี่ยนได้บ่อย
- token อาจค้างจน refresh
- จำนวนสาขาทำให้ JWT โต
- RLS สามารถตรวจ `user_locations` โดยตรง

ในระยะแรกไม่จำเป็นต้องใส่ `role` ลง custom claimเช่นกัน RLS อ่าน role จาก `profiles` เพื่อให้การลดสิทธิ์และปิดบัญชีมีผลทันทีทุก query

Custom Access Token Hook พิจารณาได้ภายหลังเมื่อมีหลักฐานว่าการ lookup role เป็นคอขวด และต้องยอมรับ semantics ว่าสิทธิ์ใน claim อาจค้างจน token ถูกออกใหม่

### 4. ใช้ request-scoped Supabase client

แยก client เป็นสามชนิด:

1. Browser client สำหรับ sign-in, sign-out และ auth state
2. Server client ที่อ่าน session จาก cookie สำหรับ Server Components และ Route Handlers
3. Admin client สำหรับ provisioning/recovery jobs เท่านั้น

ทุก operation ที่ทำในนามผู้ใช้ต้องใช้ server client ที่มี Supabase access token ของผู้ใช้ เพื่อให้ RLS ทำงาน

ห้ามให้ domain CRUD เรียก `getAdminClient()` โดยตรง

Service role อนุญาตเฉพาะ:

- สร้าง/แก้ Supabase Auth user หลังตรวจสิทธิ์ super admin แล้ว
- migration และ maintenance job
- integration ที่จำเป็นต้องมี privileged access และมี authorization guard แยกชัดเจน

### 5. คง Next.js API routes ในเฟสแรก

ยังไม่ย้าย CRUD ทั้งหมดไปเรียก Supabase จาก browser โดยตรง เพราะ API ปัจจุบันมี:

- offline idempotency
- optimistic locking บางส่วน
- child-table orchestration
- Google Drive และ OCR integrations
- audit/sync event creation

Route Handlers จะยังเป็น application layer แต่เปลี่ยนจาก service-role data access เป็น user-scoped data access

### 6. Session ใช้ `@supabase/ssr`

ใช้ cookie-based session และ refresh rotation ของ Supabase Auth แทน custom JWT/localStorage token

Server-side route protection ต้อง validate token ด้วย `getClaims()` หรือ `getUser()` ตามความต้องการด้าน revocation ห้ามเชื่อเพียงค่าจาก cookie หรือ `getSession()` บน server

Supabase SSR ต้องให้ browser client เข้าถึง refresh token จึงไม่ใช้แนวคิด “HttpOnly-only cookie” เป็น requirement หลัก การลดความเสี่ยง XSS ทำด้วย:

- Content Security Policy
- ห้าม render untrusted HTML
- dependency hygiene
- short-lived access token
- refresh-token rotation
- RLS ที่จำกัดผลกระทบของ session ที่ถูกขโมย

### 7. Offline mode ไม่ใช่ server authorization

เมื่อ offline ผู้ใช้สามารถ:

- เปิด cached UI ตามนโยบายอุปกรณ์
- อ่านข้อมูลที่ cache ไว้บนอุปกรณ์
- สร้าง mutation ลง offline queue

แต่ mutation ทุกชิ้นต้องถูกยืนยันสิทธิ์ใหม่ด้วย session ปัจจุบันและ RLS ตอน sync หากถูกถอดสิทธิ์ระหว่าง offline ให้ server ปฏิเสธและ client แสดง conflict/re-auth state

ห้ามใช้ token อายุยาวเพื่ออนุญาต server operation โดยไม่ revalidate

กำหนด offline authorization window สูงสุด **7 วัน** นับจากการยืนยันกับ server สำเร็จครั้งล่าสุด:

- ภายใน 7 วัน เปิด cached workspace และสร้าง offline mutation ได้
- เกิน 7 วันต้อง online และยืนยัน session ใหม่ก่อนเปิด workspace
- queue ไม่ถูกทิ้งเมื่อครบ 7 วัน แต่ถูกล็อกไว้จนกว่าจะ re-authenticate
- service worker ห้าม cache authenticated API response; cache ข้อมูลต้องแยกด้วย user ID

## Required database changes

1. เปลี่ยน `current_profile_id()` ให้ใช้ `auth.uid()`
2. เขียน helper เช่น `is_active_user()`, `is_super_admin()`, `can_access_location(uuid)` เป็น `SECURITY DEFINER`
3. กำหนด `SET search_path = ''` และอ้าง schema เต็มทุกจุด
4. revoke execute จาก `public`; grant เฉพาะ role ที่ต้องใช้
5. grant `SELECT/INSERT/UPDATE/DELETE` ที่จำเป็นให้ `authenticated`
6. ตรวจและแก้ policy ที่อนุญาต `location_id IS NULL`
7. เพิ่ม policy ให้ครบทุก operation ที่แอปใช้
8. เพิ่ม policy สำหรับ admin ที่แยก:
   - super admin: จัดการทุกบัญชี/สาขา
   - admin: จัดการได้เฉพาะสาขาที่ตัวเองดูแล หากยืนยันกติกานี้
9. ให้ actor columns ใช้ `auth.uid()` หรือค่าจาก trusted server context ไม่รับชื่อ/เบอร์ผู้ทำรายการจาก client เป็นหลักฐาน

## Consequences

### Positive

- Database บังคับ branch isolation แม้ API route เขียนพลาด
- ปิดบัญชีและถอนสาขามีผลกับ query ใหม่ทันที
- ไม่ต้องดูแล password hashing, JWT signing และ refresh logic เอง
- รองรับ password policy, rate limits, session rotation, MFA และ audit ของ Auth
- bcrypt hash และ UUID เดิมย้ายได้

### Negative

- ต้อง refactor `lanflow-db.ts` จำนวนมากให้รับ user-scoped client
- RLS เดิมยังใช้จริงไม่ได้ทันที ต้องแก้ recursion, grants และ policy coverage ก่อน
- offline UX ต้องแยกจากความหมายของ authenticated server session
- phone/password ต้องจัดการ E.164 และความเสี่ยงเบอร์โทรถูก recycle
- password recovery แบบ self-service ต้องมี SMS provider หรือเปลี่ยนไปใช้ email

## Alternatives considered

### เก็บ custom JWT แล้วเพิ่ม if-check ทุก API

ไม่เลือก เพราะ correctness ขึ้นกับทุก route และทุก future change ขณะที่ service role bypass RLS

### ใช้ Supabase Auth แต่ API ยังใช้ service role

ไม่เลือกเป็น target state เพราะเปลี่ยนเฉพาะ authentication แต่ไม่แก้ branch isolation

### ใส่ role และ location IDs ทั้งหมดใน custom claims

ไม่เลือกในเฟสแรก เพราะ privilege revocation ไม่ทันทีและ location list อาจทำให้ token โต

### ให้ browser เรียก Supabase CRUD โดยตรงทั้งหมด

ไม่เลือกในเฟสแรกเพราะกระทบ offline orchestration และ integrations มากเกินไป แต่เป็นทางเลือกในอนาคตสำหรับ query ที่เรียบง่าย

## Decision gates still open

1. ยืนยันว่าจะปิด self-registration และใช้ admin provisioning หรือไม่
2. จะใช้ phone + password ต่อ หรือย้าย identifier เป็น email
3. ถ้าใช้ phone: จะซื้อ SMS provider เพื่อ recovery/MFA หรือใช้ admin reset
4. `admin` จัดการผู้ใช้ได้ทุกสาขาหรือเฉพาะสาขาที่ตัวเองดูแล
5. record ที่ `location_id/default_location_id IS NULL` หมายถึงข้อมูลส่วนกลางจริงหรือเป็นข้อมูลไม่สมบูรณ์
6. offline บนอุปกรณ์ shared device ต้องมี local PIN/lock เพิ่มหรือไม่
7. ต้อง revoke session ทันทีเมื่อ `is_active=false` หรือยอมให้ access token เดิมอยู่ได้ไม่เกินอายุ token

## References

- [Supabase password auth with phone](https://supabase.com/docs/guides/auth/passwords)
- [Supabase SSR client and cookie sessions](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs)
- [Supabase SSR advanced guide](https://supabase.com/docs/guides/auth/server-side/advanced-guide)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase custom claims and RBAC](https://supabase.com/docs/guides/api/custom-claims-and-role-based-access-control-rbac)
