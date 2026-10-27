# ความพร้อมใช้งานออฟไลน์

สถานะข้างอินเทอร์เน็ตแสดงเปอร์เซ็นต์จำนวนรายการตรวจที่พร้อมจริง: ไฟล์ใน Workbox precache ตาม revision ของ production build รวมกับ HTML สำหรับเปิดแอปใหม่ ไฟล์ที่ HTML อ้างอิง สิทธิ์ออฟไลน์อายุไม่เกินเจ็ดวัน บัญชี/สาขาปัจจุบัน Service Worker controller และ IndexedDB ที่เปิด transaction สำหรับเขียนได้ โดยไม่แก้ไขรายการรอซิงก์

100% หมายถึงความพร้อมสำหรับงานที่แอปรองรับออฟไลน์ ไม่ใช่สำเนาประวัติทั้งระบบ หากไฟล์หาย สิทธิ์หมดอายุ เปลี่ยนบัญชี/สาขา หรือ storage ใช้ไม่ได้ ต้องไม่แสดงว่าพร้อม ผู้ใช้เปิดรายละเอียดเพื่อดูเหตุผลและตรวจซ้ำได้ ระบบตรวจใหม่เมื่อ connectivity เปลี่ยน กลับเข้าหน้าแอป หรือ Service Worker เปลี่ยน

`npm run build` สร้าง `public/offline-assets.json` จากรายการ precache ของ generated worker ไฟล์นี้เป็น artifact สาธารณะที่มีเฉพาะ URL/revision ไม่รวมข้อมูลบัญชี ห้ามเขียนด้วยมือ และไม่ precache ตัวเองเพราะสร้างหลัง Next build ชุดทดสอบ PWA ต้องเรียก generator เช่นเดียวกัน

ตรวจหลักฐานเป็น online-only: ปุ่มนำทาง disabled ขณะออฟไลน์ การเปิดจากบิลและลิงก์ตรงต้องผ่าน connectivity guard และหากหลุดขณะเปิดหน้านี้จะกลับหน้าบิลยางตาม policy กลาง

หลักฐาน local: isolated readiness/policy 7/7 และ full isolated 717 passed / 2 existing live-provider skips; lint/typecheck/source-size/import-direction ผ่าน การตรวจบน Android จริงและการ deploy แยกจากหลักฐาน local

Production-mode Chromium จำลอง Pixel 7 ผ่าน offline reload, browser cold restart, แสดง 100% และลดต่ำกว่า 100% เมื่อไฟล์ precache หาย รวมถึง disabled ตรวจหลักฐานและ mobile viewport ไม่มี overflow; ไม่มี pageerror หรือ script failure Production build, Service Worker และ bundle budget ผ่าน หลักฐานภาพอยู่ `output/pwa-readiness/` (ignored) คำสั่งทดสอบซ้ำ: `node --env-file=.env.local scripts/diagnostics/reproduce-pwa-offline.mjs --missing-file` และ `--cold` โดยเปิด local production server พอร์ต 3001 ก่อน

## Scrutiny follow-up 2026-10-28

- RED: cached login HTML + cached login chunk + valid account previously returned `ready: true`; fixed by requiring the root application page chunk in the cached document. Missing/stale shell regression remains covered.
- RED: reuse of the timed-out AbortController caused the next visibility retry to start already aborted. Fixed with a fresh controller per request; cleanup still aborts the active attempt. Regression rejects the old behavior and accepts the fix.
- Removed unused `OFFLINE_AUTH_MAX_AGE_MS` re-export from `use-auth.ts`; the shared policy constant and both actual consumers remain.
- Route trace: exact `/offline-assets.json` public matcher, near-miss protected matcher, navigation policy, deep-link and bill-entry guards reviewed. No business API/RPC/schema change.
- Second scrutiny RED: controller replacement during a pending manifest fetch allowed the old response to restore 100%. Added a generation fence, abort of the old fetch, immediate reset and immediate recheck after the old attempt settles. The controlled-promise regression fails before the fix and passes after it; readiness/policy coverage is now 10 tests. Strict unused checks found no additional dead code.
- Physical Android diagnosis: all 150 precache assets were present, but Vercel's `?dpl=...` made the root-page filename assertion fail and leave readiness at 99%. Root detection now uses URL pathname. Regression fails before and passes after normalization.
- Offline fetch reproduction: the canonical precached font returned 200 while the same URL with `?dpl=dpl_diagnostic` failed without runtime cache. Workbox now ignores only the exact `dpl` parameter alongside existing utm/fbclid rules, allowing Vercel asset URLs to resolve to the revisioned precache. Diagnostic `--vercel-query --cold` simulates production URLs and removes only temporary-profile runtime caches before restart.
- Verification after the fix: both font requests return 200 offline; Vercel-query cold restart reaches 100%, renders Rubber Bills and Income/Expense, and disables Evidence navigation without page errors. The route harness records an expected aborted root navigation during its synthetic intercept; workspace assertions still pass. Readiness/policy 11/11, production-mode local build, strict unused checks, ESLint, generated worker and bundle budget pass. Physical-device diagnosis was read-only; no device cache/queue deletion or production rollout was performed.
