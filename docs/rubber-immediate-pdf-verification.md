# Rubber immediate local PDF verification — 2026-10-29

The codingDO plan is `10_Daily/2026-10-29 1.md`. Scope is new offline/online bills,
online edits, unknown offline cash-lock gating and the duplicate normal-bill view
button. All evidence is Local; no commit, push, Cloud apply or deployment.

## Reproduction and experiment ledger

- Before implementation, two deterministic tests failed: online command preparation
  started a context request before returning local acceptance; the offline unknown
  cash lock blocked the explicitly permitted Rubber workspace. Log:
  `output/rubber-immediate-red.log`.
- Source trace distinguished admission/context latency from PDF rendering and the
  global cash gate. Existing renderer already builds PDF bytes in the browser;
  no new rendering service or financial engine was needed.
- Focused gates exercise allowed/approval-required/unknown local eligibility for
  create/update, wrong branch, missing creation time and expired edit window;
  frozen edited receipt refuses old Server snapshot/approval metadata; local
  acceptance sends no GET/POST; cache owner/grant isolation and unknown vs known
  lock are exercised. Deferred context is durably prepared once before POST,
  retaining UUID/original expected revision and exact payload after lost response.
- The first preparation test used a native relative import outside its mocked
  transport boundary; it therefore used the host navigator and correctly refused
  an offline update. Loading the actual command module with the same controlled
  auth boundary fixed the harness. This was not a production defect.
- Removed obsolete completion-triggered print intent storage/callbacks. Shared
  serial origin handoffs now begin from accepted local receipt snapshots only.
  Existing serial/busy/cancel/scope-leave tests exercise the new entry point.
- The first browser run successfully shared create before held context/POST, then
  the test selected the create-dialog name for an edit. Screenshot showed the
  actual edit dialog open. The locator now accepts both existing names; no UI
  label was changed to satisfy the test.
- A combined browser run exposed two test assumptions: PDF completion implied
  both business POSTs had begun, and the global threshold alert could close an
  open branch selector. Tests now wait independently for the business POST/DB
  outcomes and use the existing bounded branch-selector setup pattern. Logs retain
  the earlier failures; these are not claimed as production defects.
- One isolated source-contract test assumed `syncStatus` immediately followed the
  calculated bill spread. Permit the new document metadata field while retaining
  its approval-state assertion; the 19 contract checks then passed.

## Contract and review

[ADR 0087](adr/0087-immediate-local-rubber-receipt.md) records the accepted timing
trade-off. Receipt eligibility does not claim authoritative admission or future
approval. Storage must complete before a PDF intent exists. Context failure keeps
the proposal; context preparation is conditional on the exact local snapshot and
cannot rewrite a submitted command. Server still resolves stale revision/deletion.

The cash-lock allowance is a fifth hook argument supplied only for the Rubber
workspace with the current branch grant. Confirmed owner-scoped lock cache survives
reload; entries are filtered by current grants. Existing transitions still block
expired temporary unlocks. This cache never authorizes a Server write.

Normal-bill eye buttons are removed; failed/conflict draft viewing and inbound
branch receipts retain their dedicated view actions. WEX controls are untouched.
Existing AlertDialog, inline validation, share wait/cancel and default layout remain;
no new animation or primitive system was added.

Final completed gate results are appended only after each command exits.

## Compatibility fence

Review found that an older uploader could otherwise read a staged envelope.
IndexedDB version 7 prevents a version-6 reader from reopening; all four existing
stores are preserved. Admission rejects the staging field before RPC. The
focused compatibility/receipt/immediate-PDF suite passed 41 tests
(`output/rubber-immediate-compatibility.log`). Upgrade/rollback instructions are
in the central queue runbook and ADR 0087.

The completed desktop browser run passed 4 tests including setup
(`output/rubber-immediate-browser-final.log`): real create/edit PDF before held
context and admission; reconnect commits once; no completion PDF; approval
required suppresses immediate PDF; actual offline PDF; controlled native-share
File invocation. This native API test does not certify a physical OS share sheet.

## Completed quality gates

- `npm run verify`: exit 0; lint, typecheck, source ceilings/import direction,
  login outage, 834 isolated tests passed with 2 existing skips, production build,
  Service Worker and bundle guards passed. Initial route: 280.0/320.0 kB.
  Log: `output/rubber-immediate-verify.log`.
- `npm run test:db`: exit 0; 64 SQL files / 1,531 assertions, followed by all 7
  concurrency cases including cron-only Rubber processing and report/worker races.
  Log: `output/rubber-immediate-db.log`. No migration changed in this delivery.
- Lock edge follow-up: 9 focused cases passed, including expired temporary grant,
  grant removal, corrupt cache and unavailable storage. Scoped ESLint passed.
  Log: `output/rubber-immediate-lock-edge.log`.

## Plan acceptance evidence map

| Criteria | Evidence |
| --- | --- |
| A01–A03, A08 | Actual desktop create offline/online and edit download before independently held context/admission; local reference/document assertions in immediate receipt tests |
| A04, A14 | Allowed/approval-required/unknown create and edit eligibility; real pending approval creates no download |
| A05–A06 | Explicit Rubber-only gate, cache owner/branch/grant and expired-grant cases; production offline-reload evidence recorded separately below |
| A07, A12 | Actual reconnect creates once; full SQL/concurrency suite preserves authoritative locks, approval, stock, OCR, revision, report and idempotency guards |
| A09–A11 | Central browser regression plus serial immutable origin, busy/cancel/leave and scope tests; no completion-print caller remains; manual print path retained |
| A13 | Normal-row Eye absent in browser; source keeps problem-draft/inbound-branch viewing and edit/PDF; WEX untouched |
| A15–A16 | Hook accepts without GET/POST; exact prepared UUID/revision survives response loss; atomic queue replacement and frozen receipt reject old approval/snapshot |
| A17 | Real PDF bytes/download and controlled native File API are separate; physical mobile share sheet and paper output remain unverified |

## Review verdict

Local code is ready after the recorded gates. The smaller design reuses the
existing outbox, conditional IDB replacement, owner uploader and browser renderer.
No new storage store, Server engine or UI workflow is introduced. Review followed
form/policy → durable proposal → document snapshot → serial share and separately
owner/session → context → prepared command → admission → worker → receipt cleanup.
The compatibility issue found during review is fixed with the version-7 fence and
Route rejection. No deployment or Cloud validation is claimed.

## Production PWA experiment ledger

The first production run produced a real offline-reload PDF, then failed to show
the lock injected through a page route with the Service Worker active. It did not
establish a confirmed lock response (`output/rubber-immediate-pwa.log`). The next
run uses an isolated real Local cash-lock group and checks the authenticated
status API before testing the UI and offline reload; cleanup removes only that
fixture. No production gate is weakened to satisfy this test.

The authoritative-lock rerun passed both setup and PWA case (2 passed,
`output/rubber-immediate-pwa-real-lock.log`): offline reload created real PDF
bytes without the unknown-lock overlay; the real authenticated API confirmed a
locked isolated branch; its blocking screen remained after another offline
reload. The fixture was cleaned up. Strict unused-local/parameter TypeScript
checking also exited 0 (`output/rubber-immediate-strict-final.log`).

## Memory delivery

The Daily plan has 14 checked Phase tasks / 0 pending and `completed_local` status.
Central queue, printing and Core Brain notes were updated through the atomic
helper with expected SHA-256 and exact readback. Obsidian backlinks include the
Daily, Core Brain and printing note. The 96-note project audit found no finding
on the updated notes; it reports existing metadata/link/source-path issues in
unrelated Money Transfer, payroll and historical audit notes, plus component-level
possible-decision groups outside this delivery. Log:
`output/rubber-immediate-vault-audit.log`. These unrelated notes were preserved.

## Release preflight — user-authorized 2026-10-29

The user explicitly requested `push main` and `supabase db push`. The linked
Cloud project was verified as LanFlow (`psxwhhwjmolqperxrlzj`). Both linked dry run
and actual `supabase db push --linked` exited 0 and reported the remote database
up to date; no migration or seed was applied. `npm run deploy:check` exited 0:
deployment environment checks, 836 isolated passes / 2 existing skips, production
build, Service Worker and bundle guards passed (280.0/320.0 kB). Log:
`output/rubber-release-deploy-check.log`. This preflight does not assert a completed
Vercel deployment or a production browser smoke test.
