# Cash count redesign experiment ledger

Local PostgreSQL, 2026-10-24. No Cloud mutation.

| Run | Reproduction / change | Result / implication |
| --- | --- | --- |
| DB1 | Apply independent-count migration in a transaction | Schema/functions created on local DB. Not runtime verification. |
| DB2 | Test fixture attempted a second Super Admin | Fixture violated singleton constraint; use Admin with existing system-manager capability instead. |
| DB3 | Fixture used UI capability name as DB column | DB uses `can_access_super_admin_features`; fixed fixture to actual schema. |
| DB4 | Income fixture lacked bill_option | Existing income constraint requires รายรับ; corrected fixture. |
| DB5 | Full pgTAP independent count flow | 15/18 passed. Delete failed because deletion audit required paired report; date fallback failures followed that failed delete. |
| DB6 | Relax only the cash-count audit pairing rule and rerun | 18/18 passed, including both date fallback failures. Confirms the audit constraint was the cause. |
| DB7 | Retire prediction/report columns, then run full DB suite | Found delete_report_batch still checking cash_counts.report_id; removed that guard while preserving report/export locks. |
| DB8 | Full DB regression after forward fixes | 56 files / 1,315 assertions passed. |
| DB9 | Two actual database connections, then concurrent check/check and check/delete | Committed baseline, movement fence, expiry and first-reviewer semantics passed. Cleanup required flushing existing deferred financial-event triggers before removing fixture branches; no product workaround was added. |
| MIG1 | Review legacy report uniqueness before replay | Report numbers are branch-scoped; changed count-number uniqueness to (location_id,count_no). |
| MIG2 | Restore old schema into a disposable database, seed duplicate numbers and active legacy session, apply all three migrations | Two counts and two reports preserved, snapshots stayed null, active legacy session expired. Scratch database removed. |
| OCR1 | Live provider with six supplied photos | All expected amounts matched. |
| OCR2 | Synthetic balance/available, multiple-account and blank screens | Chose the balance and refused both ambiguous/unreadable screens. |
| UP1 | Inject Drive error, lost database acknowledgement, swapped image, missing confirmation and expiry | Retry reused reserved file ID; invalid attempts did not upload. Existing private-file 409 replay verified without adding public permissions. |
| UI1 | Browser detail disappeared while source was being edited during a run | Unchanged stable rerun passed. Avoid editing product source while end-to-end tests run. |
| UI2 | Alert test tried a manual click while automatic dialog was opening | Seeded test timer and used one deterministic manual request; shared count page/acknowledgement passed. |
| UI3 | Old alert assertions assumed a fixed header sibling and an unambiguous nested region | Scoped the tests to the actual check button and leaf group section; no unrelated product header change. Alert regression passed. |
| PDF1 | Initial Node PDF test used the server pdfkit variant | Byte parsing failed; disproof with the actual production standalone variant produced a valid PDF. Corrected only the test boundary. |
| PDF2 | Parse and render the production 80 mm renderer | Correct width, one page, Thai amounts/names, no reason field and no visual overflow. |

Fail path: delete_cash_count → document_deletion_audits INSERT → document_deletion_audits_check1. Alternatives: delete authorization, count status constraint, audit paired-report constraint. The successful check/replay and the exact 23514 audit constraint disprove the first two as the cause of this run. Relax only the cash-count pairing requirement, rerun the same full flow, and compare fallback date results as well.
