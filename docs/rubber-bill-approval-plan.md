# Rubber Bill Approval Plan

## Goal

เพิ่ม approval สองกฎที่แยกกันแต่ใช้ request queue เดียว:

1. **Price rule** — เมื่อสร้างบิลหรือเปลี่ยนราคาของรายการชั่งแล้วมีราคาใดไม่ตรงราคากลางที่กำหนด
2. **Time rule** — เมื่อแก้ข้อมูลธุรกิจหรือลบบิลตั้งแต่เวลา server-first-save บวกจำนวนนาทีที่กำหนด

สถานะพิมพ์ไม่อยู่ใน workflow นี้

## Product Contract

- Setting เป็น singleton ทั้งระบบ:
  - `edit_window_minutes` integer `>= 0`, default `30`
  - `configured_price` numeric 2 ตำแหน่ง, nullable; null หมายถึงปิด price rule
- Price rule เทียบ `rubber_bill_items.price` ของแต่ละ weigh item ไม่เทียบค่าเฉลี่ย
- บิลใหม่ที่ราคาไม่ตรงเป็น `create` request เท่านั้น ยังไม่สร้าง `rubber_bills`
- Existing update/delete request เก็บ original/proposed snapshots และ base revision
- หนึ่ง request อาจมีหลายเหตุผล เช่น `price` และ `time`
- หนึ่ง existing bill มี pending request ได้หนึ่งรายการ
- ไม่มี rejected status: pending ถูก approve หรือ hard-delete; approved history ลบไม่ได้
- ผู้มี location access ส่ง request ได้; `super_admin`/system manager ตั้งค่า ดู diff อนุมัติ และลบ pending ได้ทุกสาขา
- ผู้อนุมัติต้องผ่าน request เช่นกัน แต่อนุมัติ request ของตนเองได้
- Approved delete ใช้ Rubber Bill soft delete เดิม
- Setting change/clear ไม่เปลี่ยน pending request และไม่ backfill บิลเก่า
- Approved exceptional price ไม่ถูกขอซ้ำเมื่อแก้ข้อมูลอื่นโดยไม่เปลี่ยนราคา

## Server Flow

```text
Rubber Bill form / IndexedDB replay
  -> POST /api/lanflow/rubber-bills
  -> sync_rubber_bill(payload)
       no matched rule -> existing sync core
       matched rule    -> rubber_bill_approval_requests

Manager approval
  -> POST /api/lanflow/rubber-bills/approval-requests/:id/approve
  -> approve_rubber_bill_approval_request(id)
  -> exact proposed payload through existing sync core in one transaction
```

The wrapper must be idempotent. Offline create replay that no longer matches the current server price returns `pending_approval`, removes the IndexedDB event, and exposes a temporary request row instead of leaving a failed queue event.

## Data Contract

### `rubber_bill_approval_settings`

- singleton boolean primary key
- edit window minutes and nullable configured price
- updated actor and server timestamp

### `rubber_bill_approval_requests`

- operation `create | update | delete`
- status `pending | approved`
- nullable `bill_id` for create requests
- `location_id`, `client_temp_id`, request idempotency key and base revision
- original/proposed JSON snapshots
- matched reason array and configured-price snapshot
- requester/approver identity and server timestamps
- unique pending request per existing bill and per client temp ID

## Lock Contract

- Request creation/approval, Report item insertion, and Money Transfer item insertion use the same per-bill advisory lock.
- Active Report/Money Transfer relation blocks request creation and approval.
- Pending update/delete request is excluded from report candidates and blocked by a report-item trigger.
- Pending update/delete request is excluded from Money Transfer UI candidates and blocked by a money-transfer-item trigger.
- Rubber Export needs no additional state because it only consumes report-locked bills.

## UI Contract

- One manager button: `ตั้งค่าและอนุมัติบิลยาง`
- ช่องตั้งค่าราคาและนาทีอยู่ใน modal เดียว; queue กรอง pending/approved และแสดงสาขาของแต่ละคำขอ
- Request types: create price request, update, delete
- Read-only before/after data and matched reasons; approved history immutable
- Branch users see pending status. A create request appears as a temporary Rubber Bills table row with no server bill number and all source actions disabled.
- New weigh rows prefill configured price. A mismatch shows a warning before submit.
- No external notification; manager button badge is the notification.

## Implemented Surface

- RLS read: `rubber_bill_approval_settings`
- Safe marker RPC: `list_rubber_bill_approval_markers(location_id)` คืน diff เฉพาะคำขอสร้าง
- Manager RLS read: `rubber_bill_approval_requests`
- `PUT /api/lanflow/rubber-bills/approval-settings`
- `POST /api/lanflow/rubber-bills/approval-requests/[id]/approve`
- `DELETE /api/lanflow/rubber-bills/approval-requests/[id]`

API authorization และ database RPC enforcement ตรวจสิทธิ์ซ้ำกันสำหรับทุก mutation

## Verification Matrix

- Setting: default 30, zero, invalid integer, price > 0/scale 2, clear-to-disable
- Price: exact match, any mismatch across multiple weigh rows, unchanged approved exception, price edit inside window
- Time: before deadline direct, at/after deadline request, current setting applies to old bills, timer never resets
- Lifecycle: create/update/delete request, one-pending, self-approval, hard-delete pending, immutable approved history
- Source integrity: original unchanged while pending, approved exact snapshot, approved delete soft-deletes
- Relations: request vs Report/Money Transfer in both directions and concurrent races
- Offline: known mismatch blocked, exact cached price queued, stale price becomes idempotent pending request on reconnect
- Regression: Rubber Bills offline/PWA, stock deductions, print status, Income/Expense feed, Reports, Money Transfer, Rubber Export

## Verified Evidence

- `supabase db reset` ผ่านจาก migration แรกถึง `20260724020000_rubber_bill_approvals.sql`
- Rubber Bill approval contract ผ่าน:
  - ตั้งค่าสิทธิ์ manager, create ราคาไม่ตรง, hard-delete pending
  - manager ส่งและอนุมัติคำขอตนเอง
  - exceptional price เดิมไม่ trigger ซ้ำเมื่อแก้ข้อมูลอื่น
  - time request ไม่แก้ source ก่อนอนุมัติ
  - print status ยังทำได้ระหว่าง pending
  - Report และ Money Transfer ไม่รับ pending bill
  - reported bill ไม่สร้างคำขอย้อนหลัง
- Report batch regression ผ่าน `7/7` รวม partial transfer ที่ source bill ถูก report lock
- UI role/modal smoke test ผ่าน: user ไม่เห็นปุ่ม; system manager เห็น settings/queue
- `npm run typecheck` และ `npm run build` ผ่าน

## Scrutinize Verdict

เส้นทางจริงถูกไล่จาก form → IndexedDB replay → sync API → approval wrapper → request marker →
manager decision → existing sync core รวมถึง Report/Money Transfer ทั้ง UI และ trigger แล้ว ไม่พบ blocker ค้างอยู่
หลังแก้สองจุดระหว่าง review: ให้ `service_role` เข้าถึงตารางใหม่ และคง print-status exemption ระหว่าง pending
