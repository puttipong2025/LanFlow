# ADR-0061: เก็บสำเนารหัสผ่านปัจจุบันสำหรับ Super Admin

- Status: Accepted
- Date: 2026-09-04
- Owners: LanFlow team
- Decision scope: Password change/reset, privileged password visibility, session checks

## Context

LanFlow ใช้ Supabase Auth เป็น identity provider ซึ่งไม่สามารถคืน plaintext จาก password hash ได้ เจ้าของระบบยืนยันว่าต้องการให้ Super Admin เพียงบัญชีเดียวเปิดดูรหัสผ่านปัจจุบันของทุกบัญชี และยอมรับความเสี่ยงของการเก็บข้อมูลแบบอ่านกลับได้

ทุกบทบาทต้องเปลี่ยนรหัสผ่านตนเองได้ ผู้จัดการระบบและ Super Admin ต้องรีเซ็ตรหัสผ่านบัญชีอื่นได้ตามสิทธิ์เดิม แต่ผู้จัดการระบบต้องไม่เปิดดูค่าที่จัดเก็บ

## Decision

1. เพิ่ม nullable `public.profiles.current_password_plaintext` และ `current_password_auth_version` โดยไม่ backfill และไม่ใช้ legacy `password_hash`
2. Supabase Auth ยังคงเป็นแหล่ง authentication จริง สำเนานี้เป็นข้อมูลแสดงผลเท่านั้น
3. บันทึกเพียงค่าปัจจุบัน เขียนทับค่าเดิม และไม่สร้างประวัติ
4. ห้าม `anon` และ `authenticated` เลือกคอลัมน์โดยตรง ทุก read/write ผ่าน server ที่ใช้ service role หลัง authorization
5. endpoint เปิดดูเป็น per-user, ใช้ exact `requireRole(["super_admin"])`, ตรวจว่า JWT `session_id` ยังอยู่ใน `auth.sessions` และส่ง `Cache-Control: private, no-store, max-age=0`
6. ผู้จัดการระบบและ Super Admin ใช้ admin reset เดิม แต่เพิ่ม active-session check; ห้าม reset ตนเอง, Super Admin หรือบัญชี inactive ตาม database workflow เดิม
7. self-change ใช้ `/api/auth/password`: ยืนยัน current password ด้วย request-scoped Supabase client แล้วใช้ user-scoped `auth.updateUser`
8. consistency invariant คือ **NULL ดีกว่าค่า stale**: หลัง validate ให้ clear copy ก่อนเปลี่ยน Auth แล้วเขียนค่าใหม่เมื่อ Auth สำเร็จ หากเขียน copy ไม่สำเร็จให้รายงานว่า password เปลี่ยนแล้วแต่ข้อมูลเปิดดูไม่พร้อม
9. ทุก password mutation เขียน UUID version เดียวกันลง Auth user metadata และ profile; reveal แสดงค่าเฉพาะเมื่อ version ตรงกัน เพื่อกัน concurrent/out-of-order write และล้างค่าไม่ตรงแบบมีเงื่อนไข
10. ห้าม secret ปรากฏใน users list, audit, log, cache, mutation response หรือ error

## Session semantics

- self-change คง refresh session ปัจจุบันและยกเลิก refresh session อื่น
- admin reset ยกเลิก refresh session เดิมทั้งหมดของบัญชีเป้าหมาย
- access JWT ที่ออกแล้วอาจใช้กับ route ทั่วไปได้จนหมดอายุ; local expiry คือ 3,600 วินาที
- password reveal และ admin reset จึงตรวจ active session เพิ่มเติม ส่วน route อื่นยังใช้ `requireAuth()` ตามเดิม

## Alternatives considered

- **ไม่เก็บ plaintext** — ปลอดภัยกว่าแต่ไม่ตอบข้อกำหนดที่เจ้าของระบบยืนยัน
- **เข้ารหัส reversible ด้วย key ของแอป** — เพิ่ม key lifecycle และ operational complexity แต่ผู้ที่ได้ key ยังอ่านค่าทั้งหมดได้ จึงไม่เลือกในขอบเขตที่ยอมรับความเสี่ยงแล้ว
- **สร้างตาราง secret แยก** — เพิ่ม FK, lifecycle และอีก write seam โดยไม่เพิ่มประโยชน์สำหรับ one-to-one nullable state
- **สร้างระบบ revoke session เอง** — ไม่เลือก เพราะ Supabase password update มี behavior ที่ต้องการและมี integration test กำกับ

## Consequences

- ผู้ที่เข้าถึง service-role environment หรือ database backup สามารถอ่านรหัสผ่านได้
- บัญชีเดิมแสดง “ยังไม่มีข้อมูล” จนกว่าจะสร้าง เปลี่ยน หรือถูกรีเซ็ตผ่านระบบใหม่
- Auth กับ display copy ไม่อยู่ใน transaction เดียวกัน จึงต้องรักษาลำดับ clear-before-change และตรวจ UUID version ก่อน reveal
- ต้อง deploy migration ก่อน application

## Verification

- pgTAP ตรวจ column privilege และ active-session RPC
- Playwright/API integration ตรวจทุก role, exact Super Admin reveal, System Manager reset/no-reveal, concurrent reset, revoked privileged session, idempotency, session behavior และ leakage
- browser test ตรวจ account UI และ notification ใน native dialog
