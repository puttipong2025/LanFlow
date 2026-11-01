# Income/Expense bounded offline history

Verified locally 2026-11-01. The user chose a bounded recent copy separated by account and branch. This is a read copy of confirmed business rows, distinct from the outbox, form drafts and immutable numbered submission receipts.

## Read and retention contract

- `lanflow_sync_db` v11 adds `income_expense_history`, keyed by JSON `[ownerUserId, lowercaseLocationId]`. Upgrade preserves every earlier store, accepted submission, queued command, issuer registration and counter. Older writers remain fenced; do not downgrade or clear browser data during rollback.
- Keep at most 100 confirmed active summary rows per account/branch. The unfiltered first `latest` server page replaces that window after response validation. Searches, approval mode, later pages and local optimistic changes cannot replace it. Pending create proposals are excluded. Sale item details and generated PDFs are not copied.
- Confirmed create/update acknowledgements patch the matching copy; confirmed deletes remove it. A background revision conflict evicts the obsolete row until an authoritative refetch. An approval request does not apply its proposed values to the copy.
- A refresh reserves a generation before its HTTP request. Only the same generation can commit the page. Later refreshes and confirmed mutations invalidate older generations, preventing delayed responses from resurrecting deleted rows or overwriting acknowledged edits. Older receipt revisions cannot replace a newer cached revision.
- Offline `latest` combines this copy with the existing scoped outbox and applies the existing search/merge rules. `sync_problems` continues to show only failed/conflicted local commands. Confirmed rows remain read-only offline. The UI identifies the limited copy, its count and last update time; search explains its offline scope.
- Copies are specific to the current browser profile and device. Clearing site data, private-session expiry or browser eviction can remove them. Online history remains authoritative; a new device needs an online load. No full-history download, restore or migration from Rubber receipt contents is performed.
- Optional copy corruption/storage/quota failures do not reject an acknowledged business write or delete an outbox item. The history transaction touches only its own store. Its retention limit never prunes accepted numbered submissions or pending work.

## Feed cache fix

The old confirmed-write helper updated every query under the owner/branch prefix. A real QueryClient/outbox reproduction showed a newly synced row entering `pending_approval`; an approved row also retained `approvalPending` metadata. The helper now respects mode/search membership, removes completed approval rows, preserves approval queue ordering and clears obsolete approval fields on confirmed latest rows. Other accounts and branches are untouched.

## Evidence and source map

- `tests/income-expense-cache.spec.ts`: real sender, QueryClient and IndexedDB with only the HTTP/session boundary replaced; latest/search/pending membership and account/branch controls.
- `tests/income-expense-history.spec.ts`: bounded persistence/reload, account/branch isolation, v10→v11 preservation/fence, late-page races, revision regression, actual background update/delete and quota/outbox controls.
- `tests/income-expense-offline.spec.ts`: confirmed row visible read-only offline, unchanged server row and restored online actions.
- `tests/income-expense-pwa.spec.ts`: pending row reload/reconnect, then a second offline reload with a confirmed row and no outbox command; mobile status image.
- Implementation: `src/lib/income-expense/history-idb.ts`, `feed-cache.ts`, `src/hooks/useIncomeExpenseOperationalList.ts`, main/background senders and the existing business-cache refresh path. No server schema, migration or repair-version bump is needed for this cache feature.

Full isolated suite: **1,228 passed / 2 existing skipped**. Lint, typecheck, source-size/import guards and production build/SW/bundle passed. No Cloud apply, commit, push or deployment is part of this change.

## Final verification and review ledger

- Existing focused cache checks originally passed, while a real sender/QueryClient reproduction failed pending-list membership controls. Node inspector reached the old upsert helper and confirmed that a synced create inserted one row into an empty approval feed. Five permanent membership/control tests now pass.
- End-to-end review found the separate legacy manual retry path. It now uses the same confirmed-copy helper as the main/background senders; actual failed update/delete retry regressions pass. The complete suite above includes 15 new cache/history cases.
- Production build `bICjGC_dY8MgiTD00IGx0` passed, including offline assets, SW and 297.8/320 kB initial bundle. The final unused type-import cleanup was independently transpiled and emits identical JavaScript to this browser-tested build.
- Actual production-mode browser checks: **19 Income/Expense offline journeys**, **2 PWA journeys** including confirmed-history offline reload with an empty outbox, and **1 numbered upgrade/partial acceptance/approval/replay journey** passed. The three existing Rubber device/offline journeys also passed with the v11 upgrade. Setup cases are excluded from these counts.
- The initial PWA copy assertion used the online button names. Its failure snapshot already showed the copied row and both disabled controls named by the existing offline-lock explanation. Corrected the selectors; the same journey passes. Viewed the resulting 375px image: copy count, limit and update time wrap within the card.
- The first broader upgrade journey timed out before opening Income/Expense, at the branch-selection stage. A separate bounded action-timeout/trace run passed in 20 seconds without a product change. Its fixture now catches an already-closed context so SQL cleanup still runs; the single orphan empty branch from the failed attempt was identified by exact ID/name/start time and removed with guards. No service/container reset or broad process stop was used.
- Canonical Feed, Module, Device Numbering and Core Brain notes were updated atomically with SHA receipts. Before/after audit of 103 notes has identical issue categories and counts; this change introduced no new memory issue.

Review verdict: local delivery ready. The existing stores and business rules remain intact; only the separate read copy is bounded to 100. Publishing has not been performed.
