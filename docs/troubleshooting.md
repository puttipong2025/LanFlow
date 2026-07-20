# 🔧 LanFlow — คู่มือแก้ปัญหาและป้องกัน Error ที่เคยเจอ

## Error 1: `Could not find the module in the React Client Manifest`

### ลักษณะ Error
```
Error: Could not find the module "...PwaRegister.tsx#PwaRegister" in the React Client Manifest.
```

### สาเหตุ
Next.js HMR (Hot Module Replacement) cache เสีย เนื่องจากแก้ไขไฟล์ `"use client"` component ขณะ dev server กำลังทำงาน

### วิธีแก้ (เลือกทำวิธีใดวิธีหนึ่ง)

| วิธี | คำสั่ง | ใช้เมื่อ |
|------|--------|---------|
| **A. Restart** | กด `Ctrl + C` ใน Terminal แล้ว `npm run dev` | HMR แค่สะดุดเล็กน้อย |
| **B. Kill + Start** | `taskkill /f /im node.exe && npm run dev` | `Ctrl + C` ไม่หยุด |
| **C. Full clean** | `rmdir /s /q .next && npm run dev` | Error ยังอยู่ |

### ป้องกัน
- ถ้าจะแก้ไฟล์ `"use client"` ให้ **หยุด dev server ก่อน**
- หรือแก้ทีละไฟล์ แล้วรอให้ HMR โหลดเสร็จ (`GET / 200`) ค่อยแก้ไฟล์ต่อไป

---

## Error 2: `invariant expected layout router to be mounted`

### ลักษณะ Error
```
Uncaught Error: invariant expected layout router to be mounted
    at OuterLayoutRouter (layout-router.js)
```

### สาเหตุ
**Dependency version mismatch** — มี package ใน `node_modules` ที่ต้องการ React เวอร์ชันเก่า (เช่น react@18) แต่โปรเจกต์ใช้ React 19 หรือในทางกลับกัน

| อาการ | สาเหตุ |
|--------|--------|
| `invariant expected layout router to be mounted` | React เวอร์ชันไม่ตรงกับที่ Next.js คาดหวัง |
| แอปไม่โหลด แต่ server ตอบ `200` | SW cache เก่า / JS bundle mismatch |
| เปิดใน Incognito แล้วใช้ได้ แต่ปกติไม่ได้ | Service Worker cache |

### วิธีแก้ (ทำตามลำดับ)

1. **ลบ dependencies และ install ใหม่** (แก้ 90% ของปัญหา)
   ```
   taskkill /f /im node.exe
   rmdir /s /q node_modules .next
   del pnpm-lock.yaml
   npm install
   npm run dev
   ```

2. **ถ้ายังไม่ได้ผล — เช็ค version**
   ```
   npm ls react react-dom next
   ```
   - ถ้าเห็น `invalid` หรือ `deduped invalid` แสดงว่าเวอร์ชันไม่ตรง
   - แก้ไข `package.json` ให้ React ตรงกับที่ Next.js เวอร์ชันนั้น support

3. **ถ้ายังไม่ได้ผล — เคลียร์ browser cache**
   - Chrome: กด `F12` → Application → Service Workers → Unregister
   - หรือเปิดใน `Incognito Mode` (`Ctrl + Shift + N`)
   - หรือกด `Ctrl + F5` (Hard Refresh)

4. **วิธีสุดท้าย — ลบแล้ว clone ใหม่**
   ```
   cd ..
   rmdir /s /q webapp
   git clone <repo_url> webapp
   cd webapp
   npm install
   npm run dev
   ```

---

## Error 3: Service Worker Cache ทำให้หน้าเว็บไม่โหลด

### วิธีเช็คว่าเป็นที่ Service Worker
1. เปิด `F12` → Application → Service Workers
2. ถ้าเห็น `#12345 in #67890 ... activated and is running` แสดงว่ามี SW ทำงานอยู่
3. กด `Unregister`

### วิธีแก้แบบถาวร (ทำแล้วในโปรเจกต์นี้)
- `public/sw.js` — ใช้ `CACHE_NAME = "lanflow-shell-v2"` และ **ไม่ cache HTML pages**
- `src/components/PwaRegister.tsx` — ยกเลิก SW เก่าก่อนลงทะเบียนใหม่

### ถ้าเปลี่ยน SW แล้วต้องทำอะไร
1. แก้ `CACHE_NAME` → เปลี่ยนเป็นเวอร์ชันใหม่ (เช่น `lanflow-shell-v3`)
2. ลบ `.next` แล้ว `npm run dev` ใหม่
3. บอกให้ user `Ctrl + F5` หรือ Unregister SW เก่า

---

## Error 4: รายการค้างซิงก์ (`pending` / `failed` / `conflict`)

สถานะซิงก์ของรายการ Offline เก็บอยู่ใน IndexedDB ของ browser และผูกกับผู้ใช้กับสาขาเดิม จึงต้องตรวจว่ากำลังใช้บัญชีและสาขาที่ถูกต้องก่อนเสมอ

| สถานะ | ความหมาย | วิธีดำเนินการ |
|---|---|---|
| `pending` | บันทึกไว้ในเครื่อง รอเชื่อมต่อหรือรอรอบ sync | กลับมาออนไลน์ แล้วรอให้ระบบ sync; อย่าล้าง site data |
| `failed` | Server ปฏิเสธหรือเกิดข้อผิดพลาดชั่วคราว | อ่านข้อความใต้รายการ แก้สาเหตุ แล้วกด **ลองซิงก์อีกครั้ง** ขณะออนไลน์ |
| `conflict` | ข้อมูลบน server เปลี่ยนจน revision เดิมใช้ต่อไม่ได้ | อย่ากด retry ซ้ำ; refresh ข้อมูล แล้วตรวจ/แก้จากรายการล่าสุดตามกฎของโมดูล |

### ขั้นตอนตรวจสอบ

1. ตรวจว่าออนไลน์ และกลับเข้า **user + location เดิม** ที่สร้างรายการ
2. สำหรับ `failed` ให้แก้ payload หรือเงื่อนไขที่ข้อความ error ระบุ แล้วกด **ลองซิงก์อีกครั้ง** ที่รายการนั้น
3. ปุ่ม retry จะส่ง event เดิมเพียงรายการเดียวไป endpoint ของโมดูล; ถ้าสำเร็จ event จะถูกลบจาก queue
4. ถ้ายัง `failed` หรือกลายเป็น `conflict` ระบบจะเก็บ event และข้อความ error ไว้เพื่อไม่ให้ข้อมูลหาย

> [!warning]
> ห้ามล้าง browser site data, IndexedDB หรือ logout เพื่อ "แก้" `pending`/`failed` เพราะอาจลบ local draft ที่ยังไม่ขึ้น server. การ retry ใช้ได้เฉพาะ `failed`; `conflict` ต้อง resolve จากข้อมูลล่าสุดก่อน

### ขอบเขต Offline

- local draft ที่ยังไม่เคย sync แก้ไขหรือลบขณะ offline ได้ และ queue จะ coalesce เป็น intent สุดท้าย
- record ที่เคย sync แล้ว ต้องออนไลน์ก่อนแก้ไขหรือลบ
- รายการที่ผูกสต็อกหรือ relation สำคัญ ใช้กฎ online-only / relation lock ของโมดูลนั้น

---

## Flow การ Debug ทั่วไป

```
App ไม่โหลด?
├── Server ตอบ 500?
│   ├── อ่าน error ใน Terminal → แก้ตาม error
│   └── npm run dev ใหม่
│
├── Server ตอบ 200 แต่ browser error?
│   ├── เช็ค F12 → Console มี error อะไร
│   ├── เปิดใน Incognito → ใช้ได้ไหม?
│   │   ├── ใช้ได้ → Service Worker / Cache
│   │   │   └── F12 → Application → Service Workers → Unregister
│   │   └── ไม่ได้ → JS bundle mismatch / Next.js cache
│   │       └── rmdir /s /q .next && npm run dev
│   │
│   └── ยังไม่ได้?
│       └── Full clean reinstall
│           ├── taskkill /f /im node.exe
│           ├── rmdir /s /q node_modules .next
│           ├── del pnpm-lock.yaml
│           ├── npm install
│           └── npm run dev
│
└── ถ้าทำทุกอย่างแล้วยังไม่ได้?
    └── เช็ค package.json dependencies version
        └── npm ls react react-dom next
```

---

## ⚠️ กฎสำคัญที่ต้องจำ

1. **ห้ามใช้ `replace_in_file` แก้ไขไฟล์ `"use client"` component ขณะ dev server ทำงาน** → จะทำให้ React Client Manifest เสีย
2. **ถ้าแก้ SW หรือไฟล์ใน `public/`** → ต้องเปลี่ยน `CACHE_NAME` ใน `sw.js` และ clear `.next`
3. **ถ้า `npm install` แล้วมี `peer dependency` warning** → อาจต้องแก้ version ใน `package.json`
4. **Windows path case-sensitivity warnings (`⚠`) จาก Next.js** → ไม่ต้องสนใจ เป็น bug ของ Next.js 15.x บน Windows ไม่ส่งผลต่อการทำงาน

---

_อัปเดตล่าสุด: 15 กรกฎาคม 2026_
