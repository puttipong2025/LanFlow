# Dependency security review — 2026-11-01

## Release change

Pin `next` and `eslint-config-next` to `15.5.28`, with the corresponding lockfile update. This stays on the existing Next.js 15 line. No forced audit fix or major-version override was used.

The upstream [15.5.28 release](https://github.com/vercel/next.js/releases/tag/v15.5.28) fixes the Image Optimization RCE and Server Actions denial-of-service advisories. It also includes the earlier 15.5.27 cache-poisoning fixes. The previous lockfile already supplied `sharp@0.35.5`, the Image Optimization advisory's documented workaround; the framework is now patched as well.

## Remaining audit records

`npm audit --omit=dev` after the update reports **18 records: 0 critical, 4 high, 12 moderate and 2 low**. The remaining `next` record is inherited from bundled PostCSS, rather than an outstanding Next.js request-handler advisory. This supersedes the counts and exception review date in the September review.

| Dependency path | Input and reachability | Disposition |
| --- | --- | --- |
| `next@15.5.28 → postcss`, and repository CSS tooling → `source-map-js` | CSS/source-map compilation uses repository files during build. Application API handlers do not compile uploaded or request-supplied CSS/source maps. | Temporary build-tool exception; do not accept untrusted CSS or source maps into the build. |
| `@ducanh2912/next-pwa → workbox-build / workbox-webpack-plugin → Rollup plugins → serialize-javascript / deepmerge / ejs / jake / filelist / glob / minimatch / brace-expansion` | Workbox receives the repository-controlled PWA configuration, asset paths and generated manifest through `next.config.ts`. These packages do not process application request bodies or user templates. | Temporary build-tool exception; retain the PWA regression gate before changing this dependency chain. |
| Workbox/AJV configuration validation → `fast-uri` | Build configuration URI parsing, with repository-controlled configuration. No application import exposes this parser to incoming requests. | Temporary build-tool exception. |

Owner: LanFlow maintainers. Review by **2026-11-30**, or immediately if input trust, hosting, Next.js or next-pwa changes. These exceptions do not claim that `npm audit` passes or that the dependencies have no vulnerabilities. Patch-compatible transitive updates can be handled separately with their own build/PWA verification; no major package replacement is included in this release.

## Verification evidence

The original product changes passed `npm run verify:full`: 79 SQL files / 1,922 assertions, 29 database concurrency tests, 107 route authorization tests, 1,305 isolated tests with two existing skips, production build, service-worker integrity and bundle budgets. After the framework patch, a fresh `npm run verify` passed with the same isolated count; First Load JS is 298.3/320 kB. The build emitted a non-fatal Supabase middleware warning about `process.version` in the Edge bundle; actual authentication and application navigation passed in browser verification.

Browser verification covered **73 distinct journeys** against the locally targeted production build, across the completed focused runs: 19 Income/Expense offline, nine sale save/edit/stock/approval, one explicit sale PDF, 13 Rubber offline, ten fresh-form/validation/edit, one numbered Income/Expense upgrade/replay, two Income/Expense PWA, one real Route calendar-validation, four connectivity, two Rubber PWA, three shared-device/Admin/numbering, and eight payroll PDF/calendar journeys. Authentication setup results are excluded from this count.

The older Rubber offline/PWA fixtures were aligned with the current admission endpoint, HTML confirmations, dedicated sync-state labels, offline logout label and immutable pending-create policy. Replays use the actual completed admission request rather than an offline envelope that still needs server-context preparation. The response-loss checks retain their exactly-one-business-row and unchanged-identity proofs. No application behavior was weakened to resolve fixture failures. Focused ESLint and type checks passed after fixture updates.

Local audit/path receipts are in ignored `output/release-audit.json` and `output-release-dependency-paths.log`. Production backups and credentials remain outside Git.
