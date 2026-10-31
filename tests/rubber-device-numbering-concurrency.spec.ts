import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
async function sql(statement: string) {
  const result = await execute("docker", ["exec", "supabase_db_webapp", "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", statement], { windowsHide: true });
  return result.stdout.trim();
}
const literal = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
test("concurrent public business creates with one base get distinct suffixes; exact retries preserve the final", async () => {
  test.setTimeout(40000);
  const actor = crypto.randomUUID(), location = crypto.randomUUID(), installation = crypto.randomUUID(), generation = crypto.randomUUID();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
  const base = `0001-${date.slice(2).replaceAll("-", "")}-D01`, timestamp = new Date().toISOString();
  const auth = `select set_config('request.jwt.claim.sub','${actor}',true);`;
  try {
    await sql(`insert into auth.users(id,aud,role) values('${actor}','authenticated','authenticated');
      insert into public.locations(id,name,code,is_active) values('${location}','Numbering concurrency','NC${location.slice(0,6)}',true);
      insert into public.profiles(id,phone,name,role,is_active,can_access_super_admin_features) values('${actor}','${actor}','Numbering concurrency','admin',true,true);
      insert into public.user_locations(user_id,location_id,is_primary) values('${actor}','${location}',true);`);
    const registration = await sql(`begin;${auth} select public.register_rubber_bill_issuer('${location}','${installation}','${generation}');commit;`);
    const issuer = JSON.parse(registration.split(/\r?\n/).find(line => line.startsWith("{"))!);
    const register = async (installationId: string, generationId: string) => {
      const output = await sql(`begin;${auth} select public.register_rubber_bill_issuer('${location}','${installationId}','${generationId}');commit;`);
      return JSON.parse(output.split(/\r?\n/).find(line => line.startsWith("{"))!);
    };
    const repeated = await Promise.all(Array.from({ length: 4 }, () => register(installation, generation)));
    expect(repeated.map(row => row.id)).toEqual(Array(4).fill(issuer.id));
    const independent = await Promise.all(Array.from({ length: 4 }, () => register(crypto.randomUUID(), crypto.randomUUID())));
    expect(new Set(independent.map(row => row.id)).size).toBe(4);
    expect(independent.map(row => row.code).sort()).toEqual(["D02", "D03", "D04", "D05"]);
    const payload = (id: string) => ({ operation: "create", formulaVersion: 2, expectedRevisionNo: 0,
      clientTempId: id, idempotencyKey: id, locationId: location, localBillNo: base, billDate: date,
      billType: "weighing", customerName: "Numbering concurrency", deductWeight: 0, acidPackCount: 0,
      createdByUserId: actor, createdByName: "Numbering concurrency", createdByPhone: actor,
      clientCreatedAt: timestamp, clientRecordedAt: timestamp,
      billNumbering: { version: 1, issuerId: issuer.id, date, sequence: 1 },
      items: [{ itemType: "weigh", title: "1", inWeight: 10, outWeight: 0, netWeight: 10, unitPrice: 1, totalAmount: 10, sequenceNo: 1 }] });
    const inputs = Array.from({ length: 6 }, () => payload(crypto.randomUUID()));
    const run = async (value: object) => {
      const output = await sql(`begin;${auth} select public.sync_numbered_rubber_bill(${literal(value)});commit;`);
      return JSON.parse(output.split(/\r?\n/).find(line => line.startsWith("{"))!);
    };
    const results = await Promise.all(inputs.map(run));
    expect(results.map(r => r.status)).toEqual(Array(6).fill("synced"));
    expect(new Set(results.map(r => r.serverBillNo)).size).toBe(6);
    expect(results.map(r => r.serverBillNo).sort()).toEqual(Array.from({ length: 6 }, (_, i) => `${base}-${i+1}`));
    const retries = await Promise.all([run(inputs[0]), run(inputs[0])]);
    expect(retries.map(r => r.serverBillNo)).toEqual([results[0].serverBillNo, results[0].serverBillNo]);
    expect(await sql(`select count(*) from public.rubber_bills where location_id='${location}'`)).toBe("6");
  } finally {
    await sql(`delete from public.rubber_bills where location_id='${location}';`);
    await sql(`delete from private.rubber_bill_number_bindings where location_id='${location}';
      delete from private.rubber_bill_suffix_counters where location_id='${location}';
      delete from private.rubber_bill_issuer_heads where location_id='${location}';
      delete from private.rubber_bill_issuers where location_id='${location}';
      delete from private.rubber_bill_issuer_counters where location_id='${location}';
      delete from auth.users where id='${actor}';delete from public.locations where id='${location}';`);
  }
});
