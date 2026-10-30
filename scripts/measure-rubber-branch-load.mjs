// Local-only mixed SQL load: logical branch clients, not browser/API latency.
// Separate committed admission/worker/receipt transactions; all synthetic rows
// are scoped to fresh UUIDs and cleaned up. No production URL is accepted.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import postgres from 'postgres';

const label = process.argv[2];
assert.match(label ?? '', /^[a-z0-9-]{1,48}$/);
const clients = Number(process.env.RUBBER_LOAD_CLIENTS ?? 40);
const cycles = Number(process.env.RUBBER_LOAD_CYCLES ?? 2);
const interval = Number(process.env.RUBBER_LOAD_INTERVAL_MS ?? 30_000);
const seedCount = Number(process.env.RUBBER_LOAD_SEED_BILLS ?? 100);
assert.ok([40, 80].includes(clients));
assert.ok(Number.isInteger(cycles) && cycles >= 2 && cycles <= 10);
assert.equal(interval, 30_000); // Keep the agreed arrival rate, never compress time.
assert.ok(Number.isInteger(seedCount) && seedCount >= 100 && seedCount <= 1000);
const sql = postgres('postgres://postgres:postgres@127.0.0.1:55422/postgres', {
  max: 16, prepare: false, connect_timeout: 5, idle_timeout: 5,
  connection: { application_name: 'lanflow-rubber-local-load' },
});
const scopes = Array.from({ length: clients }, () => ({ actor: randomUUID(), branch: randomUUID() }));
const samples = [], errors = [], operations = {};
let before, after, startedAt, metadata;
const counters = async () => ({
  database: (await sql`select xact_commit, xact_rollback, blks_read, blks_hit
    from pg_stat_database where datname=current_database()`)[0],
  cpu: execFileSync('docker', ['exec', 'supabase_db_webapp', 'cat', '/sys/fs/cgroup/cpu.stat'],
    { encoding: 'utf8', windowsHide: true }).trim(),
});
async function asActor(scope, run) {
  return sql.begin(async tx => {
    await tx`select set_config('request.jwt.claim.sub',${scope.actor},true),
      set_config('statement_timeout','15s',true),set_config('lock_timeout','2s',true)`;
    return run(tx);
  });
}
async function timed(name, run) {
  const start = performance.now();
  try { return await run(); }
  finally {
    const v = operations[name] ??= { calls: 0, elapsedMs: 0 };
    v.calls++; v.elapsedMs += performance.now() - start;
  }
}
async function read(scope, feed = false) {
  await timed(feed ? 'feed' : 'queue-list', () => asActor(scope, async tx => {
    if (feed) {
      const [{ data }] = await tx`select public.get_rubber_bill_operational_feed_v2(
        ${scope.branch}::uuid,'latest','any','',null,null,100) as data`;
      assert.ok(Array.isArray(data.rows) && data.rows.length <= 100);
      assert.ok(data.rows.every(r => r.location_id === scope.branch));
      const ids = data.rows.filter(r => r.row_kind === 'bill').map(r => r.id);
      if (ids.length) await tx`select public.get_rubber_bill_evidence_states_for_bills(${scope.branch}::uuid,${ids}::uuid[])`;
      await tx`select public.get_rubber_bill_work_counts(${scope.branch}::uuid)`;
    } else {
      await tx`select public.list_rubber_queue(${scope.branch}::uuid)`;
    }
  }));
}
async function save(scope) {
  const command = randomUUID(), start = performance.now();
  const sample = { command, branch: scope.branch, scheduledAtMs: start - startedAt, status: 'unknown' };
  samples.push(sample); // Failures and timeouts stay in the denominator.
  try {
    const [{ data: context }] = await timed('command-context', () => asActor(scope, tx =>
      tx`select public.get_rubber_bill_command_context(${scope.branch}::uuid,${command}) as data`));
    const payload = { centralQueue: true, contractVersion: 2, commandId: command, idempotencyKey: command,
      actorUserId: scope.actor, locationId: scope.branch, clientTempId: command,
      expectedCommandGeneration: context.generation, expectedQueueVersion: context.queueVersion,
      expectedRevisionNo: 0, operation: 'create', localBillNo: command,
      billDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date()),
      billType: 'weighing', customerName: 'Synthetic branch load', inputMethod: 'manual',
      deductWeight: 0, acidPackCount: 0,
      items: [{ itemType: 'weigh', title: 'Weigh', inWeight: 100, outWeight: 0, netWeight: 100, unitPrice: 0, sequenceNo: 1 }] };
    // Zero price preserves the unpriced workflow without modifying global price settings.
    await timed('admission', () => asActor(scope, tx => tx`select public.submit_rubber_queue(${tx.json(payload)})`));
    let receipt;
    while (performance.now() - start < 60_000) {
      await timed('worker', () => sql.begin(async tx => {
        await tx`select set_config('statement_timeout','2s',true),set_config('lock_timeout','250ms',true)`;
        await tx`select private.process_rubber_queue_batch(1,${scope.branch}::uuid)`;
      }));
      [{ data: receipt }] = await timed('receipt', () => asActor(scope, tx =>
        tx`select public.get_rubber_queue(${scope.branch}::uuid,${command}::uuid) as data`));
      if (receipt?.state === 'done') break;
      await delay(2000);
    }
    assert.equal(receipt?.commandId, command);
    assert.equal(receipt?.state, 'done');
    assert.equal(receipt?.result?.status, 'synced');
    assert.equal(receipt?.attempts, 1);
    sample.status = 'synced';
    sample.confirmedMs = performance.now() - start;
    await read(scope, true);
  } catch (error) { sample.status = 'failed'; errors.push({ operation: 'save', code: error.code ?? error.name }); }
}
try {
  assert.equal((await sql`select current_database() as name`)[0].name, 'postgres');
  metadata = {
    sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim(),
    migration: (await sql`select max(version) as version from supabase_migrations.schema_migrations`)[0].version,
    helpers: await sql`select proname,md5(pg_get_functiondef(oid)) as definition_md5 from pg_proc
      where pronamespace='private'::regnamespace and proname in
      ('rubber_actor_active','rubber_actor_manager','rubber_actor_location') order by proname`,
  };
  for (const scope of scopes) await sql.begin(async tx => {
    await tx`insert into auth.users(id,aud,role) values(${scope.actor},'authenticated','authenticated')`;
    await tx`insert into public.profiles(id,phone,name,role,is_active,can_access_super_admin_features)
      values(${scope.actor},${'Q'+scope.actor.slice(0,9)},'Synthetic load operator','admin',true,false)`;
    await tx`insert into public.locations(id,name,code,is_active)
      values(${scope.branch},${'Synthetic branch load '+scope.branch},${'Q'+scope.branch.slice(0,8)},true)`;
    await tx`insert into public.user_locations(user_id,location_id,is_primary) values(${scope.actor},${scope.branch},true)`;
    await tx`insert into public.rubber_bills(id,client_temp_id,local_bill_no,server_bill_no,idempotency_key,
      sync_status,record_status,location_id,bill_no,bill_date,customer_name,bill_type,weight,rubber_value,
      average_price,deduction_total,net_total,revision_no,created_by_user_id,created_by_name,created_by_phone)
      select gen_random_uuid(),gen_random_uuid()::text,'seed-'||g,'seed-'||g,${scope.branch}||':'||g,
      'synced','active',${scope.branch}::uuid,'seed-'||g,current_date,'Synthetic branch load','weighing',100,100,
      1,0,100,1,${scope.actor}::uuid,'Synthetic load operator','fixture'
      from generate_series(1,${seedCount}::int) g`;
  });
  // Warm the exact read/queue/context paths; warmup is excluded from counters.
  await read(scopes[0], true); await read(scopes[0]);
  before = await counters(); startedAt = performance.now();
  await Promise.all(scopes.map(async (scope, index) => {
    const offset = interval * index / clients;
    const writing = (async () => {
      for (let n = 0; n < cycles; n++) {
        await delay(Math.max(0, startedAt + offset + n * interval - performance.now()));
        await save(scope);
      }
    })();
    const reading = (async () => {
      for (let due = 0; due < cycles * interval; due += 10_000) {
        await delay(Math.max(0, startedAt + due + index * 10 - performance.now()));
        try { await read(scope, due === 0); await read(scope); }
        catch (error) { errors.push({ operation: 'read', code: error.code ?? error.name }); }
      }
    })();
    await Promise.all([writing, reading]);
  }));
  after = await counters();
  const ids = scopes.map(s => s.branch);
  const [{ total, completed, attempts, effects }] = await sql`select count(*)::int as total,
    count(*) filter(where state='done' and result->>'status'='synced')::int as completed,
    sum(attempts)::int as attempts,(select count(*)::int from public.rubber_bills
      where location_id=any(${ids}::uuid[]) and local_bill_no not like 'seed-%') as effects
    from private.rubber_queue_jobs where location_id=any(${ids}::uuid[])`;
  assert.equal(total, clients * cycles); assert.equal(completed, total); assert.equal(attempts, total); assert.equal(effects, total);
} catch (error) { errors.push({ operation: 'setup-or-verification', code: error.code ?? error.name, constraint: error.constraint_name }); }
finally {
  // Fresh UUID scopes only; defer fixture removal until every parallel client has settled.
  const branches = scopes.map(s => s.branch), actors = scopes.map(s => s.actor);
  await sql.begin(async tx => {
    await tx`select set_config('app.history_retention_cleanup','on',true)`;
    await tx`delete from public.rubber_bill_approval_requests where location_id=any(${branches}::uuid[])`;
    await tx`delete from public.rubber_bill_items where bill_id in(select id from public.rubber_bills where location_id=any(${branches}::uuid[]))`;
    await tx`delete from public.rubber_bills where location_id=any(${branches}::uuid[])`;
    await tx`set constraints all immediate`;
    for (const table of ['dashboard_money_events','dashboard_branch_snapshots','document_deletion_audits'])
      await tx`delete from public.${tx(table)} where location_id=any(${branches}::uuid[])`;
    await tx`delete from public.user_locations where user_id=any(${actors}::uuid[])`;
    await tx`delete from public.profiles where id=any(${actors}::uuid[])`;
    await tx`delete from public.locations where id=any(${branches}::uuid[])`;
    await tx`delete from auth.users where id=any(${actors}::uuid[])`;
  });
  assert.equal((await sql`select count(*)::int as remaining from public.locations where id=any(${branches}::uuid[])`)[0].remaining, 0);
  assert.equal((await sql`select count(*)::int as remaining from private.rubber_queue_jobs where location_id=any(${branches}::uuid[])`)[0].remaining, 0);
  await sql.end();
  const ordered = samples.filter(s => s.status === 'synced').map(s => s.confirmedMs).sort((a,b) => a-b);
  const percentile = p => ordered[Math.ceil(ordered.length * p)-1] ?? null;
  const result = { label, clients, cycles, interval, seedCount, poolConnections: 16, metadata,
    environment: 'Local mixed SQL logical clients; distinct actors/scopes; not HTTP, browser or Cloud latency. DB/CPU counters include other Local services.',
    expectedCommands: clients * cycles, confirmed: ordered.length, medianMs: percentile(.5), p95Ms: percentile(.95),
    before, after, operations, errors, samples };
  fs.mkdirSync('output', { recursive: true });
  fs.writeFileSync('output/rubber-branch-load-'+label+'.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ label, clients, confirmed: ordered.length, medianMs: result.medianMs, p95Ms: result.p95Ms, errors }));
  if (errors.length) process.exitCode = 1;
}
