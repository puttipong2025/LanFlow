# Global shared bill issuer codes

Status: accepted by the user on 2026-11-01; implemented and verified locally. Cloud rollout is separate.

## Decision

Subsequent amendment on 2026-11-01: [ADR0096](0096-branch-independent-bill-device-identity.md) removes branch from device identity. One installation/generation now shares its code across branches, and UNIQUE(code) belongs to the device table rather than branch usage links. The original global counter and historical compatibility below remain applicable.

New issuer registrations use a single server-owned increasing counter across all branches. The code remains `D` plus at least two decimal digits, such as `D287`, `D288`. Rubber, Income and Expense use the same issuer registration, with their own existing bill sequence scopes. The numeric final suffix after the code is still the existing central bill suffix; it is not part of the device registration identity.

The counter starts above both the highest retained issuer code and all previous branch counter high-water marks, including retired codes. Allocation updates one locked row inside the registration transaction. Concurrent branches therefore cannot allocate the same value. A partial unique index enforces code uniqueness for new global registrations, and the private counter cannot be read or reset by ordinary clients. Codes are not truncated, reset or recycled; exhaustion fails explicitly at the existing 18-digit client limit.

## Compatibility

Historical branch-local codes may already repeat between branches. Those rows remain marked `global_code=false`, readable and valid for frozen offline proposals. Their next successful online registration retires the old row and assigns a global code. Repeated registration then returns the same global issuer without consuming another code. Already-global active issuers are not rotated. Historical codes are not rewritten to claim retrospective global uniqueness.

Both bill modules already preserve old outbox/reservations and accept old retired issuers. Their browser allocator receives a new issuer ID/code for new bills and initializes its new-issuer counters using the existing replacement path. Existing bills, queued commands and PDFs are not rewritten. No new client format, database version, endpoint or network call is introduced.

This guarantees no duplicate **new server-allocated issuer codes in this database**. It does not guarantee distinct offline base numbers after cloning/restoring a browser profile, nor across independent databases or an inconsistent database rollback. The existing central suffix and retained per-bill binding continue to reconcile repeated bases. A retired code is not a login revocation.

## Migration and rollout

Apply `20261101020000_global_bill_issuer_codes.sql` after the shared Income/Expense issuer migrations. It locks the registry/counter/head tables while seeding the high-water mark and installing the function in one explicit transaction. No data reset or bill update is required. Keep the global allocator on rollback; restoring the old branch allocator would reopen cross-branch collisions.

Administrative restores/imports must preserve the global counter and registry together and must not lower the high-water mark. Ordinary business/history deletion never touches the global counter.

## Verification

Local SQL: **1,911 assertions / 78 files passed**, including 90 targeted assertions for global registration and both bill modules. Concurrency: **3 tests passed**, including 12 registrations in four branches, stable concurrent registration retries, nonrecycled replacement codes and both modules' business/replay behavior. Tests derive their base from the actual allocated issuer code instead of assuming every branch starts at `D01`.

The first concurrency fixture reused the same location name for four rows, violating the existing unique name constraint; it was corrected to unique fixture names and all three cases then passed. The initial migration attempt required an explicit transaction around `LOCK TABLE`; no statements were applied on that failed attempt, and the corrected forward migration applied atomically.

Sources: `supabase/tests/global_bill_issuer_codes_test.sql`, adapted rubber/income SQL numbering suites, `tests/rubber-device-numbering-concurrency.spec.ts`, and the forward migration. This supersedes the per-branch issuer-code scope in ADR 0091/0094 while preserving their frozen-number and offline rules. No Cloud migration, push or deployment in this task.
