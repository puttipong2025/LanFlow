import { test, expect } from "@playwright/test";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const worker = () => execute("docker", ["exec", "supabase_db_webapp", "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", "select private.process_rubber_queue(20)"], { windowsHide: true });

const sql = (statement: string) => execFileSync("docker", ["exec", "supabase_db_webapp", "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", statement], { encoding: "utf8" }).trim();

test("one-job attempts reach an independent fifth branch behind four locked branches", async () => {
  test.setTimeout(35_000);
  const actor = crypto.randomUUID(), branches = Array.from({ length: 5 }, () => crypto.randomUUID());
  const commands = Array.from({ length: 6 }, () => crypto.randomUUID());
  const tag = `rubber-lookahead-${actor}`;
  const cronWasActive = sql("select active from cron.job where jobname='rubber-central-queue'") === 't';
  let holder: Promise<unknown> | undefined;
  const payload = (i: number) => JSON.stringify({ centralQueue: true, contractVersion: 2, operation: 'create',
    commandId: commands[i], idempotencyKey: commands[i], clientTempId: commands[i], locationId: branches[Math.min(i, 4)],
    expectedCommandGeneration: 0, expectedQueueVersion: 0, expectedRevisionNo: 0,
    billDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date()),
    localBillNo: commands[i], billType: 'weighing', customerName: 'Lookahead fixture', inputMethod: 'manual',
    deductWeight: 0, acidPackCount: 0, items: [{ itemType: 'weigh', title: 'Weigh', inWeight: 100, outWeight: 0, netWeight: 100, unitPrice: 1, sequenceNo: 1 }] });
  const branchIds = branches.map(branch => `'${branch}'`).join(',');
  try {
    sql("select cron.alter_job(jobid,active:=false) from cron.job where jobname='rubber-central-queue'");
    sql(`begin;insert into auth.users(id,aud,role) values('${actor}','authenticated','authenticated');
      insert into public.profiles(id,phone,name,role,is_active,can_access_super_admin_features) values('${actor}','L${actor.slice(0,9)}','Lookahead fixture','admin',true,true);
      ${branches.map((branch, i) => `insert into public.locations(id,name,code,is_active) values('${branch}','Lookahead ${branch}','L${branch.slice(0,8)}',true);
        insert into public.user_locations(user_id,location_id,is_primary) values('${actor}','${branch}',${i === 0});`).join('\n')}
      select set_config('request.jwt.claim.sub','${actor}',true);
      ${branches.map((_, i) => `select public.submit_rubber_queue('${payload(i)}'::jsonb);`).join('\n')}
      update private.rubber_queue_jobs set next_attempt_at=clock_timestamp()+interval '1 hour' where location_id in (${branchIds});commit;`);
    holder = execute('docker', ['exec', 'supabase_db_webapp', 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-c',
      `begin;set application_name='${tag}';${branches.slice(0, 4).map(branch => `select pg_advisory_xact_lock(hashtextextended('${branch}',0));`).join('')}select pg_sleep(30);rollback;`], { windowsHide: true }).catch(() => {});
    await expect.poll(() => sql(`select count(*) from pg_stat_activity where application_name='${tag}' and wait_event='PgSleep'`)).toBe('1');
    sql(`update private.rubber_queue_jobs set next_attempt_at='2000-01-01' where location_id in (${branches.slice(0, 4).map(branch => `'${branch}'`).join(',')})`);
    const started = performance.now();
    expect(sql('select private.process_rubber_queue(1)')).toBe('0');
    expect(performance.now() - started).toBeLessThan(2_000); // All locked is finite, not a busy loop.
    sql(`update private.rubber_queue_jobs set next_attempt_at='2000-01-01' where command_id='${commands[4]}';select private.process_rubber_queue(20);`);
    expect(sql(`select state from private.rubber_queue_jobs where command_id='${commands[4]}'`)).toBe('done'); // Disproof: valid branch/actor/business inputs.
    sql(`begin;select set_config('request.jwt.claim.sub','${actor}',true);select public.submit_rubber_queue('${payload(5)}'::jsonb);
      update private.rubber_queue_jobs set next_attempt_at='2000-01-01' where command_id='${commands[5]}';commit;`);
    sql('select private.process_rubber_queue(1)');
    expect(sql(`select state from private.rubber_queue_jobs where command_id='${commands[5]}'`)).toBe('done');
    expect(sql(`select count(*) from private.rubber_queue_jobs where location_id in (${branches.slice(0, 4).map(branch => `'${branch}'`).join(',')}) and state='queued' and attempts=0`)).toBe('4');
    expect(sql(`select count(*) from private.rubber_queue_execution where command_id in ('${commands.join("','")}')`)).toBe('0');
  } finally {
    sql(`select pg_terminate_backend(pid) from pg_stat_activity where application_name='${tag}'`);
    await holder;
    sql(`begin;set local app.history_retention_cleanup='on';delete from public.rubber_bill_approval_requests where location_id in (${branchIds});
      delete from public.rubber_bill_items where bill_id in(select id from public.rubber_bills where location_id in (${branchIds}));
      delete from public.rubber_bills where location_id in (${branchIds});set constraints all immediate;
      delete from public.dashboard_money_events where location_id in (${branchIds});delete from public.dashboard_branch_snapshots where location_id in (${branchIds});
      delete from public.document_deletion_audits where location_id in (${branchIds});delete from public.user_locations where user_id='${actor}';
      delete from public.profiles where id='${actor}';delete from public.locations where id in (${branchIds});delete from auth.users where id='${actor}';commit;`);
    sql(`select cron.alter_job(jobid,active:=${cronWasActive}) from cron.job where jobname='rubber-central-queue'`);
  }
});

for (const driver of ['manual', 'cron'] as const) {
test(`${driver} attempt deadline lets an independent bill finish before a slow bill and commits each outcome`, async () => {
  test.setTimeout(40_000);
  const branch = crypto.randomUUID(), actor = crypto.randomUUID();
  const commands = [crypto.randomUUID(), crypto.randomUUID()];
  const trigger = `rubber_slow_${branch.replaceAll('-', '')}`;
  try {
    sql(`begin;insert into auth.users(id,aud,role) values('${actor}','authenticated','authenticated');
      insert into public.locations(id,name,code,is_active) values('${branch}','Slow attempt fixture','S${branch.slice(0,8)}',true);
      insert into public.profiles(id,phone,name,role,is_active,can_access_super_admin_features) values('${actor}','S${actor.slice(0,9)}','Slow fixture','admin',true,true);
      insert into public.user_locations(user_id,location_id,is_primary) values('${actor}','${branch}',true);
      select set_config('request.jwt.claim.sub','${actor}',true);
      ${commands.map(command => `select public.submit_rubber_queue('${JSON.stringify({ centralQueue: true, contractVersion: 2, operation: "create",
        commandId: command, idempotencyKey: command, locationId: branch, clientTempId: command,
        expectedCommandGeneration: 0, expectedQueueVersion: 0, expectedRevisionNo: 0,
        billDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date()), localBillNo: command, billType: "weighing", customerName: "Slow fixture", inputMethod: "manual",
        deductWeight: 0, acidPackCount: 0, items: [{ itemType: "weigh", title: "Weigh", inWeight: 100, outWeight: 0,
          netWeight: 100, unitPrice: 1, sequenceNo: 1 }] })}'::jsonb);`).join('\n')}
      update private.rubber_queue_jobs set next_attempt_at=clock_timestamp()+interval '1 hour' where location_id='${branch}';
      create function private.${trigger}() returns trigger language plpgsql as $slow$
      begin if new.client_temp_id='${commands[0]}' then perform pg_sleep(4); end if;return new;end $slow$;
      create trigger ${trigger} before insert on public.rubber_bills for each row execute function private.${trigger}();commit;`);
    const command = sql("select command from cron.job where jobname='rubber-central-queue'")
      .replaceAll('private.process_rubber_queue(1)', `private.process_rubber_queue_batch(1,'${branch}')`);
    const started = performance.now();
    sql(`update private.rubber_queue_jobs set next_attempt_at=clock_timestamp()+case when command_id='${commands[1]}' then interval '1 millisecond' else interval '0' end where location_id='${branch}';` + (driver === 'manual' ? command : ''));
    if (driver === 'cron') await expect.poll(() => sql(`select state from private.rubber_queue_jobs where command_id='${commands[1]}'`),
      { timeout: 8_000, intervals: [100, 250, 500] }).toBe('done');
    const elapsedMs = performance.now() - started;
    console.info(JSON.stringify({ scenario: 'slow-independent', driver, elapsedMs }));
    expect(elapsedMs).toBeLessThan(driver === 'manual' ? 3_000 : 5_000);
    expect(sql(`select state from private.rubber_queue_jobs where command_id='${commands[1]}'`)).toBe('done');
    expect(sql(`select state from private.rubber_queue_jobs where command_id='${commands[0]}'`)).toBe('retry_wait');
    expect(sql(`select error_code from private.rubber_queue_jobs where command_id='${commands[0]}'`)).toBe('ATTEMPT_TIMEOUT');
    expect(sql(`select count(*) from public.rubber_bills where location_id='${branch}'`)).toBe('1');
    expect(sql(`select count(*) from private.rubber_queue_execution where command_id in ('${commands.join("','")}')`)).toBe('0');
    sql(`drop trigger ${trigger} on public.rubber_bills;drop function private.${trigger}();
      update private.rubber_queue_jobs set next_attempt_at=clock_timestamp() where command_id='${commands[0]}';
      select private.process_rubber_queue_batch(1,'${branch}');`);
    expect(sql(`select count(*) from private.rubber_queue_jobs where location_id='${branch}' and state='done'`)).toBe('2');
    expect(sql(`select count(*) from public.rubber_bills where location_id='${branch}'`)).toBe('2');
  } finally {
    sql(`begin;drop trigger if exists ${trigger} on public.rubber_bills;drop function if exists private.${trigger}();
      set local app.history_retention_cleanup='on';delete from public.rubber_bill_approval_requests where location_id='${branch}';
      delete from public.rubber_bill_items where bill_id in(select id from public.rubber_bills where location_id='${branch}');
      delete from public.rubber_bills where location_id='${branch}';set constraints all immediate;
      delete from public.dashboard_money_events where location_id='${branch}';delete from public.dashboard_branch_snapshots where location_id='${branch}';
      delete from public.document_deletion_audits where location_id='${branch}';delete from public.user_locations where location_id='${branch}';
      delete from public.profiles where id='${actor}';delete from public.locations where id='${branch}';delete from auth.users where id='${actor}';commit;`);
  }
});
}

for (const committedAttempts of [false, true]) for (const blockedIndex of [0, 1]) {
test(`connection kill ${blockedIndex === 0 ? "early" : "late"} with ${committedAttempts ? "committed attempts" : "legacy batch"} preserves the transaction boundary and recovers once`, async () => {
  test.setTimeout(45_000);
  const branch = crypto.randomUUID(), actor = crypto.randomUUID();
  const bills = [crypto.randomUUID(), crypto.randomUUID()];
  const commands = [crypto.randomUUID(), crypto.randomUUID()];
  const tag = `rubber-kill-${branch}`;
  let holder: Promise<unknown> | undefined, processing: Promise<unknown> | undefined;
  const cronWasActive = sql("select active from cron.job where jobname='rubber-central-queue'") === 't';
  const executeSql = (statement: string) => execute("docker", ["exec", "supabase_db_webapp", "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", statement], { windowsHide: true });
  try {
    if (committedAttempts) sql("select cron.alter_job(jobid,active:=false) from cron.job where jobname='rubber-central-queue'");
    sql(`begin;insert into auth.users(id,aud,role) values('${actor}','authenticated','authenticated');
      insert into public.locations(id,name,code,is_active) values('${branch}','Batch kill fixture','K${branch.slice(0,8)}',true);
      insert into public.profiles(id,phone,name,role,is_active) values('${actor}','K${actor.slice(0,9)}','Batch kill','admin',true);
      insert into public.user_locations(user_id,location_id,is_primary) values('${actor}','${branch}',true);
      select set_config('request.jwt.claim.sub','${actor}',true);
      ${bills.map((bill, i) => `insert into public.rubber_bills(id,client_temp_id,local_bill_no,server_bill_no,idempotency_key,sync_status,record_status,
        location_id,bill_no,bill_date,customer_name,bill_type,weight,rubber_value,average_price,deduction_total,net_total,revision_no,
        created_at,created_by_user_id,created_by_name,created_by_phone)
        values('${bill}','${bill}','${bill}','${bill}','seed:${bill}','synced','active','${branch}','${bill}',current_date-2,
        'Batch fixture','weighing',100,3800,38,0,3800,1,'2000-01-01','${actor}','Batch kill','0000000000');
        select public.submit_rubber_queue('${JSON.stringify({ centralQueue: true, contractVersion: 2, operation: "delete", commandId: commands[i],
          idempotencyKey: commands[i], locationId: branch, clientTempId: bill, expectedCommandGeneration: 0, expectedQueueVersion: 0, expectedRevisionNo: 1 })}'::jsonb);`).join('\n')}
      update private.rubber_queue_jobs set next_attempt_at=clock_timestamp()+interval '1 hour',
        accepted_at=clock_timestamp()+case when command_id='${commands[1]}' then interval '1 second' else interval '0 second' end
        where location_id='${branch}';commit;`);
    holder = executeSql(`begin;set application_name='${tag}-hold';select id from public.rubber_bills where id='${bills[blockedIndex]}' for update;select pg_sleep(30);rollback;`).catch(() => {});
    await expect.poll(() => sql(`select count(*) from pg_stat_activity where application_name='${tag}-hold' and wait_event='PgSleep'`)).toBe("1");
    processing = executeSql(committedAttempts
      ? `set application_name='${tag}-worker';set lock_timeout='20s';
        update private.rubber_queue_jobs set next_attempt_at='2000-01-01' where location_id='${branch}';
        begin;select private.process_rubber_queue_batch(1,'${branch}');commit;
        begin;select private.process_rubber_queue_batch(1,'${branch}');commit;`
      : `begin;set application_name='${tag}-worker';set local lock_timeout='20s';
        update private.rubber_queue_jobs set next_attempt_at='2000-01-01' where location_id='${branch}';
        select private.process_rubber_queue_batch(20,'${branch}');commit;`).catch(() => {});
    await expect.poll(() => sql(`select count(*) from pg_stat_activity where application_name='${tag}-worker' and wait_event_type='Lock'`)).toBe("1");
    sql(`select pg_terminate_backend(pid) from pg_stat_activity where application_name='${tag}-worker'`);
    await processing;
    const committed = committedAttempts && blockedIndex === 1 ? 1 : 0;
    expect(sql(`select count(*) from private.rubber_queue_jobs where location_id='${branch}' and state='queued'`)).toBe(String(2 - committed));
    expect(sql(`select count(*) from public.rubber_bill_approval_requests where location_id='${branch}'`)).toBe(String(committed));
    expect(sql(`select count(*) from private.rubber_queue_execution where command_id in ('${commands.join("','")}')`)).toBe("0");
    sql(`select pg_terminate_backend(pid) from pg_stat_activity where application_name='${tag}-hold'`);
    await holder;
    sql(`update private.rubber_queue_jobs set next_attempt_at=clock_timestamp() where location_id='${branch}';select private.process_rubber_queue_batch(20,'${branch}');`);
    expect(sql(`select count(*) from private.rubber_queue_jobs where location_id='${branch}' and state='done'`)).toBe("2");
    expect(sql(`select count(*) from public.rubber_bill_approval_requests where location_id='${branch}'`)).toBe("2");
    sql(`select private.process_rubber_queue_batch(20,'${branch}')`);
    expect(sql(`select count(*) from public.rubber_bill_approval_requests where location_id='${branch}'`)).toBe("2");
  } finally {
    sql(`select pg_terminate_backend(pid) from pg_stat_activity where application_name in ('${tag}-hold','${tag}-worker')`);
    await Promise.allSettled([holder, processing]);
    sql(`begin;set local app.history_retention_cleanup='on';
      delete from public.rubber_bill_approval_requests where location_id='${branch}';
      delete from public.rubber_bill_items where bill_id in(select id from public.rubber_bills where location_id='${branch}');
      delete from public.rubber_bills where location_id='${branch}';set constraints all immediate;
      delete from public.dashboard_money_events where location_id='${branch}';delete from public.dashboard_branch_snapshots where location_id='${branch}';
      delete from public.document_deletion_audits where location_id='${branch}';delete from public.user_locations where location_id='${branch}';
      delete from public.profiles where id='${actor}';delete from public.locations where id='${branch}';delete from auth.users where id='${actor}';commit;`);
    if (committedAttempts) sql(`select cron.alter_job(jobid,active:=${cronWasActive}) from cron.job where jobname='rubber-central-queue'`);
  }
});
}

test("central Rubber processing is a private database worker, independent of browser replay", () => {
  expect(sql("select to_regprocedure('private.process_rubber_queue(integer)') is not null")).toBe("t");
  expect(sql("select has_function_privilege('authenticated','private.process_rubber_queue(integer)','execute')")).toBe("f");
});

test("concurrent workers and a report transaction cannot duplicate effects or cross the queue blocker", async () => {
  const branch = crypto.randomUUID(), actor = crypto.randomUUID();
  const ids = Array.from({ length: 8 }, () => crypto.randomUUID());
  try {
    const payloads = ids.map(id => JSON.stringify({ centralQueue: true, contractVersion: 2, operation: "create",
      commandId: id, idempotencyKey: id, locationId: branch, clientTempId: id, expectedCommandGeneration: 0,
      expectedQueueVersion: 0, expectedRevisionNo: 0, billDate: "2026-10-28", localBillNo: `race-${id.slice(0, 8)}`,
      billType: "weighing", customerName: "Worker concurrency", inputMethod: "manual", deductWeight: 0, acidPackCount: 0,
      items: [{ itemType: "weigh", title: "Weigh", inWeight: 100, outWeight: 0, netWeight: 100, unitPrice: 0, sequenceNo: 1 }] }));
    sql(`begin;insert into auth.users(id,aud,role) values('${actor}','authenticated','authenticated');
      insert into public.locations(id,name,code,is_active) values('${branch}','Worker races','WQ${branch.slice(0,6)}',true);
      insert into public.profiles(id,phone,name,role,is_active) values('${actor}','${Date.now().toString().slice(-10)}','Race operator','admin',true);
      insert into public.user_locations(user_id,location_id,is_primary) values('${actor}','${branch}',true);
      select set_config('request.jwt.claim.sub','${actor}',true);
      ${payloads.map(payload => `select public.submit_rubber_queue('${payload}'::jsonb);`).join('\n')}
      commit;`);
    // Zero-price bills or their pending approvals still block reports after the
    // queue handoff, so no possible report/worker ordering may create a report.
    const report = execute("docker", ["exec", "supabase_db_webapp", "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c",
      `select set_config('request.jwt.claim.sub','${actor}',false);select public.create_report_batch('${branch}');`], { windowsHide: true });
    const authenticatedSql = (statement: string) => execute("docker", ["exec", "supabase_db_webapp", "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c",
      `select set_config('request.jwt.claim.sub','${actor}',false);${statement}`], { windowsHide: true });
    const replay = authenticatedSql(`select public.submit_rubber_queue('${payloads[0]}'::jsonb)`);
    const retry = authenticatedSql(`select public.manage_rubber_queue('${ids[0]}',1,'retry')`);
    const retire = authenticatedSql(`select public.manage_rubber_queue('${ids[1]}',1,'retire')`);
    const results = await Promise.allSettled([worker(), worker(), report, replay, retry, retire]);
    expect(results[0].status).toBe("fulfilled"); expect(results[1].status).toBe("fulfilled");
    expect(results[2].status).toBe("rejected");
    expect(results[3].status).toBe("fulfilled");
    if (results[4].status === "rejected") expect(String(results[4].reason)).toContain("QUEUE_CHANGED");
    expect(results[5].status).toBe("rejected");
    if (results[5].status === "rejected") expect(String(results[5].reason)).toMatch(/QUEUE_CHANGED|FORBIDDEN_ACTION/);
    // A bounded worker may skip this branch while report/retry holds its lock.
    // After the racing transactions finish, subsequent ticks must drain it once.
    await expect.poll(async () => {
      await worker();
      return sql(`select count(*) from private.rubber_queue_jobs where location_id='${branch}' and state='done'`);
    }, { timeout: 15_000 }).toBe("8");
    expect(sql(`select count(*) from public.report_batches where location_id='${branch}'`)).toBe("0");
    expect(sql(`select count(*) from private.rubber_bill_report_blockers('${branch}',clock_timestamp())`)).toBe("8");
    expect(Number(sql(`select count(*) from public.rubber_bills where location_id='${branch}'`))
      + Number(sql(`select count(*) from public.rubber_bill_approval_requests where location_id='${branch}' and request_status='pending'`))).toBe(8);
    expect(sql(`select count(*) from private.rubber_queue_execution where command_id in (select command_id from private.rubber_queue_jobs where location_id='${branch}')`)).toBe("0");
  } finally {
    sql(`begin;set local app.history_retention_cleanup='on';
      delete from public.rubber_bill_approval_requests where location_id='${branch}';
      delete from public.rubber_bill_items where bill_id in(select id from public.rubber_bills where location_id='${branch}');
      delete from public.rubber_bills where location_id='${branch}';set constraints all immediate;
      delete from public.dashboard_money_events where location_id='${branch}';
      delete from public.dashboard_branch_snapshots where location_id='${branch}';
      delete from public.document_deletion_audits where location_id='${branch}';
      delete from public.user_locations where location_id='${branch}';delete from public.profiles where id='${actor}';
      delete from public.locations where id='${branch}';delete from auth.users where id='${actor}';commit;`);
  }
});

test("scheduled database worker completes an admitted command with no browser or HTTP requests", async () => {
  test.setTimeout(35_000);
  const branch = crypto.randomUUID(), actor = crypto.randomUUID(), bill = crypto.randomUUID(), command = crypto.randomUUID();
  const payload = JSON.stringify({ centralQueue: true, contractVersion: 2, operation: "delete", commandId: command,
    idempotencyKey: command, locationId: branch, clientTempId: bill, expectedCommandGeneration: 0,
    expectedQueueVersion: 0, expectedRevisionNo: 1 });
  try {
    sql(`begin;insert into auth.users(id,aud,role) values('${actor}','authenticated','authenticated');
      insert into public.locations(id,name,code,is_active) values('${branch}','Cron queue','CQ${branch.slice(0,6)}',true);
      insert into public.profiles(id,phone,name,role,is_active) values('${actor}','${Date.now().toString().slice(-10)}','Cron operator','admin',true);
      insert into public.user_locations(user_id,location_id,is_primary) values('${actor}','${branch}',true);
      insert into public.rubber_bills(id,client_temp_id,local_bill_no,server_bill_no,idempotency_key,sync_status,record_status,
      location_id,bill_no,bill_date,customer_name,bill_type,weight,rubber_value,average_price,deduction_total,net_total,revision_no,
      created_at,created_by_user_id,created_by_name,created_by_phone)
      values('${bill}','${bill}','CQL','CQS','original:${bill}','synced','active','${branch}','CQS',current_date-2,'Cron fixture','weighing',
      100,3800,38,0,3800,1,'2000-01-01','${actor}','Cron operator','0000000000');
      select set_config('request.jwt.claim.sub','${actor}',true);
      select public.submit_rubber_queue('${payload}'::jsonb);commit;`);
    // Only observational SQL from here: no HTTP/browser/manual worker invocation.
    await expect.poll(() => sql(`select state from private.rubber_queue_jobs where command_id='${command}'`),
      { timeout: 20_000, intervals: [500, 1_000, 2_000] }).toBe("done");
    expect(sql(`select result->>'status' from private.rubber_queue_jobs where command_id='${command}'`)).toBe("pending_approval");
    expect(sql(`select requested_by_user_id from public.rubber_bill_approval_requests where location_id='${branch}'`)).toBe(actor);
    expect(sql(`select count(*) from private.rubber_queue_execution where command_id='${command}'`)).toBe("0");
  } finally {
    sql(`begin;set local app.history_retention_cleanup='on';
      delete from public.rubber_bill_approval_requests where location_id='${branch}';
      delete from public.rubber_bill_items where bill_id='${bill}';delete from public.rubber_bills where location_id='${branch}';
      set constraints all immediate;
      delete from public.dashboard_money_events where location_id='${branch}';
      delete from public.dashboard_branch_snapshots where location_id='${branch}';
      delete from public.document_deletion_audits where location_id='${branch}';
      delete from public.user_locations where location_id='${branch}';delete from public.profiles where id='${actor}';
      delete from public.locations where id='${branch}';delete from auth.users where id='${actor}';commit;`);
  }
});
