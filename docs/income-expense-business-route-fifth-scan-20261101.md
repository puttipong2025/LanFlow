# Income/Expense business and route scrutiny, fifth pass — 2026-11-01

Scope: the fresh-create/single-record-edit/manual-PDF behavior after ADR0098/0099. Trace cash-form input → persistence → numbered acceptance/outbox → validated Route receipt, and the now-independent sale PDF/detail path. Prefer an existing form preflight over a new persistence protocol or changes to monetary/business rules.

## Fixed finding

### P1 — A partly invalid cash form silently saves only some touched rows

`IncomeExpenseModal.submitForm` filtered general rows with `title.trim() && cost > 0` before passing the array to persistence. With a valid first row and a named second row whose cost was zero or negative, it silently omitted the second row and closed the create form as a success. No storage or Route failure occurred, so the partial-persistence error summary never ran. With draft recovery deliberately removed, that named row was lost without a warning.

The general form now checks every touched row before any save: require a nonblank title and a finite, positive cost. If any such row fails, show one validation message and do not accept any rows. After correcting the amount, both rows can be accepted together. This is pre-save validation; the authorized policy of discarding unfinished input after an actual failed save remains unchanged. Sale validation and genuinely untouched-row filtering retain their existing behavior.

## Dead code removed

- Removed the unused `transaction` projection from `useIncomeExpense.syncTransaction`. Its only caller now consumes the sync status; constructing a receipt-shaped record was left over from automatic sale PDF delivery.
- Removed the old result union's unused transaction member/type. The sender still validates the complete server result and the foreground sale flow still requires its receipt before returning synced.
- Removed the unreachable fallback title in general submission mapping: all submitted lines already have a nonblank trimmed title.

## Debug ledger

1. Deterministic RED through the actual form submit handler: **4 failing zero/negative-cost cases / 2 passing all-valid controls**, covering income and expense. Only React/data/toast boundaries were replaced; the production validation/filter/mapping ran unchanged.
2. Node inspector paused at the real `onSave` call in `submitForm`: `lines` contained named rows costing 10 and 0, while `filledLines` contained only the first. The save callback received one row with no validation error.
3. Ranked hypotheses: browser-native number validation already prevents the input, persistence/Route drops a row, a storage failure causes normal partial success, and client filtering removes the row before persistence. The debugger located the last path before any storage/network work. Separate all-valid controls passed before the fix. Real old-build PWA RED then failed **all four zero/negative-cost cases** and found the valid row already in the outbox, disproving the native-validation hypothesis.
4. GREEN focused form/action/Route/receipt suite: **31 passed**. Extended regression cases cover non-finite amounts, whitespace titles and untouched-row filtering; no new production helper or protocol was introduced.

5. Full isolated suite: **1,305 passed / 2 existing skipped**. Strict unused/type checks, ESLint, source-size and import-direction guards passed. The changed product files match build `b3ZtBsNwXRTgW1Yu1VCo8` by SHA-256; build/offline assets/service worker/bundle checks passed (298.4/320 kB initial load).

6. The real production PWA suite passed **14 journeys + authentication setup**, including the four previously failing invalid-cost forms, correcting each form and accepting both rows, fresh-create policy, actual income/expense edits, numbering/replay/approval and real HTTP Route validation.

7. Final same-build regression: **19 offline + 9 sale + 1 manual PDF journey** passed (30 Playwright results including setup). Zero-priced sale controls remain valid; cash validation did not change giveaway pricing, stock handling, pending approval or manual document delivery.

Verdict: **ship for Local review** — touched cash rows cannot be silently omitted, and confirmed sync/Route/PDF behavior remains intact. No additional verified Route issue was identified in this pass.

No SQL migration, Cloud apply, commit, push or deployment in this scan.
