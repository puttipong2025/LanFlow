# Rubber Bill command contract

## Intent and receipt

`GET /api/lanflow/rubber-bills/command-context?locationId=…&clientTempId=…`
returns `generation`, `revisionNo`, `recordStatus`, `serverId` and, only for the
requester's pending OCR create, its `ocrUploadId`. The RPC checks active role and
branch access; responses are private and uncached.

New submissions to the existing sync endpoint carry `contractVersion: 2`, UUID
`commandId`, identical `idempotencyKey`, and `expectedCommandGeneration`. Business
`expectedRevisionNo` remains independent. Initial offline creates start with
generation zero. Synced bills cannot be edited/deleted offline. A pending legacy
create initializes a nonzero context, so a delayed offline create cannot replace it.

The server serializes the location before command/approval/OCR work. It resolves
known receipts, validating owner, branch, client identity, operation and fingerprint,
before comparing new command generations. Accepted new work advances generation;
explicit discard and approval advance it too. It never resets with history cleanup.

`src/lib/rubber-bills/command.ts` exposes preparation, the shared sender, receipt
validation and failure handling. Every Rubber Bill sender, including stock retry,
uses those paths. Income/Expense transport remains unchanged.

| Result | Local action |
| --- | --- |
| Matched `synced` / `pending_approval` | Conditionally remove the unchanged queued command and refresh |
| Matched terminal `discarded` receipt | Close only that retired command; starting again is explicit |
| `STALE_COMMAND_CONTEXT` / other business conflict | Keep draft, do not rotate key or auto-discard |
| Invalid acknowledgement or transient/unknown failure | Keep the immutable command pending for retry |

V2 success requires a matching command UUID as well as the existing operation,
bill identity and revision receipt checks. A conflict is not a `discard_local`
instruction for v2. Read-only draft details remain available in Sync Problems.

## Replacement and OCR

An authorized new operation can replace pending proposals for the same logical
bill, regardless of the original requester. The standalone approval DELETE API
remains manager-only. Old request payloads are removed; only minimal receipts and
fingerprints are durable. The original bill and financial calculation remain the
source of truth.

Replacement uses a subtransaction around old-key retirement, source cleanup,
proposal deletion, legacy validation/submission, receipt insertion and generation
advance. `failed` / `conflict` JSON results trigger rollback too. Consequently a
locked/invalid/unauthorized replacement never destroys the previous pending work.

Pending creates use client identity rather than a missing server bill ID. Editing
a pending create remains a create. A delete of an uncreated bill must use the
explicit approval-cancellation flow, not a fabricated server bill deletion.

For a pending OCR create with the same source and requester, move the reservation
key within the replacement transaction. Do not abandon then reclaim the source.
For a different authorized source, abandon the old source and reserve the new one
atomically. Another actor cannot appropriate the original owner's image.

## Compatibility and rollout

Apply migration `20261028010000` before publishing the client. Legacy traffic
cannot replace pending work through the old sync implementation. A successful v2
command activates that logical bill's compatibility gate; unknown legacy commands
then receive `COMMAND_UPGRADE_REQUIRED`, while known replay preserves its previous
semantics. Newly accepted legacy work also advances context generation so it
cannot be silently overwritten by a v2 request holding an older context.

Do not downgrade by deleting contexts/receipts/guards: that would make delayed
commands fresh again. Keep the server compatibility layer during a client rollback.
Schema deployment preserves the previous implementations under restricted names;
those functions are not executable by authenticated or anonymous clients.

Release checks: local DB suite and real multi-connection races, route/IDB tests,
actual browser replacement/approval, build/PWA checks, migration rollback rehearsal,
Cloud backup/dry-run, exact commit CI/hosting status, and authorized smoke checks.
Test-only fixture cleanup must remove private contexts through its isolated branch;
it must never target production branches.
