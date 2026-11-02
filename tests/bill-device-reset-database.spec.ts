import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { RESET_TEST_CONTAINER, resetTestEnvironment, resetTestSql, restoreResetSeedActor } from "./support/bill-device-reset-target";

const execute = promisify(execFile), actor = crypto.randomUUID(), branch = crypto.randomUUID(), otherBranch = crypto.randomUUID();
const auth = `select set_config('request.jwt.claim.sub','${actor}',true);`;
const json = (output: string) => JSON.parse(output.split(/\r?\n/).filter(line => line.startsWith("{")).at(-1)!);
const run = async (statement: string) => (await execute("docker", ["exec", RESET_TEST_CONTAINER, "psql", "-X", "-q", "-At",
  "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", `begin;${auth}${statement};commit;`], { windowsHide: true })).stdout.trim();
const preview = () => json(resetTestSql(`begin;${auth}select public.preview_bill_device_reset();commit;`));
const register = (installation = crypto.randomUUID(), generation = crypto.randomUUID(), location = branch) =>
  run(`select public.register_rubber_bill_issuer('${location}','${installation}','${generation}')`).then(json);
const reset = (snapshot: string, id = crypto.randomUUID()) =>
  run(`select public.reset_all_bill_devices('${id}','${snapshot}','รีเซ็ตทั้งหมด','clear_registry_v1')`).then(json);
async function waitForGate() {
  await expect(async () => {
    expect(resetTestSql("select pg_try_advisory_xact_lock(hashtextextended('bill-issuer-registry',0));")).toBe("f");
  }).toPass({ timeout: 2000, intervals: [30] });
}
test.beforeAll(() => {
  resetTestEnvironment();
  resetTestSql(`update public.profiles set role='admin' where role='super_admin';
    insert into public.profiles(id,phone,name,role,is_active) values('${actor}','${actor}','Reset concurrency','super_admin',true);
    insert into public.locations(id,name,code,is_active) values
      ('${branch}','Reset concurrency ${branch}','R${branch.slice(0,7)}',true),
      ('${otherBranch}','Reset other ${otherBranch}','R${otherBranch.slice(0,7)}',true);`);
});
test.afterAll(() => {
  resetTestSql(`delete from private.bill_device_reset_receipts where actor_user_id='${actor}';
    delete from private.rubber_bill_issuer_heads where location_id in ('${branch}','${otherBranch}');
    delete from private.rubber_bill_issuers where location_id in ('${branch}','${otherBranch}');
    delete from private.bill_issuer_device_heads h using private.bill_issuer_devices d where h.device_id=d.id
      and not exists(select 1 from private.rubber_bill_issuers i where i.device_id=d.id);
    delete from private.bill_issuer_devices d where not exists(select 1 from private.rubber_bill_issuers i where i.device_id=d.id);
    delete from private.rubber_bill_issuer_counters where location_id in ('${branch}','${otherBranch}');
    delete from public.user_locations where user_id='${actor}'; delete from public.profiles where id='${actor}';
    delete from public.locations where id in ('${branch}','${otherBranch}');`);
  restoreResetSeedActor();
});
test("two reset confirmations from one preview retire once; same-request replay preserves replacements", async () => {
  const installation = crypto.randomUUID(), generation = crypto.randomUUID(); const old = await register(installation, generation);
  const before = preview(), request = crypto.randomUUID();
  const results = await Promise.all([reset(before.snapshot, request), reset(before.snapshot, request)]);
  expect(results[0]).toEqual(results[1]); expect(results[0].retiredCount).toBe(before.count);
  const replacement = await register(installation, generation);
  expect(replacement.code).toBe("D01"); expect(replacement.registryEpoch).toBeGreaterThan(old.registryEpoch);
  expect(await reset(before.snapshot, request)).toEqual(results[0]);
  expect(resetTestSql(`select retired_at is null from private.bill_issuer_devices where id='${replacement.deviceId}'`)).toBe("t");
});

test("number validation holds the registry gate until the old registration can become a proof", async () => {
  const issuer = await register(), before = preview();
  const payload = JSON.stringify({ operation: "create", clientTempId: "reset-concurrent-offline", locationId: branch,
    txDate: "2026-11-02", type: "expense", billOption: "ค่าใช้จ่าย", localBillNo: `E-0001-261102-${issuer.code}`,
    billNumbering: { version: 1, issuerId: issuer.id, date: "2026-11-02", sequence: 1 } });
  const checking = run(`select private.assert_income_expense_numbering('${payload}'::jsonb);select pg_sleep(1)`);
  await waitForGate(); const resetting = reset(before.snapshot);
  await checking; expect((await resetting).retiredCount).toBe(before.count);
  expect(resetTestSql(`select count(*) from private.rubber_bill_issuers where id='${issuer.id}'`)).toBe("0");
  await run(`select private.assert_income_expense_numbering('${payload}'::jsonb)`);
});
test("two different requests from the same snapshot produce one success and one conflict", async () => {
  await register(); const before = preview();
  const outcomes = await Promise.allSettled([reset(before.snapshot), reset(before.snapshot)]);
  expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(String((outcomes.find(result => result.status === "rejected") as PromiseRejectedResult).reason)).toContain("BILL_DEVICE_RESET_CONFLICT");
});
test("register waits behind reset and cannot add an active branch link under the retired device", async () => {
  const installation = crypto.randomUUID(), generation = crypto.randomUUID(); const old = await register(installation, generation);
  const before = preview();
  const resetting = run(`select pg_advisory_xact_lock(hashtextextended('bill-issuer-registry',0));
    select public.reset_all_bill_devices('${crypto.randomUUID()}','${before.snapshot}','รีเซ็ตทั้งหมด','clear_registry_v1');select pg_sleep(1)`);
  await waitForGate();
  const registering = register(installation, generation, otherBranch);
  await resetting; const replacement = await registering;
  expect(replacement.deviceId).not.toBe(old.deviceId);
  expect(resetTestSql(`select count(*) from private.rubber_bill_issuers i join private.bill_issuer_devices d on d.id=i.device_id
    where i.retired_at is null and d.retired_at is not null`)).toBe("0");
});
test("registration already holding shared gate commits before reset validates snapshot", async () => {
  const before = preview();
  const registering = run(`select public.register_rubber_bill_issuer('${branch}','${crypto.randomUUID()}','${crypto.randomUUID()}');select pg_sleep(1)`);
  await waitForGate(); const resetting = expect(reset(before.snapshot)).rejects.toThrow("BILL_DEVICE_RESET_CONFLICT");
  await registering; await resetting;
});
test("individual retirement and bulk reset serialize without deadlock", async () => {
  const issuer = await register(), before = preview();
  const outcomes = await Promise.allSettled([reset(before.snapshot), run(`select public.retire_rubber_bill_issuer('${issuer.id}')`)]);
  if (outcomes[1].status === "rejected") expect(String(outcomes[1].reason)).toContain("ISSUER_NOT_FOUND");
  if (outcomes[0].status === "rejected") expect(String(outcomes[0].reason)).toContain("BILL_DEVICE_RESET_CONFLICT");
  expect(resetTestSql(`select count(*) from private.bill_issuer_devices where id='${issuer.deviceId}'`)).toBe("0");
});
test("bounded lock timeout leaves registry and receipt untouched", async () => {
  await register(); const before = preview(), request = crypto.randomUUID();
  const holding = run("select pg_advisory_xact_lock(hashtextextended('bill-issuer-registry',0));select pg_sleep(4.2)");
  await waitForGate(); await expect(reset(before.snapshot, request)).rejects.toThrow("lock timeout"); await holding;
  expect(preview()).toEqual(before);
  expect(resetTestSql(`select count(*) from private.bill_device_reset_receipts where request_id='${request}'`)).toBe("0");
});
