# Rubber settings — second scrutiny, 2026-10-31

Intent: settings must require an intentional online save, validate acknowledgement before success, and preserve the current exact-role/revision/database boundaries.

Simpler-alternative pass: reuse the existing strict response contracts in a browser-safe module instead of writing a second set of validators. Keep server import paths compatible through re-exports. Preserve the existing query and mutation architecture.

## Debug ledger

1. Repro harness initially exposed cross-realm Promise matcher errors; wrapping VM calls in native async functions corrected the test harness before evaluating production failures.
2. Reliable production repro: 26 failures / 9 valid-response controls pass. Eight actual TanStack MutationObservers become paused while offline and resume on reconnect; malformed successful group/settings bodies are accepted; null error bodies become TypeErrors. Synthetic data and real query-core scheduling isolate this from database/network failures.
3. Node inspector attaches a breakpoint in query-core's retryer before further hypothesis tests. Default online network mode reaches the paused state. Source trace: UI handler -> useMutation default network mode -> paused mutation -> reconnect execution; response.json -> unchecked type assertion -> success/cache/UI. Knobs: connectivity, network mode, response status, response body, requested value/target.
4. Ranked hypotheses/disproof: (a) default paused scheduling vs API latency — paused before fetch and reconnect resumes it; (b) missing client contract vs bad valid fixtures — all nine valid controls pass; (c) null-only error access vs server rejection itself — non-null explicit errors remain actionable. Matchers are ruled out by corrected native wrappers and independent MutationObserver state assertions.

5. Shared the unchanged strict server response contracts through `src/lib/rubber-bills/approval-group-contract.ts` and pure `src/lib/validation/primitives.ts`. Existing server import paths re-export the same functions, avoiding duplicated validator implementations or Next.js server imports in browser code.
6. Group query and all eight group/global mutations now validate successful replies against their submitted values/targets before cache/success handling. Null/malformed failures retain public messages; malformed maximum-conflict details cannot crash formatting.
7. Settings mutations use immediate execution with an explicit connectivity guard, so offline attempts reject rather than pause for later replay. The global date-rule save uses the same boundary. Native disabled fieldsets make the settings/group forms read-only offline while retaining drafts and allowing the global section to be opened for inspection.
8. Focused route/client/refresh regressions passed 154/154. Strict TypeScript unused scan, targeted lint and source-size guard passed. No unused code was identified; validator implementations were relocated and shared rather than copied.

9. Full isolated suite passed 1,006 tests / 2 existing skips. Browser/API suite passed 11/11, including offline form locking/draft retention/no reconnect writes, malformed-read handling without a page crash, malformed central-save rejection with retained draft, plus maximum conflict/required-field and reset permission workflows.

10. Final full lint, strict TypeScript unused scan, production build, source-size/import guards, service-worker checks and bundle budgets passed. Initial route first-load JavaScript is 291.9 kB under 320.0 kB. The updated browser contracts do not pull Next.js server dependencies into the client.

Verdict: fix-then-ship, now passing Local verification. The main additional risk was offline settings intent being silently deferred until reconnect. No new schema migration, commit, push or deployment was performed in this scan.
