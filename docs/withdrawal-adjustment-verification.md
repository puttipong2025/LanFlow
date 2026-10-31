# Withdrawal adjustment verification ledger — 2026-10-31

Scope: latest-only adjustment deletion and outside-system settlement, preserving existing reports, closed slips and other working-tree changes. Local implementation only; no Cloud release.

## Contract established before mutation

- Slip dependency matches the existing outstanding snapshot source inclusion: same employee, active PENDING/APPROVED, slip created at or after adjustment approval, source effective month included by slip month. This includes an outstanding-only source and target zero omitted from printable transactions. Earlier slips and cancelled/rejected slips do not block merely by existing. The original closed deduction floor remains enforced independently.
- Identity is the latest active APPROVED adjustment ordered by approved_at DESC NULLS LAST, created_at DESC, id DESC. Never infer it from history display order or retarget a repeated delete to the next adjustment.
- Lock the employee, adjustment/source rows, then the sorted affected branch set before deletion/rebuild. Existing cash and report guards remain active. Rebuild may touch all open parents for the employee.
- Use existing admin delete POST/RPC; leave self-service pending withdrawal unchanged. Outside-system uses explicit null at the API boundary; missing/invalid branch is not null.

## Debug evidence

PostgreSQL has no interactive debugger installed in this workflow; after the runnable SQL reproduction, trace the RPC and trigger definitions and compare inputs one axis at a time.

| Run | Observation | Conclusion |
| --- | --- | --- |
| R1 — baseline SQL regression | Outside increase/zero failed with ADJUSTMENT_BRANCH_REQUIRED; target remained 1000 | Confirms request RPC rejects null before any cash effect |
| R2 — source trace | Rebuild joins the adjustment by ID; Dashboard writer always appends a branch event with mandatory location | A null-branch API-only change and delete-before-old-helper are insufficient |
| R3 — forward migration guards | Signature checks rejected CRLF/LF mismatches; whole migration rolled back | Normalize existing function definitions for guarded patches; apply LF SQL bytes consistently |
| R4 — SQL after implementation | Two approvals in one transaction tied at now()/created_at; UUID tie-break determined latest | Test chronological history with distinct approval times; preserve existing deterministic tie-break |
| R5 — SQL with ordered fixtures | All 16 assertions passed, including delete-zero restore, latest summary, pending blocker and permissions | New source-based helper and outside-system event guard satisfy the initial reproduction |

Ranked hypotheses tested: (1) request branch guard blocks null — confirmed by R1; (2) null branch alone suffices — disproved by Dashboard NOT NULL trace; (3) old rebuild can run after deletion — disproved by required join; (4) history list creation order identifies latest — disproved by approval ordering and R4. Further regression results are recorded below as run.

## Extended verification and scrutiny

- R6: `supabase/tests/time_payroll_adjustment_delete_test.sql` expanded to 44 passing assertions: original-only report lock, adjustment report refusal, pending/approved/outstanding-only/zero-omission snapshots, employee and delegated branch permission, active/overdue cash fence, temporary unlock, post-delete rebuild failure rollback and private helper grants.
- R7: Feature integration/UI run: 11/11 passed including setup. The real admin API accepts explicit null outside settlement, rejects missing/malformed settlement, exposes latest ID/adjustment metadata and rejects repeated deleted IDs. Existing RPC tests retain branch deltas and source deletion history cleanup.
- R8: SQL full suite: 73 files / 1,715 assertions passed. Database concurrency suite: 16 passed; feature races cover actual create_report_batch, approval and simultaneous duplicate delete. A further feature concurrency rerun added new-pending-request-versus-delete and passed.
- R9: Combined adjustment/payment browser suite: 15 passed including setup. Fixture isolation suppresses unrelated threshold notifications and explicitly chooses the directory branch; no product alert behavior was changed. Checked mobile dialog images at 390×844: no horizontal overflow, native focus handling and cancel-first destructive dialog.
- R10: Guarded forward migration replay from original HEAD function definitions inside a rollback transaction: all 44 assertions passed; existing local data/state preserved. Local migration history records 20261031030000. Schema snapshot regenerated while preserving unrelated existing changes.
- R11: Initial verify completed ESLint, TypeScript, size/import guards, auth-outage check, 1,077 isolated tests (2 live OCR skips), production build and Service Worker, then failed the existing dynamic Time/Payroll bundle budget. Lazy loading the deletion interaction reduced the chunk but remained above budget; the adjustment entry modal is now lazy loaded too. No budget threshold was increased. Final gate follows below.

## End-to-end scrutiny

Reviewed the deletion entry from EmployeeTransactionHistory through the admin action and permanent-delete RPC, including the unchanged report guard, cash movement guard, dashboard delete projection and open-deduction planner. The adjustment branch precedes original-source deletion and requires manager employee scope plus the adjustment payer branch. It targets the submitted ID, verifies latest after locks, blocks pending/report/slip dependencies, then deletes and rebuilds by the surviving withdrawal ID. Forced failure restores both row and branch projection.

Reviewed outside settlement from both creation and pending approval dropdowns through explicit-null API validation, request/decision RPC and branch-only history writer. Outside adjustments retain source history but skip branch events; their deletion needs no branch projection and still obeys the original source's cash fence during remaining-balance updates.

The smaller design reuses the existing POST/RPC, planner, report fence, shared AlertDialog and native selects. No new cash-pair table, transfer workflow, per-row preflight endpoint or permission was introduced. Two lazily loaded interaction surfaces preserve the existing bundle limits.

Latest user wording: row button “ลบ”, confirmation button “ยืนยันลบ”. The row's accessible name identifies adjustment deletion. Earlier trash-icon wording was superseded by the user.

- R12: A new deterministic permissions-race reproduction showed a manager revoked while waiting on the employee lock could still delete an outside-system adjustment. Source trace found employee scope was checked only before waiting; payer-branch checks cannot catch a null-branch source. Forward migration `20261031031000_withdrawal_delete_permission_fence.sql` rechecks active status and employee scope after the row is reacquired. The same real concurrent test now passes, together with report/approval/new-pending/duplicate races. No bypass or permission expansion was introduced.
- R13: Final UI wording regression passed (2 including setup): visible row action “ลบ”, confirmation “ยืนยันลบ”, accessible name retained, latest moves backward after success and stays on failure. Final screenshots: `output/adjustment-delete-mobile.png`, `output/adjustment-outside-mobile.png`.
- R14: Final `npm run verify` passed: ESLint, TypeScript, source-size/import boundaries, auth-outage, 1,077 isolated tests / 2 existing live OCR skips, production build, offline manifest and Service Worker checks. Time/Payroll dynamic chunk 119.4 kB raw / 27.8 kB gzip, within unchanged 125.0 / 28.8 limits; initial first load 294.8 kB within 320.0.

## Final verdict

Fixes from scrutiny were reproduced and verified, including the permissions revocation race and bundle regression. The implementation is ready for local review with the agreed behavior. Cloud migration, commit, push and deployment were not performed. DB lint reports no error in this scope; its unused p_account_number warning is from the existing payment-bundle function.

- R15: After the permission-fence forward fix, full DB rerun again passed 73 files / 1,715 assertions plus all 16 real concurrency tests. Final DB lint has no scope error, and the stored schema includes the post-lock permission recheck.

## Additional scrutiny pass

See [withdrawal-adjustment-scrutiny-20261031.md](withdrawal-adjustment-scrutiny-20261031.md): fixed stale approval authorization after waiting for the employee fence (forward migration 20261031032000) and the missing employee POST exception boundary. Both reproduced before fixes and pass afterward, including account deactivation during the wait. Strict unused scan found no dead code. Final verify1,082/2existing skips and DB1,715/concurrency16 pass; no Cloud release.
