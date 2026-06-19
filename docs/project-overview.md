# LanFlow Project Notes

## 📌 ภาพรวมโปรเจกต์ (Project Overview)

LanFlow เป็นเว็บแอปพลิเคชันสำหรับจัดการงานลานยางหลายสาขา โดยโฟกัสงานบันทึกข้อมูลประจำวัน เช่น บิลยาง รายรับ-รายจ่าย การแยกสาขาที่รับผิดชอบข้อมูล และการแยกผู้รับผิดชอบการจ่ายเงินระหว่าง `สาขานี้จ่าย` กับ `สาขาใหญ่จ่าย`

ระบบถูกออกแบบให้รองรับการทำงานแบบ PWA/offline-first สำหรับงาน data entry บนแท็บเล็ต โดยใช้เลขชั่วคราวฝั่งเครื่อง, idempotency key, server timestamp และ server-generated ID เพื่อลดปัญหาข้อมูลชนกันเมื่อลงข้อมูลพร้อมกันหลายเครื่อง

## 🛠️ เทคโนโลยีที่ใช้ (Tech Stack)

- **Frontend:** Next.js 15, React 19, TypeScript, TailwindCSS, lucide-react
- **Backend:** Next.js API Routes
- **Database:** Supabase Local, PostgreSQL, Row Level Security policies
- **State Management:** React `useState`, `useMemo`, `useEffect`, localStorage-based offline queue
- **PWA:** Web manifest + client-side service worker registration
- **Local Development:** Docker Desktop + Supabase CLI

## 📂 โครงสร้างโฟลเดอร์ (Folder Structure)

```text
webapp/
  docs/
    gas-crud-findings-and-lanflow-plan.md
    project-overview.md
  public/
    manifest.json
    sw.js
  src/
    app/
      api/
        lanflow/
          route.ts
          rubber-bills/route.ts
          income-expense/route.ts
      globals.css
      layout.tsx
      page.tsx
    components/
      LanFlowApp.tsx
      PwaRegister.tsx
    hooks/
      use-offline-queue.ts
    lib/
      demo-data.ts
      format.ts
      supabase-browser.ts
      server/
        lanflow-db.ts
    types/
      index.ts
  supabase/
    config.toml
    migrations/
  .env.local
  next.config.ts
  package.json
  supabase-schema.sql
```

## ⚙️ ระบบการทำงานหลัก (Core Features)

1. **ระบบหลายสาขา:** มีตาราง `locations` และ `user_locations` เพื่อรองรับผู้ใช้ 1 คนดูแลได้หลายสาขา และเลือกสาขาที่จะจัดการจาก dropdown ในหน้าเว็บ

2. **ระบบสมาชิก/สิทธิ์ผู้ใช้:** โครงสร้างฐานข้อมูลมี `profiles` พร้อม role `user`, `admin`, `super_admin` และวาง RLS policies สำหรับแยกสิทธิ์ตามสาขาไว้แล้ว แต่หน้าสมัคร/เข้าสู่ระบบด้วยเบอร์โทร + รหัสผ่านยังต้องพัฒนาต่อ

3. **CRUD บิลยาง:** หน้า `บิลยาง` มีตาราง, modal เพิ่ม/แก้ไข, soft delete, รายการชั่งหลายแถว, หักน้ำกรดได้หลายรายการตามแบบที่กำหนด, หักหนี้ และบันทึกลง Supabase ผ่าน API route `/api/lanflow/rubber-bills`

4. **CRUD รายรับ-รายจ่าย:** หน้า `รับ-จ่าย` มี modal เพิ่มหลายรายการในครั้งเดียว และตารางรับ-จ่ายที่ผู้ใช้ยืนยันว่ารูปแบบปัจจุบันดีแล้ว ไม่ควรแก้ UI ตารางนี้โดยไม่แจ้งก่อน บันทึกลง Supabase ผ่าน API route `/api/lanflow/income-expense`

5. **Offline-first Queue:** มี `useOfflineQueue` เก็บคิวใน localStorage พร้อมสถานะ `pending`, `synced`, `failed`, `conflict` ใช้ `clientTempId`, `localBillNo`, `idempotencyKey`, `clientRecordedAt`, `serverReceivedAt`, `revisionNo` เพื่อกันข้อมูลชนและรองรับการ sync ภายหลัง

6. **Supabase API Bridge:** ตอนนี้เว็บเรียก Next.js API routes ฝั่ง server เพื่ออ่าน/เขียน Supabase local database โดยใช้ service role key เฉพาะฝั่ง server เพราะ RLS เปิดอยู่และยังไม่มี auth session จริงใน browser

7. **การแยกผู้รับผิดชอบการจ่าย:** ค่าเดิม `ชาวสวน`/`ผู้ค้าขาย` ถูกเปลี่ยนเป็น `สาขานี้จ่าย`/`สาขาใหญ่จ่าย` และหัวข้อบนหน้าระบบใช้คำว่า `ผู้รับผิดชอบการจ่าย` เพื่อแยกการจ่ายเงินให้ชัดเจน

## 🚀 สถานะปัจจุบันและสิ่งที่ต้องทำต่อไป (Current Status & Next Steps)

- **สิ่งที่ทำเสร็จแล้ว:**
  - Supabase local start ได้ผ่าน Docker Desktop
  - `.env.local` ชี้ local Supabase แล้ว
  - สร้างและ push migrations เข้า local database แล้ว
  - API routes สำหรับโหลดข้อมูล, บันทึกบิลยาง, บันทึกรายรับ-รายจ่ายทำงานแล้ว
  - ตารางหลักใน local DB พร้อมใช้งาน เช่น `profiles`, `locations`, `rubber_bills`, `rubber_bill_items`, `income_expense`, `offline_sync_events`
  - Next.js build ผ่าน และเว็บรันที่ `http://127.0.0.1:3000`

- **สิ่งที่กำลังทำอยู่:**
  - เชื่อม flow หน้าเว็บกับฐานข้อมูลจริงแบบ optimistic update แล้ว แต่ยังเป็นระยะเริ่มต้น
  - Offline queue ยังเป็น localStorage queue และยังไม่ได้ทำ background retry/sync worker แบบสมบูรณ์

- **ปัญหาที่พบ (ถ้ามี):**
  - Supabase image จาก public ECR/CloudFront ดาวน์โหลดหลุด `EOF` หลายครั้ง จึงใช้วิธีดึงบาง image จาก GHCR แล้ว tag เป็นชื่อ public ECR
  - ปิด `edge_runtime` และ `analytics` ใน `supabase/config.toml` ชั่วคราวเพื่อให้ local Supabase start ได้ง่ายขึ้น
  - PowerShell แสดงภาษาไทยเพี้ยนใน output บางคำสั่ง แต่ข้อมูลในไฟล์และ PostgreSQL เป็น UTF-8 ถูกต้อง
  - ยังไม่มี auth จริง จึงใช้ API bridge ฝั่ง server ด้วย service role สำหรับ local dev เท่านั้น

## 🎯 เป้าหมายสำหรับ AI ตัวถัดไป

1. สร้างระบบสมัคร/เข้าสู่ระบบด้วยเบอร์โทร unique + ชื่อ + รหัสผ่าน โดยผูกกับ `profiles` และไม่เก็บ password แบบ plain text
2. ปรับ API routes ให้ใช้ auth session/role จริงแทน service role bridge เมื่อระบบ login พร้อม
3. ทำระบบ admin จัดการสมาชิก เพิ่มสาขา กำหนดสมาชิกดูแลหลายสาขา และเลื่อนสมาชิกเป็น admin โดยยังคง super admin ได้คนเดียว
4. ทำ background sync/retry สำหรับ offline queue ให้ส่งรายการ `pending` และจัดการ `failed/conflict` แบบใช้งานจริง
5. เพิ่ม seed/demo เฉพาะข้อมูลระบบ เช่น super admin และสาขาเริ่มต้น แต่ให้ข้อมูลลูกค้า/บิล/รับ-จ่ายเริ่มว่างตาม requirement
6. ทดสอบ CRUD ผ่าน browser หลังเพิ่มข้อมูลจริง โดยเฉพาะบิลยาง, รายรับ-รายจ่าย และการแยก `สาขานี้จ่าย`/`สาขาใหญ่จ่าย`
7. อย่าแก้รูปแบบตารางรับ-จ่ายโดยไม่แจ้งผู้ใช้ก่อน เพราะผู้ใช้ยืนยันว่ารูปแบบปัจจุบันดีแล้ว
