import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';

const container = 'lanflow-retention-verification-20260903';
assert.equal(execFileSync('docker', ['inspect', '--format', '{{.HostConfig.NetworkMode}}', container], { encoding: 'utf8' }).trim(), 'none');
const args = ['exec', '-i', container, 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres'];
const sql = (query) => execFileSync('docker', args, { input: query, encoding: 'utf8' }).trim();
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
assert.equal(sql('show cron.launch_active_jobs'), 'off');
function asyncSql(query) {
  const child = spawn('docker', args);
  const promise = new Promise((resolve, reject) => {
    let output = '', error = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { error += data; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(output.trim()) : reject(new Error(error)));
  });
  child.stdin.end(query);
  return promise;
}
const manager = sql("select id from public.profiles where role='super_admin' and is_active order by id limit 1");
assert.match(manager, /^[0-9a-f-]{36}$/);
const savePolicy = days => `select set_config('request.jwt.claim.sub','${manager}',false);
  select public.save_history_retention_settings(${days},(select updated_at from public.history_retention_settings where singleton));`;
sql(`create or replace function private.retention_test_pause() returns trigger language plpgsql as $$
begin perform pg_sleep(1.5); return old; end $$;
create trigger retention_test_pause before delete on cron.job_run_details for each row
when (old.runid in (-980001,-980002)) execute function private.retention_test_pause();
insert into cron.job_run_details(runid,status,start_time,end_time,username)
values (-980001,'succeeded',now()-interval '20 days',now()-interval '20 days','postgres'),
       (-980002,'succeeded',now()-interval '20 days',now()-interval '20 days','postgres');`);
try {
  const worker = asyncSql("set application_name='retention_race_worker'; select private.cleanup_history_retention(1000);");
  let sleeping = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    sleeping = sql("select exists(select 1 from pg_stat_activity where application_name='retention_race_worker' and wait_event='PgSleep')") === 't';
    if (sleeping) break;
    await delay(40);
  }
  assert.ok(sleeping, 'worker must be inside the batch before concurrent writes');
  sql(`insert into cron.job_run_details(runid,status,start_time,end_time,username) values
    (-980003,'succeeded',now(),now(),'postgres'),
    (-980004,'running',now()-interval '20 days',null,'postgres'),
    (-980005,'succeeded',now()-interval '20 days',now()-interval '20 days','postgres');`);
  assert.equal(JSON.parse(sql('select private.cleanup_history_retention(1000)')).reason, 'already_running');
  let policyFinished = false;
  const policy = asyncSql(savePolicy(30)).then(value => { policyFinished = true; return value; });
  await delay(100);
  assert.equal(policyFinished, false, 'setting writer must wait for the in-flight batch');
  const first = JSON.parse(await worker);
  await policy;
  assert.equal(first.status, 'succeeded');
  assert.equal(first.deletedCounts.scheduler_run_history, 2, 'newly inserted rows are not part of the selected batch');
  assert.equal(Number(sql('select count(*) from cron.job_run_details where runid in (-980003,-980004,-980005)')), 3);
  const next = JSON.parse(sql('select private.cleanup_history_retention(1000)'));
  assert.ok(next.status === 'succeeded' || next.reason === 'no_work');
  assert.equal(Number(sql('select count(*) from cron.job_run_details where runid in (-980003,-980004,-980005)')), 3, 'new policy protects remaining rows on the next batch');

  // An eligibility-changing update has its row lock before the next batch starts.
  sql(savePolicy(15));
  const holder = spawn('docker', args);
  const ready = new Promise((resolve,reject) => {
    const timeout = setTimeout(() => reject(new Error('row-lock fixture did not become ready')), 5000);
    holder.stdout.on('data', data => { if (String(data).includes('ROW_LOCKED')) { clearTimeout(timeout); resolve(); } });
    holder.on('error', reject);
  });
  holder.stdin.write("begin; update cron.job_run_details set status='running' where runid=-980005; select 'ROW_LOCKED';\n");
  await ready;
  try {
    const duringUpdate = JSON.parse(sql('select private.cleanup_history_retention(1000)'));
    assert.equal(duringUpdate.status, 'succeeded');
    assert.equal(Number(sql('select count(*) from cron.job_run_details where runid=-980005')), 1);
  } finally {
    const exited = new Promise(resolve => holder.on('exit',resolve));
    holder.stdin.end('commit;\n');
    await exited;
  }
  sql('select private.cleanup_history_retention(1000)');
  assert.equal(sql('select status from cron.job_run_details where runid=-980005'), 'running');
  assert.equal(Number(sql('select count(*) from cron.job_run_details where runid=-980003')), 1, 'fresh completed history remains');
  sql(`drop trigger retention_test_pause on cron.job_run_details;
    create trigger retention_test_pause before delete on cron.job_run_details for each row
    when (old.runid=-980006) execute function private.retention_test_pause();
    insert into cron.job_run_details(runid,status,start_time,end_time,username)
    values (-980006,'succeeded',now()-interval '20 days',now()-interval '20 days','postgres');`);
  const timedOut = JSON.parse(sql("set statement_timeout='200ms'; select private.cleanup_history_retention(1000)"));
  assert.equal(timedOut.status, 'failed');
  assert.match(timedOut.errorMessage, /57014/);
  assert.equal(Number(sql('select count(*) from cron.job_run_details where runid=-980006')), 1, 'timeout rolls back its batch');
  console.log(JSON.stringify({ concurrentInsertPreserved: true, lateInsertExcludedFromSelectedBatch: true,
    overlapSkipped: true, settingWaitedForBatch: true, nextBatchUsedLatestPolicy: true,
    concurrentStatusChangePreserved: true, freshHistoryPreserved: true, timeoutRolledBack: true }, null, 2));
} finally {
  sql('drop trigger if exists retention_test_pause on cron.job_run_details; drop function if exists private.retention_test_pause(); delete from cron.job_run_details where runid between -980006 and -980001;');
}
