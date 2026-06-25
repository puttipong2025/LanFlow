# 🔐 สถาปัตยกรรมระบบ Authentication ของ LanFlow

เอกสารนี้สรุปเทคโนโลยี โครงสร้างข้อมูล และการทำงานของระบบยืนยันตัวตน (Authentication) และการจัดการสิทธิ์ (Authorization) ที่ถูกนำมาใช้ในโปรเจกต์ LanFlow ณ ปัจจุบัน

---

## 🛠️ 1. เทคโนโลยีที่ใช้ (Tech Stack)

ระบบ Auth ของ LanFlow ถูกออกแบบมาให้รองรับ **Offline-first PWA** และการทำงานร่วมกับ **Next.js Server/Client Components** โดยใช้เทคโนโลยีดังนี้:

1. **Supabase Auth (Native Phone Provider)**: ใช้เป็นระบบจัดการผู้ใช้หลัก ล็อกอินด้วยเบอร์โทรศัพท์ (E.164) และรหัสผ่าน
2. **Supabase PostgreSQL & RLS**: ใช้ Row Level Security (RLS) เพื่อป้องกันการเข้าถึงข้อมูลข้ามสาขาในระดับ Database
3. **`@supabase/ssr`**: จัดการ Session ผ่าน Cookie อย่างปลอดภัย เพื่อให้ใช้งานร่วมกับ Next.js Middleware และ Server Components ได้
4. **Local Storage + Offline Queue**: เก็บ Profile ข้อมูลพื้นฐานในเครื่อง เพื่อให้แอปยังเปิดขึ้นมาทำงานได้ในโหมดออฟไลน์
5. **Next.js Middleware**: ทำหน้าที่เป็นยามเฝ้าประตู (Gatekeeper) ตรวจสอบ Supabase Session Token หากไม่มีจะเด้งไปหน้า `/login`
6. **React Context (`AuthProvider`)**: จัดการ State การล็อกอินบนฝั่ง Client และเชื่อมต่อ Real-time Auth State Changes ของ Supabase

---

## 🗄️ 2. โครงสร้างข้อมูล (Data Structure)

ข้อมูลผู้ใช้ถูกบริหารจัดการหลักๆ โดย Supabase Auth (`auth.users`) แต่จะมีตารางเสริมเก็บสิทธิ์เพิ่มเติม:

### 1. `profiles` (ตารางพนักงาน/ผู้ใช้เสริม)
เก็บข้อมูลส่วนตัวของพนักงานและสิทธิ์ของแต่ละคน (ทำงานคู่ขนานกับ `auth.users`)

| Column | Type | Detail |
|---|---|---|
| `id` | `uuid` (PK) | รหัสผู้ใช้ (ตรงกับ `auth.users.id`) |
| `phone` | `text` (Unique) | เบอร์โทรศัพท์ (เพื่อการแสดงผลหรือค้นหา) |
| `name` | `text` | ชื่อพนักงาน |
| `role` | `enum` | ระดับสิทธิ์ `user` (พนักงานทั่วไป), `admin` (ผู้ดูแล), `super_admin` (เจ้าของระบบ) |
| `is_active` | `boolean` | สถานะบัญชี (`true` = ใช้งานได้, `false` = ถูกแบน/ปิดใช้งาน) |

> [!NOTE]
> รหัสผ่าน (`password_hash`) จะไม่ได้ถูกจัดการโดยเราอีกต่อไป แต่ถูกจัดการโดย Supabase อย่างปลอดภัย

### 2. `user_locations` (ตารางเชื่อมผู้ใช้-สาขา)
ใช้เก็บว่าพนักงานแต่ละคนมีสิทธิ์มองเห็นและจัดการข้อมูลของ "สาขาไหน" บ้าง (1 คนดูแลได้หลายสาขา)

| Column | Type | Detail |
|---|---|---|
| `user_id` | `uuid` (FK) | รหัสผู้ใช้ |
| `location_id` | `uuid` (FK) | รหัสสาขา (`locations` table) |

---

## 🔄 3. ระบบการทำงาน (Authentication Flow)

### 3.1 การเข้าสู่ระบบ (Login Flow)
1. **Frontend**: ผู้ใช้กรอก `เบอร์โทรศัพท์` และ `รหัสผ่าน` 
2. **Frontend**: แปลงเบอร์โทรให้เป็นรูปแบบสากล (E.164 เช่น `+66800000001`) และส่งคำสั่ง `supabase.auth.signInWithPassword({ phone, password })`
3. **Supabase**: ตรวจสอบบัญชีและรหัสผ่าน หากถูกต้องจะคืนค่า Session Token พร้อมกับตั้งค่า Cookie โดยอัตโนมัติผ่าน `@supabase/ssr`
4. **Frontend**: ฟังก์ชัน Auth Context ทำการ Sync ข้อมูล Profile ของผู้ใช้ และเก็บแคชไว้ใน LocalStorage เพื่อใช้โหมด Offline
5. **Frontend**: ทำการโหลดหน้าแอปใหม่ (`window.location.href = "/"`) เพื่อให้ Next.js Middleware เริ่มทำงาน

### 3.2 การรักษาความปลอดภัยของระบบ (Authorization & API Protection)
1. **Client API Request**: Frontend เรียกใช้ Supabase Client ที่ถูกเตรียมไว้พร้อม Session
2. **Backend Protection**: 
   - Middleware คอยปกป้อง Route หลัก
   - API Handler เรียกใช้ `@supabase/ssr` Server Client เพื่อตรวจสอบสิทธิ์การเข้าถึงข้อมูล 
3. **Database Security (RLS)**: คำสั่ง SQL จะถูกผูกติดกับ Role และ UUID ของผู้ใช้ (ผ่าน `auth.uid()`) ทำให้ Database ปฏิเสธคำสั่งที่พยายามดู/แก้ไข ข้อมูลนอกสาขาของตัวเองโดยอัตโนมัติ

### 3.3 การออกจากระบบ (Logout Flow)
1. กดปุ่ม Logout ในเมนู
2. Frontend เรียกคำสั่ง `supabase.auth.signOut()`
3. Supabase จะล้าง Cookie Session และ LocalStorage ของระบบ
4. พาผู้ใช้กลับไปหน้า `/login`
