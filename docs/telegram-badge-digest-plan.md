# Telegram Badge Digest

## Scope

LanFlow sends a count-only reminder to one Telegram chat. Each message groups non-zero pending counts by branch, followed by `ส่วนกลาง` for records without one owning branch. Messages never contain names, bill numbers, amounts, or record-level details.

Included registry keys:

| Key | Module / status | Branch |
| --- | --- | --- |
| `rubber_bill_approval_pending` | บิลยาง / รออนุมัติ | request location |
| `income_expense_approval_pending` | รับ–จ่าย / รออนุมัติ | request location |
| `cash_transfer_pending_receipt` | รับ–จ่าย / รอรับเงินสด | destination |
| `cash_transfer_mismatched` | รับ–จ่าย / ยอดเงินสดไม่ตรง | destination |
| `stock_approval_pending` | สต็อกสินค้า / รออนุมัติ | entry location or central product request |
| `money_transfer_pending` | โอนเงิน / รอโอน | source |
| `money_transfer_partial` | โอนเงิน / ค้างจ่าย | source |
| `money_transfer_advance` | โอนเงิน / จ่ายล่วงหน้า | source |
| `time_tracking_approval_pending` | เวลาและเงินเดือน / รออนุมัติ | central |
| `rubber_export_draft` | ส่งออกยาง / ฉบับร่าง | export location |

OCR, device-local sync state, unprinted bills, overpaid transfers, approved debt balances, deleted rows, and successful/completed states are excluded.

## Configuration contract

- One singleton setting for the whole system.
- Only `super_admin` and system managers may read or change it.
- Fields: master enabled switch, write-only Bot Token, Chat ID, start/end time, interval `10–240` minutes, and enabled registry keys.
- Start must be before end on the same `Asia/Bangkok` day.
- Existing registry keys are seeded enabled. A future catalog row is not added to the enabled-key array automatically.
- GET responses expose only `tokenConfigured`; they never return the token.
- Disabling preserves destination, schedule, and category choices.

## Schedule and retry contract

Normal slots are aligned from the configured start time. Enabling creates one initial attempt ten minutes later; a successful/no-op initial attempt returns to normal aligned slots.

Postgres atomically claims one slot. Concurrent or duplicate invocations cannot claim the same slot while a fresh claim exists. A stale claim may be recovered after five minutes.

On Telegram failure, the current slot retries every ten minutes inside the configured window. Each retry recomputes current counts. Retry stops after the end time. When there are no enabled non-zero counts, the slot completes without calling Telegram.

## Runtime boundaries

1. Supabase Cron runs every minute and invokes the Edge Function only when notification delivery and deployment secrets are configured.
2. The Edge Function validates the internal Vault-backed dispatch secret.
3. The Edge Function claims a due slot through a service-role-only RPC.
4. Postgres aggregates enabled pending counts.
5. The Edge Function formats/splits count-only messages and calls Telegram `sendMessage`.
6. A completion RPC records success, no-op, or sanitized failure and calculates retry state.

Production setup calls `configure_telegram_badge_dispatcher(edge_function_url)` with service-role authority after the Edge Function is deployed. No secret value belongs in repository files or client-visible environment variables.

## Implementation inventory

- Migration: `20260724030000_telegram_badge_digest.sql`
- Tables: `telegram_badge_catalog`, `telegram_badge_settings`
- Manager RPCs: `get_telegram_badge_config`, `save_telegram_badge_config`
- Service-role RPCs: `configure_telegram_badge_dispatcher`, `verify_telegram_badge_dispatch_secret`, `claim_telegram_badge_dispatch`, `complete_telegram_badge_dispatch`, `get_telegram_badge_delivery_credentials`, `get_telegram_badge_counts`
- Cron entrypoint: `dispatch_telegram_badge_tick`; job name `telegram-badge-digest-tick`
- Edge Function: `telegram-badge-dispatch`
- Next routes: `/api/lanflow/telegram-badge/config`, `/api/lanflow/telegram-badge/test`

## Operational runbook

1. Apply migrations and deploy `telegram-badge-dispatch` with JWT verification disabled; the function validates its own Vault-backed dispatch header.
2. With service-role authority, call `configure_telegram_badge_dispatcher` once with the deployed function URL.
3. In LanFlow, open **Telegram** beside the branch selector, save the Bot Token and Chat ID, and use **ทดสอบการส่ง**.
4. Keep the master switch off until the test message arrives. Enabling schedules the first aggregate attempt ten minutes later.
5. Diagnose delivery from the Config modal's last attempt/success/sanitized error. Verify the cron job and dispatcher URL only if no attempt is recorded.
6. To stop delivery without losing configuration, turn off the master switch. Rotate a Bot Token by entering the replacement and saving; the old value is never read back.

## Verification matrix

- Database constraints, role/RPC grants, Vault write-only behavior, registry aggregation, branch/central grouping, no-op, slot alignment, retry and concurrent claims.
- API authorization, masked Token response, validation, and Telegram test error mapping.
- UI visibility and Config behavior for system managers versus ordinary admins/users.
- Edge Function formatter/message splitting and scheduled claim/complete paths.
- `supabase db reset`, database lint, TypeScript, production build, focused Playwright, secret scan, and end-to-end call-graph review.

Verified on 2026-07-24: local migration reset, schema snapshot, TypeScript, production build, six focused automated cases, 23 source-module regression cases, Vault/grant/cron inspection, repository secret scan, and one live generic Telegram test message. Database lint has no new Phase 4 finding; it still reports pre-existing findings in `sync_rubber_bill_core_20260716020000`, `sync_income_expense`, and `accept_cash_branch_difference`. Local Edge runtime boot is blocked before user-function loading by the development machine's untrusted `deno.land` certificate chain; two scoped recovery attempts confirmed that `DENO_TLS_CA_STORE=system` reaches the container but does not change the `UnknownIssuer` signature. Production deployment/invocation remains an explicit deployment step.
