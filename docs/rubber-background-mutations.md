# Rubber background edit/delete contract

2026-10-30 successor: pending edits now expose a compact proposed summary for
table presentation while authoritative values remain unchanged. Local-state reads
update the currently loaded list without awaiting its Server feed. Pending approval
has an explicit edit/delete guard. The pending-update summary survives command
acknowledgement/reload through the existing branch feed; forward migration
`20261030010000_rubber_pending_update_display_summary.sql` is required. Deletes
retain the user-confirmed revision during deferred preparation. See
[verification ledger](rubber-immediate-feedback-verification.md) for current gates.
The older Server-value-only presentation and mandatory context-wait descriptions
below are historical; their authorization and terminal cleanup rules still apply.

Local successor (2026-10-29): [central queue contract](rubber-central-queue-contract.md) / [ADR-0086](adr/0086-server-processed-rubber-command-queue.md) applies to newly marked `centralQueue` commands, including creates and manager decisions. The selected-branch browser replay below remains the legacy compatibility path. See the [verification ledger](rubber-central-queue-verification.md) for Local evidence and deployment limits.

PDF timing successor: [ADR 0087](adr/0087-immediate-local-rubber-receipt.md)
allows eligible create offline/online and update online receipts immediately after
durable local acceptance. The context wait and unconfirmed-edit print restriction
described below belong to the legacy path. Central completion never starts another
automatic PDF; approval and authoritative Server guards remain in effect.

New online edits and deletions persist `background: true` in their immutable
submission payload. The mutation returns after the context check and IndexedDB
commit; POST and invalidation are not part of form acknowledgement. The existing
app coordinator owns replay, scoped single-flight, session checks and connectivity
retries. Creation, Income/Expense, approval rules and Server locks are unchanged.

Pending and failed background commands overlay synchronization state on Server
values in Latest, not on monetary projections. A pending delete remains visible.
Unconfirmed edits are not printed automatically. Context/storage failures stay in
the form; destructive actions retain the existing AlertDialog.

## Terminal proof and cleanup

`probeDeletedRubberCommand` uses the existing authenticated command-context route.
The route/RPC verifies active user and branch access. The response must positively
report `deleted` for the event's exact Server ID; payload operation/client/location
must match its event. Empty results, other IDs and failed requests are insufficient.
An authorized context read may prove deletion even if this command never committed.
This result acknowledges retirement, not successful application of an update.

Known command receipts continue validating command UUID, operation and logical
identity. Background results carry `silent` through manual/stock retry so outer UI
handlers do not reannounce terminal cleanup. An explicit restart probes deletion
before creating a replacement, including after a stored stale-context rejection.

`completeRubberCommand` checks the exact current event and commits queue deletion,
receipt deletion and bill tombstone in one readwrite transaction across the existing
three stores. It never deletes the whole logical-bill queue group. Unrelated/new
events remain. Aborting the transaction retains queue and receipt; after commit,
the existing receipt writer honors the tombstone on reopen or delayed responses.

Failure notices are keyed by command identity and current status/code/message,
recorded outside the immutable payload in the queued event. A registration from
the app coordinator prevents cross-account/location notifications; IndexedDB
serialization prevents duplicate notices across tabs/remounts. Changed reasons
may notify again. Legacy queue behavior retains its compatibility rules.

## Verification receipts

- `tests/rubber-background.spec.ts`: durable acceptance, context/storage rejection,
  exact deleted proof, same-bill dependent work, atomic abort/reopen cleanup,
  another-tab changed event, scope-bound durable notices and correction revision.
- `tests/rubber-command-browser.spec.ts`: real authenticated local API/DB fixture,
  delayed POST, form closure, visible status, disabled actions, module navigation,
  replacement and approval followed by removal from Latest.
- Controlled latency experiment: seven samples per operation, simulated context
  10 ms and POST 150 ms. Baseline p50/p95 update 178/195 ms, delete 173/180 ms;
  after change update 25/35 ms, delete 20/23 ms. These are harness measurements,
  not Production performance or a guaranteed user-visible time.

Run `npm run verify`, affected browser/route tests and the database suite as
applicable before release. Keep Server command generations, receipts and replay
guards during rollback. The client uses the existing Server RPC and IDB version 5.
Code/test evidence does not itself assert Production deployment or phone recovery.
