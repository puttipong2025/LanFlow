# APPROVAL_REQUEST_EXPIRED_REPLAY investigation

Historical investigation, recorded before implementation. The verified fix and
current compatibility contract are in [Rubber command replacement](rubber-command-replacement.md)
and [ADR-0083](adr/0083-replace-pending-rubber-commands.md). Statements below about
unchanged application code describe the investigation stage only.

Date: 2026-10-28. Scope: repository, Local Supabase, and a user-provided screenshot of the Production Rubber Bill screen at นาดอนใหญ่. The exact request identities and Cloud state have not been identified.

## Verified behavior

`private.reject_expired_approval_request_replay()` raises this message when a new approval request uses a key already present in `private.approval_request_replay_guards` for the same workflow. The supported workflows are Income/Expense, Rubber Bills, stock entries, and stock products.

The trigger does not check the current date or the age of the guard. The wording about expired history therefore does not establish when the request ended or whether retention caused this particular occurrence. A deleted Rubber Bill approval can also have a guard.

Terminal approval cleanup preserves a minimal guard before deleting temporary approval history. This prevents a delayed command from recreating a completed request. The existing policy is documented in [ADR-0058](adr/0058-configurable-temporary-history-retention.md).

For deleted Rubber Bill approval requests, the current sync RPC already handles `submissionMode = 'replay'`: matching fingerprints return `discarded`; mismatches return `conflict`. This path differs from the generic insertion trigger. The exact submitted command and response are needed before attributing the reported UI error to either path.

## Local reproduction and controls

Executed a rollback-only SQL probe through `docker exec -i supabase_db_webapp psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres`:

- Selected an existing Rubber Bill guard key without printing its value.
- Attempted an insert into the real `public.rubber_bill_approval_requests` table using that key twice. Both attempts raised exactly `APPROVAL_REQUEST_EXPIRED_REPLAY: คำขอนี้สิ้นสุดและพ้นช่วงประวัติแล้ว`.
- Repeated with a fresh key. It passed the replay trigger and stopped at required-field validation.
- Rolled back the transaction. No request or business row was retained or removed.

This proves the database rejection condition locally. It does not reproduce the reporting device's complete UI/sync path.

## Reporting-device screenshot

The user-provided mobile screenshot shows two rows in the Rubber Bill **ซิงก์มีปัญหา** tab at นาดอนใหญ่. Both display **ซิงก์ไม่สำเร็จ** and the reported replay error. The table is horizontally scrolled to its later columns; bill numbers and the management buttons are outside the captured portion.

The current screen builds sync-problem rows from device-local queue events (`src/hooks/useRubberBillList.ts` and `src/lib/rubber-bills/local-feed.ts`). An error saved in that queue can remain visible until the command is retried or discarded; the screenshot alone does not establish a fresh Server response.

The existing recovery UI provides **ทิ้งรายการค้าง** in the first **จัดการ** column, followed by a **ยืนยันทิ้งรายการค้าง** dialog. Its handler removes the selected bill's local queue group and receipt cache, then refreshes the feed. It does not invoke the Server bill-deletion API. Unsynced proposals are lost when this action is confirmed.

The reporting phone's browser storage cannot be modified through an attached screenshot or a different desktop browser. Device recovery therefore requires using this existing action on that phone. Completion must be verified there by checking that the selected rows leave the sync-problem tab; no device recovery is claimed in this report.

## Resolution boundary

### Production diagnosis confirmed — 2026-10-28

With the user-prepared Production browser, selected the exact bill identified by the user and opened its deletion confirmation. After the user accepted the dialog, the Server bill remained in Latest and a failed delete command appeared in Sync Problems with the exact reported error. No approval request was created by that attempt.

A narrowly scoped read-only Cloud transaction confirmed that the selected bill remained active at revision 1, no matching approval requests remained, and the deterministic delete key for that same revision already had a `deleted` replay guard recorded earlier that day. This is not evidence of an old terminal request expiring through retention: it is an explicitly deleted approval identity being reused for a new delete attempt.

`src/hooks/useRubberBills.ts` constructs every delete identity as `delete:${clientTempId}:${targetRev}`. Discarding a local command does not change the Server revision or remove its durable replay guard. A subsequent delete therefore reuses the retired identity and fails again. Approving an update increments the bill revision, which explains the user's successful edit-then-delete workaround on another bill.

Recommended design: distinguish a newly requested deletion from a retry of its existing queued command. A new deletion after an abandoned approval needs a new command identity, while network retries must preserve the already queued identity. Keep durable replay protection and avoid modifying financial bill values solely to obtain a different revision. This is a proposed fix; no application code or Cloud state has been changed to implement it.

Identify the affected module and command before choosing a remedy. If the command is obsolete, use the module's supported queue-discard flow after confirming its server state. If it represents new work, investigate why an old command identity was reused before resubmitting.

Removing the guard would permit an old request to be created again. Changing retention cannot restore deleted history or clear a browser queue. Neither is an appropriate blanket remedy.

The existing glossary defines **ทิ้งรายการค้าง** as discarding a command stored on the device without deleting the authoritative business bill. No new domain term or architectural decision is proposed in this investigation.

## Evidence

- `supabase/migrations/20260903010000_configurable_temporary_history_retention.sql`: archival and insertion triggers.
- `supabase/migrations/20261008014000_bind_deleted_rubber_approval_replay_identity.sql`: deleted-request identity handling.
- `supabase/tests/history_retention_test.sql`: retention preserves replay guards.
- `src/hooks/useRubberBills.ts`: supported local queue discard operation.
- `CONTEXT.md`: existing queue-discard terminology.

No application code, persistent database data, or Cloud configuration was changed during this investigation.
