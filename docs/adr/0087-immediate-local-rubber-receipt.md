# ADR 0087: Share an eligible Rubber receipt after durable local acceptance

Status: Accepted by user; implementation verified locally as recorded in the
verification ledger. No Cloud deployment is implied.

## Decision

For new offline/online bills and online edits, a locally eligible receipt may be
shared after the proposal is durably stored, before central command admission or
business completion. Use the local reference and a frozen proposal document.
Known approval-required or unknown policy never produces this immediate receipt.
Central authorization, locks, revision checks and approval remain authoritative;
a local document is not proof of their outcome. Later rejection or a changed
Server policy cannot retrospectively turn that local document into a confirmed
Server receipt.

Defer context preparation using `localContextPending` in the local outbox payload.
Before the first business POST, the owner uploader obtains context and atomically
replaces that local preparation envelope, preserving the UUID, idempotency key and
proposed expected revision. Persist the prepared command before marking it as
submitted. Thereafter every replay uses the exact prepared payload. Stale/deleted
proposals are submitted with their original expected revision for authoritative
central retirement, never silently rebased.

IndexedDB version 7 is a protocol fence for staged envelopes. Version-6 tabs
close existing connections on version change and cannot reopen at version 6.
The upgrade retains all existing stores and rows. The admission Route rejects
any `localContextPending` field before calling RPC, including false/null values.
Rollout requires refreshing old tabs; rollback must retain the version-7 opener
and staged-envelope resolver until work drains. Never delete local storage or
downgrade the database as a rollback procedure.

The local PDF snapshot does not clear `serverSubmissionAttempted` on the queue.
Its separate display model uses local reference and clears old approval/receipt
metadata. PDF delivery stays origin-tab/account/branch scoped and serial. The
central completion path has no PDF trigger, so cancelled or failed delivery does
not replay business or open a retrospective share. Manual confirmed receipt
printing remains available.

Unknown cash-lock state may not prevent the explicitly allowed offline Rubber
workspace. Persist confirmed states per owner and filter current branch grants on
read; known locked states and expired temporary grants still block. Other modules
retain their gates; uploader/worker always revalidate on reconnect.

## Trade-off

Waiting for authoritative completion was simpler for confirmed receipts but made
printing depend on admission, cron and browser polling. Sharing a frozen local
document restores the user's workflow with an explicit distinction between local
acceptance and central success. It cannot guarantee that the proposal will later
pass changed Server conditions. Eligibility uses the available valid local policy,
date, price and edit-window information; missing information prevents sharing.

## Boundaries

No SQL, formula, approval, report, stock or OCR ownership rule changes. Unknown
offline permission does not grant new access; only the cached authorized session
and Rubber workflow can use the local allowance. No new PDF renderer is introduced.
Native share and download fallback are different outcomes; local tests cannot
certify a physical device share sheet or printer.

Sources: `src/lib/rubber-bills/immediate-receipt.ts`, `command.ts`, `central-sync.ts`,
`central-print.ts`, `src/lib/cash-counts/lock-cache.ts`, `src/hooks/useCashCountLocks.ts`.
Evidence and limitations: [verification ledger](../rubber-immediate-pdf-verification.md).
This decision updates the PDF timing in ADR 0086; its Server queue contract remains.
