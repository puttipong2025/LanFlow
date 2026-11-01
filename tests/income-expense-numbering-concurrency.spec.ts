import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
async function sql(statement: string) {
  const r = await execute("docker", ["exec", "supabase_db_webapp", "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", statement], { windowsHide: true });
  return r.stdout.trim();
}
const literal = (v: unknown) => `'${JSON.stringify(v).replaceAll("'", "''")}'::jsonb`;
test("concurrent numbered income business creates and exact replays keep one binding per identity", async () => {
  test.setTimeout(60000);
  const actor = crypto.randomUUID(), branch = crypto.randomUUID();
  const settings = JSON.parse(await sql("select to_jsonb(s) from public.income_expense_approval_settings s where id=true"));
  const auth = `select set_config('request.jwt.claim.sub','${actor}',true);`;
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
  try {
    await sql(`insert into public.locations(id,name,code,is_active) values('${branch}','IE concurrent','IC${branch.slice(0,6)}',true);
      insert into public.profiles(id,phone,name,role,is_active,can_access_super_admin_features) values('${actor}','${actor}','IE concurrent','admin',true,true);
      insert into public.user_locations(user_id,location_id,is_primary) values('${actor}','${branch}',true);
      update public.income_expense_approval_settings set approval_min_amount=null,non_current_date_requires_approval=false;`);
    const registration = await sql(`begin; ${auth} select public.register_rubber_bill_issuer('${branch}','${crypto.randomUUID()}','${crypto.randomUUID()}'); commit;`);
    const issuer = JSON.parse(registration.split(/\r?\n/).find(v => v.startsWith("{"))!);
    const payload = (id: string) => ({ operation: "create", expectedRevisionNo: 0, clientTempId: id, idempotencyKey: `create:${id}:0`,
      locationId: branch, localBillNo: `I-0001-${date.slice(2).replaceAll("-", "")}-${issuer.code}`, type: "income", txDate: date,
      billOption: "รายรับ", recordStatus: "active", title: crypto.randomUUID(), cost: 1,
      clientCreatedAt: new Date().toISOString(), clientRecordedAt: new Date().toISOString(), createdByUserId: actor,
      billNumbering: { version: 1, issuerId: issuer.id, date, sequence: 1 } });
    const inputs = Array.from({ length: 6 }, () => payload(crypto.randomUUID()));
    const run = async (p: object) => {
      const output = await sql(`begin; ${auth} set local role authenticated; select public.sync_numbered_income_expense(${literal(p)}); commit;`);
      return JSON.parse(output.split(/\r?\n/).find(v => v.startsWith("{"))!);
    };
    const result = await Promise.all(inputs.map(run));
    expect(result.map(v => v.status)).toEqual(Array(6).fill("synced"));
    expect(new Set(result.map(v => v.serverBillNo)).size).toBe(6);
    const replay = await Promise.all(Array.from({ length: 4 }, () => run(inputs[0])));
    expect(replay.map(v => v.serverBillNo)).toEqual(Array(4).fill(result[0].serverBillNo));
    expect(await sql(`select count(*) from public.income_expense where location_id='${branch}'`)).toBe("6");
  } finally {
    await sql(`begin; update public.income_expense_approval_settings set approval_min_amount=${settings.approval_min_amount ?? "null"},non_current_date_requires_approval=${settings.non_current_date_requires_approval};
      delete from public.income_expense where location_id='${branch}';
      set constraints all immediate;
      delete from private.income_expense_number_bindings where location_id='${branch}';
      delete from private.income_expense_suffix_counters where location_id='${branch}';
      delete from private.income_expense_create_receipts where location_id='${branch}';
      delete from private.rubber_bill_issuer_heads where location_id='${branch}';
      delete from private.rubber_bill_issuers where location_id='${branch}';
      delete from private.rubber_bill_issuer_counters where location_id='${branch}';
      delete from public.dashboard_money_events where location_id='${branch}'; delete from public.dashboard_branch_snapshots where location_id='${branch}';
      delete from public.user_locations where location_id='${branch}'; delete from public.profiles where id='${actor}'; delete from public.locations where id='${branch}'; commit;`);
  }
});
