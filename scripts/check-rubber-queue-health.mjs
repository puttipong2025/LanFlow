// Read-only diagnostics. No customer rows, tokens or SQL error details are printed.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parse } from 'dotenv';

const cloud = process.argv.includes('--cloud');
const variables = ['PGHOST', 'PGPORT', 'PGUSER', 'PGDATABASE', 'PGPASSWORD', 'PGSSLMODE', 'PGCONNECT_TIMEOUT'];
let env = { ...process.env, PGHOST: '127.0.0.1', PGPORT: '5432', PGUSER: 'postgres',
  PGDATABASE: 'postgres', PGPASSWORD: '', PGSSLMODE: 'disable', PGCONNECT_TIMEOUT: '10' };
if (cloud) {
  const credentials = parse(fs.readFileSync('.env.production.local'));
  const ref = fs.readFileSync('supabase/.temp/project-ref', 'utf8').trim();
  const pooler = new URL(fs.readFileSync('supabase/.temp/pooler-url', 'utf8').trim());
  assert.match(ref, /^[a-z0-9]+$/);
  assert.equal(new URL(credentials.NEXT_PUBLIC_SUPABASE_URL).hostname, `${ref}.supabase.co`);
  assert.ok(pooler.hostname.endsWith('.pooler.supabase.com'));
  assert.ok(credentials.SUPABASE_DB_PASSWORD);
  env = { ...env, PGHOST: pooler.hostname, PGUSER: `postgres.${ref}`,
    PGPASSWORD: credentials.SUPABASE_DB_PASSWORD, PGSSLMODE: 'require' };
}
const query = `begin read only;
set local statement_timeout='15s';
select json_build_object(
  'readOnly',current_setting('transaction_read_only'),
  'latestMigration',(select max(version) from supabase_migrations.schema_migrations),
  'cron',(select json_agg(json_build_object('schedule',schedule,'active',active,'commandHash',md5(command)))
    from cron.job where jobname='rubber-central-queue'),
  'recentRuns',(select json_agg(r) from(select status,count(*) from cron.job_run_details
    where jobid in(select jobid from cron.job where jobname='rubber-central-queue')
      and start_time>now()-interval '5 minutes' group by status)r),
  'backlog',(select json_agg(r) from(select state,error_code,count(*),
    max(extract(epoch from now()-accepted_at))::bigint oldest_seconds,
    count(*) filter(where next_attempt_at<=now() and state<>'correction_required') due
    from private.rubber_queue_jobs where state<>'done' group by state,error_code)r),
  'definitions',(select json_object_agg(p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid)))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where(n.nspname='private' and p.proname in('process_rubber_queue','process_rubber_queue_batch'))
      or(n.nspname='public' and p.proname in('get_rubber_queue','submit_rubber_queue','list_rubber_queue'))));
commit;`;
const result = spawnSync('docker', ['exec', '-i', ...variables.flatMap(key => ['-e', key]),
  'supabase_db_webapp', 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'],
{ env, input: query, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
if (result.status !== 0) {
  console.error('Queue health diagnostic unavailable; credentials and raw diagnostics suppressed.');
  process.exitCode = 1;
} else {
  const health = JSON.parse(result.stdout.trim());
  assert.equal(health.readOnly, 'on');
  console.log(JSON.stringify({ target: cloud ? 'cloud' : 'local', ...health }, null, 2));
}
