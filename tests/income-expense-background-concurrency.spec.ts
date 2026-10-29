import { test, expect } from "@playwright/test";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
const args = ["exec", "supabase_db_webapp", "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c"];
const sql = (query: string) => execFileSync("docker", [...args, query], { encoding: "utf8", timeout: 20_000 }).trim();

test("concurrent exact replay applies once and competing new intent cannot overwrite its revision", async () => {
  const actor = crypto.randomUUID(), branch = crypto.randomUUID(), bill = crypto.randomUUID(), commandId = crypto.randomUUID();
  const identity = `set statement_timeout='10s'; select set_config('request.jwt.claim.sub','${actor}',false); select set_config('app.bypass_income_expense_approval','true',false);`;
  const base = { contractVersion: 2, background: true, commandId, actorUserId: actor, expectedServerId: bill,
    operation: "update", expectedRevisionNo: 1, idempotencyKey: `update:${bill}:1`, clientTempId: bill, locationId: branch,
    recordStatus: "active", localBillNo: "LOCAL-RACE", txDate: "2026-10-28", type: "expense", title: "Background race fixture", cost: 120,
    billOption: "ค่าใช้จ่าย", clientCreatedAt: "2026-10-28T01:00:00Z", clientRecordedAt: "2026-10-28T01:00:00Z" };
  const submit = (payload: unknown) => run("docker", [...args, `${identity} select public.sync_income_expense_background('${JSON.stringify(payload)}'::jsonb);`], { timeout: 20_000 });
  const results = (entries: Awaited<ReturnType<typeof submit>>[]) => entries.map((entry) => JSON.parse(entry.stdout.trim().split("\n").at(-1)!));
  try {
    sql(`insert into public.locations(id,name,code,is_active) values('${branch}','Background race','BR${branch.slice(0,6)}',true);
      insert into public.profiles(id,phone,name,role,is_active) values('${actor}','${Date.now().toString().slice(-10)}','Background race','admin',true);
      insert into public.user_locations(user_id,location_id,is_primary) values('${actor}','${branch}',true);
      insert into public.income_expense(id,client_temp_id,location_id,type,number,local_bill_no,server_bill_no,tx_date,title,cost,bill_option,client_recorded_at,client_created_at,created_by_user_id,created_by_name,created_by_phone,revision_no,idempotency_key,sync_status)
      values('${bill}','${bill}','${branch}','expense','RACE','RACE','RACE',current_date,'Background race fixture',100,'ค่าใช้จ่าย',now(),now(),'${actor}','Race','000',1,'original:${bill}','synced');`);
    expect(results(await Promise.all([submit(base), submit(base)])).map((result) => result.outcome)).toEqual(["synced", "synced"]);
    expect(sql(`select revision_no from public.income_expense where id='${bill}'`)).toBe("2");
    const next = { ...base, expectedRevisionNo: 2, idempotencyKey: `update:${bill}:2` };
    const competing = results(await Promise.all([
      submit({ ...next, commandId: crypto.randomUUID(), cost: 130 }),
      submit({ ...next, commandId: crypto.randomUUID(), cost: 140 }),
    ]));
    expect(competing.map((result) => result.outcome).sort()).toEqual(["revision_conflict", "synced"]);
    expect(sql(`select revision_no from public.income_expense where id='${bill}'`)).toBe("3");
  } finally {
    sql(`begin; set local app.history_retention_cleanup='on';
      delete from private.income_expense_background_commands where location_id='${branch}';
      delete from public.income_expense_approval_requests where location_id='${branch}';
      delete from public.income_expense where location_id='${branch}'; set constraints all immediate;
      delete from public.dashboard_money_events where location_id='${branch}'; delete from public.dashboard_branch_snapshots where location_id='${branch}';
      delete from public.document_deletion_audits where location_id='${branch}'; delete from public.user_locations where location_id='${branch}';
      delete from public.profiles where id='${actor}'; delete from public.locations where id='${branch}'; commit;`);
  }
});
