# SMS login second factor — local implementation

Release update 2026-10-25: user authorized `push main` and `supabase db push`. Cloud migrations 20261025010000, 20261025011000 and 20261025012000 applied successfully; post-apply dry-run reports up to date and migration history matches. CLI emitted a nonfatal catalog-cache certificate warning after applying; independent dry-run/history checks confirmed the migration state. Earlier local-only statements below are historical evidence, not the current migration status. Application hosting deployment, SMS environment configuration and pilot activation are not confirmed by database migration or Git push alone.

Post-push inspection: Vercel reported successful Production deployment for 718c243 and its login page returned HTTP200. GitHub web-gate passed; database tests passed but route-boundary tests failed on the three new SMS mutations (expected401, actual403). Origin was checked before authentication. Follow-up fixes authenticate first, then enforce Origin before body parsing or mutation. Three new tests failed before the fix and passed after it, including authenticated foreign-Origin rejection with zero writes. Database migrations are unchanged; hosting SMS secrets and pilot activation still require separate verification.

Status: local implementation verified; no Production migration/deployment has been performed. The user received SMS with the new sender. A real-provider fixture verified once/rejected replay, and a subsequent handset test using the code returned by the user passed through the real local application API. Final build, PWA reconnect/role-downgrade acceptance and regression checks passed. Production configuration, pilot-account selection and rollout remain separate steps.

## Ownership and boundaries

Supabase retains phone/password authentication. LanFlow owns the SMS challenge, keyed by the verified Supabase session ID and account generation. THSMS is the only delivery provider. There is no Native Phone MFA subscription, custom JWT signing, or browser-stored authorization flag.

`sms_login_status` is the sole authenticated bootstrap RPC allowed before the second factor. It returns a status only. The PostgREST pre-request hook protects table access and SECURITY DEFINER RPC entry points; restrictive RLS policies additionally protect existing public RLS tables and Storage objects. Service-role challenge RPCs must never be granted to browser roles. A missing/failed status check fails closed.

The migration installs `pgrst.db_pre_request`. Before applying to another environment, inspect its existing value. If another hook exists, compose the checks instead of overwriting it. Recheck newly added schemas/tables and non-PostgREST entry points separately.

## Server-only settings

- `THSMS_API_KEY`: THSMS access token.
- `THSMS_SENDER`: approved sender name.
- `SMS_OTP_SECRET`: at least 32 cryptographically random bytes, stored as a server secret. Never use a NEXT_PUBLIC_ prefix. Rotation invalidates pending codes, not an already verified session.

The application will not enable SMS through its admin endpoint without all settings. A new deployment/process is needed after changing environment variables. Never print the values. `.env.local.example` contains names only.

For local production-mode tests, explicitly set `SUPABASE_SECRET_KEY` to the local service credential as well as any legacy `SUPABASE_SERVICE_ROLE_KEY`. Next also loads `.env.production.local`: if its Cloud `SUPABASE_SECRET_KEY` fills a missing local variable, the local URL and Cloud credential become mixed and service RPCs fail. Keep each environment's URL and preferred credential together; do not fix this by weakening the gate or modifying Cloud settings. The current ignored local file was aligned, then the real build-mode SMS send/verification and replay rejection passed.

The THSMS request follows https://thsms.com/sms-api and its linked cURL/Node examples: POST `/api/send-sms`, Bearer authorization, JSON `sender`, `msisdn` array and `message`. A real connection test returned HTTP 200, `success: true`, numeric `code`, and a `data` object containing `credit_usage` and `remaining_credit`; no message ID was present in that response. The adapter accepts explicit `success: true`. HTTP 200 alone is not proof of handset receipt. Do not weaken this check to accept arbitrary JSON.

## Behavior

- Super Admin alone can toggle SMS for non-Super-Admin accounts. Default is off.
- Enabling bumps the account generation and revokes all earlier sessions. Disabling preserves active sessions.
- Each new password session must pass its own SMS challenge when required. Token refresh does not request another code.
- Codes have six digits, expire in five minutes, allow five failed attempts, and can be used once. Resend waits 60 seconds and replaces the old challenge. Additional limits are five sends per account per hour, ten failed attempts per account per hour, 20 sends per IP per hour and 100 sends globally per hour. The IP bucket trusts `x-vercel-forwarded-for` only on Vercel; development shares a local bucket. Raw IPs are not persisted. Account/global caps remain independent. Old IP buckets and expired unverified/orphan challenges are cleaned opportunistically during sending, without a separate scheduler.
- No automatic provider retry. An ambiguous send timeout leaves the challenge unusable until a successful new send; the user waits for the resend interval.
- Revocation blocks server access immediately. The browser returns to login when it detects revocation online. No push channel is added.
- Before replaying persisted queues, revalidate the current account, business role and original branch. A 401 pauses existing sync without changing the event to failed. Business data is not cleared by auth-cache cleanup. A role downgrade now retains pending work: the User shell has no business sync hooks. Restoring business access allows the same owner/branch to resume through the normal validation path; it never transfers work to another account.

## Phone changes

Super Admin changes a phone in the employee dialog. Changing their own phone requires their current password through an isolated, non-cookie client. No SMS is sent for phone changes.

The server records a short-lived phone-change authorization and invokes the Supabase Admin Auth API. A trigger on `auth.users` checks that authorization, synchronizes `profiles.phone`, increments the security generation, revokes old sessions, removes pending challenges and audits the change in the same database transaction as the Auth phone update. Direct self-service phone changes are rejected. The existing password and user ID are preserved. A timeout should be resolved by rereading the account before retrying; an unchanged phone request is rejected rather than revoking a fresh session again.

## Local verification

- `node scripts/verify-sms-security.mjs`: local container only; creates and removes its own fixture account, signs in through real Supabase Auth, exercises direct REST/RPC and RLS without the pre-request hook. Sends no SMS.
- `npx playwright test --config=playwright.isolated.config.ts tests/sms-otp.spec.ts`: HMAC binding, origin enforcement, queue ownership, provider failure.
- `npx supabase test db --local`: existing database regression suite.
- Run project lint, typecheck, source-size, isolated, browser and build gates before rollout.

## Rollout and recovery

1. Inspect target Auth/schema and pre-request configuration; take the normal database recovery checkpoint.
2. Apply migration before deploying application code, since the new API requires `sms_login_status`. Keep all SMS switches off.
3. Configure the three server settings; deploy and verify ordinary password login and Super Admin recovery access.
4. Test one SMS to the user-authorized phone recorded in the Daily plan, then the complete OTP flow. Confirm handset receipt with the user. Do not put the real OTP in logs or notes.
5. Confirm provider response shape and sending limits; test offline/reconnect, role changes with pending work, multiple sessions and phone-change retries before enabling trial accounts.
6. Super Admin may disable SMS to recover a user. This does not restore already revoked sessions: the user signs in again with the existing password.
7. During an application rollback, do not remove the database gate while accounts still require SMS. Keep a compatible login/recovery path, or disable SMS explicitly per approved recovery policy first. Avoid destructive schema rollback and preserve audit evidence.

## Trial monitoring

At each trial, compare THSMS dashboard delivery status and remaining credit before/after sending. Provider acceptance is separate from handset receipt. Start with one approved account and review credit daily; pause new enrollments if delivery or verification degrades. Disable affected accounts' SMS through Super Admin recovery rather than bypassing verification. Hard limits are 5 sends/account/hour, 20/IP/hour and 100 globally/hour; at the observed one-credit test rate, 100 accepted sends in an hour can consume 100 credits. Actual billing depends on message length/provider terms, so this is a send cap rather than a currency cap.

Server errors log only `stage` and an allowlisted generic `reason`; never the request body, OTP, token, key, phone or upstream payload. Inspect these alongside HTTP 429/503 counts. For private local/operator SQL, the following is a current snapshot, not a historical delivery or conversion percentage (resending replaces a challenge):

```sql
select count(*) filter (where required) as sms_accounts,
       coalesce(sum(sends) filter (where send_window > now()-interval '1 hour'),0) as hour_reserved_sends,
       coalesce(sum(failures) filter (where failure_window > now()-interval '1 hour'),0) as hour_wrong_attempts
from private.sms_account_security;
select count(*) filter (where delivered and not verified and expires_at > now()) as awaiting_code,
       count(*) filter (where verified) as verified_sessions
from private.sms_login_challenges;
```

No monitoring query should select `digest`, `phone` or secret material. Do not expose private tables through a browser dashboard. Historical provider delivery rates come from THSMS transactions; this release does not introduce a separate analytics service.

## Debug ledger

| Run | Observation | Resolution / limit |
| --- | --- | --- |
| Initial local migration | Installed transactionally | Local only; migration history repaired after verification |
| Local integration | 32 checks passed | Includes concurrent IP budget enforcement, boundary, attempt, expiry and raw RLS checks; no SMS sent |
| Existing auth identity tests | Seven failures after adding status RPC | Fixture lacked the new status contract; updated fixture, then all 43 focused checks passed |
| OTP provider unit test | Cross-context promise matcher failed | Replaced matcher with explicit awaited rejection; provider still fails closed |
| Source-size gate | Rubber hook grew to 501 lines | Kept the added preflight within the 500-line limit without broad refactoring |
| Mobile browser/local API | Real POST returned 403 before OTP validation | Reproduced host/origin mismatch in a failing unit test; compare browser Host with the request protocol; foreign-origin rejection remains tested |
| Browser rerun | Pending state, provider failure, wrong/correct code all passed | Real local Auth/API/Chromium; challenge delivery was a fixture, not a handset SMS |
| Real THSMS connection test | One request returned HTTP 200 and success true | Test message only, not a valid login challenge; receipt requires user confirmation |
| Delivery investigation | Dashboard reports sent to the intended recipient, approved public sender, 1 credit and 1.851-second latency; user reports no receipt | Compared V2 request/response against vendor examples; key valid, sender allowed. No proven root cause yet. Awaiting spam/blocked-folder check; no resend or sender change performed |

| User-authorized sender change | Second request returned success=true/code=200 and used one credit; user confirmed receipt | Use the new configured sender. This does not establish why the old sender failed |
| Real provider OTP | One additional SMS; opt-in test passed | Local password-authenticated fixture, real THSMS delivery, one-time verification/replay check; code stayed in process memory. User confirmed receipt of the second connection message, not manual entry of this third code |
| Final isolated suite | 582 passed / 3 skipped | Includes opt-in real-provider test skipped by default; no extra SMS |
| Final static checks | Typecheck, lint and source-size passed | Rechecked after IP budget and browser acceptance additions |
| PWA acceptance infrastructure | Web server build exceeded 180 seconds; standalone recovery produced no complete build artifact | No application assertion ran. Two recovery cycles exhausted; no build process remains. Final PWA build/reconnect gate stays open; earlier build passes do not substitute for it |
| Phone API fixture | Initial test attempted a second Super Admin and hit the singleton constraint | Corrected fixture to an Admin target; real API then proved Super Admin authorization, preserved identity/password and old-session revocation |
| Phone API final | Three checks including setup passed | Self change rejected missing/wrong password, accepted current password, revoked own old session and retained password/identity; other-user change passed. Restored local fixture phone |

| PWA recovery after continuation | Instrumented standalone build exited 0 and produced complete manifests; final build after fixes also exited 0 | Previous interruption's root cause was not established. Build and server ownership/readiness were checked before acceptance; do not claim a proven infrastructure fix |
| Human handset acceptance | User returned SMS codes; real local API accepted them and rejected replay in both development and production build mode | First successful interactive send lost stdin and its fixture was removed; the next dev send passed. After fixing mixed credentials, the final build-mode send passed too. Six accepted real SMS across the session; check THSMS for billing. No automatic resend loop |
| Build-mode SMS 503 | Safe server diagnostics reported sending-budget RPC unavailable | Three failed build-mode attempts used a Cloud preferred admin key with the local URL because `.env.production.local` filled a missing local variable. Code failed before contacting THSMS. Aligned only the ignored local preferred credential and restarted the same build: send 200, user-returned code accepted and replay rejected. Cloud settings unchanged |
| Login readiness | Browser interacted with login before React/auth initialization; values were lost | Disable fields and password visibility control until auth initialization finishes; the same browser scenario then progressed |
| Role downgrade | Failing browser test found the pending event deleted after new User login | Removed destructive User-shell queue cleanup; owner/business-role/original-branch preflight pauses replay. Failing role/branch unit cases passed after the fix |
| PWA final | 7 passed including setup | Real production build/service worker and local Auth/API; both rubber and income/expense queues stayed pending with original owner/branch and zero replay, including downgrade plus new login |
| Fixture isolation | Second PWA scenario reused a session revoked by the first | Each reconnect case now signs in independently. Full rerun passed |
| Final regression | 584 isolated passed / 3 skipped; 9 User-boundary and 3 phone-API checks passed (each browser count includes setup) | Phone tests now derive Origin from configured baseURL; route-boundary scanner follows the existing authenticated threshold-alert factory rather than mistaking delegation for missing authorization |
| Final release artifacts | Build, service-worker checks and bundle budget passed | No Cloud deployment. Existing database suite previously passed 1,329 assertions; migrations unchanged in this continuation |

This ledger records local evidence. Production target inspection, secrets, approved pilot account and rollout remain open. Existing admin UI/password regression passed; do not mark deployment complete from local results.

## Business/route scan — 2026-10-25

Scope: SMS OTP send/verify, account phone/SMS routes, shared identity guard and their queue call sites. Reuse existing UUID validation and Auth failure classification; no new authentication abstraction.

- Reproduced three malformed verify bodies: 36 hyphens as a UUID, numeric code and array code reached the verifier. Require a string code and the existing `isUuid` before any verifier RPC; regression now returns 400 with zero verifier calls.
- Reproduced thrown admin dependencies escaping both PATCH handlers; wrap their boundary and return private/no-store 503. Also reproduced phone lookup outages reported as 404 and password-verifier outages as 400; reuse Auth classification to retain retryable 503 behavior.
- Reproduced expired credentials treated as service outage in the minimal SMS identity path; reuse the shared classifier so invalid/expired credentials become signed-out while real Auth outages stay 503.
- Reproduced an empty Origin accepted as browser authorization. Require exact Origin equality when present; Bearer fallback applies only when Origin is absent. This closes a validation gap, not proof of an exploitable browser attack.
- Removed `removeSyncEventsForOwner` from `src/lib/idb-queue.ts`: after the queue-preservation change, the whole-repository scan found no product caller, only its own obsolete test/import. Removed that obsolete test/import; retained the negative contract that forbids deleting pending work.

Experiment ledger: initial six route/identity regressions failed; two additional outage cases and the empty-Origin case each failed before fixes. The first green attempt exposed a missing no-store header in the test double, corrected without weakening the assertion. Final focused tests 14 passed; full isolated 592 passed/3 skipped; real local queue/phone regression 17 passed including setup; typecheck/lint/source-size passed. No additional SMS or Production changes in this scan. Prior production build evidence predates these review fixes; it is not a new deployment claim.

## Concurrency review — 2026-10-25

`scripts/verify-sms-ip-concurrency.mjs` holds two independent stale IP buckets in concurrent local transactions before calling the real budget function. Before the fix, only one transaction completed and PostgreSQL reported one deadlock. The control using fresh buckets completed both transactions without deadlock, isolating stale-row cleanup from quota locking itself.

Forward migration `20261025012000_sms_cleanup_skip_locked.sql` changes opportunistic IP/challenge cleanup to select rows with `FOR UPDATE SKIP LOCKED`. Cleanup defers rows held by active send/verify transactions; the per-IP quota still locks and updates its own bucket. Applied locally only and recorded in local migration history. Original applied migrations were preserved.

After migration, both stale-bucket transactions completed, each retained sends=1; the independent 32-check real local security suite still passed. Focused route/OTP regressions: 14 passed. No additional dead code was proven in this pass; no speculative deletion, new scheduler, SMS delivery or Cloud change was added.

## Follow-up route review — 2026-10-25

Traced provider send/reservation/error paths and the existing password-change route used alongside SMS. No further unused product symbols were proven. The password route caught thrown Auth errors but treated returned Auth 503 errors as a wrong password (400). Deterministic boundary test reproduced expected503/actual400; reused `classifyAuthClaimsFailure` to return private/no-store503 with Retry-After3. Wrong-password behavior remains400.

After fix: focused route/OTP15 passed; real local self-password regression2 passed including setup (current browser retained and other refresh session revoked); typecheck/lint/source-size and diff checks passed. No extra SMS, migration or Production deployment in this pass.
