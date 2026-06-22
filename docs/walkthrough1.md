# Walkthrough: โมดูลรายชื่อรถขนส่ง (Transport Vehicles)

## สรุปการเปลี่ยนแปลง

สร้างโมดูลใหม่ **"รายชื่อรถขนส่ง"** สำหรับจัดการข้อมูลคนขนส่ง + ทะเบียนรถ (1 คน → หลายทะเบียน)

### ไฟล์ที่สร้างใหม่

| ไฟล์ | รายละเอียด |
|------|-----------|
| [20260622070000_transport_vehicles.sql](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/supabase/migrations/20260622070000_transport_vehicles.sql) | Migration: 4 ตาราง + RLS + grants |
| [TransportModule.tsx](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/components/TransportModule.tsx) | UI Component พร้อม modal form |
| [route.ts](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/app/api/lanflow/transport-vehicles/route.ts) | API: GET (paginated) + POST (upsert) |
| [[id]/route.ts](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/app/api/lanflow/transport-vehicles/[id]/route.ts) | API: DELETE (soft delete) |

### ไฟล์ที่แก้ไข

| ไฟล์ | รายละเอียด |
|------|-----------|
| [index.ts](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/types/index.ts) | เพิ่ม `TransportVehicle`, `TransportVehiclePlate` types + อัพเดท QueueItem |
| [lanflow-db.ts](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/lib/server/lanflow-db.ts) | เพิ่ม CRUD functions: get/save/delete transport vehicles |
| [LanFlowApp.tsx](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/components/LanFlowApp.tsx) | เพิ่ม tab "รถขนส่ง" + state/handlers/persist/render |

---

## Screenshots

### Navigation Tab
![Nav bar with transport tab](C:/Users/Do/.gemini/antigravity-ide/brain/6e17c575-e64c-4f9f-9acc-be12ee2ecd01/nav_bar_tabs_1782142691772.png)

### Transport Vehicles Page
![Transport page](C:/Users/Do/.gemini/antigravity-ide/brain/6e17c575-e64c-4f9f-9acc-be12ee2ecd01/transport_page_1782142703431.png)

### Add Modal Form
![Transport modal](C:/Users/Do/.gemini/antigravity-ide/brain/6e17c575-e64c-4f9f-9acc-be12ee2ecd01/transport_modal_1782142717977.png)

### Recording
![Browser recording](C:/Users/Do/.gemini/antigravity-ide/brain/6e17c575-e64c-4f9f-9acc-be12ee2ecd01/verify_transport_module_1782142679990.webp)

---

## Data Model

```
transport_vehicles (1 คน)
  ├── transport_vehicle_contacts (N เบอร์โทร)
  ├── transport_vehicle_bank_accounts (N บัญชี, 1 primary)
  └── transport_vehicle_plates (N ทะเบียนรถ)
```

## Verification

- ✅ `supabase db reset` — ทุก migration ผ่าน
- ✅ Nav tab "รถขนส่ง" แสดงพร้อม icon Truck
- ✅ หน้ารายการแสดงตาราง + search + pagination
- ✅ Modal form ทำงาน: ชื่อหลัก + เบอร์โทร + ทะเบียนรถ + บัญชีธนาคาร
- ✅ ไม่มี FSC / Class / ฟาร์ม (ตามสเปค)
