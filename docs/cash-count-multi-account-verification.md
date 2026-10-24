# Four-account count extension — local receipt

Date: 2026-10-24. Extends the independent count implementation; no Cloud migration, push or production deployment in this session.

## Scope and simpler implementation

Reuse the existing camera/OCR, evidence table, private Drive uploader, PDF renderer and alert system. Add an ordered array of at most four evidence rows instead of a bank-account master, bank-name fields or duplicate-account validation. Each slot has stable UUID identity even when a middle slot is removed; submitted account_position is a compact 1–4 order. The same account/photo may occupy different slots, as requested. Within one slot a retake replaces the chosen evidence; selecting two versions of the same slot is rejected.

Form, details and PDF show `บัญชี1 = 10,000.00 บาท` through the actual account count. Each slot needs a readable amount and fresh user confirmation. Empty/unreadable/unconfirmed slots block the whole count until retaken, confirmed or explicitly removed. Zero slots remains a valid cash-only count. No bank/last-digit/name input or automatic duplicate-account blocker.

`20261024040000_cash_count_four_accounts.sql` is append-only. It replaces evidence count uniqueness with per-count account positions and slot/image identity, adds `submit_cash_count_v3(uuid,jsonb,uuid[])`, and retains v2/no-bank compatibility wrappers. Old evidence gets position 1. The RPC validates 0–4 distinct evidence IDs, owner/session/upload status and one chosen image per slot, totals trusted amounts using numeric arithmetic, and attaches all rows in the same transaction as the count. Replay returns the existing count and its ordered account list.

Multipart preparation validates every chosen image before any upload and processes at most four in order. Persisted Drive IDs/status allow retry to skip completed files, including a failed fourth file after three successes. Identical photo OCR results within the same session are cached, while different slots retain separate evidence and private file identities. Photo download uses an authenticated `position=1..4` filter scoped to that count; legacy requests default to position 1.

## Verification

- Full local database suite: 57 files / 1,329 assertions passed, including 14 new four-account assertions: same photo accepted across slots, fifth account rejected, same evidence ID rejected, unreadied fourth upload blocks/rolls back all, retake images of one slot cannot both be selected, exact totals/order/replay and unselected evidence remains unattached.
- Upload/recovery tests: 5 passed; new four-slot failure test confirmed calls `file-1, file-2, file-3, file-4, file-4`, with four reservations and no repeat upload of the first three. All photos are checked before external writes.
- Browser camera tests passed for 0–4 slots, fresh confirmation, invalid-photo blocking, removing/renumbering slots and unchanged shared alerts/Admin group flow. Camera uses Chromium simulated media; physical-phone hardware is not claimed.
- Live authenticated contract suite: 7 passed including setup, prior cash-only/one-bank/report/review/PDF/cleanup paths and a real four-bank duplicate-photo OCR → four private Drive uploads → atomic submit → replay → per-position image read. Amounts 4 × 1,366.68 = 5,466.72, cash 70,000, combined 75,466.72. Test-created remote files cleaned using only IDs belonging to the fixture.
- Pre-extension schema restored into a disposable local database with an attached one-bank count. Migration applied successfully; original 123.45 balance, file ID and count link remained with position 1. Scratch DB removed. Local migration history and schema snapshot updated.
- `npm run verify` passed: lint/typecheck/source-size/import-direction/auth-outage, 566 isolated tests (two opt-in provider tests skipped), production build, Service Worker and bundle budget. Provider coverage is recorded separately above; the OCR prompt did not change.
- Four-account PDF generated with the actual renderer; parsed as one 80 mm page, Thai text and exact totals; visual render reviewed for spacing/overflow and signature room. Final user label format is included in UI/PDF acceptance.

## Scrutiny and release boundary

Traced slot create/capture/retake/remove → trusted OCR evidence → all-image validation → reserved-ID upload/retry → v3 atomic count → receipt/details/position-specific image/PDF. Kept permissions, branch fence, count timing, deletion/review and deadline alerts unchanged. Found and corrected the risk that sequential capture callbacks could overwrite each other's slot state by using functional list updates. Removed the earlier single-count evidence constraint without weakening per-slot or four-account submission checks.

Final user label regression passed: 11 camera/refresh browser tests, actual PDF text/render, lint/typecheck and production build; final Service Worker/bundle checks passed. Daily Multi Phases 1–3 are checked only after these receipts. Vault changes were saved with checksums and full readback; audit found no relevant issue in the updated notes, and existing findings in other components were left outside scope.

Verdict: ship locally. Production release remains separate: use the prior independent-count cutover plan, apply the fourth migration after the first three, then release the matching app and reload old clients. To roll back to one-account code after any four-account rows exist, recover a matching DB/app checkpoint or issue a forward fix; do not add the old unique(count_id) constraint over multi-account data.
