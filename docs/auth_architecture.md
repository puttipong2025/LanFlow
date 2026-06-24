# 🔐 สถาปัตยกรรมระบบ Authentication ของ LanFlow

เอกสารนี้สรุปเทคโนโลยี โครงสร้างข้อมูล และการทำงานของระบบยืนยันตัวตน (Authentication) และการจัดการสิทธิ์ (Authorization) ที่ถูกนำมาใช้ในโปรเจกต์ LanFlow ณ ปัจจุบัน

---

## 🛠️ 1. เทคโนโลยีที่ใช้ (Tech Stack)

ระบบ Auth ของ LanFlow ถูกออกแบบมาให้รองรับ **Offline-first PWA** และการทำงานร่วมกับ **Next.js Server/Client Components** โดยใช้เทคโนโลยีดังนี้:

1. **Supabase PostgreSQL**: ใช้เป็น Database หลักสำหรับเก็บข้อมูลผู้ใช้และสิทธิ์การเข้าถึง 
2. **Bcrypt.js (Node.js)**: ใช้ในการเข้ารหัสรหัสผ่าน (Hashing) แบบ One-way encryption เพื่อไม่ให้เก็บรหัสผ่านเป็น Plain Text 
3. **`jose` (JSON Web Token)**: ใช้สำหรับสร้าง (Sign) และตรวจสอบ (Verify) JWT บนฝั่ง Server Edge/Node
4. **Local Storage + Cookies**: เก็บ JWT ไว้ 2 ที่ 
   - `LocalStorage` (`lanflow:auth-token`): เพื่อให้แอปทำงานได้ตอนออฟไลน์ (Offline-first / Service Worker)
   - `Cookie` (`lanflow-token`): เพื่อให้ Next.js Middleware สามารถกันไม่ให้คนนอกเข้าสู่ระบบได้ตั้งแต่ฝั่ง Server
5. **Next.js Middleware**: ทำหน้าที่เป็นยามเฝ้าประตู (Gatekeeper) ตรวจจับ Cookie ถ้าไม่มี Token จะเด้งไปหน้า `/login`
6. **React Context (`AuthProvider`)**: จัดการ State การล็อกอินบนฝั่ง Client ทำให้ทุก Component เข้าถึง Profile ของผู้ใช้ได้

---

## 🗄️ 2. โครงสร้างข้อมูล (Data Structure)

ข้อมูลผู้ใช้และสิทธิ์ถูกเก็บอยู่ใน 2 ตารางหลัก (Table) บน Supabase:

### 1. `profiles` (ตารางพนักงาน/ผู้ใช้)
เก็บข้อมูลส่วนตัวของพนักงานและสิทธิ์ของแต่ละคน

| Column | Type | Detail |
|---|---|---|
| `id` | `uuid` (PK) | รหัสผู้ใช้ |
| `phone` | `text` (Unique) | เบอร์โทรศัพท์ (ใช้เป็น Username สำหรับล็อกอิน) |
| `name` | `text` | ชื่อพนักงาน |
| `password_hash` | `text` | รหัสผ่านที่เข้ารหัสแล้วด้วย Bcrypt |
| `role` | `enum` | ระดับสิทธิ์ `user` (พนักงานทั่วไป), `admin` (ผู้ดูแล), `super_admin` (เจ้าของระบบ) |
| `is_active` | `boolean` | สถานะบัญชี (`true` = ใช้งานได้, `false` = ถูกแบน/ปิดใช้งาน) |

> [!NOTE]
> ระบบมี Database Level Constraint (Unique Partial Index) เพื่อบังคับให้มี `super_admin` ได้เพียง **1 คน** เสมอ

### 2. `user_locations` (ตารางเชื่อมผู้ใช้-สาขา)
ใช้เก็บว่าพนักงานแต่ละคนมีสิทธิ์มองเห็นและจัดการข้อมูลของ "สาขาไหน" บ้าง (1 คนดูแลได้หลายสาขา)

| Column | Type | Detail |
|---|---|---|
| `user_id` | `uuid` (FK) | รหัสผู้ใช้ |
| `location_id` | `uuid` (FK) | รหัสสาขา (`locations` table) |

---

## 🔄 3. ระบบการทำงาน (Authentication Flow)

### 3.1 การเข้าสู่ระบบ (Login Flow)
1. **Frontend**: ผู้ใช้กรอก `เบอร์โทรศัพท์` และ `รหัสผ่าน` ส่ง POST Request ไปที่ `/api/auth/login`
2. **Backend**: ค้นหาผู้ใช้จาก `phone` ในตาราง `profiles`
3. **Backend**: ตรวจสอบรหัสผ่านโดยใช้ `bcrypt.compare()`
4. **Backend**: หากถูกต้อง ดึงรายการสาขาจาก `user_locations` และสร้าง **JWT (JSON Web Token)** ซึ่งบรรจุข้อมูล (Payload) เช่น `id`, `name`, `role`, และ `locationIds` 
5. **Frontend**: เมื่อได้รับ Token กลับมา จะทำการบันทึกลง 2 จุด:
   - บันทึกลง `localStorage.setItem("lanflow:auth-token", token)`
   - บันทึกลง `document.cookie = "lanflow-token=token"`
6. **Frontend**: ทำการโหลดหน้าแอปใหม่ (`window.location.href = "/"`) เพื่อให้ Next.js Middleware เริ่มทำงาน

### 3.2 การรักษาความปลอดภัยของระบบ (Authorization & API Protection)
เมื่อมีการเรียก API เส้นอื่น ๆ เช่น (ดูข้อมูลลูกค้า, ดูบันทึกการโอนเงิน) จะผ่านกระบวนการดังนี้:

1. **Client API Request**: Frontend เรียกใช้ฟังก์ชัน `authFetch()` ซึ่งจะดึง Token จาก LocalStorage แนบไปกับ Header (`Authorization: Bearer <token>`) โดยอัตโนมัติ
2. **Backend Protection**: 
   - ทุก API จะเรียกใช้ `requireAuth()` เพื่ออ่านค่า Token (จาก Header หรือ Cookie) และแกะ Payload ออกมา
   - หาก Token หมดอายุ หรือไม่ถูกต้อง API จะคืนค่า `401 Unauthorized` 
   - ฟังก์ชัน `requireRole(["admin", "super_admin"])` จะใช้เพื่อบล็อก API เฉพาะทางไม่ให้พนักงานทั่วไปเข้าถึง
3. **Database Security (RLS)**: ปัจจุบันระบบ API เรียกคุยกับ Supabase ผ่าน Service Role Bridge (ข้ามกฎ Database) แต่ใช้ Middleware ของ API กรองสิทธิ์ผู้ใช้เองอย่างรัดกุมก่อนที่จะเข้าถึง Database

### 3.3 การออกจากระบบ (Logout Flow)
1. กดปุ่ม Logout ในเมนู
2. Frontend เรียกฟังก์ชันเคลียร์ `localStorage` 
3. ยิง API เคลียร์ค่า `Cookie` หรือสั่งลบ Cookie ทางฝั่ง Client 
4. พาผู้ใช้กลับไปหน้า `/login`
