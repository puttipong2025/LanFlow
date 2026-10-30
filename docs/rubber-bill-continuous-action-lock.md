# Rubber Bill continuous action lock

Confirmed behavior, 2026-10-30: after a create, update or delete is saved locally,
close its form and keep that bill's edit/delete controls disabled continuously
until the pending work has a confirmed outcome. The add-bill control remains
available. Offline work remains locked while awaiting sync. Approval, report and
transfer locks still apply after sync; failures retain their existing recovery
controls. Local receipt/PDF delivery retains its existing independent lifecycle.

## Implementation

- `getRubberBillSyncActionBlockReason` covers every pending Rubber Bill, including
  a new create before any submission attempt. Both row controls and their module
  handlers use this guard. Other modules retain the generic server-action guard.
- Save/delete success publishes the current local queue into the scoped list
  cache before its mutation promise settles. This hands the immediate mutation
  lock to the pending row without waiting for network refresh or PDF completion.
- Existing local-feed projection keeps pending edits/deletes over server rows.
  A completed delete is removed by the existing confirmed-deletion path.

## Evidence

Two deterministic regressions failed before the change: a pending create exposed
an enabled edit control, and mutation success settled before the local queue was
published. Both pass after the change.

`tests/rubber-central-queue.spec.ts` exercises actual table output and local-feed
projection for create/update/delete with submission markers false/true/false.
It checks both edit/delete remain disabled and a synced row releases these locks.
A gated local read verifies save/delete cannot settle early, while a never-ending
network refresh verifies local acceptance does not wait for the network.

Validation: full isolated suite 895 passed, 2 existing skips; final strengthened
central-queue suite 35 passed; typecheck, changed-file ESLint, source-size check
and diff whitespace check passed. No production deployment or browser session
test was performed for this change.

## Follow-up scrutiny — 2026-10-30

Found and reproduced a post-commit failure: `publishLocalQueue` could reject after
the business command was durably queued, making a successful save/delete appear
failed and skipping its follow-up refresh/upload. The minimal correction retains
the committed command in the mutation result. If the presentation reread fails,
publish that snapshot while preserving unrelated cached commands, then continue
normal refresh/upload. Existing read-before-unlock behavior remains on success.

Ledger: the injected post-commit storage failure initially rejected mutation
success; it now resolves and preserves the pending row. The normal gated-read
test still proves locks cannot release before publication and network refresh
is not awaited. Full isolated suite: 896 passed, 2 existing skips. Strict unused
local/parameter TypeScript scan found no unused declarations to remove.
Production build and changed-file ESLint also passed.

Traced queue Route authentication, actor/branch identity, bounded request parsing,
receipt validation, immediate-worker failure fallback and retry/version checks.
The existing Route regression suite passed; no additional Route bug was proven.

## Second scrutiny — preserve newer cached outcomes

Reproduced a second fallback bug: a failed queue reread could overwrite a cached
`failed`/correction outcome for the same command with its older committed
`pending` snapshot. Reuse `isSameSyncCommand` to retain progress for that exact
command while replacing an older, different proposal when needed.

Moved publication into the existing feed-cache owner. The fallback also compares
the target bill before and after the read, preserving concurrent target changes
or removal. An unrelated bill changing during the read does not prevent the
committed target from being published. No queue or database records are rewritten
by this fallback.

Ledger: seeded correction state was reset to pending before the fix. Regression
now preserves it for save and delete. A gated failing read verifies concurrent
progress, stale-proposal replacement, and unrelated-bill preservation. Full
isolated suite: 897 passed, 2 existing skips. Strict unused-declaration scan,
changed-file ESLint, source-size and whitespace checks passed. No dead code was
proven, and no additional Route fault was reproduced.
Production build, Service Worker validation and bundle budget checks passed.
