// Production operations in this helper are read-only; backups remain git-ignored.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parse } from "dotenv";

const ref = fs.readFileSync("supabase/.temp/project-ref", "utf8").trim();
assert.equal(ref, "psxwhhwjmolqperxrlzj");
const credentials = parse(fs.readFileSync(".env.production.local"));
assert.equal(new URL(credentials.NEXT_PUBLIC_SUPABASE_URL).hostname, `${ref}.supabase.co`);
assert.ok(credentials.SUPABASE_DB_PASSWORD);
const pooler = new URL(fs.readFileSync("supabase/.temp/pooler-url", "utf8").trim());
assert.ok(pooler.hostname.endsWith(".pooler.supabase.com"));
const env = { ...process.env, PGHOST: pooler.hostname, PGPORT: "5432", PGUSER: `postgres.${ref}`,
  PGDATABASE: "postgres", PGPASSWORD: credentials.SUPABASE_DB_PASSWORD, PGSSLMODE: "require" };
const prefix = ["exec", "-i", ...["PGHOST", "PGPORT", "PGUSER", "PGDATABASE", "PGPASSWORD", "PGSSLMODE"].flatMap((key) => ["-e", key]), "supabase_db_webapp"];
const directory = path.resolve("output/production-backups/dashboard-freshness-20260912");
assert.ok(directory.startsWith(path.resolve("output/production-backups") + path.sep));
function run(args, input, outputPath) {
  const fd = outputPath ? fs.openSync(outputPath, "wx") : undefined;
  try {
    const result = spawnSync("docker", [...prefix, ...args], { env, input, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
      stdio: ["pipe", fd ?? "pipe", "pipe"] });
    if (result.status !== 0) throw new Error(result.stderr || "Database command failed");
    return result.stdout?.trim();
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
const sql = (query) => run(["psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"], `begin read only; set local statement_timeout='30s'; ${query}; commit;`);
const json = (query) => JSON.parse(sql(query));
const mode = process.argv[2];
fs.mkdirSync(directory, { recursive: true });
if (mode === "backup") {
  const receipts = [];
  for (const [name, options] of [
    ["pre-schema.sql", ["--schema-only", "--schema=public", "--schema=private"]],
    ["pre-data.sql", ["--data-only", "--schema=public", "--schema=private"]],
    ["pre-cron.sql", ["--data-only", "--table=cron.job"]],
    ["pre-migrations.sql", ["--data-only", "--schema=supabase_migrations"]],
  ]) {
    const file = path.join(directory, name);
    run(["pg_dump", "--no-owner", "--no-privileges", ...options], undefined, file);
    const bytes = fs.readFileSync(file);
    assert.ok(bytes.length > 0);
    const receipt = { name, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    receipts.push(receipt);
    console.log(JSON.stringify(receipt));
  }
  fs.writeFileSync(path.join(directory, "backup-receipts.json"), JSON.stringify(receipts, null, 2), { flag: "wx" });
} else if (mode === "roles") {
  const actors = json(`select coalesce(jsonb_agg(to_jsonb(actor)),'[]') from (
    select distinct on (p.role,p.can_access_super_admin_features) p.id,p.role,p.can_access_super_admin_features,branch.id location_id
    from public.profiles p join lateral (
      select l.id from public.locations l where l.is_active and
        (p.role='super_admin' or p.can_access_super_admin_features or exists(select 1 from public.user_locations ul where ul.user_id=p.id and ul.location_id=l.id))
      order by l.id limit 1
    ) branch on true where p.is_active order by p.role,p.can_access_super_admin_features,p.id
  )actor`);
  const results = [];
  for (const actor of actors) {
    assert.match(actor.id, /^[0-9a-f-]{36}$/);
    assert.match(actor.location_id, /^[0-9a-f-]{36}$/);
    const claims = `set local "request.jwt.claim.sub"='${actor.id}';
      set local "request.jwt.claims"='{"sub":"${actor.id}","role":"authenticated"}';`;
    const manualAllowed = json(`${claims} select to_jsonb(private.can_request_dashboard_refresh('${actor.location_id}'))`);
    if (actor.role === "user") {
      // User is payroll-only under ADR 0051, even if an old manager flag remains.
      assert.throws(() => json(`${claims} set local role authenticated;
        select public.get_dashboard_snapshot('${actor.location_id}')`), /Location access denied/);
      assert.deepEqual(json(`${claims} set local role authenticated; select public.get_dashboard_branch_summaries()`), []);
      assert.equal(manualAllowed, false);
      results.push({ role: actor.role, managerAccess: actor.can_access_super_admin_features, payrollOnlyBoundary: true, manualAllowed });
      continue;
    }
    const payload = json(`${claims} set local role authenticated;
      select jsonb_build_object('snapshot',public.get_dashboard_snapshot('${actor.location_id}'),
        'summaries',public.get_dashboard_branch_summaries(),
        'branchIsolation',not exists(select 1 from jsonb_array_elements(public.get_dashboard_branch_summaries())item where not public.can_access_location((item->>'locationId')::uuid)))`);
    assert.equal(typeof payload.snapshot.isOverdue, "boolean");
    assert.ok("nextCheckAt" in payload.snapshot);
    assert.ok(payload.summaries.every((item) => typeof item.isOverdue === "boolean"));
    assert.ok(!["pending_since", "failure_count", "next_retry_at", "last_source_transaction_id", "pendingSince", "failureCount", "nextRetryAt", "lastSourceTransactionId"].some((key) => key in payload.snapshot));
    assert.equal(payload.branchIsolation, true);
    assert.equal(manualAllowed, true);
    results.push({ role: actor.role, managerAccess: actor.can_access_super_admin_features, derivedContract: true, branchIsolation: true, manualAllowed });
  }
  assert.ok(results.length > 0);
  fs.writeFileSync(path.join(directory, "role-read-verification.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ readOnlyRoleChecks: results }));
} else if (["pre", "post", "status"].includes(mode)) {
  const installed = sql("select exists(select 1 from information_schema.columns where table_schema='public' and table_name='dashboard_branch_snapshots' and column_name='pending_since')") === "t";
  const state = json(`select jsonb_build_object(
    'checkedAt',now(),'migration',(select max(version) from supabase_migrations.schema_migrations),
    'activeBranches',(select count(*) from public.locations where is_active),
    'intervalMinutes',(select interval_minutes from public.dashboard_refresh_settings where id),
    'states',(select jsonb_object_agg(status,n) from (select status,count(*)n from public.dashboard_branch_snapshots s join public.locations l on l.id=s.location_id where l.is_active group by status)x),
    'manualHandoffWait',pg_get_functiondef('public.rebuild_dashboard_refresh_now(uuid,bigint)'::regprocedure) like '%pg_advisory_xact_lock%',
    'cron',(select jsonb_agg(jsonb_build_object('schedule',schedule,'active',active,'command',command)) from cron.job where jobname like 'dashboard-read-model-%'),
    'recentRuns',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from (select d.status,d.start_time,d.end_time,extract(epoch from d.end_time-d.start_time)*1000 runtime_ms from cron.job_run_details d join cron.job j on j.jobid=d.jobid where j.jobname like 'dashboard-read-model-%' order by d.start_time desc limit 5)r)
    ${installed ? ", 'oldestPendingSeconds',(select max(extract(epoch from now()-pending_since)) from public.dashboard_branch_snapshots s join public.locations l on l.id=s.location_id where l.is_active and s.status<>'ready'), 'retryBranches',(select count(*) from public.dashboard_branch_snapshots where status='failed')" : ""}
  )`);
  if (mode === "status") { console.log(JSON.stringify(state)); process.exit(0); }
  const tables = json(`select jsonb_agg(format('%I.%I',schemaname,tablename) order by schemaname,tablename)
    from pg_tables where (schemaname in ('public','private') and tablename not in ('dashboard_branch_snapshots','dashboard_refresh_settings'))
    or (schemaname='auth' and tablename in ('users','identities','sessions','refresh_tokens'))
    or (schemaname='storage' and tablename in ('objects','buckets'))`);
  const invariants = json(`select jsonb_object_agg(name,digest) from (${tables.map((table) =>
    `select '${table}' name,jsonb_build_array(count(*),md5(coalesce(string_agg(md5(row_to_json(t)::text),'' order by md5(row_to_json(t)::text)),'')))digest from ${table} t`
  ).join(" union all ")})x`);
  const catalog = installed ? json(`select jsonb_build_object(
    'columns',(select jsonb_agg(column_name order by column_name) from information_schema.columns where table_schema='public' and table_name='dashboard_branch_snapshots' and column_name in ('pending_since','failure_count','next_retry_at','last_source_transaction_id')),
    'nonnegativeFailureCount',exists(select 1 from pg_constraint where conrelid='public.dashboard_branch_snapshots'::regclass and pg_get_constraintdef(oid) like '%failure_count >= 0%'),
    'workIndex',exists(select 1 from pg_indexes where schemaname='public' and indexname='dashboard_branch_snapshots_work_idx' and indexdef like '%next_retry_at%pending_since%'),
    'publicAccessPreserved',has_function_privilege('authenticated','public.get_dashboard_snapshot(uuid)','execute') and not has_function_privilege('anon','public.get_dashboard_snapshot(uuid)','execute') and has_function_privilege('authenticated','public.queue_dashboard_refresh(uuid)','execute'),
    'privateSchedulerDenied',not has_function_privilege('authenticated','private.process_dashboard_refresh_tick()','execute') and not has_function_privilege('anon','private.process_dashboard_refresh_tick()','execute'),
    'snapshotRls', (select relrowsecurity from pg_class where oid='public.dashboard_branch_snapshots'::regclass),
    'definerSearchPaths',(select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc where oid in ('private.process_dashboard_refresh_tick()'::regprocedure,'private.rebuild_dashboard_branch_automatic(uuid)'::regprocedure,'public.get_dashboard_snapshot(uuid)'::regprocedure)),
    'noReadyPending',not exists(select 1 from public.dashboard_branch_snapshots where status='ready' and (pending_since is not null or next_retry_at is not null))
  )`) : null;
  if (mode === "post") {
    assert.equal(state.migration, "20260912030000");
    assert.equal(state.manualHandoffWait, true);
    assert.equal(state.cron.length, 1);
    assert.deepEqual(state.cron[0], { schedule: "* * * * *", active: true, command: "select private.process_dashboard_refresh_tick()" });
    assert.equal(catalog.columns.length, 4);
    for (const [key, value] of Object.entries(catalog)) if (key !== "columns") assert.equal(value, true, key);
    const before = JSON.parse(fs.readFileSync(path.join(directory, "pre-verification.json")));
    assert.equal(state.intervalMinutes, before.state.intervalMinutes, "production interval must not be changed");
    const changed = tables.filter((table) => JSON.stringify(invariants[table]) !== JSON.stringify(before.invariants[table]));
    console.log(JSON.stringify({ invariantTables: tables.length, changedInvariantTables: changed }));
    assert.deepEqual(changed, [], "business/auth/storage data changed; investigate before claiming scope safety");
  }
  fs.writeFileSync(path.join(directory, `${mode}-verification.json`), JSON.stringify({ state, catalog, invariants }, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ mode, state, catalog }));
} else { throw new Error("Use backup, pre, post, status or roles"); }
