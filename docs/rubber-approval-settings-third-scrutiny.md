# Rubber settings — third scrutiny, 2026-10-31

Intent: each deliberate save should execute once, pending forms must not accept conflicting edits, and an offline failure must settle without waiting for a paused read.

Simpler-alternative pass: retain backend optimistic concurrency and current handlers; use one immediate UI lock shared by the existing policy actions, and skip error-recovery refetches while offline. No new service, queue or mutation framework is required.

## Debug ledger

1. The first fixture lacked audit timestamps and failed during presentation; corrected the fixture before evaluating production behavior.
2. Deterministic repro: 10 action failures / 1 successful next-action control. Five handlers issue duplicate calls before a pending-state rerender. Five offline-error paths await a held refetch and do not report the original error immediately.
3. Node inspector breakpoint is attached to the actual transpiled confirmAction catch before further changes. The blocked refetch precedes error reporting; releasing that read exposes the original offline error. Other handlers have the same ordering.
4. Ranked hypotheses and disproofs: (a) missing immediate guard vs failed backend locking — duplicate calls are observable before any backend response, and existing CAS remains independently covered; (b) paused recovery refetch vs swallowed mutation rejection — the original rejection appears after releasing the read; (c) excessive permanent locking vs transient pending lock — a completed action must permit a new action. An online-failure control must still refetch authoritative state.

5. Expanded controls produced 11 failing cases / 2 positive controls before fixes. The debugger probe required its test helper's normal TypeScript interop setting; after correcting the probe, the breakpoint showed confirmAction awaiting refetch with zero errors, then exposing the original error as soon as the read resumed.
6. One shared immediate ref lock now wraps the five policy action handlers and is released in finally. Local busy state disables the policy fields and confirmation controls until the entire operation, including online recovery, finishes. Offline recovery skips refetch using a fresh connectivity snapshot; an unexpected rejected refetch does not mask the original save error.
7. Focused action/refresh/approval-guard suite passed 24/24, including duplicate suppression across rerenders, completion/retry unlock and preservation of online authoritative refresh behavior.

8. Full isolated suite passed 1,019 tests / 2 existing skips. Strict TypeScript unused-local/parameter scan, targeted lint and the 500-line source-size guard passed. No unused production code was found in this pass.

9. Browser/API suite passed 15/15, including actual same-frame double confirmation (one PUT, pending fields disabled, error-path unlock) and an online-to-offline confirmation (zero PUTs, prompt dialog closure/error without reconnect). Existing price-cap, reset, group conflict, vertical layout, draft and manager access workflows also passed.

10. Final full lint, strict TypeScript unused scan, production build, source-size/import guards, service-worker checks and bundle budgets passed. Initial route first-load JavaScript remains 291.9 kB under 320.0 kB.

Sources: `src/components/rubber-bills/RubberApprovalPolicyPanel.tsx` (`runPolicyMutation`, five policy action handlers and their recovery paths); `tests/rubber-approval-policy-actions.spec.ts`; expanded `tests/rubber-approval-settings-ui.spec.ts`.

Verdict: fix-then-ship, now passing Local verification. Duplicate UI submissions and offline error-recovery waits were the additional failure paths. Existing Route authorization, response contracts and database concurrency rules remain covered by the full suite. No new schema migration, commit, push or deployment was performed in this scan.
