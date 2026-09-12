// Never restore backups into the application Local DB or any networked database.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const container = "lanflow-dashboard-backup-20260912";
assert.equal(execFileSync("docker", ["inspect", "--format", "{{.HostConfig.NetworkMode}}", container], { encoding: "utf8" }).trim(), "none");
const args = ["exec", "-i", container, "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"];
function sql(input, admin = false) {
  const result = spawnSync("docker", admin ? [...args.slice(0, -4), "-U", "supabase_admin", "-d", "postgres"] : args,
    { input, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) {
    // COPY diagnostics may contain business rows. Keep them out of tool output.
    fs.mkdirSync("output/dashboard-freshness", { recursive: true });
    fs.writeFileSync("output/dashboard-freshness/backup-replay-error.log", result.stderr);
    throw new Error("Isolated backup verification failed; diagnostics saved in ignored output/dashboard-freshness/backup-replay-error.log");
  }
  return result.stdout.trim();
}
assert.equal(sql("show cron.launch_active_jobs"), "off");
const directory = "output/production-backups/dashboard-freshness-20260912";
for (const receipt of JSON.parse(fs.readFileSync(path.join(directory, "backup-receipts.json")))) {
  const bytes = fs.readFileSync(path.join(directory, receipt.name));
  assert.equal(bytes.length, receipt.bytes);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), receipt.sha256);
}
if (process.argv.includes("--restore")) {
  assert.equal(sql("select to_regclass('public.profiles') is null"), "t");
  const authSchema = execFileSync("docker", ["exec", "supabase_db_webapp", "pg_dump", "--schema-only", "--schema=auth", "--no-owner", "--no-privileges", "--clean", "--if-exists", "-U", "supabase_admin", "-d", "postgres"]);
  sql(authSchema, true);
  sql(`create extension if not exists moddatetime with schema extensions;
    create extension if not exists pg_net with schema extensions;
    create extension if not exists btree_gist with schema extensions;
    grant all on schema net to postgres with grant option;
    grant execute on all functions in schema net to postgres;
    grant usage on schema auth to postgres; grant select on all tables in schema auth to postgres;
    drop schema public cascade;`, true);
  sql(fs.readFileSync(path.join(directory, "pre-schema.sql")));
  sql(Buffer.concat([Buffer.from("set session_replication_role=replica;\n"), fs.readFileSync(path.join(directory, "pre-data.sql"))]), true);
  console.log("Production public/private backup restored only into the isolated container");
}
// pg_cron's extension namespace is public in this image; provision it after a
// schema restore so DROP SCHEMA cannot remove it again.
sql("create extension if not exists pg_cron; grant all on schema cron to postgres with grant option; grant execute on all functions in schema cron to postgres;", true);
if (sql("select exists(select 1 from information_schema.columns where table_schema='public' and table_name='dashboard_branch_snapshots' and column_name='pending_since')") === "f") {
  sql(`begin;\n${fs.readFileSync("supabase/migrations/20260912010000_dashboard_refresh_freshness.sql", "utf8")}\ncommit;`);
}
if (sql("select exists(select 1 from information_schema.columns where table_schema='public' and table_name='dashboard_branch_snapshots' and column_name='last_source_transaction_id')") === "f") {
  sql(`begin;\n${fs.readFileSync("supabase/migrations/20260912020000_dashboard_source_commit_order.sql", "utf8")}\ncommit;`);
}
if (sql("select pg_get_functiondef('public.rebuild_dashboard_refresh_now(uuid,bigint)'::regprocedure) like '%pg_advisory_xact_lock%'") === "f") {
  sql(`begin;\n${fs.readFileSync("supabase/migrations/20260912030000_dashboard_manual_handoff_wait.sql", "utf8")}\ncommit;`);
}
const tables = JSON.parse(sql(`select jsonb_agg(format('%I.%I',schemaname,tablename) order by schemaname,tablename) from pg_tables
  where schemaname in ('public','private') and tablename not in ('dashboard_branch_snapshots','dashboard_refresh_settings')`));
const fingerprint = () => JSON.parse(sql(`select jsonb_object_agg(name,digest) from (${tables.map((table) =>
  `select '${table}' name,jsonb_build_array(count(*),md5(coalesce(string_agg(md5(row_to_json(t)::text),'' order by md5(row_to_json(t)::text)),'')))digest from ${table} t`
).join(" union all ")})x`));
const before = fingerprint();
const branches = Number(sql("select count(*) from public.locations where is_active"));
assert.equal(branches, 26);
sql(`update public.dashboard_refresh_settings set interval_minutes=10,last_rollover_date=(now() at time zone 'Asia/Bangkok')::date;
  update public.dashboard_branch_snapshots set status='dirty',source_version=1,snapshot_version=0,claimed_version=null,claimed_at=null,
  manual_requested_at=null,pending_since=now(),failure_count=0,next_retry_at=null where location_id in(select id from public.locations where is_active);`);
const ticks = [];
for (let tick = 0; tick < 9; tick++) {
  const result = JSON.parse(sql(`with started as materialized(select clock_timestamp() at),
    work as materialized(select private.process_dashboard_refresh_tick() completed from started)
    select jsonb_build_object('completed',completed,'ms',extract(epoch from clock_timestamp()-started.at)*1000) from started,work`));
  assert.ok(result.ms < 60_000);
  ticks.push(result);
}
assert.equal(sql(`select count(*) from public.dashboard_branch_snapshots s join public.locations l on l.id=s.location_id
  where l.is_active and (s.status<>'ready' or s.snapshot_version<>s.source_version or not(s.summary->'rubberRemaining' ? 'branchReceipts'))`), "0");
assert.deepEqual(fingerprint(), before, "every other public/private table must remain byte-for-byte unchanged");
const catalogQuery = `select jsonb_build_object(
  'functions',(select jsonb_object_agg(oid::regprocedure::text,md5(pg_get_functiondef(oid))) from pg_proc where pronamespace in ('public'::regnamespace,'private'::regnamespace)
    and proname in ('mark_dashboard_dirty','dashboard_rollover_if_needed','claim_dashboard_branch','dashboard_retry_delay','rebuild_dashboard_branch_target','rebuild_dashboard_branch_automatic','process_dashboard_refresh_tick','queue_dashboard_refresh','rebuild_dashboard_refresh_now','get_dashboard_snapshot','get_dashboard_branch_summaries')),
  'columns',(select jsonb_agg(jsonb_build_array(column_name,udt_name,is_nullable,column_default) order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='dashboard_branch_snapshots'),
  'constraints',(select jsonb_agg(pg_get_constraintdef(oid) order by conname) from pg_constraint where conrelid='public.dashboard_branch_snapshots'::regclass),
  'index',pg_get_indexdef('public.dashboard_branch_snapshots_work_idx'::regclass),
  'rls',(select relrowsecurity from pg_class where oid='public.dashboard_branch_snapshots'::regclass)
)`;
const localCatalog = JSON.parse(execFileSync("docker", ["exec", "-i", "supabase_db_webapp", "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], { input: catalogQuery, encoding: "utf8" }));
assert.deepEqual(JSON.parse(sql(catalogQuery)), localCatalog, "backup + forward migration must match the Local semantic contract");
const result = { branches, intervalMinutes: 10, budget: 3, ticks, maxTickMs: Math.max(...ticks.map((tick) => tick.ms)), unchangedBusinessTables: tables.length, readyBranches: 26, semanticParity: true, status: "PASS" };
fs.mkdirSync("output/dashboard-freshness", { recursive: true });
fs.writeFileSync("output/dashboard-freshness/backup-benchmark.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
