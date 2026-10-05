# Rubber Bill Price Policy Without Quota — Implementation Plan

Status: released to Production on 2026-10-05

## Outcome

Remove every active quota path while preserving one central price, group/ungrouped allowances, the global maximum allowance, historical data, pending approvals, offline queue semantics, and all non-price approval rules.

## Phases

1. Freeze the contract in `CONTEXT.md` and ADR 0075; keep ADR 0073 and the original rollout plan as historical evidence.
2. Add one dependency-safe forward migration: detach active functions, simplify the price decision, preserve maximum-allowance provenance, add the standalone maximum RPC, then remove quota functions/storage.
3. Remove preview/confirmation/quota client paths, preserve queue-first mutation, change the offline guard to the effective cap, and replace the quota settings card with the standalone maximum card.
4. Add database, route, UI, offline, replay, and concurrency regressions; scrutinize both policy call graphs and remove dead code.
5. Run the full quality gate, migration checks, database lint, schema parity, and diff checks; record verified evidence in the project memory.
6. Create a recovery checkpoint and perform the coordinated database/application cutover, then verify GitHub/Vercel and read-only production contracts.

## Invariants

- `price <= effective cap` is direct unless a different approval rule applies; `price > effective cap` requires approval.
- The rule is identical for Admin, System Manager, and super admin and has no counter.
- Maximum allowance is non-negative `numeric(12,2)`, editable only by exact `super_admin`, and cannot be lower than any active allowance.
- Same-value maximum saves do not update provenance.
- Historical bills, revisions, snapshots, and approval decisions are never recalculated.
- Current bill and pending-request replays remain idempotent; an obsolete historical quota key has no ledger fallback and cannot mutate data.
- Old clients receive 404 for removed quota/preview routes and must reload.

## Verification record

- Clean migration replay: `npx supabase db reset --local` passed.
- Database contract: all 36 pgTAP files passed (796 assertions), including 32 quota-removal policy assertions.
- Schema safety: `supabase db lint` returned no errors; `supabase db diff --local --schema public --schema private` returned no schema changes.
- Full gate: `npm run verify:full` passed, including 84 route-boundary tests, 148 isolated tests, lint, typecheck, source-size, import direction, auth-outage, production build, Service Worker, and bundle budget checks.
- Focused Rubber Bill E2E: approval groups, submission/share, and approval contract passed 40/40 after regenerating local auth state following the database reset.
- Responsive management UI: the Superadmin maximum form passed at 375×812 and the System Manager read-only view passed at 1280×800.
- Dead-code scan: runtime source has no quota vocabulary or removed route/RPC consumers; historical references remain only in applied migrations, superseded ADRs, and removal assertions.
- Offline full-file rerun remains affected by the pre-existing Next dev-server exit (`ECONNREFUSED`); the changed offline cap guard passes isolated tests and its server replay/idempotency paths pass focused E2E and pgTAP coverage.
- Release: Supabase Cloud applied migration `20261005010000`; post-push dry-run is up to date and remote DB lint reports no errors. Commit `bec884e90cf54e9b2c5360b3e6bf511992956782` reached `main`, GitHub Quality gates run `37273907984` succeeded, and Vercel deployment `DBd7iEoSG3KHGPrpLhJiMY36jkQJ` completed.
- Production read-only smoke: login returned 200, removed quota/preview routes returned 404, the new maximum route returned 401 without a session, and the remote schema contained zero old quota references.
- Recovery checkpoint (git ignored): `output/production-backups/rubber-quota-removal-20261005/`; hashes are recorded in the codingDO Daily note `10_Daily/2026-10-05 1.md`.

The Daily note `10_Daily/2026-10-05 1.md` remains the task-level checklist and source of truth.
