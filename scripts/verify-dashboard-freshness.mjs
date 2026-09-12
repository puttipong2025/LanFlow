// Destructive fixture setup is restricted to this isolated, networkless container.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

const container = "lanflow-dashboard-freshness-20260912";
assert.equal(execFileSync("docker", ["inspect", "--format", "{{.HostConfig.NetworkMode}}", container], { encoding: "utf8" }).trim(), "none");
const args = ["exec", "-i", container, "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"];
const sql = (query) => execFileSync("docker", args, { input: query, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).trim();
assert.equal(sql("show cron.launch_active_jobs"), "off");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function asyncSql(query) {
  const child = spawn("docker", args);
  const promise = new Promise((resolve, reject) => {
    let output = "", error = "";
    child.stdout.on("data", (data) => { output += data; });
    child.stderr.on("data", (data) => { error += data; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve(output.trim()) : reject(new Error(error)));
  });
  child.stdin.end(query);
  return promise;
}

const migration = "20260912010000_dashboard_refresh_freshness.sql";
if (process.argv.includes("--replay")) {
  assert.equal(sql("select to_regclass('public.profiles') is null"), "t", "replay requires a freshly initialized disposable database");
  // The bare Postgres image predates GoTrue's managed Auth schema migrations.
  // Copy schema only (never users/sessions/data) from Local before app replay.
  const authSchema = execFileSync("docker", ["exec", "supabase_db_webapp", "pg_dump", "--schema-only", "--schema=auth", "--no-owner", "--no-privileges", "--clean", "--if-exists", "-U", "supabase_admin", "-d", "postgres"]);
  execFileSync("docker", [...args.slice(0, -4), "-U", "supabase_admin", "-d", "postgres"], { input: authSchema });
  // Supabase provisions these managed extensions as its superuser. Historical
  // app migrations then execute under the non-superuser postgres role.
  execFileSync("docker", [...args.slice(0, -4), "-U", "supabase_admin", "-d", "postgres"], {
    input: `create extension if not exists moddatetime with schema extensions;
      create extension if not exists pg_cron;
      create extension if not exists pg_net with schema extensions;
      grant all on schema cron,net to postgres with grant option;
      grant all on all tables in schema cron,net to postgres with grant option;
      grant all on all sequences in schema cron,net to postgres with grant option;
      grant all on all functions in schema cron,net to postgres with grant option;`, encoding: "utf8",
  });
  // Match the app's canonical provisioning defaults, not the image's broad
  // browser grants. Application migrations must not inherit anonymous SELECT.
  sql(`alter default privileges for role postgres in schema public revoke all on tables from anon,authenticated,service_role;
    alter default privileges for role postgres in schema public grant references,trigger,truncate,maintain on tables to anon,authenticated,service_role;
    alter default privileges for role postgres in schema public revoke all on functions from public,anon,authenticated,service_role;
    alter default privileges for role postgres in schema public revoke all on sequences from anon,authenticated,service_role;
    alter default privileges for role postgres in schema public grant update on sequences to anon,authenticated,service_role;`);
  execFileSync("docker", [...args.slice(0, -4), "-U", "supabase_admin", "-d", "postgres"], {
    input: "grant usage on schema auth to postgres,anon,authenticated,service_role; grant all on all tables in schema auth to postgres; grant execute on all functions in schema auth to postgres,anon,authenticated,service_role;", encoding: "utf8",
  });
  const migrations = readdirSync("supabase/migrations").filter((name) => name.endsWith(".sql") && name < migration).sort();
  for (const [index, name] of migrations.entries()) {
    try {
      sql(`begin;\n${readFileSync(`supabase/migrations/${name}`, "utf8")}\ncommit;`);
    } catch (error) {
      throw new Error(`Replay failed at ${name}`, { cause: error });
    }
    if ((index + 1) % 25 === 0) console.log(`Replayed ${index + 1}/${migrations.length} baseline migrations`);
  }
  console.log(JSON.stringify({ baselineMigrationsReplayed: migrations.length }));
  sql(`update public.locations set is_active=false;
    insert into public.locations(id,name,code,is_active)
    select ('25000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'freshness fixture '||n,'FF'||n,true from generate_series(1,26)n;
    update public.dashboard_refresh_settings set interval_minutes=10,last_rollover_date=(now() at time zone 'Asia/Bangkok')::date;
    update public.dashboard_branch_snapshots set status='dirty',source_version=2,snapshot_version=1,summary='{}',calculated_at=now(),updated_at=now()-interval '11 minutes';`);
  const oldCompleted = Number(sql("select private.claim_dashboard_branch(); select private.rebuild_dashboard_branch(); select count(*) from public.dashboard_branch_snapshots where status='ready';").split("\n").at(-1));
  assert.equal(oldCompleted, 1);
  assert.ok(oldCompleted < 3, "original two-job tick fails the required three completed rebuilds");
  sql(`update public.dashboard_branch_snapshots set status=case right(location_id::text,1)
      when '1' then 'ready' when '2' then 'dirty' when '3' then 'queued' when '4' then 'running' else 'failed' end,
    updated_at='2026-09-11T03:00:00Z',claimed_version=null,claimed_at=null;`);
  sql(readFileSync(`supabase/migrations/${migration}`));
  assert.equal(sql(`select bool_and(case when status='ready' then pending_since is null and next_retry_at is null
    when status='failed' then pending_since='2026-09-11T03:00:00Z' and next_retry_at is not null
    else pending_since='2026-09-11T03:00:00Z' and next_retry_at is null end) from public.dashboard_branch_snapshots`), "t");
  console.log(JSON.stringify({ originalBudgetRed: { actual: oldCompleted, required: 3 }, fiveStateBackfill: "PASS", forwardMigrationRole: "postgres" }));
}

if (process.argv.includes("--canonical-acl-baseline")) {
  // Resume a replay initialized before the provisioning defaults were aligned.
  // Restore only the pre-change canonical ACLs; never rewrite application DDL.
  const baseline = execFileSync("git", ["show", "HEAD:supabase-schema.sql"], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  const acls = baseline.split("\n").filter((line) => /^(GRANT |REVOKE |ALTER DEFAULT PRIVILEGES )/.test(line)).join("\n");
  sql(`revoke all on all tables in schema public,private from public,anon,authenticated,service_role;\n${acls}`);
  console.log("Pre-change canonical ACL baseline restored in the isolated replay only");
}
if (sql("select exists(select 1 from information_schema.columns where table_schema='public' and table_name='dashboard_branch_snapshots' and column_name='last_source_transaction_id')") === "f") {
  sql(`begin;\n${readFileSync("supabase/migrations/20260912020000_dashboard_source_commit_order.sql", "utf8")}\ncommit;`);
}
if (sql("select pg_get_functiondef('public.rebuild_dashboard_refresh_now(uuid,bigint)'::regprocedure) like '%pg_advisory_xact_lock%'") === "f") {
  sql(`begin;\n${readFileSync("supabase/migrations/20260912030000_dashboard_manual_handoff_wait.sql", "utf8")}\ncommit;`);
}

execFileSync("docker", [...args.slice(0, -4), "-U", "supabase_admin", "-d", "postgres"], {
  input: "create extension if not exists pgtap with schema extensions;", encoding: "utf8",
});
assert.equal(sql("select count(*) from public.locations where id::text like '25000000-0000-4000-8000-%'"), "26");
sql("update public.locations set is_active=false where id::text not like '25000000-0000-4000-8000-%';");
let assertions = 0;
for (const name of readdirSync("supabase/tests").filter((name) => name.endsWith(".sql")).sort()) {
  const result = sql(readFileSync(`supabase/tests/${name}`));
  assert.doesNotMatch(result, /^not ok /m, name);
  const count = [...result.matchAll(/^ok \d+/gm)].length;
  const plan = result.match(/^1\.\.(\d+)/m);
  assert.ok(plan, name);
  assert.equal(count, Number(plan[1]), name);
  assertions += count;
  console.log(`${name}: ${count} PASS`);
}

sql(`update public.dashboard_refresh_settings set interval_minutes=10,last_rollover_date=(now() at time zone 'Asia/Bangkok')::date;
  update public.dashboard_branch_snapshots set status='dirty',source_version=greatest(source_version+1,txid_current()),snapshot_version=0,
  claimed_version=null,claimed_at=null,manual_requested_at=null,pending_since=now()-interval '10 minutes',failure_count=0,next_retry_at=null;
  create table public.dashboard_test_calculations(location_id uuid,started_at timestamptz);
  create function private.dashboard_test_summary(p_location_id uuid) returns jsonb language plpgsql as $$
  begin
    insert into public.dashboard_test_calculations values(p_location_id,clock_timestamp());
    if current_setting('application_name')='dashboard_race_worker' then perform pg_sleep(5); end if;
    return '{}'::jsonb;
  end $$;
  alter function private.calculate_dashboard_summary(uuid) rename to calculate_dashboard_summary_original;
  create function private.calculate_dashboard_summary(p_location_id uuid) returns jsonb language sql as $$select private.dashboard_test_summary(p_location_id)$$;`);
try {
  const id = "25000000-0000-4000-8000-000000000001";
  // A transaction can obtain its XID before a later writer, then commit a
  // source change during calculation. XID order is not source commit order.
  const olderWriter = spawn("docker", args);
  const olderExited = new Promise((resolve, reject) => {
    olderWriter.on("error", reject);
    olderWriter.on("exit", (code) => code === 0 ? resolve() : reject(new Error("older writer failed")));
  });
  const olderReady = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("older transaction did not start")), 5_000);
    olderWriter.stdout.on("data", (data) => { if (String(data).includes("OLDER_READY")) { clearTimeout(timeout); resolve(); } });
  });
  olderWriter.stdin.write("begin; select txid_current(); select 'OLDER_READY';\n");
  await olderReady;
  sql(`select private.mark_dashboard_dirty('${id}');`);
  const lateCommitWorker = asyncSql(`set application_name='dashboard_race_worker'; select private.rebuild_dashboard_branch_automatic('${id}');`);
  let olderRaceSleeping = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    olderRaceSleeping = sql("select exists(select 1 from pg_stat_activity where application_name='dashboard_race_worker' and wait_event='PgSleep')") === "t";
    if (olderRaceSleeping) break;
    await delay(25);
  }
  assert.ok(olderRaceSleeping);
  olderWriter.stdin.end(`select private.mark_dashboard_dirty('${id}'); commit;\n`);
  await olderExited;
  await lateCommitWorker;
  assert.equal(sql(`select status from public.dashboard_branch_snapshots where location_id='${id}'`), "dirty", "an older transaction committing a source change during calculation must not be lost");
  sql("truncate public.dashboard_test_calculations;");
  sql(`update public.dashboard_branch_snapshots set status='dirty',source_version=1,snapshot_version=0,pending_since=now()-interval '11 minutes' where location_id='${id}';`);
  const earliest = sql(`select pending_since from public.dashboard_branch_snapshots where location_id='${id}'`);
  const versions = [];
  for (let write = 0; write < 5; write++) {
    sql(`select private.mark_dashboard_dirty('${id}');`);
    assert.equal(sql(`select pending_since from public.dashboard_branch_snapshots where location_id='${id}'`), earliest);
    versions.push(Number(sql(`select source_version from public.dashboard_branch_snapshots where location_id='${id}'`)));
  }
  assert.ok(versions.every((version, index) => index === 0 || version > versions[index - 1]));
  const worker = asyncSql(`set application_name='dashboard_race_worker'; select private.rebuild_dashboard_branch_automatic('${id}');`);
  let sleeping = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    sleeping = sql("select exists(select 1 from pg_stat_activity where application_name='dashboard_race_worker' and wait_event='PgSleep')") === "t";
    if (sleeping) break;
    await delay(25);
  }
  assert.ok(sleeping, "worker must be calculating before the race");
  sql(`set statement_timeout='700ms'; select private.mark_dashboard_dirty('${id}');`);
  assert.equal(sql(`select private.rebuild_dashboard_branch_automatic('${id}')`), "f", "concurrent automatic calculation is skipped");
  const claimed = sql(`update public.dashboard_branch_snapshots set status='running',claimed_version=source_version,claimed_at=now() where location_id='${id}' returning claimed_version`);
  assert.equal(sql(`select private.rebuild_dashboard_branch_target('${id}',${claimed}) is null`), "t", "manual rebuild shares the automatic advisory lock");
  let manualHandoffSettled = false;
  const manualHandoff = asyncSql(`begin;
    select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
    set local role authenticated;
    select public.rebuild_dashboard_refresh_now('${id}',${claimed});
    commit;`);
  void manualHandoff.finally(() => { manualHandoffSettled = true; });
  await delay(100);
  assert.equal(manualHandoffSettled, false, "manual handoff waits for the automatic branch lock");
  await worker;
  const firstPass = JSON.parse((await manualHandoff).split("\n").at(-1));
  assert.equal(firstPass.status, "dirty", "the first manual pass observes the automatic handoff");
  assert.equal(sql(`select status='dirty' and source_version>snapshot_version and pending_since is not null from public.dashboard_branch_snapshots where location_id='${id}'`), "t");
  assert.equal(Number(sql(`select count(*) from public.dashboard_test_calculations where location_id='${id}'`)), 1, "overlap did not calculate twice");
  const secondPass = JSON.parse(sql(`begin;
    select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
    set local role authenticated;
    with claim as materialized (
      select public.claim_dashboard_refresh_now('${id}',${claimed}) response
    )
    select public.rebuild_dashboard_refresh_now(
      '${id}', (response ->> 'claimedVersion')::bigint
    ) from claim;
    commit;`).split("\n").at(-1));
  assert.ok(Number(secondPass.snapshotVersion) >= Number(claimed), "the second Edge pass completes the requested version");
  assert.equal(sql(`select status='ready' and source_version=snapshot_version from public.dashboard_branch_snapshots where location_id='${id}'`), "t");
  // A second automatic tick must skip, even when invoked outside the Cron job.
  sql(`update public.dashboard_branch_snapshots set status='ready',pending_since=null;
    update public.dashboard_branch_snapshots set status='dirty',pending_since=now(),source_version=source_version+1 where location_id='${id}';`);
  const tickWorker = asyncSql("set application_name='dashboard_race_worker'; select private.process_dashboard_refresh_tick();");
  sleeping = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    sleeping = sql("select exists(select 1 from pg_stat_activity where application_name='dashboard_race_worker' and wait_event='PgSleep')") === "t";
    if (sleeping) break;
    await delay(25);
  }
  assert.ok(sleeping);
  assert.equal(sql("select private.process_dashboard_refresh_tick()"), "0");
  await tickWorker;
  console.log(JSON.stringify({ assertions, olderTransactionCommitPreserved: true, committedWritesPreservedEarliestPending: versions.length, concurrentSourceWriteDidNotBlock: true, newerVersionPreserved: true, automaticManualOverlapSkipped: true, manualHandoffWaitedAndCompleted: true, overlappingTickSkipped: true }));
} finally {
  sql(`drop function private.calculate_dashboard_summary(uuid);
    alter function private.calculate_dashboard_summary_original(uuid) rename to calculate_dashboard_summary;
    drop function private.dashboard_test_summary(uuid); drop table public.dashboard_test_calculations;`);
}

const runtimes = [];
assert.equal(sql("select count(*) from public.locations where is_active"), "26");
for (let tick = 0; tick < 9; tick++) {
  if (tick === 0) sql("update public.dashboard_branch_snapshots set status='dirty',pending_since=now(),source_version=source_version+1,claimed_version=null,claimed_at=null where location_id in(select id from public.locations where is_active);");
  const result = JSON.parse(sql(`with started as materialized(select clock_timestamp() at),
    work as materialized(select private.process_dashboard_refresh_tick() completed from started)
    select json_build_object('completed',completed,'ms',extract(epoch from clock_timestamp()-started.at)*1000) from started,work`));
  assert.ok(result.ms < 60_000);
  runtimes.push(result);
}
assert.equal(sql("select count(*) from public.dashboard_branch_snapshots s join public.locations l on l.id=s.location_id where l.is_active and s.status<>'ready'"), "0");
console.log(JSON.stringify({ activeBranches: 26, intervalMinutes: 10, budget: 3, ticks: runtimes, maxTickMs: Math.max(...runtimes.map((tick) => tick.ms)), status: "PASS" }));
