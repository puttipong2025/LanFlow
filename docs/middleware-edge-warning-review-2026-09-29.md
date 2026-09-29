# Middleware Edge Warning Review — 2026-09-29

## Result

คำเตือน Edge Runtime จาก import chain `src/lib/supabase/middleware.ts → @supabase/ssr → @supabase/supabase-js` ที่พบใน baseline Next.js 15.5.24 **ไม่เกิดซ้ำ** หลังอัปเดตเป็น Next.js 15.5.26

Minimal reproduction:

```text
npm run build
```

Production build ผ่านและรายงาน middleware ประมาณ 90.3 kB โดยไม่มี Edge Runtime warning ดังกล่าว จึงไม่เพิ่ม warning suppression และไม่เปลี่ยน auth runtime boundary

## Dependency decision

- คง `@supabase/ssr@0.6.1` และ API `createServerClient` เดิม
- รุ่นล่าสุดที่ตรวจเมื่อ 2026-09-29 คือ `@supabase/ssr@0.12.7` และต้องการ `@supabase/supabase-js ^2.114.0`
- เนื่องจาก `@supabase/ssr` ยังเป็น 0.x, warning หายแล้ว และไม่มี runtime failure ที่พิสูจน์ได้ การย้ายรุ่นในรอบนี้จะขยายขอบเขตโดยไม่มีประโยชน์ที่วัดได้

## Regression boundary

การตรวจรอบปิดต้องคงพฤติกรรมต่อไปนี้:

- anonymous และ invalid session ถูกปฏิเสธตามเดิม
- cookie session และ Bearer session ใช้ precedence เดิม
- public/static paths ไม่ถูก redirect
- page request ที่ไม่มี session ถูก redirect ไป `/login`

Review again: 2026-10-29 หรือเมื่อ Edge warning กลับมาเกิดซ้ำ

## Verification receipt

- `npm run test:auth-outage`: ผ่านและ `/login` ไม่เรียก Supabase เมื่อ upstream ใช้งานไม่ได้
- Bearer identity precedence และ invalid Bearer rejection: ผ่าน
- User role self-service boundary: ผ่านและไม่ยิง business-module API request
- Anonymous `/` redirect ไป `/login`, public paths เปิดได้ และ anonymous API ไม่ถูก redirect: ผ่าน
