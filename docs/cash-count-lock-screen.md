# Cash count branch lock screen

## Scope (2026-10-28)

Selected locked branches show a non-dismissible native modal using the existing ModalShell. The application remains mounted so unsaved forms and dialogs survive a lock/unlock cycle. Browser approval remains the outer authentication gate. No database, permissions, lock deadlines, temporary grant duration, or cash count calculation changes.

The screen shows branch, due date (Bangkok), contacts for users without unlock rights, and the existing authorized unlock action. It provides manual status refresh, online logout, and branch selection restricted to the accessible bootstrap locations. No close or cash-count shortcut exists. Offline branch switching remains prohibited.

## State and requests

- useCashCountLocks keeps the last server-confirmed snapshot for the same identity/role/branch scope when going offline; a different scope cannot reuse it.
- No snapshot means checking, not unlocked. Loading failures retain the gate with retry.
- After a known deadline expires, an unconfirmed status blocks interaction until the server confirms the next state. The client never extends a temporary grant.
- Existing deadline timers, focus, visibility, online, and cross-tab events remain. Only the blocked screen adds a 10-second status poll, paused while hidden/offline, deduplicated through the same pending request, bounded by a request timeout.
- Countdown to the next status request and existing temporary-use countdown are retained. Browser approval retains its existing 10-second countdown and behavior.
- Unlock remains server-authorized. A ref prevents duplicate submissions; late unlock errors/results from another scope cannot release the current gate. Invalidated read results are discarded before applying state.
- The financial server guard remains authoritative for writes. The screen adds UI blocking, not new server-side restrictions on reading or cash counting.

## Review / experiment ledger

1. Existing tests expected clicking cash count while locked; this contradicts the approved new screen. Updated to assert no escape, no counting shortcut, authorized unlock, and retained temporary countdown.
2. New branch test initially clicked the underlying header after the dialog changed title; native modal correctly intercepted it. The test now selects its initial branch while still in the deterministic failed-load state.
3. Draft test initially searched for a button title instead of its accessible text. Corrected the selector to the existing visible label; no product behavior changed for this test issue.
4. Existing settings tests inherited live local lock state. Mocked an unlocked scope for settings-only scenarios, while dedicated lock tests exercise locked state explicitly.
5. Offline-expiry test initially disconnected on the dashboard before the existing offline fallback's RubberBillsModule chunk loaded. A pageerror probe reproduced the chunk-load failure. The control loads that existing fallback online first, then disconnects. This isolates deadline handling without changing unrelated offline navigation.
6. Review reduced the per-second app-shell clock to blocked screens only; a one-shot deadline timer handles expiry during normal/offline operation. The existing notice keeps its local temporary-use countdown.
7. Mobile inspection exposed an initial 11-second display when the most recent request started after the last clock tick. Clamped the display to 0–10; request scheduling still uses actual elapsed time.

Offline failure hypotheses were: an unloaded fallback chunk, expiry-state calculation, or native modal activation. The pageerror probe identified RubberBillsModule chunk loading; loading the same fallback online before disconnection falsified the expiry/modal hypotheses. The resulting offline-expiry test passed with the same lock state fixture.

## Verification

- `output/lock-screen-ui-green.log`: 11 passed (setup, browser approval, initial lock/draft, overdue settings/expiry).
- `output/lock-screen-regression.log`: 9 passed (setup, six shared discrepancy UI cases, two lock screen cases).
- `output/lock-screen-final-ui.log`: 9 passed (setup, three lock screen cases including offline expiry, five overdue cases).
- `output/lock-screen-race-final.log`: 5 passed (setup and all four new lock screen cases, including stale branch response and rejected unlock).
- `output/lock-screen-verify.log`: full verify exit 0, 740 isolated passed / 2 live OCR skipped; lint, types, source size, import direction, login outage, production build, SW and bundle checks passed. First load 273.6 kB / 320 kB.
- Hook lint passed again after adding a bounded POST timeout. No server code or migration changed.

Daily 2026-10-28 and the existing Overdue Lock memory note contain the completed Phase checklist and local-only evidence. No commit, Cloud deployment or database push is part of this work.
