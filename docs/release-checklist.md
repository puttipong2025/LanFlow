# LanFlow Release Checklist

ใช้ checklist นี้หลังเปลี่ยน offline sync, queue, API/RPC, หรือ PWA และก่อนปล่อยขึ้น environment ใหม่

## Required release gates

- [ ] รัน `npm run verify` ผ่านครบ: ESLint, typecheck, auth-outage check, isolated tests, production build, service-worker check และ First Load JS budget
- [ ] ตรวจว่า `/` มี First Load JS ไม่เกิน 320 kB จาก `scripts/check-bundle-budget.mjs`
- [ ] รัน `npm run verify:full` เมื่อมี local Supabase พร้อมใช้งาน เพื่อรวม pgTAP database tests และ middleware route test
- [ ] ตรวจว่า GitHub Actions jobs `web-gate` และ `database-gate` ผ่านก่อน merge เข้า `main`
- [ ] รัน offline test ที่ได้รับผลกระทบ เช่น `npx.cmd playwright test tests/income-expense-offline.spec.ts --project=chromium`
- [ ] รัน offline test ของ Rubber Bills เมื่อแก้ queue/shared sync: `npx.cmd playwright test tests/rubber-bills-offline.spec.ts --project=chromium`
- [ ] ตรวจว่า event `failed` และ `conflict` ยังไม่ถูกลบอัตโนมัติ
- [ ] ตรวจว่า retry ของ `failed` ส่ง event เดิมเพียงรายการเดียวและสำเร็จแล้วลบ queue event

## PWA smoke (เมื่อแก้ service worker, bootstrap cache, auth cache หรือ offline reload)

- [ ] รัน `npm run build` ล่าสุดก่อน PWA test
- [ ] รัน `npx.cmd playwright test tests/auth-cache-offline.spec.ts --project=chromium-pwa`
- [ ] รัน production module matrix: `$env:PW_PROJECT='pwa'; npx.cmd playwright test tests/pwa-connectivity-matrix.spec.ts --project=chromium-pwa`
- [ ] รัน PWA spec ของโมดูลที่เปลี่ยน (`income-expense-pwa.spec.ts` หรือ `rubber-bills-pwa.spec.ts`)
- [ ] ทดสอบเปิด workspace, สร้าง local draft, reload ขณะ offline และกลับมา sync เมื่อออนไลน์

## Dependency security

- [ ] รัน `npm audit --omit=dev` และเทียบกับ `docs/dependency-security-review-2026-09-29.md`
- [ ] บล็อก release เมื่อ advisory เข้าถึงได้จาก production runtime และยังไม่มี mitigation ที่บันทึกไว้
- [ ] ห้ามใช้ `npm audit fix --force`; อัปเดตแบบเจาะจงและรัน gates ใหม่ทุกครั้ง

## Known limits

- Income/Expense feed แสดงช่วง 90 วันตาม query ปัจจุบัน
- การค้นหาในหน้า feed ทำกับ rows ที่ browser โหลดมาแล้ว ไม่ใช่ server-side global search
- Phase 0 baseline เริ่มจาก 0 rows; อย่าใช้ตัวเลขนี้เป็น production capacity claim
