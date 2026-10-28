---
status: accepted
date: 2026-10-28
extends: ADR-0082
---

# Replace pending Rubber Bill commands without replaying retired work

A deterministic `operation:clientTempId:revision` key cannot distinguish a new
request from a retry after an earlier approval was discarded. A business revision
does not advance when an approval is discarded. Removing replay protection would
allow a disconnected device to resurrect that discarded command.

Each new intent therefore has a UUID persisted before sending. A durable command
generation, scoped to location and client identity, protects pending-request
changes independently of the bill revision. Known receipts resolve before the
new-intent generation check. New submissions with an old context retain their
local draft rather than silently rebasing or discarding it.

An active actor with operation access to the bill's branch can replace pending
work, including another actor's proposal, only inside the submission transaction.
This deliberately differs from the manager-only standalone cancellation endpoint.
Validation, locks, OCR reservation changes, retirement of old identities, removal
of old proposals and accepting the replacement commit together. A returned JSON
business failure also rolls back the replacement. Applied transactions are never
undone by replacement, and approval still checks the current business revision.

Only minimal receipts and retired identities remain; superseded proposal payloads
are removed. OCR reservations can transfer between commands for the same source,
owner and logical bill. Replacement permission does not grant access to another
owner's OCR image.

Legacy traffic retains its original behavior until a logical bill accepts v2.
After that, only known legacy replay is allowed; unknown legacy commands require
an application update. This avoids breaking every legacy draft at the schema
deployment boundary while preventing old clients from overriding activated work.

The command module is Rubber Bill specific. Stock-origin Rubber Bill retry uses
the same transport, receipt validation and conditional queue operations. The
Income/Expense branch keeps its existing behavior.

This extends ADR-0082: automatic discard for legacy conflicts remains compatible,
but v2 business conflicts retain drafts. A terminal receipt for the exact command
or an explicit user discard is required to close v2 local work.

See [the contract and rollout](../rubber-command-replacement.md). Acceptance of this
decision does not assert Cloud rollout or recovery of a particular device.
