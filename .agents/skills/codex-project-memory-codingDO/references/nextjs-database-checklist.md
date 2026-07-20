# Next.js and database memory checklist

Read only the sections relevant to the change.

## Next.js

- Identify App Router or Pages Router; do not mix their conventions accidentally.
- Mark the client/server boundary and prevent secrets or server libraries from entering client bundles.
- Record route handlers, server actions, middleware, cache/revalidation behavior, and runtime choice when they affect correctness.
- Verify authentication and authorization at API/server/database boundaries, not only in UI.
- Capture environment variable names and purpose, never their values.
- Record timezone and locale assumptions for dates, scheduling, billing, and reports.

## Database

- Identify the authoritative schema: Prisma, Drizzle, Supabase migrations, or SQL migrations.
- Read existing migrations and naming conventions before creating one.
- Record primary keys, foreign keys, uniqueness, nullability, defaults, indexes, and delete behavior that encode business rules.
- Record transaction and concurrency expectations for multi-step writes.
- Record RLS policies, grants, tenant boundaries, and privileged functions/RPCs.
- Record idempotency and replay rules for jobs, webhooks, offline queues, and retries.
- Prefer a forward fix for an applied migration unless repository policy explicitly says otherwise.
- Require a backup/recovery plan for destructive or irreversible production operations.

## Verification evidence

- Typecheck and lint results
- Unit/integration/E2E tests relevant to the change
- Schema validation or migration dry run
- Database tests for constraints/RLS/RPC when applicable
- Exact source paths and migration names

If verification cannot be completed, record the note as `draft` and say what remains unverified.
