# Dependency Security Review — 2026-09-29

## Policy

- ใช้ reachability จาก production runtime เป็นเกณฑ์ตัดสิน release ไม่ใช้จำนวน advisory เพียงอย่างเดียว
- อัปเดต dependency แบบเจาะจงและไม่ใช้ `npm audit fix --force`
- ทุกการเปลี่ยน dependency ต้องผ่าน `npm run verify` และ pgTAP ตามขอบเขตที่ได้รับผลกระทบ

## Change in this cycle

- Pin `next` และ `eslint-config-next` ที่ `15.5.26` เพื่อรับ security patch ล่าสุดในสาย Next.js 15 LTS โดยไม่ย้ายไป Next.js 16
- การอัปเดต Next.js ทำให้ optional image runtime `sharp` ขยับจาก `0.35.3` เป็น `0.35.5`
- ย้าย lint command จาก `next lint` ที่เลิกใช้แล้วเป็น ESLint CLI flat config

## Review rule for remaining advisories

ผล `npm audit --omit=dev` หลังการแก้ไขต้องแนบไว้ในผลการตรวจรอบนี้ โดยแยกเป็นสองกลุ่ม:

1. **Reachable:** โค้ดที่ bundle หรือทำงานใน production request path ต้องแก้หรือมี mitigation ที่ทดสอบได้ก่อน release
2. **Build-only / unreachable:** dependency ที่ใช้เฉพาะ build-time และไม่มีเส้นทางรับ untrusted input ใน production อาจยอมรับชั่วคราวได้ แต่ต้องบันทึก package path, advisory และเหตุผล

ข้อยกเว้นต้องถูกทบทวนใหม่เมื่อ dependency path, deployment model หรือข้อมูล input เปลี่ยน

## Verified audit result

หลัง patch framework และอัปเดต transitive packages ที่อยู่ในช่วงรองรับเดิม ผล `npm audit --omit=dev` ลดจาก **11 รายการ (5 high, 6 moderate)** เหลือ **7 รายการ (2 high, 5 moderate)** และไม่มี critical

รายการที่แก้ได้โดยไม่เปลี่ยน major และได้รับการอัปเดตแล้ว:

- `browserslist` → `4.29.3`
- `baseline-browser-mapping` → `2.11.26`
- `fast-uri` → `3.1.8`

## Accepted build-time exceptions

Owner ของข้อยกเว้นทั้งหมด: **LanFlow maintainers**  
Review date: **2026-10-29 หรือทันทีเมื่ออัปเดต Next.js / next-pwa แล้วแต่ว่าอะไรเกิดก่อน**

| Dependency path | Affected operation | Reachability analysis | Disposition |
| --- | --- | --- | --- |
| `next@15.5.26 → postcss@8.4.31` | Next.js production build compiles repository-owned CSS | PostCSS ไม่ประมวลผล CSS หรือ source map จาก HTTP request/runtime input; package ถูก bundle มากับ Next.js 15 และ audit เสนอเฉพาะ Next.js 16.3.7 ซึ่งอยู่นอกขอบเขตรอบนี้ | ยอมรับชั่วคราวบน Next.js 15 LTS และทบทวนเมื่อมี 15.x patch หรือรอบ migration 16 |
| `@ducanh2912/next-pwa → workbox-build / workbox-webpack-plugin → @rollup/plugin-terser → serialize-javascript@6.0.2` | สร้าง Service Worker ระหว่าง production build | ค่า serialize มาจาก Workbox build configuration และ asset manifest ที่ repository ควบคุม ไม่มาจาก request/user data ใน production; package เหล่านี้ไม่อยู่ใน request-time application path | ยอมรับชั่วคราว; ติดตาม next-pwa/Workbox และรัน PWA browser regression เมื่อมี safe update |

`npm audit` นับ package chain ด้านบนเป็น 7 vulnerability records แม้มี root cause หลักสองสาย การ downgrade `@ducanh2912/next-pwa` เป็น `10.2.6` ตามคำแนะนำอัตโนมัติไม่ได้พิสูจน์ว่าเป็น security upgrade และเสี่ยงทำให้ PWA behavior ถดถอย จึงไม่ทำ การใช้ override ข้าม major ของ `serialize-javascript` ก็ไม่ทำเพราะไม่มี support contract จาก Workbox รุ่นปัจจุบัน
