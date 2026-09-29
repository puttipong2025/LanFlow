# LanFlow Webapp Improvement Audit and Roadmap

Date: 2026-09-29  
Repository baseline: `main` at `3c60e7a`

Implementation status: **completed locally and verified on 2026-09-30**. GitHub-hosted workflow execution and branch-protection enforcement require the changes to be pushed and are therefore deployment follow-ups, not local verification claims.

## Outcome

LanFlow is currently healthy against its existing automated checks. The highest-value improvements are not a broad rewrite. They are:

1. apply the current Next.js 15 security patch;
2. make the existing fast regression suites mandatory release gates;
3. split top-level business modules out of the initial browser bundle;
4. modernize linting and track dependency exceptions without unsafe forced upgrades;
5. investigate the remaining build warning after the security and performance work is stable.

The work should proceed in that order. Internal refactors that do not support one of these outcomes are intentionally deferred.

## Confirmed scope and decisions

- Priority order: security, initial-load performance, then maintainability and quality gates.
- Google Drive is entirely out of scope. Do not change Drive files, permissions, identifiers, API behavior, or historical objects as part of this roadmap.
- Stay on Next.js 15 Maintenance LTS for this cycle. Do not combine this work with a Next.js 16 migration.
- Upgrade to the current Next.js 15 security patch immediately rather than waiting for a later announced patch.
- Evaluate dependency advisories by runtime reachability and impact. Do not require a zero-advisory report by forcing incompatible upgrades or downgrades.
- Do not run `npm audit fix --force` without a reviewed dependency plan and full regression evidence.
- Lazy-load top-level business modules by tab. A brief first-open loading state is acceptable.
- Preserve the installed PWA's offline module behavior and authorization boundaries.
- Set a production build budget of at most 320 KB First Load JS for `/`.
- Add GitHub Actions release gates.
- Limit refactoring to the loading/module boundary needed for these outcomes. Large business modules are not a blanket refactor target.
- The initial audit was read-only. The user subsequently authorized implementation of every phase on 2026-09-29.

## Implementation receipt

| Outcome | Before | After |
| --- | --- | --- |
| Next.js | 15.5.24 | 15.5.26, pinned within major 15 |
| `/` First Load JS | ~453 kB | 262 kB in Next.js report; 256.0 KiB from the automated gzip gate |
| Production audit | 11 records: 5 high, 6 moderate | 7 records: 2 high, 5 moderate; remaining paths classified as build-time exceptions |
| Lint | deprecated `next lint` | ESLint 9 CLI flat config, zero warnings |
| Fast gate | typecheck + auth-outage + build + SW | lint + typecheck + auth-outage + 140 isolated tests + build + SW + bundle budget |
| Full gate | no composed command | `npm run verify:full` adds Local Supabase pgTAP and middleware route coverage |
| Top-level modules | all static imports in initial route | inactive tabs use dynamic imports with an accessible static skeleton; the default Dashboard stays static to survive an online→offline bootstrap race |
| Query Devtools | production component tree | development-only dynamic import, absent from production chunks and precache |
| Middleware warning | Edge Runtime warning on baseline build | not reproduced on Next.js 15.5.26; Supabase dependency left unchanged |

Verification receipts:

- `npm run verify`: passed; 140/140 isolated contracts and production build passed.
- `npm run test:db`: passed; 34 files / 717 assertions.
- Production PWA browser: every authorized top-level module opened on first use.
- Production PWA offline browser: Rubber Bills and Income/Expense opened after Service Worker control with the browser offline.
- Auth boundary browser tests: Bearer precedence, User-role isolation, public assets and anonymous page redirect passed.
- `git diff --check`: passed.

Detailed exception and warning records:

- `docs/dependency-security-review-2026-09-29.md`
- `docs/middleware-edge-warning-review-2026-09-29.md`
- `docs/webapp-improvement-release-note-2026-09-29.md`

## Verified baseline

All commands below were executed against the repository baseline on 2026-09-29.

| Check | Result |
| --- | --- |
| `npm run verify` | Passed: TypeScript, auth-outage check, optimized Next/PWA build, and Service Worker checks |
| `npm run lint` | Passed with no warnings or errors; `next lint` emitted its deprecation notice |
| `npm run test:isolated` | 140/140 passed in 5.5 seconds |
| `npm run test:db` | 34 pgTAP files and 717 assertions passed |
| Production build | Passed on Next.js 15.5.24 |
| Repository hygiene | Local environment files, backups, generated Service Worker files, output, and test artifacts are ignored and not tracked |

The production build reported:

- `/` First Load JS: approximately 453 KB;
- generated `app/page` chunk: approximately 1,018 KB uncompressed;
- middleware: approximately 90 KB;
- an Edge Runtime warning from the `@supabase/ssr` to `@supabase/supabase-js` import chain;
- large webpack cache strings during serialization.

The root cause of the initial bundle size is directly visible in `src/components/LanFlowApp.tsx`: all top-level business modules are statically imported, and there are no dynamic component imports. The current application therefore ships code for inactive tabs during the initial page load.

## Work package 1 — Next.js 15 security patch

### Why

The repository uses Next.js 15.5.24. Next.js published 15.5.26 as the current Maintenance LTS security patch and instructed 15.x users to upgrade. Next.js 15 remains supported, so a major-version migration is unnecessary for this remediation.

Primary references:

- <https://nextjs.org/blog>
- <https://nextjs.org/support-policy>

### Change boundary

- Update `next` and `eslint-config-next` within the 15.5 release line.
- Refresh the lockfile normally.
- Accept compatible transitive patch updates, including the patched Sharp version selected by Next.js.
- Do not upgrade to Next.js 16.
- Do not downgrade `@ducanh2912/next-pwa` based only on the automatic `npm audit fix` suggestion.

### Acceptance criteria

- Installed Next.js version is at least 15.5.26 and remains on major version 15.
- `npm run verify`, `npm run test:isolated`, and `npm run test:db` pass.
- PWA production build and `scripts/check-service-worker.mjs` pass.
- Login, authentication outage, middleware redirects, and offline navigation retain current behavior.
- The dependency diff contains no unexplained major-version change.
- A fresh `npm audit --omit=dev` result is reviewed and classified by dependency path and reachability.

## Work package 2 — Enforced release gates

### Why

The two broad suites that currently pass quickly are not part of `npm run verify`, and the repository has no CI workflow or Git hook. A successful production build therefore does not prove the isolated contracts or database contracts passed before deployment.

### Proposed commands

- Replace deprecated `next lint` with the ESLint CLI and an ESLint 9 flat configuration.
- Keep a fast, environment-independent verification command containing:
  - lint with zero warnings;
  - TypeScript;
  - auth-outage check;
  - isolated Playwright contracts;
  - production build;
  - Service Worker validation.
- Add a full verification command that also runs local Supabase pgTAP.

### GitHub Actions jobs

1. `web-gate`: install from the lockfile, lint, typecheck, run isolated tests, build, and validate the Service Worker.
2. `database-gate`: start the project-scoped Local Supabase stack, run pgTAP, and verify anonymous middleware routing against the local app.

Do not inject production credentials or point integration tests at a remote Supabase project.

### Acceptance criteria

- CI runs on pull requests and pushes to the protected release branch.
- Both jobs use `npm ci` and fail on any command failure.
- The isolated job does not load `.env.local`, start application servers, or write database fixtures.
- The database job validates the Local Supabase target before any fixture write.
- CI logs contain no environment secrets, local auth state, or production rows.
- Release documentation names the exact command/job required before deployment.

## Work package 3 — Top-level module lazy loading

### Why

`LanFlowApp.tsx` statically imports Dashboard, Customers, Transport, Money Transfer, Admin, Time/Payroll, Rubber Bills, Evidence, Income/Expense, Acid Stock, Reports, Rubber Export, and Cash Count. This makes inactive modules part of the initial route bundle.

### Change boundary

- Introduce a small top-level module registry or equivalent loading seam.
- Dynamically import module components at the active-tab boundary.
- Use a consistent accessible loading state for the first open of a module.
- Keep authorization checks before selecting/loading restricted modules.
- Load React Query Devtools only in development or remove them from the production tree.
- Do not refactor the internal behavior of business modules in the same work package.

### PWA constraint

Code splitting must not weaken the offline-first contract. Required module chunks must be available to an installed, warmed PWA after the Service Worker takes control. This must be proven in a browser test; it must not be inferred merely from the Workbox build output.

### Acceptance criteria

- Production First Load JS for `/` is no more than 320 KB.
- Inactive business-module implementation is absent from the initial page chunk.
- The initial authenticated workspace and Dashboard remain usable without waiting for every module chunk to execute.
- Each authorized tab opens successfully online on first use.
- After one successful online installation/warm-up, every currently supported offline module opens offline.
- Online-only modules retain their existing offline block/fallback behavior.
- User-role accounts do not enter the business workspace or initiate business-module data requests.
- Existing navigation, deep-link, branch-change, reconnect, OCR queue, and pending-source tests remain green.

## Work package 4 — Dependency advisory policy

### Current evidence

`npm audit --omit=dev` reported 11 findings: 5 high and 6 moderate. The main paths are:

- Next.js bundled PostCSS and optional Sharp;
- `@ducanh2912/next-pwa` through Workbox, webpack, and `serialize-javascript`;
- Browserslist and baseline-browser-mapping in the CSS/build toolchain;
- `fast-uri` through build-time schema validation.

The count alone is not a release-risk assessment. Several reported packages are build-time dependencies rather than request-time application code.

### Policy

- Block release for reachable Critical/High runtime issues and unsafe direct dependencies.
- Patch resolvable transitive dependencies through normal compatible upgrades.
- For build-only findings without a safe upstream resolution, record:
  - dependency path;
  - affected operation;
  - why application-controlled input cannot reach it;
  - owner;
  - review date;
  - upstream issue or upgrade path.
- Reassess exceptions on every framework/PWA toolchain update.
- Do not hide findings with an override unless the overridden version is supported and the complete build/PWA regression gate passes.

### Acceptance criteria

- Every remaining High or Moderate finding has either a verified fix or a documented exception.
- No accepted exception is described only as “dev dependency” without a reachability analysis.
- No forced downgrade, unreviewed override, or major upgrade is introduced to make the count zero.

## Work package 5 — Build-warning investigation

### Why

The optimized build succeeds but warns that a Node.js API from `@supabase/supabase-js` is present in the Edge Runtime import chain through `src/lib/supabase/middleware.ts`. This is not currently a demonstrated runtime failure, but it can hide a future incompatibility and adds noise to the release signal.

### Change boundary

- Reproduce the warning after work package 1.
- Inspect supported `@supabase/ssr` versions and their migration notes before changing the current 0.x dependency.
- Prefer a supported import/runtime boundary over warning suppression.
- Do not change authentication precedence, cookie refresh behavior, 401/403 mapping, or branch authorization.

### Acceptance criteria

- Either the warning is removed using a supported dependency/import path, or it is documented as an upstream-only warning with a minimal reproduction and review date.
- Anonymous, invalid-session, cookie-session, and Bearer-session route tests pass.
- Middleware still leaves public/static paths public and redirects unauthenticated page requests to `/login`.

## Deferred work

These items may be useful later but should not be mixed into the first three work packages:

- migration to Next.js 16;
- broad decomposition of `TimeTrackingModule.tsx` or other large business modules;
- redesign of database contracts or historical migrations;
- broad replacement of `any` types without a failing contract or touched boundary;
- bundle optimization inside individual modules before top-level splitting is measured;
- any Google Drive-related change.

Large files are signals for targeted investigation, not sufficient justification for refactoring. Open a separate work item only when a file causes a demonstrated defect, prevents isolated testing, or blocks ownership of a concrete feature.

## Recommended delivery sequence

1. Next.js 15.5 security patch and fresh advisory classification.
2. ESLint CLI migration and two-tier verification commands.
3. GitHub Actions web and database gates.
4. Capture the pre-change bundle receipt.
5. Implement top-level module lazy loading and development-only Query Devtools.
6. Verify the 320 KB budget and complete the online/offline browser matrix.
7. Re-run the middleware warning investigation against the updated dependency tree.
8. Record remaining build-only dependency exceptions with review dates.

Each work package should be independently reviewable and revertible. Do not combine framework patching, CI setup, lazy loading, and middleware dependency changes in one commit.

## Documentation decision

No glossary term was added to `CONTEXT.md`: the decisions above concern implementation and release policy, not LanFlow business language. No ADR was created because the current choices are deliberately reversible and do not yet satisfy the repository's threshold for a hard-to-reverse architectural decision.
