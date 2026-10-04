# Rubber Bill Central Price and Admin Quota — Implementation Plan

Status: implemented on 2026-10-02 and reverified locally on 2026-10-03

## Outcome

ใช้ราคากลางยางหนึ่งค่าเดียวทั้งระบบเป็นฐานตัดสินราคา และให้แต่ละกลุ่มกำหนดได้เพียงว่า Admin ซื้อสูงกว่าราคากลางได้อีกกี่บาทต่อกิโลกรัม ผู้ใช้โควต้าสามารถข้ามการอนุมัติด้านราคาได้ตามจำนวนสิทธิ์ของตนเมื่อราคายังอยู่ในเพดานของกลุ่ม โดย Server เป็น authority ของกฎ ราคา โควต้า และการตัดสิทธิ์ทั้งหมด

งานตามแผนนี้เสร็จครบทุก phase ใน local workspace แล้ว ยังไม่ได้ apply Cloud, commit, push หรือ deploy ซึ่งคงอยู่นอกขอบเขตจนกว่าผู้ใช้จะสั่งแยก

## Implementation result

- Phase 0: ตรวจ repository/working tree, เก็บ baseline และยืนยันขอบเขตสำเร็จ
- Phase 1: เพิ่ม migration `20261002010000_rubber_central_price_admin_quota.sql`, server-authoritative decision, atomic quota ledger, revision/provenance และ schema snapshot สำเร็จ
- Phase 2: เพิ่ม API, types, cache v4, preview/confirm/finalize และ replay ที่ไม่ใช้โควต้าอัตโนมัติสำเร็จ
- Phase 3: เพิ่มหน้าตั้งค่าราคากลาง กลุ่ม/สาขาที่ยังไม่จัดกลุ่ม โควต้าเฉพาะ super admin ข้อมูลอ้างอิงราคา และ confirmation dialog สำเร็จ โดยคงข้อมูลโควต้าออกจากรายละเอียดบิลและ PDF
- Phase 4: fresh database reset, pgTAP 36 files/804 assertions, route-auth 85 tests, isolated 148 tests, focused Rubber Bill API/UI/offline tests, PWA production-mode test, production build, service-worker/bundle checks และ schema parity ผ่าน
- Post-implementation scrutiny: ลบตัวแปร SQL และ response fields ที่ไม่มี consumer, บังคับ RPC ตรวจสิทธิ์ก่อน validate input, และแก้ route mapping ของสาขาที่ไม่มี/ปิดใช้งานจาก 500 เป็น 400 พร้อม regression tests
- Second scrutiny pass: ปิด route input ที่เกินขอบเขต PostgreSQL ไม่ให้กลายเป็น 500, ป้องกัน stale cross-group move ด้วย revision ของกลุ่มต้นทาง, ป้องกัน invalid location ทำให้กฎวันที่ถูกบันทึกทั้งที่ route ตอบ 404, และลบ decision metadata ซ้ำที่ไม่มี consumer
- Third scrutiny pass: ปิดการเผย PostgreSQL cast/internal errors, ป้องกันการนำ quota operation key เก่าไปผูกกับบิลอื่น, คง historical retry ของบิลเดิมหลังมี update และเพิ่ม regression tests ครอบคลุม quota ledger identity กับ non-price update
- Fourth scrutiny pass: ปิดช่องที่ `ราคากลาง + ส่วนต่างราคา` เกินขอบเขต `numeric(12,2)` แม้แต่ละค่าผ่าน validation แยกกัน, คืน route error ที่เสถียรเป็น 400 และเพิ่ม regression tests ครอบคลุม central/group/ungrouped; ตรวจเส้นทาง re-evaluate หลังล็อกโควต้าแล้ว core guard กับ transaction rollback ยังป้องกัน relation race และ OCR side effect ได้ จึงไม่เพิ่ม branch ซ้ำหรือถอด decision fields ที่ SQL ยังใช้
- Fifth scrutiny pass: ผูก replay identity กับ `operation + expected revision + bill status` ทั้งบิลที่ sync แล้ว คำขออนุมัติที่ยัง pending และ historical quota ledger; ป้องกัน preview อ่าน bill คนละสาขาผ่าน security-definer, ตรวจ auth/identity ก่อน normalize payload, และรายงาน `quotaConsumed` เฉพาะ ledger ของ operation/revision ปัจจุบัน พร้อม regression ที่ระดับ RPC และ route
- Phase 5: อัปเดต ADR, context, implementation plan และ codingDO Vault ด้วยหลักฐานที่ตรวจยืนยันแล้ว โดยไม่ทำ Cloud/commit/push/deploy

ระหว่าง Debug Mantra/Scrutiny พบและแก้ fail-path สำคัญเพิ่มเติม ได้แก่ PostgREST safe-update ที่ปฏิเสธการอัปเดตราคากลางทุกกลุ่ม, idempotent retry ที่ต้องเกิดก่อน policy locks, stale confirmation/rule revision, การคง historical snapshots, offline queue ที่ต้องไม่เก็บ confirmation และ cache test เก่าที่อ้าง v1/v3

## Scrutiny result applied to this plan

หลังตรวจ call graph จริง แผนถูกปรับให้แก้ช่องว่างสำคัญดังนี้:

- ใช้แถว singleton เดิมใน `rubber_bill_approval_settings` เป็นศูนย์รวมค่าระบบ แทนการสร้าง singleton ใหม่แยกสำหรับราคากลาง ค่าเริ่มต้นสาขาที่ยังไม่จัดกลุ่ม และโควต้า
- เพิ่ม protocol `preview → confirm → finalize` เพื่อให้หน้าต่างยืนยันแสดงกฎล่าสุดและป้องกันการใช้ confirmation เก่าหลังราคาหรือรอบโควต้าเปลี่ยน
- ใช้ quota ledger ที่แบ่งด้วย `Bangkok business date + quota round` แทนการ update/reset ตัวนับของผู้ใช้ทุกคนเมื่อถึงวันใหม่หรือบันทึกค่าโควต้า
- เพิ่ม atomic membership replacement/move เพราะ RPC ปัจจุบันไม่อนุญาตให้สาขาที่อยู่กลุ่มหนึ่งถูกเพิ่มเข้ากลุ่มอื่นโดยตรง และการ save สองครั้งไม่สามารถรับประกัน actor/time เดียวกันบนทุกการ์ดได้
- เพิ่ม snapshot ใหม่แบบ append-only แทนการเปลี่ยนความหมาย `configured_price_snapshot` เดิม เพื่อไม่ให้ข้อมูลประวัติราคาเต็มถูกตีความเป็นส่วนต่าง
- เปลี่ยน online submit flow ที่ปัจจุบัน enqueue ก่อนเรียก API ให้ confirmation token เป็นข้อมูลชั่วคราวที่ไม่ถูกเก็บใน offline queue และ replay ไม่มีสิทธิ์ใช้โควต้า
- แยก UI/hook ใหม่แทนการเพิ่มโค้ดเข้าไฟล์ขนาดเกิน baseline ได้แก่ `RubberBillModal.tsx`, `RubberBillsModule.tsx` และ `useRubberBills.ts`

## Final domain rules

### One central price

- มี `ราคากลางยาง` เพียงหนึ่งค่าทั้งระบบ หน่วยบาทต่อกิโลกรัม
- ค่าเริ่มต้นหลัง migration คือ `42.00`
- ค่าเริ่มต้นแสดง `ปรับล่าสุดโดย ระบบ` และใช้เวลาที่ migration สำเร็จตาม `Asia/Bangkok`
- ราคากลางต้องมากกว่า `0` และมีทศนิยมไม่เกิน 2 ตำแหน่ง
- ผู้จัดการระบบและ super admin แก้ราคากลางได้
- หน้าตั้งค่าแสดงชื่อและเวลาของผู้ปรับล่าสุด แต่ไม่มีหน้าประวัติราคา
- การเปลี่ยนราคากลางมีผลเฉพาะ Submit ใหม่ ไม่แก้ pending request, บิล, revision หรือ snapshot เดิม และไม่รีเซ็ตโควต้า
- การกรอกค่าเท่าปัจจุบันเป็น no-op: ปุ่มบันทึกปิด ไม่เปิด confirmation และไม่เปลี่ยนผู้ปรับล่าสุด
- Save ต้องใช้ optimistic concurrency หากค่าหรือ revision เปลี่ยนหลังเปิดฟอร์ม ให้โหลดค่าล่าสุดและขอให้ผู้ใช้ยืนยันคู่ค่าเดิม→ค่าใหม่อีกครั้ง

### Group allowance

- ช่องเดิม `ราคายางที่กำหนด` เปลี่ยนความหมายจากราคาเต็มเป็น `จำนวนบาทต่อกิโลกรัมที่ซื้อเกินราคากลางได้`
- ค่าว่างและ `0` มีผลเท่ากัน คือเพดานของกลุ่มเท่ากับราคากลาง
- สูตรเพดานของกลุ่มคือ `ราคากลาง + ราคายางที่กำหนด`
- ตัวอย่าง: ราคากลาง `42.00` และค่ากลุ่ม `3.00` ให้เพดาน `45.00`
- ผู้จัดการระบบและ super admin ยังคงสร้าง แก้ไข และลบกลุ่ม รวมถึงแก้ส่วนต่างและช่วงเวลาได้ตามสิทธิ์เดิม
- การเปลี่ยนส่วนต่างหรือสมาชิกกลุ่มมีผลเฉพาะ Submit ใหม่ ไม่แก้ snapshot เดิมและไม่รีเซ็ตโควต้า
- การ์ดแต่ละกลุ่มแสดงผู้ปรับล่าสุดและเวลา `Asia/Bangkok`; ตอนสร้างใช้ชื่อผู้สร้าง และเมื่อแก้สมาชิก ส่วนต่าง หรือช่วงเวลา ให้แทนด้วยผู้กระทำล่าสุดโดยไม่มีหน้าประวัติ
- การย้ายสาขาอัปเดตผู้กระทำและเวลาเดียวกันบนทุกการ์ดที่สมาชิกเปลี่ยน ทั้งกลุ่มต้นทาง กลุ่มปลายทาง และการ์ดสาขาที่ยังไม่จัดกลุ่ม

### Ungrouped branch defaults

- สาขาที่ยังไม่จัดกลุ่มใช้กฎและโควต้าเหมือนสาขาที่จัดกลุ่ม ไม่เป็นเหตุอนุมัติด้วยตัวเอง
- ทุกสาขาที่ยังไม่จัดกลุ่มใช้ส่วนต่างราคาและช่วงเวลาแก้ไขชุดเดียวกัน ค่าเริ่มต้นคือ `0 บาท/กก.` และ `30 นาที`
- ผู้จัดการระบบและ super admin แก้ค่าชุดนี้ได้; Admin ทั่วไปเห็นเฉพาะค่าที่นำไปใช้กับบิล
- การ์ดแสดงอยู่ตลอดแม้ไม่มีสมาชิก พร้อมข้อความ `ยังไม่มีสาขาที่ใช้ค่านี้` และยังแก้ค่าเพื่อเตรียมกฎในอนาคตได้
- ค่า seed แสดงผู้ปรับล่าสุดเป็น `ระบบ`; การแก้ค่า สมาชิกเข้า–ออก หรือการลบกลุ่มที่ย้ายสาขาเข้ามา ให้แทนด้วยชื่อผู้กระทำและเวลาเดียวกัน
- การเปลี่ยนค่าหรือสมาชิกมีผลเฉพาะ Submit ใหม่ ไม่แก้ snapshot เดิมและไม่รีเซ็ตโควต้า

### Price and quota decision

- ใช้ราคาของแต่ละรายการชั่ง ไม่ใช้ราคาเฉลี่ย
- ราคาไม่เกินราคากลาง: บันทึกตาม workflow ปกติและไม่ใช้โควต้า
- ราคาสูงกว่าราคากลาง แต่ทุกรายการไม่เกิน `ราคากลาง + ส่วนต่างกลุ่ม`: ใช้โควต้าได้เมื่อบัญชียังเหลือสิทธิ์
- ราคาเท่ากับเพดานใช้โควต้าได้
- หากมีอย่างน้อยหนึ่งรายการสูงกว่าเพดาน หรือโควต้าหมด: ส่งอนุมัติทั้งบิลและไม่ตัดสิทธิ์
- ตอน update ประเมินโควต้าเมื่อราคาเปลี่ยนและยังมีรายการสูงกว่าราคากลาง การแก้ข้อมูลที่ไม่ใช่ราคาไม่ใช้สิทธิ์ใหม่ และไม่ตรวจราคาที่ไม่ได้เปลี่ยนซ้ำเพียงเพราะกฎภายหลังลดลง
- การลดราคาจนไม่เกินราคากลางไม่ใช้สิทธิ์ใหม่
- กฎวันที่บิล ช่วงเวลาแก้ไข การลบ และ relation/report locks มีอำนาจเหนือโควต้า โควต้าข้ามได้เฉพาะเหตุผลอนุมัติด้านราคา

### Quota scope, reset, and consumption

- ผู้ใช้โควต้าคือบัญชี active ที่เป็น Admin, ผู้จัดการระบบ หรือ super admin
- ทุกบัญชีได้รับจำนวนสิทธิ์ค่ากลางเดียวกัน แต่มีตัวนับแยกต่อบัญชีและใช้ก้อนเดียวรวมทุกสาขาที่บัญชีนั้นดูแล
- รีเซ็ตทุกวันเวลา 00:00 น. ตาม `Asia/Bangkok`
- เฉพาะ exact role `super_admin` ตั้งจำนวนโควต้าได้ ผู้จัดการระบบเห็นค่าปัจจุบันแบบอ่านอย่างเดียว
- ฟอร์มโควต้ามีเพียง `จำนวนโควต้าต่อ Admin ต่อวัน` ซึ่งเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป ไม่มีช่องส่วนต่างราคา
- ค่าเริ่มต้นคือ `0`; ค่า `0` หมายถึงปิดการข้ามอนุมัติด้วยโควต้า แต่ราคาไม่เกินราคากลางยังบันทึกตามปกติ
- การบันทึกค่าโควต้าทุกครั้ง รวมถึงค่าเดิม เริ่มรอบใหม่และรีเซ็ตยอดใช้ของทุกบัญชีทันที
- ใช้หนึ่งสิทธิ์ต่อบิลต่อ Submit ที่สำเร็จ ไม่คิดตามจำนวนรายการชั่ง
- Bill mutation กับ quota consume ต้องสำเร็จหรือ rollback ใน transaction เดียว
- ยกเลิก confirmation หรือ mutation ล้มเหลวไม่ตัดสิทธิ์
- สิทธิ์ที่ใช้สำเร็จแล้วไม่คืน แม้ภายหลังลดราคา แก้ไข หรือลบบิล

### Server authority and concurrent changes

- Server ตรวจ central price, group allowance, approval reasons, quota round และยอดใช้ล่าสุดใน transaction
- ถ้าสองเครื่องแย่งสิทธิ์สุดท้าย มีเพียง transaction เดียวตัดโควต้า อีก transaction สร้าง approval request และแจ้ง `โควต้าถูกใช้ครบแล้ว รายการถูกส่งขออนุมัติ`
- Confirmation ใช้ได้เฉพาะกับ rule revision ที่แสดง หาก central price หรือ group allowance เปลี่ยนจนกฎล่าสุดเพิ่งทำให้ต้องใช้โควต้า ให้หยุด mutation โหลดค่าล่าสุด และเปิด confirmation ใหม่
- หากกฎล่าสุดทำให้ไม่ต้องใช้โควต้า ให้บันทึกตามปกติโดยไม่ตัดสิทธิ์
- Pending approval request คง snapshot และผลตัดสินเดิม ไม่คำนวณใหม่จากค่าตั้งปัจจุบัน
- เก็บ internal snapshot ของผู้ใช้ ราคากลาง ส่วนต่างกลุ่ม เพดาน และลำดับสิทธิ์ที่ใช้ เพื่ออธิบาย revision และนับสิทธิ์อย่างถูกต้อง
- Quota use เป็นข้อมูลภายใน ตาราง รายละเอียดบิล ใบรับบิล และ PDF แสดงเหมือน `ไม่ต้องอนุมัติ` โดยไม่แสดงป้ายหรือข้อมูลโควต้า/ราคากลาง

### Idempotency and no-op rules

- Bill Submit หนึ่งครั้งมี operation/idempotency key เดิมตลอด preview, final request และ network retry
- quota ledger มี unique key ที่ผูกกับผู้ใช้และ operation นั้น เพื่อไม่ให้ retry หรือ replay ตัดสิทธิ์ซ้ำ
- ถ้า final request สำเร็จแล้วแต่ client ไม่ได้รับ response การ retry ต้องคืนผลเดิม ไม่สร้างบิล คำขอ หรือ quota use ซ้ำ
- Save central/group/default ที่ค่าและสมาชิกไม่เปลี่ยนเป็น no-op ไม่เพิ่ม rule revision และไม่เปลี่ยน actor/time
- Save quota เป็นข้อยกเว้น: แม้จำนวนเท่าเดิมก็ต้องสร้าง quota round ใหม่ตามกติกาที่ผู้ใช้ยืนยัน

### Offline behavior

- ใช้พฤติกรรมเดิมของราคากลุ่ม: client ใช้ snapshot ราคากลางล่าสุดเป็นตัวคัดกรองเบื้องต้น
- ขณะออฟไลน์ บล็อก Submit ที่ราคาเกิน central-price snapshot หรือทราบอยู่แล้วว่าต้องอนุมัติ และห้ามใช้หรือจองโควต้า
- ทั้งสาขาที่จัดกลุ่มและยังไม่จัดกลุ่มซึ่งราคาไม่เกิน snapshot ราคากลางและไม่ติดกฎอนุมัติอื่น ยังคงใช้ offline workflow เดิม
- ตอน replay Server ตรวจราคากลางและกฎล่าสุด หากกฎเปลี่ยนจนต้องอนุมัติ ให้สร้าง approval request แบบ idempotent แทนบิลปกติ โดยไม่ใช้โควต้าอัตโนมัติ

## Migration contract

- เพิ่ม/ปรับ schema แบบ append-only ตามกติกา migration ของ repository
- Seed central price เป็น `42.00`, updater kind เป็น `system`, และ timestamp เป็นเวลาที่ migration สำเร็จ
- Seed ค่ากลางสาขาที่ยังไม่จัดกลุ่มเป็น allowance `0`, edit window `30` นาที และผู้ปรับเป็น `ระบบ`
- แปลงเฉพาะค่าตั้งราคาเต็มของกลุ่มเดิมด้วยสูตร `max(ราคาเดิม - 42, 0)`
- ค่าเดิม `45` กลายเป็น `3`; ค่าเดิม `42`, `40`, `0` หรือ `null` กลายเป็น `0`/ว่าง
- ยอมรับโดยเจตนาว่ากลุ่มเดิมที่เพดานต่ำกว่า `42` จะมีเพดานใหม่เท่าราคากลาง เพราะโมเดลใหม่ไม่มีส่วนต่างติดลบ
- ห้าม rewrite บิล, revision, pending/completed approval request หรือ snapshot เดิม
- ต้องมี validation, uniqueness/singleton guard, grants/RLS, locked `search_path`, transaction boundary และ rollback strategy ที่ตรวจสอบได้
- ใช้ `rubber_bill_approval_settings` แถว `id = true` ที่มีอยู่แล้ว โดยเพิ่มคอลัมน์แยกสำหรับ central, ungrouped defaults, quota และ revision; ห้ามใช้ `updated_by*` ชุดเดิมร่วมกัน เพราะชุดเดิมเป็น provenance ของกฎวันที่บิล
- เพิ่ม `price_allowance` ในกลุ่มและ backfill จาก `configured_price` เดิม แทนการ rename/เปลี่ยนความหมายคอลัมน์เดิมทันที เพื่อให้ migration เป็น forward-compatible และไม่ทำให้ app รุ่นเดิมตีความข้อมูลใหม่ผิด
- ก่อน backfill ต้องรัน preflight รายงานจำนวนกลุ่ม ค่า `null/0/<42/=42/>42`, min/max และ group IDs ที่เพดานจะถูกยกขึ้นเป็น `42`; เก็บผลไว้เป็นหลักฐาน deployment
- หลัง backfill ต้อง assert ว่า allowance ทุกค่ามากกว่าหรือเท่ากับ `0`, ทศนิยมไม่เกิน 2 ตำแหน่ง และ `central + allowance` ตรงกับสูตรที่ยืนยัน
- หลีกเลี่ยงการแก้ function definition ด้วย `pg_get_functiondef`/string replacement แบบ migration เดิม; สร้าง helper/dispatcher รุ่นใหม่ด้วย source ที่ตรวจสอบและทดสอบได้โดยตรง

## Target data and server design

### Reuse one global settings row

เพิ่มค่าต่อไปนี้ใน `rubber_bill_approval_settings (id = true)` โดยแยก provenance ของแต่ละ section:

- `central_price`, `central_price_revision`, `central_price_updated_at/by_*`
- `ungrouped_price_allowance`, `ungrouped_edit_window_minutes`, `ungrouped_revision`, `ungrouped_updated_at/by_*`
- `quota_limit_per_admin`, `quota_round_id`, `quota_updated_at/by_*`
- `price_rule_revision` สำหรับ invalidate confirmation เมื่อ central, allowance หรือ membership ที่มีผลต่อราคาเปลี่ยน
- คง date-rule columns และ `updated_by*` เดิมไว้เพื่อ compatibility; ไม่ใช้เป็น actor ของ section ใหม่

กลุ่มใช้ `price_allowance` ใหม่ เพิ่ม `revision_no` สำหรับ optimistic concurrency และใช้ `updated_at/by_*` ที่มีอยู่ ส่วน list RPC ต้องคืนชื่อ/เบอร์ผู้กระทำล่าสุดให้ UI ด้วย สาขาที่ยังไม่จัดกลุ่มอ่านค่าจาก global row จึงไม่ต้องมี group ปลอม

### Logical quota reset and ledger

- สร้าง internal quota-use ledger โดยอย่างน้อยมี `actor_user_id`, `bangkok_business_date`, `quota_round_id`, `operation_key`, `operation`, `bill_id/revision`, `created_at`
- unique constraint ป้องกัน operation เดิมตัดโควต้าซ้ำ และ index รองรับการนับต่อ `(actor, date, round)`
- การรีเซ็ตเที่ยงคืนทำโดยเปลี่ยน business-date bucket อัตโนมัติ ไม่ใช้ cron และไม่ update บัญชีผู้ใช้
- การ save quota เพิ่ม/เปลี่ยน `quota_round_id` ใน transaction เดียว แม้จำนวนเท่าเดิม ทำให้ทุกบัญชีเริ่ม bucket ใหม่ทันทีโดยไม่ mass update
- ledger เป็นข้อมูล correctness ภายใน ไม่ใช่ history UI และไม่ถูกส่งไป bill list/detail/receipt/PDF

### Append-only decision snapshots

- เพิ่ม snapshot ใหม่ใน bill/revision/approval request ตามจุดที่ระบบเก็บ snapshot อยู่แล้ว: central price, allowance, effective cap, price-rule revision, rule source (`group`/`ungrouped`) และ quota-use reference เมื่อมี
- คง `configured_price_snapshot` เดิมไว้สำหรับข้อมูลเก่า ห้ามตีความค่าประวัติเป็น allowance
- pending request ใช้ snapshot ตอนสร้างคำขอจนจบ ไม่ re-evaluate ด้วยค่าปัจจุบัน

### One shared decision engine

สร้าง helper เดียวสำหรับ resolve policy/decision แล้วใช้ทั้ง preview และ final mutation เพื่อไม่ให้สูตรแยกกันสองชุด:

1. ตรวจ user/location/payload/idempotency และหา policy ปัจจุบันจาก group หรือ ungrouped default
2. ตรวจ relation/report locks, non-current-date, edit-window และ delete rules ก่อน quota
3. สำหรับ update ให้ประเมินราคาเฉพาะเมื่อ price rows เปลี่ยนจริง
4. ถ้าราคาทุกแถว `<= central` ให้ direct โดยไม่ใช้ quota
5. ถ้ามีแถว `> effective cap` ให้ price approval โดยไม่ใช้ quota
6. ถ้าอยู่ช่วง `central < price <= cap` และ quota เหลือ ให้ตอบว่าต้อง confirmation; หาก quota หมดให้สร้าง price approval
7. final mutation ต้อง resolve ซ้ำใน transaction เดียวกับ core bill mutation/approval request และ quota ledger

public `sync_rubber_bill` ยังคงเป็น composition boundary สำหรับ Bangkok date rule และ OCR source reservation จากนั้นเรียก policy dispatcher รุ่นใหม่และ existing core mutation โดยผล `rule_changed`, `confirmation_required`, `pending_approval`, `synced`, `conflict`, `failed` ต้องมี contract ชัดเจน ห้ามใช้การจับข้อความ error เป็นหลัก

### Preview, confirmation, and final mutation protocol

- เพิ่ม authenticated decision-preview endpoint/RPC แบบ read-only รับ operation key และ proposed payload แล้วคืน `disposition`, central, allowance, cap, current remaining, remaining-after-confirm, `price_rule_revision`, `quota_round_id` และ `decision_fingerprint` ที่ผูกกับ actor/location/operation/normalized price rows
- Client เปิด dialog เฉพาะ `quota_confirmation_required`; confirmation ส่ง revision/round/fingerprint ที่ผู้ใช้เห็นกลับไปกับ final request แบบ ephemeral
- Server ไม่เชื่อราคาหรือจำนวนคงเหลือจาก client และ re-evaluate เสมอ
- ถ้า payload fingerprint ไม่ตรง หรือ rule/round เปลี่ยนแล้วยังเข้าเงื่อนไขใช้ quota ให้คืน `rule_changed` โดยไม่สร้างบิล/คำขอ/ledger แล้ว client โหลด preview ล่าสุดและขอยืนยันใหม่
- หากกฎล่าสุดเปลี่ยน disposition เป็น direct ให้บันทึกโดยไม่ใช้ quota; หากกลายเป็น approval-required ให้สร้างคำขอ; หากสิทธิ์สุดท้ายถูกคนอื่นใช้ใน round เดียวกันโดยกฎ/round ยังตรง ให้สร้าง price approval และคืนข้อความ fallback ที่กำหนดไว้
- ใช้ transaction/advisory lock ที่ scope ต่อ `actor + Bangkok date + quota round` เพื่อ serialize การแย่งสิทธิ์ของบัญชีเดียวกัน โดยไม่ล็อกทุก Admin ทั้งระบบ
- API route โควต้าใช้ `requireRole(request, ["super_admin"])`; RPC ตรวจ exact database role ซ้ำ ส่วน central/group/default ใช้ system-manager boundary เดิม
- Interactive submit กับ replay ต้องส่ง submission mode จาก route/RPC boundary ที่ชัดเจน ไม่เก็บ mode/confirmation เป็น authority ใน queue; replay mode เปลี่ยนกรณี quota-eligible เป็น approval โดยไม่เปิด confirmation และไม่มีทาง consume quota

### Atomic group membership mutation

- เพิ่ม RPC สำหรับ replace/move membership หนึ่ง transaction ภายใต้ global group-assignment advisory lock
- lock กลุ่มต้นทาง/ปลายทางและ singleton default, ตรวจ optimistic revisions และห้ามเหลือกลุ่มว่าง (กรณีสมาชิกสุดท้ายให้ใช้ delete-group flow)
- ใช้ timestamp เดียวและ actor เดียวอัปเดตทุกกลุ่ม/default ที่ membership เปลี่ยน พร้อมเพิ่ม `price_rule_revision` ครั้งเดียว
- delete group ต้องย้ายสมาชิกเข้าสู่ ungrouped default, อัปเดต default actor/time และ rule revision ใน transaction เดียว
- response คืน affected location IDs และ server-confirmed cards เพื่อ update query cache โดยไม่ต้องเดา state ฝั่ง client

### Cache and offline boundary

- เปลี่ยน effective-settings response เป็น `centralPrice`, `priceAllowance`, `effectivePriceCap`, `priceRuleRevision`, `ruleSource`, edit/date rules และ provenance ที่จำเป็น; retire `priceTimeExempt` เพราะ ungrouped ไม่ได้รับการยกเว้นอีกต่อไป
- bump local cache prefix จาก v3 เป็น v4 และไม่อ่าน cache shape เก่า
- online create/update ทำ preview ก่อน enqueue; หลังผู้ใช้ยืนยันจึง enqueue sanitized base payload แล้วส่ง final request โดย confirmation token ไม่ถูก persist
- ถ้า final response เป็น `rule_changed`/`confirmation_required` ให้ลบ provisional queue item และกลับเข้า dialog; ถ้า network outcome ไม่แน่นอนให้คง base operation key เพื่อ retry/replay แบบ idempotent แต่ไม่มี reusable confirmation
- offline create enqueue ได้เฉพาะเมื่อ cached central/date rules อนุญาต; replay ไม่มี confirmation และจึงไม่มีทางใช้ quota ระบบจะ direct เมื่อไม่ต้องใช้ quota หรือสร้าง approval request เมื่อจำเป็น
- invalidation ขั้นต่ำ: central เปลี่ยนกระทบทุกสาขา, group allowance กระทบสมาชิกกลุ่ม, ungrouped default กระทบสาขาที่ยังไม่จัดกลุ่ม, membership กระทบ location IDs ที่ย้าย; mutation response ต้อง merge authoritative state ก่อน background refetch

## UI contract

### Settings order

หน้าต่าง `ตั้งค่าและอนุมัติบิลยาง` เรียงส่วนดังนี้:

1. งานรออนุมัติ
2. ราคากลางยาง
3. กลุ่มส่วนต่างราคา/เวลา
4. โควต้า Admin
5. กฎวันที่บิล

### Central price section

- ผู้จัดการระบบและ super admin เห็นค่าปัจจุบัน ผู้ปรับล่าสุด และเวลา `Asia/Bangkok`
- ก่อน save เปิด dialog แสดงค่าเดิม→ค่าใหม่ และเตือนว่าเพดานของทุกกลุ่มจะเปลี่ยนทันทีสำหรับ Submit ใหม่ โดยไม่รีเซ็ตโควต้าหรือเปลี่ยนคำขอเดิม
- ปุ่มคือ `ยืนยันราคากลาง` และ `ยกเลิก`
- การชน optimistic concurrency แสดง `ราคากลางถูกแก้ไขโดยผู้ใช้อื่น กรุณาตรวจสอบค่าล่าสุดและยืนยันอีกครั้ง`

### Group section

- Label: `ราคายางที่กำหนด — ซื้อเกินราคากลางได้`
- Unit: `บาท/กก.`
- Helper: `เว้นว่าง = 0 บาท`
- การ์ดแสดงสูตร เช่น `ราคากลาง 42.00 + กำหนด 3.00 = ซื้อได้สูงสุด 45.00 บาท`
- ทุกการ์ดแสดง `ปรับล่าสุดโดย [ชื่อ] · [วัน–เวลา Asia/Bangkok]`
- การ์ด `ยังไม่จัดกลุ่ม` มีส่วนต่างและช่วงเวลาที่แก้ได้เหมือนกลุ่ม แสดงตลอด และเมื่อว่างแสดง `ยังไม่มีสาขาที่ใช้ค่านี้`

### Bill create/edit form

- ใกล้ช่องราคา แสดงข้อมูลอ่านอย่างเดียว เช่น `ราคากลาง 42.00 · ซื้อเกินได้ 3.00 · ราคาสูงสุด 45.00 บาท/กก.`
- ข้อมูลนี้มีไว้ให้ Admin เห็นเกณฑ์ก่อน Submit แต่ไม่แทน quota confirmation
- ไม่แสดงข้อมูลนี้ในตาราง รายละเอียดบิล หรือ PDF

### Quota setting and Submit confirmation

- ผู้จัดการระบบเห็นจำนวนปัจจุบันแบบอ่านอย่างเดียว; exact `super_admin` เท่านั้นที่เห็นปุ่มตั้งและบันทึก
- ก่อน save quota แสดงค่าเดิม→ค่าใหม่และเตือนว่าจะรีเซ็ตยอดใช้ทุกบัญชี พร้อม `ยืนยันการตั้งค่า` / `ยกเลิก`
- เปิด quota confirmation เฉพาะ Submit ที่กำลังใช้สิทธิ์
- แสดงราคาสูงสุดในบิล ราคากลาง ส่วนต่างกลุ่ม เพดาน และโควต้าคงเหลือหลังยืนยันอย่างชัดเจน
- ยกเลิกแล้วกลับไปแก้ฟอร์มโดยไม่ตัดสิทธิ์

## Implementation phases

### Phase 0 — Start gate and current-state audit

- รับคำสั่ง `เริ่ม` แล้วเมื่อ 2026-10-02
- ตรวจ working tree และรักษาการเปลี่ยนแปลงนอก scope
- เก็บ baseline ของ schema/function signatures, source-size ratchet, focused tests และ preflight distribution ของ group prices ก่อนออกแบบ migration จริง

### Phase 1 — Database and server contracts

- เพิ่ม columns ลง singleton เดิม, `price_allowance`, snapshot columns และ quota ledger แบบ append-only พร้อม constraints/indexes/RLS/grants
- seed central/default/quota และ backfill allowance หลังผ่าน preflight assertions
- สร้าง effective-policy resolver, preview decision และ final policy dispatcher จาก shared logic
- ทำ membership replace/move/delete ให้ actor/time/revision เป็น atomic
- ทำ quota round/ledger ให้ reset เชิงตรรกะ, idempotent และ concurrency-safe
- ต่อ dispatcher ใหม่เข้ากับ current `public.sync_rubber_bill` โดยรักษา date/OCR/core transaction boundary และ historical semantics
- เพิ่ม DB rollback/compatibility verification โดยไม่ rewrite ประวัติและไม่ใช้ function-source string surgery

### Phase 2 — API, hooks, cache, and offline replay

- เพิ่ม endpoints/types สำหรับ global settings, exact-super-admin quota save, atomic membership และ decision preview
- กำหนด status/error mapping ที่เป็น typed contract สำหรับ confirm, stale rule, approval fallback, conflict และ failure
- เพิ่ม submission-decision hook แยกจาก `useRubberBills`; refactor online queue-first flow และ sanitize queue payload
- เปลี่ยน effective cache เป็น v4, invalidation ตาม affected locations และ merge server-confirmed state ก่อน refetch
- ทำ replay path ให้ไม่รับ/ไม่ใช้ quota confirmation และคง idempotency key เดิม

### Phase 3 — Settings and bill UI

- เพิ่ม central-price section และจัดลำดับหน้าตั้งค่าใหม่
- เปลี่ยน group form/card เป็น allowance semantics
- เพิ่มการ์ด ungrouped defaults แบบแสดงตลอด แก้ค่าได้ตามสิทธิ์ และแสดง latest actor/time เหมือนกลุ่ม
- ลด quota form เหลือ count อย่างเดียว
- เพิ่ม read-only price reference ใน create/edit form และ quota confirmation
- ตรวจ keyboard flow, focus, accessible labels, responsive layout และ loading/error/success states
- แยก settings sections, central/quota dialogs และ `QuotaConfirmationDialog` เป็นไฟล์ใหม่ไม่เกิน 500 บรรทัด; ห้ามเพิ่มจำนวนบรรทัดเกิน grandfathered baseline ของไฟล์เดิม

### Phase 4 — Verification gate

- DB tests: preflight/backfill, singleton reuse, legacy snapshot preservation, actor propagation, exact roles, validation, logical daily/round reset, per-account scope, idempotency, transaction rollback และ concurrent last-quota race
- Decision matrix: below/equal/above central, equal/above effective cap, multiple rows, exhausted quota, date/edit/delete, grouped/ungrouped, create/update/non-price update/price reduction
- Concurrency tests: central-price stale save, stale price-rule confirmation, stale quota round, same-account last-slot race และ different-account non-blocking behavior
- Offline tests: v3 cache rejected, v4 cached central guard, latest-rule replay, network-uncertain retry, idempotent approval fallback และ no automatic quota use
- Composition tests: preview ไม่มี side effect; rule-changed/confirmation-required ไม่ reserve OCR, ไม่สร้าง bill/request/ledger; final success/pending ทำ OCR + mutation + ledger/approval แบบ atomic
- Membership tests: ungrouped↔group, group↔group, delete group, empty-source rejection, same actor/timestamp และ exact affected-location invalidation
- UI/API tests: visibility, copy, confirmation/no-op, stale errors, accessibility และ direct-call authorization
- รัน focused suites, `test:db`, `test:unit`, isolated Playwright, `verify`, `verify:full`, migration/schema checks, DB lint/parity, source-size ratchet และ `git diff --check`
- ให้ independent scrutiny/QA ตรวจ call graph, authorization, cache, offline, concurrency และ PDF/detail regressions

### Phase 5 — Delivery and memory

- อัปเดต checklist เมื่อ implementation และ verification ของ task นั้นผ่านจริงเท่านั้น
- บันทึก migration names, source paths, test evidence, residual risks และ deployment status
- ห้าม apply Cloud, commit, push หรือ deploy โดยไม่มีคำสั่งแยกจากผู้ใช้

## Safe implementation order

1. เพิ่ม DB schema/helper/RPC แบบ backward-compatible และทดสอบ local โดยยังไม่เปลี่ยน UI
2. เพิ่ม API/types/hooks/cache v4 และ typed result contract
3. refactor submit orchestration/queue แล้วเพิ่ม confirmation UI
4. เปลี่ยน settings UI และ atomic membership UI
5. รัน full verification รวม migration จาก fixture ที่มีค่ากลุ่มเดิมหลายแบบ
6. ตรวจ diff อิสระและอัปเดตเอกสารหลักฐาน; หยุดก่อน Cloud/commit/push/deploy เพื่อรอคำสั่งแยก

## Acceptance scenarios

1. Central `42`, allowance `3`, bill price `42`: บันทึกปกติ ไม่ใช้โควต้า
2. Central `42`, allowance `3`, bill price `45`, quota available: เปิด confirmation และใช้หนึ่งสิทธิ์หลังยืนยัน
3. เงื่อนไขเดียวกันแต่ราคา `45.01`: ส่งอนุมัติทั้งบิล ไม่ตัดโควต้า
4. Allowance ว่างหรือ `0`, ราคา `42`: บันทึกปกติ; ราคา `42.01`: ส่งอนุมัติหรือใช้โควต้าไม่ได้เพราะอยู่นอกเพดาน
5. ราคาอยู่ในเพดานแต่โควต้าหมด: ส่งอนุมัติ ไม่ตัดสิทธิ์
6. เข้าเงื่อนไขวันที่ ช่วงเวลา การลบ หรือ relation lock: ใช้โควต้าข้ามไม่ได้
7. แก้ข้อมูลที่ไม่ใช่ราคา: ไม่ใช้สิทธิ์ใหม่
8. แก้ราคาแล้วยังสูงกว่า central แต่ไม่เกินเพดาน: ประเมินและใช้หนึ่งสิทธิ์ใหม่
9. ลดราคาจนไม่เกิน central: ไม่ใช้สิทธิ์ใหม่และไม่คืนสิทธิ์เดิม
10. สาขาที่ยังไม่จัดกลุ่มใช้ allowance `0` และ edit window `30` นาทีเริ่มต้น: ราคา `42` บันทึกปกติ ราคา `42.01` อยู่นอกเพดาน และการแก้/ลบใช้กฎเวลาเหมือนกลุ่ม
11. สองเครื่องแย่งสิทธิ์สุดท้าย: transaction เดียวใช้โควต้า อีก transaction กลายเป็น approval request
12. กฎเปลี่ยนหลังเปิดฟอร์มจนเพิ่งต้องใช้โควต้า: ไม่ตัดสิทธิ์จนกว่าผู้ใช้เห็นค่าล่าสุดและยืนยันใหม่
13. Central เปลี่ยนหลังสร้างรายการ offline: replay ตรวจค่าล่าสุดและอาจสร้าง approval request โดยไม่ใช้โควต้า
14. Save central `42 → 42`: no-op และไม่เปลี่ยน updater/time
15. ผู้จัดการสองคนแก้ central พร้อมกัน: stale save ถูกปฏิเสธและต้องยืนยันคู่ค่าล่าสุดใหม่
16. ย้ายสาขาระหว่างกลุ่มหรือเข้า–ออกการ์ดยังไม่จัดกลุ่ม: ทุกการ์ดที่สมาชิกเปลี่ยนแสดงชื่อผู้กระทำและเวลาเดียวกัน
17. ไม่มีสาขาที่ยังไม่จัดกลุ่ม: การ์ดยังแสดงพร้อมค่าปัจจุบันและข้อความ `ยังไม่มีสาขาที่ใช้ค่านี้`
18. Save quota ค่าเดิม: quota round เปลี่ยนและยอดใช้ทุกบัญชีกลับเป็น 0 โดยไม่มี mass update
19. Retry operation เดิมหลัง response หาย: ได้ผลเดิมและ quota ledger เพิ่มไม่เกินหนึ่งแถว
20. Rule/round หรือ normalized price rows เปลี่ยนหลังเปิด confirmation และผลล่าสุดยังต้องใช้ quota: ไม่มี bill/request/quota side effect และต้องยืนยันค่าล่าสุดใหม่; หากผลล่าสุดเป็น direct/approval ให้ดำเนินตามผลนั้นโดยไม่ใช้ confirmation เก่า
21. Offline replay ของราคาที่ล่าสุดต้องใช้ quota: สร้าง approval request แบบ idempotent และไม่ใช้ quota
22. ลบกลุ่ม: สมาชิกเข้า ungrouped default และทุกการ์ดที่ได้รับผลแสดง actor/time เดียวกัน
23. ข้อมูลเก่าที่ `configured_price_snapshot = 45` ยังคงหมายถึงเพดานเดิม ไม่ถูกอ่านเป็น allowance `45`

## Out of scope

- ประวัติการเปลี่ยนราคากลางหรือค่าตั้งโควต้า
- หน้ารวมการใช้โควต้ารายบัญชี
- ป้ายหรือรายละเอียด `ใช้โควต้า` ในตาราง รายละเอียดบิล ใบรับบิล หรือ PDF
- การใช้หรือจองโควต้าขณะออฟไลน์
- ราคากลางรายสาขา/รายกลุ่ม หรือส่วนต่างราคาอีกชั้นในฟอร์มโควต้า
- การคำนวณหรือเขียนข้อมูลบิล คำขอ และ snapshot ย้อนหลังใหม่
