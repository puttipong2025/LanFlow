# Deploy LanFlow to Supabase and Vercel

This runbook prepares a production release without copying secrets into Git.
Run the database steps before deploying the matching web build.

## 1. Preflight

Use Node.js 20 or newer, then install the lockfile exactly and run:

```powershell
npm ci
npm run deploy:check
```

`deploy:check` validates the required environment-variable groups without
printing their values, then runs TypeScript and a production Next.js build.
For local release preparation it reads `.env.production.local`; Next.js
development continues to use `.env.local`, preventing dev/test writes from
accidentally targeting the hosted project.

Required Vercel runtime variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (preferred) or
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SECRET_KEY` (preferred) or `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_DRIVE_FOLDER_ID`
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL` is optional and has an application default

Do not add `SUPABASE_ACCESS_TOKEN`, `GITHUB_TOKEN`,
`SUPABASE_DB_PASSWORD`, `LANFLOW_BOOTSTRAP_PASSWORD`, `TEST_PHONE`, or
`TEST_PASSWORD` to the Vercel runtime. They are deployment, migration, or test
credentials.

## 2. Prepare the hosted Supabase project

Authenticate and link this working copy to the intended project:

```powershell
npx.cmd supabase login
npx.cmd supabase link --project-ref <project-ref>
npx.cmd supabase projects list
npx.cmd supabase migration list
```

Confirm the linked project name before every remote database command. Review
the migration plan without changing the hosted database:

```powershell
npx.cmd supabase db push --dry-run
```

Take a recoverable production backup or verify point-in-time recovery before
applying pending migrations. Then apply only the reviewed migrations:

```powershell
npx.cmd supabase db push
```

Never run `supabase db reset --linked` or use `--include-seed` against
production.

LanFlow also has a scheduled Telegram Edge Function. Deploy it after the
database migration:

```powershell
npx.cmd supabase functions deploy telegram-badge-dispatch
```

The function uses Supabase-provided `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`. Do not copy those values into the repository.
After deployment, call `configure_telegram_badge_dispatcher` with the deployed
function URL using a service-role session, as described in
`docs/adr/0012-supabase-scheduled-telegram-badge-digest.md`. The RPC creates
the internal dispatch secret in Supabase Vault.

In Supabase Auth URL Configuration, set the production site URL to the final
HTTPS Vercel domain and add only the preview redirect URLs that are actually
needed.

## 3. Configure and deploy Vercel

Vercel detects this repository as Next.js, so no `vercel.json` override is
required. Authenticate and link the directory:

```powershell
npx.cmd vercel login
npx.cmd vercel link
```

Add the runtime variables listed in section 1 to Production. Use separate
Supabase projects/keys for Preview if preview deployments may write data.
Variables added or changed in Vercel apply to the next deployment.

Create a preview deployment first:

```powershell
npx.cmd vercel
```

After smoke testing the preview against the intended non-production database,
deploy production:

```powershell
npx.cmd vercel --prod
```

## 4. Production smoke test

- Sign in with a real non-admin account and verify branch isolation.
- Open the dashboard and one read/write module.
- Create and sync a disposable record, then remove it through the normal UI.
- Reload once online, then verify the PWA shell opens offline.
- Exercise OCR upload and Google Drive upload.
- Verify `/api/auth/me` returns `401` without a session.
- Confirm no server secret appears in browser source, network payloads, or
  `NEXT_PUBLIC_*` variables.
- Verify the Telegram digest function/config only if that feature is enabled.

If the web deployment fails after database migrations were applied, keep the
database forward-compatible and fix or roll forward the web deployment. Do
not edit an already-applied migration in place.
