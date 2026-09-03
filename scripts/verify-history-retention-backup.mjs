// Run only against the explicitly isolated backup-replay container, never an app DB.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const container = 'lanflow-retention-verification-20260903';
const network = execFileSync('docker', ['inspect', '--format', '{{.HostConfig.NetworkMode}}', container], { encoding: 'utf8' }).trim();
assert.equal(network, 'none', 'backup verification must not have network access');
function sql(query) {
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres'], {
    input: query, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  }).trim();
}
assert.equal(sql("show cron.launch_active_jobs"), 'off');
const json = (query) => JSON.parse(sql(query));
const omitted = ['dashboard_money_events', 'time_tracking_audit_logs', 'admin_account_audit_logs',
  'income_expense_approval_requests', 'cash_transfer_delete_requests', 'rubber_bill_approval_requests',
  'stock_entry_approval_requests', 'stock_product_approval_requests', 'history_cleanup_runs', 'approval_request_replay_guards'];
const tables = json(`select json_agg(format('%I.%I',schemaname,tablename) order by schemaname,tablename)
  from pg_tables where schemaname in ('public','private') and tablename not in (${omitted.map(t => `'${t}'`).join(',')})`);
function fingerprint() {
  return json(`select json_object_agg(name, digest) from (${tables.map(table =>
    `select '${table}' name, json_build_array(count(*), md5(coalesce(string_agg(md5(row_to_json(t)::text),'' order by md5(row_to_json(t)::text)),''))) digest from ${table} t`
  ).join(' union all ')}) all_tables`);
}
function pending() {
  return json(`select json_object_agg(name, digest) from (${omitted.filter(t => t.endsWith('requests')).map(table =>
    `select '${table}' name, json_build_array(count(*), md5(coalesce(string_agg(md5(row_to_json(t)::text),'' order by md5(row_to_json(t)::text)),''))) digest from public.${table} t where request_status='pending'`
  ).join(' union all ')}) pending_tables`);
}
const before = fingerprint();
const pendingBefore = pending();
const initial = json('select json_object_agg(group_key,eligible_count) from private.history_retention_preview_rows(15)');
assert.ok(initial.scheduler_run_history > 4321, 'restore the production-sized cron backup before running this benchmark');
const plan = json(`explain (analyze, buffers, format json) select runid from cron.job_run_details
  where status in ('succeeded','failed') and start_time < private.history_retention_cutoff_date(15)::timestamp at time zone 'Asia/Bangkok'
  order by runid limit 1000`);
const elapsed = [];
const deleted = {};
let result;
for (let batch = 0; batch < 500; batch++) {
  const run = json(`with started as materialized(select clock_timestamp() at),
    work as materialized(select private.cleanup_history_retention(1000) result from started)
    select json_build_object('result',work.result,'ms',extract(epoch from clock_timestamp()-started.at)*1000) from started,work`);
  result = run.result;
  assert.equal(result.status, 'succeeded', JSON.stringify(result));
  elapsed.push(Number(run.ms));
  for (const [key, count] of Object.entries(result.deletedCounts)) {
    assert.ok(count <= 1000, `${key} exceeded the batch bound`);
    deleted[key] = (deleted[key] ?? 0) + count;
  }
  if (!result.hasMore) break;
}
assert.equal(result.hasMore, false, 'backlog must be fully drained');
assert.deepEqual(fingerprint(), before, 'every durable business table fingerprint must be unchanged');
assert.deepEqual(pending(), pendingBefore, 'pending requests must be byte-for-byte unchanged');
const remaining = Number(sql('select sum(eligible_count) from private.history_retention_preview_rows(15)'));
assert.equal(remaining, 0);
assert.equal(sql("select private.cleanup_history_retention(1000)->>'reason'"), 'no_work');

// Imported backups bypass triggers; validate actual FK contents, not just convalidated.
sql(`do $check$
declare c record; v_count bigint;
begin
  for c in
    select co.conname, co.conrelid::regclass child, co.confrelid::regclass parent,
      string_agg(format('c.%I is not null',ca.attname),' and ' order by k.n) nonnull,
      string_agg(format('c.%I = p.%I',ca.attname,pa.attname),' and ' order by k.n) matches
    from pg_constraint co
    join pg_class cl on cl.oid=co.conrelid join pg_namespace ns on ns.oid=cl.relnamespace
    cross join lateral unnest(co.conkey,co.confkey) with ordinality k(childnum,parentnum,n)
    join pg_attribute ca on ca.attrelid=co.conrelid and ca.attnum=k.childnum
    join pg_attribute pa on pa.attrelid=co.confrelid and pa.attnum=k.parentnum
    where co.contype='f' and ns.nspname in ('public','private')
    group by co.oid,co.conname,co.conrelid,co.confrelid
  loop
    execute format('select count(*) from %s c where %s and not exists(select 1 from %s p where %s)',c.child,c.nonnull,c.parent,c.matches) into v_count;
    if v_count <> 0 then raise exception 'FK verification failed: %, count=%',c.conname,v_count; end if;
  end loop;
end $check$;`);
const sorted = [...elapsed].sort((a,b) => a-b);
console.log(JSON.stringify({
  initial, deleted, remaining, batches: elapsed.length,
  databaseMs: { total: elapsed.reduce((a,b) => a+b,0), median: sorted[Math.floor(sorted.length/2)], p95: sorted[Math.ceil(sorted.length*0.95)-1], max: sorted.at(-1) },
  durableTablesUnchanged: tables.length, pendingUnchanged: true, foreignKeyViolations: 0,
  scheduledDrainMinutesAtOneBatchPerMinute: elapsed.length,
  schedulerCandidatePlan: plan,
}, null, 2));
