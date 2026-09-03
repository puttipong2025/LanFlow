# OCR, Bearer identity, WEX delete, and login keyboard regression ledger

Scope: Daily `10_Daily/2026-09-03 3.md`, findings B2–B5. Baseline: `4f88b155`.
The user subsequently chose to remove Drive deletion entirely and manage file cleanup manually.
Evidence ACL and unrelated dead code are outside this work.

## Hypotheses and discriminating checks

| Finding | Ranked hypotheses | Disproof/control and fail path |
| --- | --- | --- |
| OCR | 1. Response loss is mistaken for rollback. 2. Duplicate resolution deletes the winner's image. 3. Validation fails before insertion. | Successful insert, constraint rejection, same/other-owner duplicate are controls. Real Supabase client with injected fetch failure reaches route compensation after the simulated DB commit. |
| Bearer | 1. Two parsers disagree about scheme case. 2. Token claims are rejected. 3. Branch assignment mapping is wrong. | Canonical Bearer and cookie-only controls pass with the same claims/assignment data; lowercase fails and uses cookie RPC identity. |
| WEX | 1. A pending GET rewrites post-delete state. 2. DELETE fails. 3. Branch switch permits an old response. | Delay GET separately from DELETE; failed-delete and scope-change controls distinguish server result from stale client state. |
| Login | 1. Negative tabindex excludes reveal. 2. Auth/loading disables the control. 3. A key handler intercepts Tab. | Signed-out loaded page, native Tab/Shift+Tab and Enter/Space; no custom key handling needed. |

## Experiments

| Run | Change/input | Result and implication |
| --- | --- | --- |
| R1 | Seven OCR route tests, real PostgREST client with fake fetch; original implementation | 3 failed (committed response loss, unknown commit, failed reconciliation); 4 controls passed. Compensation deletes `attempt-file` in all failures. |
| R2 | Attach Node inspector with a source breakpoint to the isolated OCR test | Repro remains red; breakpoint did not resolve in the Playwright worker VM. Continue with source trace of INSERT → returned error → Drive delete and the client's fetch-error conversion. No product instrumentation added. |
| R3 | Add attempt UUID and exact-identity reconciliation, retain images on uncertainty | OCR 7/7 pass; committed response loss recovers same source, unknown outcomes keep the image. |
| R4 | Bearer production auth/client modules with cookie identity different from header | Canonical/cookie/error-status controls pass; mixed-case and malformed headers expose identity fallback. |
| R5 | Shared Bearer parser in claims and client factory | 14/14 pass: case matrix, absent/invalid header, cookie precedence, 401/403/503. |
| R6 | Delayed WEX GET completed after confirmed DELETE | Original hook restores the deleted row; request cancellation/identity guard and a fresh page prevent restoration and preserve loading ownership. Failed-delete and branch-switch controls pass. A VM promise matcher issue was fixed in the test harness, not product code. |
| R7 | Real signed-out login page, Tab then Enter/Space | Original negative tabindex fails; removing it passes normal/shift Tab, reveal toggling and no accidental submit. |
| R8 | User removes Drive cleanup responsibility from the app | Delete helper and production caller removed. All seven OCR scenarios retain images; exact-attempt reconciliation still recovers committed response loss. |
| R9 | Local authenticated API/browser run | 20 pass, 3 OCR failures: old positive fixtures use the now-denied `user` role (403). Switch positive fixtures to admin, preserve an explicit user-denial test, and use current Bangkok bill date to avoid unrelated backdate approval. |
| R10 | Final isolated regression run | 24/24 pass: auth 14, OCR failure-injection 7, WEX race 3. TypeScript test fixture nullability fixed without changing production behavior. |
| R11 | Final local runtime run | 24/24 pass: real Bearer API 1, WEX browser 11, login keyboard 1, OCR backend 11. Attached source image uses real local auth/RLS/DB with only Drive media stubbed. |
| R12 | Strict TypeScript and repository lint | `npx.cmd tsc --noEmit --noUnusedLocals --noUnusedParameters --incremental false` and `npm.cmd run lint` pass. Direct ESLint 9 CLI lacked flat config; the repository's supported `next lint` command passes. |
| R13 | `npm.cmd run verify` | Typecheck, production build (20 pages) and service-worker checks pass. Removed a trailing blank line left by deleting the Drive helper; final diff check passes. |

Production code is reviewed end-to-end after the regression gates. Local I/O fixtures are synthetic;
no Production credentials, rows, or media are part of this ledger.

## Final scrutinize

Intent: prevent referenced OCR media loss, keep one authentication identity, reject stale WEX reads after deletion, and restore keyboard access to password reveal.

Simpler-alternative pass: retain the existing OCR resolver, request controller, native login button and AlertDialog. The requested removal of Drive deletion eliminates compensation decisions. No cleanup subsystem, state library or migration is needed; the attempt UUID still permits immediate recovery after a lost INSERT response.

| Claim | End-to-end trace and checks |
| --- | --- |
| OCR image safety | `src/app/api/lanflow/rubber-bills/ocr/route.ts`: validate → private upload → explicit source UUID → INSERT → exact owner/location/hash/file reconciliation. `src/lib/server/google-drive.ts` has no delete helper. `rubber-bill-ocr.ts` retains owner/state replay guards; the attached-image route validates auth, bill location and attached source before media retrieval. |
| Consistent identity | `src/lib/server/auth.ts` → `src/lib/supabase/server.ts`: the shared parser selects header token or cookie; malformed headers return 401 before client creation. Claims, profile query and assignment RPC use the same token. The client factory has no other production caller. Local API tests exercise a token with another user's cookies and denied/allowed branches. |
| WEX deletion | Modal AlertDialog → hook `remove` → auth fetch → DELETE route → existing revision-checked `delete_export_vehicle_weigh_bill` RPC. Only confirmed success invalidates pending GET, filters the row and reloads page/cursor. Request identity protects both state and finally; branch/reconnect scope prevents an old deletion from changing the current scope. Failed DELETE preserves the list. |
| Keyboard | `src/app/login/page.tsx`: native type=button retains its existing accessible text and browser focus behavior. Tab/Shift+Tab and Enter/Space pass against the running page; the existing destructive WEX AlertDialog is retained. |

No remaining actionable finding in B2–B5 after the above gates. Evidence ACL (B1) and unrelated dead code (D1–D7) retain their original audit status. Verification is local and scoped; Google Drive/OpenRouter and Production were not exercised.

Verdict: **ship** for the selected local B2–B5 scope; all four reproduced failures have passing regression coverage. No commit, push, deployment or schema migration was performed.
