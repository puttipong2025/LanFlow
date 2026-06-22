# 📋 บันทึกการเปลี่ยนแปลง — 22 มิ.ย. 2569

---

## 1. โมดูลรายชื่อรถขนส่ง (Transport Vehicles)

สร้างโมดูลใหม่ **"รายชื่อรถขนส่ง"** สำหรับจัดการข้อมูลคนขนส่งและทะเบียนรถ  
โครงสร้างเหมือนโมดูลลูกค้า แต่ตัดส่วน FSC / Class / ฟาร์มออก เพิ่มส่วนทะเบียนรถแทน

### Data Model

```
transport_vehicles (1 คน)
  ├── transport_vehicle_contacts    (N เบอร์โทร)
  ├── transport_vehicle_bank_accounts (N บัญชีธนาคาร, 1 primary)
  └── transport_vehicle_plates       (N ทะเบียนรถ)
```

### ไฟล์ที่สร้างใหม่

| ไฟล์ | รายละเอียด |
|------|-----------|
| [20260622070000_transport_vehicles.sql](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/supabase/migrations/20260622070000_transport_vehicles.sql) | Migration: 4 ตาราง + RLS policies + grants + unique index สำหรับ `is_primary` |
| [TransportModule.tsx](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/components/TransportModule.tsx) | UI Component: ตารางข้อมูล + modal form + ค้นหา + pagination (theme สี indigo/violet) |
| [transport-vehicles/route.ts](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/app/api/lanflow/transport-vehicles/route.ts) | API: `GET` (paginated) + `POST` (upsert) |
| [transport-vehicles/[id]/route.ts](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/app/api/lanflow/transport-vehicles/%5Bid%5D/route.ts) | API: `DELETE` (soft delete) |

### ไฟล์ที่แก้ไข

| ไฟล์ | การเปลี่ยนแปลง |
|------|---------------|
| [index.ts](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/types/index.ts) | เพิ่ม type `TransportVehicle`, `TransportVehiclePlate` + อัพเดท `QueueItem.entityType` |
| [lanflow-db.ts](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/lib/server/lanflow-db.ts) | เพิ่มฟังก์ชัน `getTransportVehicles`, `getTransportVehiclesPaginated`, `saveTransportVehicle`, `deleteTransportVehicle` + อัพเดท `saveSyncEvent` type union |
| [LanFlowApp.tsx](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/components/LanFlowApp.tsx) | เพิ่ม tab "รถขนส่ง" (icon: Truck) + state `transportVehicles` + handlers (add/update/delete) + persist functions + โหลดข้อมูลจาก API |

### ฟังก์ชันที่รองรับ

- ✅ เพิ่ม / แก้ไข / ลบ คนขนส่ง
- ✅ 1 คน → หลายทะเบียนรถ (string, คอลัมน์เดียว, หลายแถว)
- ✅ เบอร์โทรศัพท์ (หลายแถว)
- ✅ บัญชีธนาคาร (หลายแถว + กำหนดบัญชีหลัก)
- ✅ รหัสสมาชิก 6 หลัก (auto-generate)
- ✅ ค้นหา / กรอง / Pagination
- ✅ Client-side + Server-side validation
- ✅ Sync / Offline queue

---

## 2. แก้ไข Service Worker Error

### ปัญหา
```
Uncaught (in promise) TypeError: Failed to execute 'addAll' on 'Cache': Request failed
```

### สาเหตุ
ไฟล์ `public/sw.js` เดิมพยายาม precache ไฟล์ `/icons/icon-192x192.png` และ `/icons/icon-512x512.png` ที่ไม่มีอยู่จริง (มีแค่ `icon.svg`)

### การแก้ไข
แก้ `PRECACHE_ASSETS` ให้ชี้ไปที่ `/icons/icon.svg` แทน (ก่อนจะย้ายไปใช้ next-pwa ทั้งหมด)

---

## 3. ย้ายจาก Manual SW → next-pwa

### ปัญหาของ SW เดิม
1. **แคช API แบบ Cache First** — ทำให้เห็นข้อมูลเก่าเสมอ
2. **ไม่มีขีดจำกัด Cache** — Cache โตไม่จำกัด
3. **ไม่รองรับ Next.js build hashing** — ไฟล์ static ที่เปลี่ยน hash ทุกครั้ง build ไม่ได้ถูกจัดการ

### การเปลี่ยนแปลง

| งาน | รายละเอียด |
|-----|-----------|
| ติดตั้ง `@ducanh2912/next-pwa` | `npm install @ducanh2912/next-pwa` |
| ลบ `public/sw.js` | next-pwa จะ auto-generate ตอน build แทน |
| ลบ `PwaRegister` จาก layout | next-pwa จดทะเบียน SW อัตโนมัติ (`register: true`) |
| อัพเดท `.gitignore` | เพิ่ม `public/sw.js`, `public/workbox-*.js`, `public/swe-worker-*.js` |

### ไฟล์ที่แก้ไข

| ไฟล์ | การเปลี่ยนแปลง |
|------|---------------|
| [next.config.ts](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/next.config.ts) | ตั้งค่า `withPWA` + caching strategies |
| [layout.tsx](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/app/layout.tsx) | ลบ `<PwaRegister />` |
| [.gitignore](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/.gitignore) | เพิ่ม next-pwa generated files |

### Caching Strategies ที่กำหนด

| ประเภท | Strategy | Cache Name | หมดอายุ |
|--------|----------|-----------|---------|
| `/api/*` | **Network First** | `lanflow-api-cache` | 1 ชม., max 64 entries |
| `/_next/static/*` | **Cache First** | `lanflow-static-cache` | 1 ปี, max 128 entries |
| รูปภาพ (png/jpg/svg/webp) | **Stale While Revalidate** | `lanflow-images-cache` | 30 วัน, max 64 entries |
| Google Fonts CSS | **Stale While Revalidate** | `lanflow-google-fonts-cache` | 1 ปี, max 4 entries |
| Google Fonts Files | **Cache First** | `lanflow-gstatic-fonts-cache` | 1 ปี, max 4 entries |

> [!NOTE]
> ในโหมด development (`npm run dev`) next-pwa จะ **ปิดอัตโนมัติ** (`disable: process.env.NODE_ENV === "development"`)
> Service Worker จะทำงานจริงตอน production build (`next build`) เท่านั้น

---

## 4. แก้ Bug อื่นๆ ที่เจอระหว่าง Build

| ไฟล์ | ปัญหา | การแก้ไข |
|------|-------|---------|
| [OcrTicketUpload.tsx](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/components/OcrTicketUpload.tsx) L200 | `driverName` ไม่มีอยู่ใน type `OcrTicket` แล้ว (ถูก drop ใน migration ก่อนหน้า) | ลบ `driverName: null` ออก |
| [lanflow-db.ts](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/lib/server/lanflow-db.ts) L301 | `saveSyncEvent` ไม่รู้จัก entity type `"transport_vehicle"` | เพิ่ม `"transport_vehicle"` ใน type union |

---

## ✅ สถานะ Build

```
npx next build → ✓ Compiled successfully
```

ทุก route รวมถึง `/api/lanflow/transport-vehicles` และ `/api/lanflow/transport-vehicles/[id]` ผ่านหมด
