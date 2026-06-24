# Implementation Plan: LanFlow Auth System (3 เฟส)

## สรุปภาพรวม

แบ่งงานเป็น 3 เฟส โดย **เฟส 1 ไม่กระทบโค้ดเดิมเลย** (zero breaking changes):

```mermaid
graph LR
    P1["เฟส 1: Login PWA"] --> P2["เฟส 2: Auth API + Offline"] --> P3["เฟส 3: Admin Panel"]
    style P1 fill:#2f6b4f,color:#fff
    style P2 fill:#316b83,color:#fff
    style P3 fill:#6b5231,color:#fff
```

## Open Questions

> [!IMPORTANT]
> **Q1: ใครเป็นคนสร้างบัญชีให้พนักงาน?**
> - **Option A:** super_admin สร้างให้ (ปลอดภัยกว่า — ไม่มีคนแปลกปลอมเข้ามา)
> - **Option B:** พนักงานสมัครเอง แล้ว admin อนุมัติ
> - **Plan ปัจจุบัน:** ทำ `/api/auth/register` ไว้ แต่ lock ให้เฉพาะ super_admin เรียกได้ตอนแรก

> [!IMPORTANT]
> **Q2: ลืมรหัสผ่าน ทำยังไง?**
> - **Option A:** super_admin reset ให้ผ่าน Admin Panel
> - **Option B:** ส่ง OTP ทาง SMS (ต้องเพิ่ม SMS provider ภายหลัง)
> - **Plan ปัจจุบัน:** ทำ Option A ก่อน

> [!IMPORTANT]
> **Q3: JWT token หมดอายุเท่าไหร่?**
> - **Plan:** 7 วัน (เหมาะกับ PWA offline) + refresh ตอน reconnect

---

## เฟส 1: ระบบ Login สำหรับ PWA

> [!NOTE]
> **หลักการ:** เพิ่มระบบ login แยกออกมาต่างหาก API เดิมทุกตัวยังวิ่งผ่าน `service_role` เหมือนเดิม ไม่กระทบผู้ใช้ปัจจุบัน

### Dependencies ที่ต้องเพิ่ม

| Package | หน้าที่ | ทำไมถึงเลือก |
|---|---|---|
| `jose` | สร้าง/ตรวจสอบ JWT | ใช้ได้ทั้ง Edge Runtime + Node.js, ไม่ต้องพึ่ง native modules เหมือน `jsonwebtoken` |
| `bcryptjs` | Hash/verify password | Pure JS — ไม่ต้อง compile native binary, ทำงานบน Vercel ได้ |

---

### Database

#### [NEW] [20260624000000_auth_password_functions.sql](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/supabase/migrations/20260624000000_auth_password_functions.sql)

สร้าง SQL functions สำหรับ hash/verify password ฝั่ง DB (backup — หลักใช้ bcryptjs ฝั่ง Node):
```sql
-- ฟังก์ชัน hash password ด้วย pgcrypto (ใช้เป็น fallback)
CREATE OR REPLACE FUNCTION public.hash_password(raw_password text)
RETURNS text AS $$
  SELECT crypt(raw_password, gen_salt('bf', 10))
$$ LANGUAGE sql;

-- ฟังก์ชัน verify password
CREATE OR REPLACE FUNCTION public.verify_password(raw_password text, hashed text)
RETURNS boolean AS $$
  SELECT crypt(raw_password, hashed) = hashed
$$ LANGUAGE sql;

-- ตั้ง password ให้ super_admin (dev) ไว้ทดสอบ
UPDATE public.profiles
SET password_hash = crypt('admin1234', gen_salt('bf', 10))
WHERE phone = '0800000000' AND password_hash IS NULL;
```

---

### Backend — Auth Library

#### [NEW] [auth.ts](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/lib/server/auth.ts)

Core auth library:
- `hashPassword(raw)` → bcryptjs hash
- `verifyPassword(raw, hash)` → boolean
- `signToken(payload)` → JWT string (7 วัน) ด้วย `jose`
- `verifyToken(token)` → payload หรือ null
- `getTokenFromRequest(req)` → อ่าน JWT จาก `Authorization: Bearer` header

Payload ของ JWT:
```typescript
{
  sub: string;      // profile.id
  phone: string;    // profile.phone
  name: string;     // profile.name
  role: AppRole;    // "user" | "admin" | "super_admin"
  locationIds: string[]; // สาขาที่เข้าถึงได้
  iat: number;
  exp: number;
}
```

ENV ที่ต้องเพิ่มใน `.env.local`:
```
LANFLOW_JWT_SECRET=<random 64 char string>
```

---

### Backend — API Routes

#### [NEW] [/api/auth/login/route.ts](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/app/api/auth/login/route.ts)

```
POST /api/auth/login
Body: { phone: string, password: string }
Response: { token: string, profile: Profile }
Error: 401 { error: "เบอร์โทรหรือรหัสผ่านไม่ถูกต้อง" }
```

ขั้นตอน:
1. Query `profiles` by phone (ใช้ service_role)
2. ตรวจ `is_active`
3. `bcrypt.compare(password, password_hash)`
4. Query `user_locations` เพื่อดึง locationIds
5. สร้าง JWT ด้วย `signToken()`
6. Return `{ token, profile }`

#### [NEW] [/api/auth/register/route.ts](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/app/api/auth/register/route.ts)

```
POST /api/auth/register
Headers: Authorization: Bearer <admin-jwt>
Body: { phone: string, name: string, password: string }
Response: { profile: Profile }
Error: 403 ถ้าไม่ใช่ super_admin/admin
```

> [!WARNING]
> Register ถูก lock ไว้ — ต้องเป็น admin/super_admin ที่ login แล้วถึงเรียกได้

#### [NEW] [/api/auth/me/route.ts](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/app/api/auth/me/route.ts)

```
GET /api/auth/me
Headers: Authorization: Bearer <jwt>
Response: { profile: Profile, locationIds: string[] }
```

ใช้ตอน app เปิดขึ้นมา → ตรวจว่า token ยังใช้ได้ไหม + ดึงข้อมูล profile ล่าสุด

#### [NEW] [/api/auth/refresh/route.ts](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/app/api/auth/refresh/route.ts)

```
POST /api/auth/refresh
Headers: Authorization: Bearer <old-jwt>
Response: { token: string } (JWT ใหม่ อายุ 7 วัน)
Error: 401 ถ้า token หมดอายุเกิน grace period
```

---

### Frontend — Auth Context

#### [NEW] [AuthProvider.tsx](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/components/AuthProvider.tsx)

React Context ที่จัดการ auth state:
```typescript
type AuthState = {
  token: string | null;
  profile: Profile | null;
  isLoading: boolean;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => void;
};
```

**เก็บ token ใน LocalStorage** key = `lanflow:auth-token`:
- PWA Service Worker อ่านได้
- ปิดแอปเปิดใหม่ยังอยู่
- Offline ก็เข้าแอปได้ (token อ่านจาก local)

#### [NEW] [useAuth.ts](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/hooks/use-auth.ts)

Hook `useAuth()` ที่ return auth state + helpers:
- ตอน mount → อ่าน token จาก LocalStorage → เรียก `/api/auth/me` ตรวจสอบ
- ถ้า online + token ใกล้หมดอายุ → เรียก `/api/auth/refresh`
- ถ้า offline → ใช้ token เดิมที่เก็บไว้ + profile จาก LocalStorage cache

---

### Frontend — Login Page

#### [NEW] [/login/page.tsx](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/app/login/page.tsx)

หน้า Login UI:
- เบอร์โทร input (type="tel", pattern สำหรับเบอร์ไทย)
- รหัสผ่าน input (type="password", show/hide toggle)
- ปุ่ม "เข้าสู่ระบบ" 
- Error message แสดงเมื่อ login ไม่ผ่าน
- Logo LanFlow + สีเขียว theme เดียวกับแอป
- Responsive สำหรับมือถือ

Design แนว: พื้นหลัง gradient เขียวอ่อน → เข้ม, card กลางจอ, glassmorphism

---

### Frontend — Middleware (Route Guard)

#### [NEW] [middleware.ts](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/middleware.ts)

> [!IMPORTANT]
> **ใช้ Next.js Middleware** (runs on Edge) เพื่อดัก request ก่อนเข้า page

Logic:
1. ถ้า path = `/login` หรือ `/api/auth/*` → ปล่อยผ่าน
2. ถ้า path = `/api/*` (API อื่นๆ) → ปล่อยผ่าน (เฟส 1 ยังใช้ service_role)
3. ถ้า path = `/` (หน้าหลัก) → ตรวจ cookie `lanflow-token` หรือ header
4. ถ้าไม่มี token → redirect ไป `/login`
5. ถ้ามี token → verify JWT → ถ้าหมดอายุ redirect ไป `/login`

> [!NOTE]
> **สำหรับ PWA:** Middleware ทำงานเฉพาะ server-side เท่านั้น ตอน offline จะไม่ถูกเรียก (Service Worker serve cached page) — ดังนั้น client-side ต้องตรวจ token ด้วย AuthProvider อีกชั้น

---

### Modification — Layout

#### [MODIFY] [layout.tsx](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/app/layout.tsx)

ครอบ `<AuthProvider>` รอบ children

#### [MODIFY] [page.tsx](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/app/page.tsx)

เพิ่ม auth guard → ถ้ายังไม่ login redirect ไป `/login`

#### [MODIFY] [LanFlowApp.tsx](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/components/LanFlowApp.tsx)

- รับ `profile` จาก AuthProvider แทน hardcoded demo profile
- แสดง logout button ที่ header
- เก็บ `token` ไว้ส่งไปกับ API calls (เตรียมสำหรับเฟส 2)

---

### ผังไฟล์เฟส 1

```
src/
├── app/
│   ├── login/
│   │   └── page.tsx                    [NEW] Login page UI
│   ├── api/
│   │   └── auth/
│   │       ├── login/route.ts          [NEW] POST login
│   │       ├── register/route.ts       [NEW] POST register (admin only)
│   │       ├── me/route.ts             [NEW] GET verify token
│   │       └── refresh/route.ts        [NEW] POST refresh token
│   ├── layout.tsx                      [MODIFY] wrap AuthProvider
│   └── page.tsx                        [MODIFY] auth guard
├── components/
│   ├── AuthProvider.tsx                [NEW] Auth context
│   └── LanFlowApp.tsx                  [MODIFY] use auth profile
├── hooks/
│   └── use-auth.ts                     [NEW] Auth hook
├── lib/
│   └── server/
│       └── auth.ts                     [NEW] JWT + bcrypt helpers
└── middleware.ts                       [NEW] Route guard

supabase/migrations/
└── 20260624000000_auth_password_functions.sql   [NEW]

.env.local
└── LANFLOW_JWT_SECRET=...              [NEW]
```

---

## เฟส 2: เชื่อม Token เข้า Offline Queue & API

> [!WARNING]
> **เริ่มเฟส 2 ได้หลังเฟส 1 เสถียรแล้วเท่านั้น** (login ใช้งานจริงได้ ไม่มี bug)

### ขั้นตอนการย้าย API (ทีละ route — ไม่ใช่ Big Bang)

**ลำดับที่แนะนำ:**
1. `GET /api/lanflow` (อ่านข้อมูลหลัก) — ย้ายก่อนเพื่อทดสอบ
2. `POST /api/lanflow/rubber-bills` — ตารางที่ใช้มากสุด
3. ตามด้วย `income-expense`, `customers`, `transport-staffs`
4. สุดท้าย `money-transfers`, `ocr-tickets`

### ที่ต้องแก้ไข

#### [MODIFY] [lanflow-db.ts](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/lib/server/lanflow-db.ts)

- เพิ่ม function `getAuthenticatedClient(token: string)` ที่สร้าง Supabase client ด้วย JWT token แทน service_role
- คง `getAdminClient()` ไว้สำหรับ route ที่ยังไม่ย้าย
- แต่ละฟังก์ชันรับ optional `token` parameter — ถ้ามี ใช้ authenticated client, ถ้าไม่มี ใช้ admin client (backward compatible)

#### [NEW] RLS migrations สำหรับตารางใหม่

- `transport_staffs` + child tables
- `ocr_tickets`
- `money_transfers` + child tables

เพิ่ม policies แบบเดียวกับ `rubber_bills`:
```sql
CREATE POLICY "transport_staffs scoped" ON transport_staffs
  FOR SELECT USING (public.can_access_location(location_id));
```

#### [MODIFY] [use-offline-queue.ts](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/hooks/use-offline-queue.ts)

- ยอมให้ enqueue ได้แม้ token หมดอายุ (เก็บไว้ใน LocalStorage)
- เพิ่ม `flush()` function: เมื่อ online + token valid → ส่ง queue items ทั้งหมด
- เพิ่ม reconnect handler: `online` event → refresh token → flush queue

#### [MODIFY] ทุก API route

แต่ละ route ที่ย้ายแล้ว:
1. อ่าน JWT จาก `Authorization` header
2. ส่ง token ให้ `lanflow-db` functions
3. ถ้าไม่มี token → return 401

---

## เฟส 3: Admin Panel

> [!NOTE]
> เมื่อเฟส 1+2 เสถียร ระบบจะรู้ทันทีว่า "ใครเป็นคนกดปุ่ม" จาก JWT

### ที่ต้องทำ

#### [MODIFY] AdminPanel ใน LanFlowApp.tsx

เพิ่ม 3 sections:

**Section 1: จัดการสมาชิก**
- ตารางแสดงรายชื่อ profiles ทั้งหมด (phone, name, role, is_active)
- ปุ่ม "เพิ่มสมาชิก" → เรียก `/api/auth/register`
- ปุ่ม "เลื่อนเป็น admin" / "ลดเป็น user"
- ปุ่ม "ปิดใช้งาน" (set is_active = false)
- ปุ่ม "รีเซ็ตรหัสผ่าน"

**Section 2: จัดการสาขา**
- ตารางแสดง locations (มีอยู่แล้ว — เพิ่มปุ่ม edit/deactivate)

**Section 3: กำหนดสมาชิกดูแลสาขา**
- เลือกสมาชิก → ติ๊ก multi-select สาขา → บันทึกลง `user_locations`
- แสดง matrix: สมาชิก × สาขา

#### [NEW] API routes สำหรับ Admin

- `GET /api/admin/profiles` — list all profiles (super_admin only)
- `PATCH /api/admin/profiles/[id]` — update role, is_active, reset password
- `GET /api/admin/user-locations` — list assignments
- `POST /api/admin/user-locations` — assign user to locations
- `DELETE /api/admin/user-locations/[id]` — remove assignment

---

## Verification Plan

### เฟส 1
1. **Build test:** `npx next build` ผ่านไม่มี error
2. **Login flow:** เปิด `/login` → ใส่เบอร์ `0800000000` + รหัส `admin1234` → redirect ไป `/`
3. **Token persistence:** ปิดแท็บ → เปิดใหม่ → ยังอยู่ในระบบ
4. **Guard:** ลบ token จาก LocalStorage → refresh → เด้งไป `/login`
5. **Offline:** เปิดแอปขณะ offline → ยังเข้าได้ (token จาก localStorage)
6. **Existing features:** ทุกฟีเจอร์เดิม (บิลยาง, ลูกค้า, โอนเงิน) ยังทำงานเหมือนเดิม

### เฟส 2
1. ย้าย `GET /api/lanflow` → ลองเข้าโดยไม่มี token → ได้ 401
2. ย้าย `POST /api/lanflow/rubber-bills` → เพิ่มบิลยังได้
3. ทดสอบ offline → เพิ่มบิล → reconnect → ตรวจว่า sync สำเร็จ

### เฟส 3
1. Login เป็น super_admin → เห็น Admin Panel ครบ
2. สร้างสมาชิกใหม่ → login ด้วยสมาชิกใหม่ → เห็นเฉพาะสาขาที่กำหนด
3. ลอง login เป็น user ปกติ → ไม่เห็นหน้า Admin
