# Shared device Business/Route scan — 2026-11-01

Intent: verify the branch-independent device registration, legacy rollout, recovery and Admin paths with minimal changes.

## Simpler alternative

Keep the existing issuer validator and RPCs. Validate `deviceId` only when advertised; reuse the old response shape during deployment, as explicitly confirmed by the user. No new capability endpoint, flag, queue or allocator is needed. User-requested registry cleanup is handled separately by forward migrations that preserve frozen bill references.

## Finding: an advertised malformed device identity was accepted

The shared backend includes `deviceId`, but `src/lib/rubber-bills/numbering-contract.ts:4` previously ignored it. Registration Route → existing validator → browser prepare → persist issuer would accept `deviceId="invalid"` and mark a fresh browser ready. The validated issuer now has an optional device UUID, checked at the shared validator's existing Route and client call sites. A missing field remains valid for the legacy backend; old cached registrations keep their counters.

### Reproduction and debugger

- Pre-fix Route cases accepted both absent and malformed device identity. Initial strict-capability tests produced three failures; requiring the field was then superseded by the user's explicit request to keep the old backend usable until deployment. Absence is therefore supported behavior, not a final bug finding.
- Three pre-change controls passed: a well-formed shared response, parallel branch preparation and a lost-registration-response retry. Ranked hypotheses were missing capability validation, branch mismatch, corrupted cached state and a stuck registration request. Matching branch/empty initial storage and successful controls ruled out the latter three for the repro.
- A disposable V8 debugger at the production response-validation line observes the malformed advertised field. With the unchanged HEAD validator loaded in memory, registration is accepted and readiness=true. The current validator rejects that same input; readiness=false. The current validator still accepts a field-absent legacy response with readiness=true, as required.
- The diagnostic initially replaced both files named numbering-contract.ts (including Income's); its resulting IDB abort was a harness defect and not product evidence. Restricting it to the Rubber contract produces the before/after observations above.
- A cross-context rejection matcher in the new test returned an unexpected Promise; it was changed to the existing boolean-rejection assertion style. This was a test-harness issue. The first full check also collected test names while rollout expectations were being changed; the stable final source is verified separately.

## Authorized scope additions

The user asked whether production codes change and requested removal of old registrations. Current production is untouched. At deployment, old browsers transition on successful registration, and obsolete unlinked registry rows are removed using ADR0097's atomic reference-preserving migration. Admin defaults to active devices. This is a user-requested lifecycle change, not another claimed discovered defect.

## Dead code

No additional dead function/import/variable was proven. The temporary strict-only helper was removed when the user confirmed legacy compatibility; the final implementation reuses `isRubberBillIssuer` with one optional-field validation. Existing Route exports, allocator and installation helper have live callers.

## Verification ledger

- Focused final compatibility/readiness/registration run before the default-filter addition: **72 passed**.
- Targeted SQL after cleanup: **101 passed**; full SQL **1,922 assertions / 79 files passed**; shared/business concurrency **3 passed**.
- Local old registry count changed from 313 to zero; 313 minimal reference records preserved. Real Rubber/Income outbox-style creates with removed issuer UUIDs still commit and retain their old numbers; wrong-branch references are rejected.
- Final full verify after all rollout/cleanup changes: **1,245 passed / 2 existing skips**, exit 0, including lint/type/source-size/import/auth-outage/build/offline/SW/bundle. The build was explicitly targeted at Local. First load 298.7/320kB; offline assets 161.
- Production browser/PWA/Routes: **114 passed**, including default-active filtering and explicit history for modern retired devices, shared code across branches and offline/PDF/lock journeys. Strict unused/type check and targeted ESLint passed. Full SQL1922/79files and concurrency3 completed successfully. Diff check passed after normalizing only two generated trailing spaces in the schema snapshot.
- Vault: four notes saved atomically with exact readback/SHA-256 receipts. Post-write audit scanned 103 notes and matched the pre-write audit exactly; no new memory issues were introduced.
- No Cloud migration, commit/push or deployment.

Verdict: **ship at the separately agreed rollout step** — malformed advertised identity is guarded, legacy compatibility remains available, and registry deletion preserves old business references.
