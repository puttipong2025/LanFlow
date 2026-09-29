# LanFlow Webapp Improvement Release Note — 2026-09-29

## Release contents

- Pin Next.js and its ESLint config at security patch `15.5.26`.
- Replace deprecated `next lint` with ESLint 9 flat config.
- Add local fast/full verification commands and GitHub Actions web/database jobs.
- Dynamically load inactive top-level business modules at the active-tab boundary while keeping the default Dashboard immediately available.
- Add an accessible, motion-free loading skeleton.
- Load React Query Devtools only in development.
- Enforce a 320 kB First Load JS budget for `/`.
- Add browser coverage for online first-open modules, offline-supported modules, User-role isolation and middleware routing.

## Verified receipts

- `npm run verify`: pass; isolated contracts 140/140.
- `npm run test:db`: pass; pgTAP 34 files / 717 assertions.
- `/` First Load JS: 262 kB in the Next.js report, down from approximately 453 kB.
- Service Worker validation: pass.
- Production PWA module matrix: pass online and offline.
- Dependency audit: reduced from 11 to 7 records; remaining findings documented as build-time exceptions.
- Middleware Edge warning: absent after the Next.js patch.

## Deployment checklist

1. Review the dependency exception document and current `npm audit --omit=dev` result.
2. Push the branch and require both `web-gate` and `database-gate` before merge.
3. Confirm branch protection names match those two jobs.
4. Deploy only after the release checklist is signed off.

## Recovery

- No database migration or data rewrite is included.
- If a module-loading regression appears, redeploy the previous application revision; stored business data is unaffected.
- If CI infrastructure fails, preserve the failing logs and run `npm run verify:full` against the same revision before changing workflow versions.
- Do not use a forced audit fix as a recovery action.
