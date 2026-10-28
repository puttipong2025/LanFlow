import { test, expect } from "@playwright/test";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const base = ["exec", "supabase_db_webapp", "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c"];
const sql = (query: string) => execFileSync("docker", [...base, query], { encoding: "utf8" }).trim();

test("new command races have one winner and approval cannot apply a replaced request", async () => {
  const branch = crypto.randomUUID(), actor = crypto.randomUUID(), bill = crypto.randomUUID();
  const identity = `select set_config('request.jwt.claim.sub','${actor}',false);`;
  const payload = (key: string, generation: number) => JSON.stringify({ operation: "delete", contractVersion: 2,
    expectedCommandGeneration: generation, expectedRevisionNo: 1, clientTempId: bill, locationId: branch,
    commandId: key, idempotencyKey: key });
  const submit = (key: string, generation: number) => `${identity}select public.sync_rubber_bill('${payload(key, generation)}'::jsonb);`;
  try {
    sql(`begin;insert into public.locations(id,name,code,is_active) values('${branch}','Command race','CR${branch.slice(0,6)}',true);
      insert into public.profiles(id,phone,name,role,is_active,can_access_super_admin_features)
      values('${actor}','${Date.now().toString().slice(-10)}','Command race manager','admin',true,true);
      insert into public.user_locations(user_id,location_id,is_primary) values('${actor}','${branch}',true);
      insert into public.rubber_bills(id,client_temp_id,local_bill_no,server_bill_no,idempotency_key,sync_status,record_status,
      location_id,bill_no,bill_date,customer_name,bill_type,weight,rubber_value,average_price,deduction_total,net_total,revision_no,
      created_at,created_by_user_id,created_by_name,created_by_phone)
      values('${bill}','${bill}','CRL','CRS','original:${bill}','synced','active','${branch}','CRS',current_date-2,'Race fixture','weighing',
      100,3800,38,0,3800,1,'2000-01-01','${actor}','Command race manager','0000000000');commit;`);
    const race = await Promise.all([run("docker", [...base, submit(crypto.randomUUID(), 0)]), run("docker", [...base, submit(crypto.randomUUID(), 0)])]);
    const results = race.map((entry) => JSON.parse(entry.stdout.trim().split("\n").at(-1)!));
    expect(results.map((entry) => entry.status).sort()).toEqual(["conflict", "pending_approval"]);
    expect(results.find((entry) => entry.status === "conflict").errorCode).toBe("STALE_COMMAND_CONTEXT");
    expect(sql(`select count(*) from public.rubber_bill_approval_requests where location_id='${branch}' and request_status='pending'`)).toBe("1");
    const pending = results.find((entry) => entry.status === "pending_approval").requestId;
    const approvalRace = await Promise.allSettled([
      run("docker", [...base, `${identity}select public.approve_rubber_bill_approval_request('${pending}');`]),
      run("docker", [...base, submit(crypto.randomUUID(), 1)]),
    ]);
    expect(approvalRace.some((entry) => entry.status === "fulfilled")).toBe(true);
    const active = sql(`select record_status from public.rubber_bills where id='${bill}'`);
    const pendingCount = sql(`select count(*) from public.rubber_bill_approval_requests where location_id='${branch}' and request_status='pending'`);
    expect(active === "deleted" ? pendingCount === "0" : pendingCount === "1").toBe(true);
  } finally {
    sql(`begin;set local app.history_retention_cleanup='on';
      delete from public.rubber_bill_approval_requests where location_id='${branch}';
      delete from public.rubber_bill_items where bill_id='${bill}';delete from public.rubber_bills where location_id='${branch}';
      set constraints all immediate;
      delete from public.dashboard_money_events where location_id='${branch}';
      delete from public.dashboard_branch_snapshots where location_id='${branch}';
      delete from public.document_deletion_audits where location_id='${branch}';
      delete from public.user_locations where location_id='${branch}';delete from public.profiles where id='${actor}';
      delete from public.locations where id='${branch}';commit;`);
  }
});
