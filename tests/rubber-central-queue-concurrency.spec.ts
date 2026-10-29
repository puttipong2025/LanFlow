import { test, expect } from "@playwright/test";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const worker = () => execute("docker", ["exec", "supabase_db_webapp", "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", "select private.process_rubber_queue(20)"], { windowsHide: true });

const sql = (statement: string) => execFileSync("docker", ["exec", "supabase_db_webapp", "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", statement], { encoding: "utf8" }).trim();

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
    const results = await Promise.allSettled([worker(), worker(), report]);
    expect(results[0].status).toBe("fulfilled"); expect(results[1].status).toBe("fulfilled");
    expect(results[2].status).toBe("rejected");
    expect(sql(`select count(*) from private.rubber_queue_jobs where location_id='${branch}' and state='done'`)).toBe("8");
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
