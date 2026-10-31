import { expect, test } from "@playwright/test";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";

const run = promisify(execFile);
const branch = "a7310000-0000-4000-8000-000000000001";
const actor = "a7310000-0000-4000-8000-000000000002";
const employee = "a7310000-0000-4000-8000-000000000003";
const source = "a7310000-0000-4000-8000-000000000004";
const args = ["exec", "supabase_db_webapp", "psql", "-U", "postgres", "-d", "postgres", "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c"];
const sql = (query: string) => execFileSync("docker", [...args, query], { encoding: "utf8" }).trim();
const identity = (id = actor) => `select set_config('request.jwt.claim.sub','${id}',false);`;
const command = (query: string) => run("docker", [...args, identity() + query]);
const jsonResult = (output: string) => JSON.parse(output.trim().split("\n").findLast((line) => line.startsWith("{"))!);

async function waitForSleep(application: string) {
  for (let i = 0; i < 100; i++) {
    if (sql(`select count(*) from pg_stat_activity where application_name='${application}' and wait_event='PgSleep'`) === "1") return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Transaction ${application} never reached its locked barrier`);
}

function setupFixture(second = false) {
  const fixture = readFileSync("supabase/tests/time_payroll_adjustment_delete_test.sql", "utf8");
  const setup = fixture.slice(fixture.indexOf("insert into public.locations"), fixture.indexOf("select extensions.lives_ok"));
  sql(`begin;${second ? setup.replaceAll("a7310000", "a7320000").replaceAll("0899931", "0899932").replaceAll("ADJDEL31", "ADJDEL32").replace("Adjustment deletion test", "Adjustment second branch test") : setup}commit;`);
}

function cleanupFixture(second = false) {
    const cleanup = `begin;delete from public.report_items where location_id='${branch}';
      delete from public.report_batches where location_id='${branch}';
      select set_config('app.time_tracking_permanent_delete_rpc','true',true);
      delete from public.payroll_slips where profile_id='${employee}';
      delete from public.financial_transactions where profile_id='${employee}';
      delete from public.time_tracking_audit_logs where admin_id in('${actor}','${employee}','a7310000-0000-4000-8000-000000000009');
      delete from public.document_deletion_audits where location_id='${branch}';
      set constraints all immediate;
      delete from public.dashboard_money_events where location_id='${branch}';
      delete from public.dashboard_branch_snapshots where location_id='${branch}';
      delete from public.user_locations where user_id='${employee}';
      delete from public.profiles where id in('${actor}','${employee}','a7310000-0000-4000-8000-000000000009');
      delete from private.document_number_counters where location_id='${branch}';
      delete from public.locations where id='${branch}';commit;`;
    sql(second ? cleanup.replaceAll("a7310000", "a7320000") : cleanup);
}

test("real report, approval and repeated-delete connections preserve the latest adjustment boundary", async () => {
  test.setTimeout(60_000);
  setupFixture();
  try {
    const first = jsonResult(sql(`${identity()}select public.request_time_tracking_withdrawal_adjustment('${source}',1500,'${branch}','concurrency branch');`));
    const report = command(`set application_name='adjustment-race-report';begin;
      select private.lock_report_locations(array['${branch}']::uuid[]);select pg_sleep(1);
      select public.create_report_batch('${branch}');commit;`);
    await waitForSleep("adjustment-race-report");
    const rejectedDelete = command(`select public.delete_time_tracking_source_permanently('transaction','${first.id}');`);
    const outcomes = await Promise.allSettled([report, rejectedDelete]);
    expect(outcomes[0].status).toBe("fulfilled");
    expect(outcomes[1].status).toBe("rejected");
    if (outcomes[1].status === "rejected") expect(String(outcomes[1].reason)).toContain("REPORT_LOCKED:");
    expect(sql(`select count(*) from public.financial_transactions where id='${first.id}'`)).toBe("1");
    if (outcomes[0].status !== "fulfilled") throw new Error("report failed");
    const reportId = jsonResult(outcomes[0].value.stdout).id;
    sql(`${identity()}select public.delete_report_batch('${reportId}');`);
    // Approval commits a newer target while a stale client attempts to delete the prior one.
    const pending = jsonResult(sql(`${identity(employee)}select public.request_time_tracking_withdrawal_adjustment('${source}',1200,null,'pending race');`));
    const approval = command(`set application_name='adjustment-race-approval';begin;
      select pg_advisory_xact_lock(hashtextextended('time-tracking:${employee}',0));
      select public.decide_time_tracking_withdrawal_adjustment('${pending.id}','APPROVED',null,null);
      select pg_sleep(1);commit;`);
    await waitForSleep("adjustment-race-approval");
    const stale = command(`select public.delete_time_tracking_source_permanently('transaction','${first.id}');`);
    const approved = await Promise.allSettled([approval, stale]);
    expect(approved[0].status).toBe("fulfilled");
    expect(approved[1].status).toBe("rejected");
    if (approved[1].status === "rejected") expect(String(approved[1].reason)).toContain("ADJUSTMENT_NOT_LATEST");
    const deletes = await Promise.allSettled([1, 2].map(() => command(`select public.delete_time_tracking_source_permanently('transaction','${pending.id}');`)));
    expect(deletes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(Number(sql(`select private.latest_withdrawal_target('${source}')`))).toBe(1500);
    expect(sql(`select count(*) from public.financial_transactions where id='${first.id}'`)).toBe("1");
    const newRequest = run("docker", [...args, `${identity(employee)}set application_name='adjustment-race-request';begin;
      select pg_advisory_xact_lock(hashtextextended('time-tracking:${employee}',0));
      select public.request_time_tracking_withdrawal_adjustment('${source}',1400,null,'new pending race');
      select pg_sleep(1);commit;`]);
    await waitForSleep("adjustment-race-request");
    const deletingBase = command(`select public.delete_time_tracking_source_permanently('transaction','${first.id}');`);
    const requested = await Promise.allSettled([newRequest, deletingBase]);
    expect(requested[0].status).toBe("fulfilled");
    expect(requested[1].status).toBe("rejected");
    if (requested[1].status === "rejected") expect(String(requested[1].reason)).toContain("ADJUSTMENT_PENDING_EXISTS");
    const pendingId = sql(`select id from public.financial_transactions where parent_debt_id='${source}' and type='ADJUSTMENT' and status='PENDING'`);
    sql(`${identity(employee)}select public.withdraw_time_tracking_withdrawal_adjustment('${pendingId}');`);
    const outside = jsonResult(sql(`${identity()}select public.request_time_tracking_withdrawal_adjustment('${source}',1600,null,'permission race');`));
    const revokedActor = "a7310000-0000-4000-8000-000000000009";
    sql(`insert into public.profiles(id,phone,name,role,can_access_super_admin_features) values('${revokedActor}','0899931009','Revoked manager','admin',true);`);
    const revoke = command(`set application_name='adjustment-race-permission';begin;
      select pg_advisory_xact_lock(hashtextextended('time-tracking:${employee}',0));
      update public.profiles set can_access_super_admin_features=false,can_manage_time_payroll=false where id='${revokedActor}';
      select pg_sleep(1);commit;`);
    await waitForSleep("adjustment-race-permission");
    const revokedDelete = run("docker", [...args, `${identity(revokedActor)}select public.delete_time_tracking_source_permanently('transaction','${outside.id}');`]);
    const revoked = await Promise.allSettled([revoke, revokedDelete]);
    expect(revoked[0].status).toBe("fulfilled");
    expect(revoked[1].status).toBe("rejected");
    if (revoked[1].status === "rejected") expect(String(revoked[1].reason)).toContain("Forbidden");
    sql(`update public.profiles set can_access_super_admin_features=true where id='${revokedActor}';`);
    const approvalRequest = jsonResult(sql(`${identity(employee)}select public.request_time_tracking_withdrawal_adjustment('${source}',1700,null,'revoked approval race');`));
    const revokeApproval = command(`set application_name='adjustment-race-approval-permission';begin;
      select pg_advisory_xact_lock(hashtextextended('time-tracking:${employee}',0));
      update public.profiles set can_access_super_admin_features=false,can_manage_time_payroll=false where id='${revokedActor}';
      select pg_sleep(1);commit;`);
    await waitForSleep("adjustment-race-approval-permission");
    const revokedApproval = run("docker", [...args, `${identity(revokedActor)}select public.decide_time_tracking_withdrawal_adjustment('${approvalRequest.id}','APPROVED',null,null);`]);
    const approvalPermission = await Promise.allSettled([revokeApproval, revokedApproval]);
    expect(approvalPermission[0].status).toBe("fulfilled");
    expect(approvalPermission[1].status).toBe("rejected");
    if (approvalPermission[1].status === "rejected") expect(String(approvalPermission[1].reason)).toContain("Forbidden");
    expect(sql(`select status from public.financial_transactions where id='${approvalRequest.id}'`)).toBe("PENDING");
    sql(`update public.profiles set can_access_super_admin_features=true where id='${revokedActor}';`);
    const deactivate = command(`set application_name='adjustment-race-inactive-approval';begin;
      select pg_advisory_xact_lock(hashtextextended('time-tracking:${employee}',0));
      update public.profiles set is_active=false where id='${revokedActor}';select pg_sleep(1);commit;`);
    await waitForSleep("adjustment-race-inactive-approval");
    const inactiveApproval = run("docker", [...args, `${identity(revokedActor)}select public.decide_time_tracking_withdrawal_adjustment('${approvalRequest.id}','APPROVED',null,null);`]);
    const inactive = await Promise.allSettled([deactivate, inactiveApproval]);
    expect(inactive[0].status).toBe("fulfilled");
    expect(inactive[1].status).toBe("rejected");
    if (inactive[1].status === "rejected") expect(String(inactive[1].reason)).toContain("Authentication required");
    expect(sql(`select status from public.financial_transactions where id='${approvalRequest.id}'`)).toBe("PENDING");


  } finally {
    cleanupFixture();
  }
});

for (const target of [0, 1500]) test(`a slip created by an older transaction snapshots the ${target} adjustment approved before its lock`, async () => {
  test.setTimeout(20_000);
  setupFixture();
  try {
    const creating = command(`set application_name='adjustment-slip-old-transaction';begin;
      select pg_sleep(2);
      select public.create_time_tracking_payroll_slip('${employee}',to_char(now() at time zone 'Asia/Bangkok','YYYY-MM'),false,null,null,0);commit;`);
    await waitForSleep("adjustment-slip-old-transaction");
    const adjustment = jsonResult(sql(`${identity()}select public.request_time_tracking_withdrawal_adjustment('${source}',${target},null,'approved before slip builds');`));
    await creating;
    const slip = jsonResult(sql(`select jsonb_build_object('data',slip_data,'createdAfterApproval',created_at >= (select approved_at from public.financial_transactions where id='${adjustment.id}')) from public.payroll_slips where profile_id='${employee}'`));
    expect(slip.data.outstandingAdjustments.remainingAfterDeductions).toBe(target);
    expect(slip.createdAfterApproval).toBe(true);
    expect(sql(`select count(*) from private.withdrawal_adjustment_blocking_slip('${adjustment.id}')`)).toBe("1");
    await expect(command(`select public.delete_time_tracking_source_permanently('transaction','${adjustment.id}');`)).rejects.toThrow("MONTH_CLOSED:");
    expect(Number(sql(`select private.latest_withdrawal_target('${source}')`))).toBe(target);
  } finally {
    cleanupFixture();
  }
});

for (const action of ["request", "approve"] as const) test(`cross-branch ${action} locks all affected locations in one order`, async () => {
  test.setTimeout(20_000);
  setupFixture();
  try {
    setupFixture(true);
    const secondSource = source.replace("a7310000", "a7320000");
    const secondBranch = branch.replace("a7310000", "a7320000");
    const ids = action === "approve" ? [source, secondSource].map((withdrawal) => jsonResult(sql(
      `${identity(withdrawal === source ? employee : employee.replace("a7310000", "a7320000"))}select public.request_time_tracking_withdrawal_adjustment('${withdrawal}',1200,null,'cross-branch pending');`,
    )).id) : [];
    // Test-only scheduling barrier: both connections reach the adjustment write
    // before either rebuilds the source. No production trigger is changed.
    sql(`create function private.adjustment_cross_branch_test_barrier() returns trigger language plpgsql as $$begin
      if new.type='ADJUSTMENT' and new.profile_id in ('${employee}','${employee.replace("a7310000", "a7320000")}') then perform pg_sleep(0.7);end if;return new;end$$;
      create trigger adjustment_cross_branch_test_barrier before ${action === "request" ? "insert" : "update"} on public.financial_transactions
      for each row execute function private.adjustment_cross_branch_test_barrier();`);
    const outcomes = await Promise.allSettled([source, secondSource].map((withdrawal, i) => command(action === "request"
      ? `select public.request_time_tracking_withdrawal_adjustment('${withdrawal}',1200,'${i === 0 ? secondBranch : branch}','cross-branch');`
      : `select public.decide_time_tracking_withdrawal_adjustment('${ids[i]}','APPROVED','${i === 0 ? secondBranch : branch}',null);`)));
    expect(outcomes.map((item) => item.status), outcomes.map((item) => item.status === "rejected" ? String(item.reason) : "ok").join("\n")).toEqual(["fulfilled", "fulfilled"]);
    for (const withdrawal of [source, secondSource]) expect(Number(sql(`select private.latest_withdrawal_target('${withdrawal}')`))).toBe(1200);
  } finally {
    sql("drop trigger if exists adjustment_cross_branch_test_barrier on public.financial_transactions;drop function if exists private.adjustment_cross_branch_test_barrier();");
    // Both employees can reference either payer branch; release both sets of
    // transactions before removing either location.
    sql(`begin;delete from public.report_items where location_id in ('${branch}','${branch.replace("a7310000", "a7320000")}');
      select set_config('app.time_tracking_permanent_delete_rpc','true',true);
      delete from public.financial_transactions where profile_id in ('${employee}','${employee.replace("a7310000", "a7320000")}');commit;`);
    cleanupFixture(true);
    cleanupFixture();
  }
});

for (const mutation of ["deactivate", "unlock-report"] as const) test(`pending request rechecks ${mutation} after waiting for the employee fence`, async () => {
  test.setTimeout(20_000);
  setupFixture();
  try {
    const change = mutation === "deactivate"
      ? `update public.profiles set is_active=false where id='${employee}';`
      : "select public.delete_report_batch('a7310000-0000-4000-8000-000000000005');";
    const blocker = command(`set application_name='adjustment-request-state-race';begin;
      select pg_advisory_xact_lock(hashtextextended('time-tracking:${employee}',0));
      ${change}select pg_sleep(1);commit;`);
    await waitForSleep("adjustment-request-state-race");
    const request = run("docker", [...args, `${identity(employee)}select public.request_time_tracking_withdrawal_adjustment('${source}',1200,null,'state race');`]);
    const outcomes = await Promise.allSettled([blocker, request]);
    expect(outcomes[0].status).toBe("fulfilled");
    expect(outcomes[1].status).toBe("rejected");
    if (outcomes[1].status === "rejected") expect(String(outcomes[1].reason)).toContain(
      mutation === "deactivate" ? "Authentication required" : "WITHDRAWAL_NOT_REPORT_LOCKED",
    );
    expect(sql(`select count(*) from public.financial_transactions where parent_debt_id='${source}' and type='ADJUSTMENT'`)).toBe("0");
  } finally {
    cleanupFixture();
  }
});

test("pending withdrawal rechecks the employee account after waiting for its row", async () => {
  test.setTimeout(20_000);
  setupFixture();
  try {
    const pending = jsonResult(sql(`${identity(employee)}select public.request_time_tracking_withdrawal_adjustment('${source}',1200,null,'withdrawal account race');`));
    const blocker = command(`set application_name='adjustment-withdraw-account-race';begin;
      select id from public.financial_transactions where id='${pending.id}' for update;
      update public.profiles set is_active=false where id='${employee}';select pg_sleep(3);commit;`);
    await waitForSleep("adjustment-withdraw-account-race");
    const withdrawal = run("docker", [...args, `${identity(employee)}set application_name='adjustment-withdraw-account-waiter';select public.withdraw_time_tracking_withdrawal_adjustment('${pending.id}');`]);
    let waitedForRow = false;
    for (let i = 0; i < 50; i++) {
      if (sql("select count(*) from pg_stat_activity where application_name='adjustment-withdraw-account-waiter' and wait_event_type='Lock'") === "1") {
        waitedForRow = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const outcomes = await Promise.allSettled([blocker, withdrawal]);
    expect(waitedForRow, "The request must pass initial auth and wait for the locked adjustment row").toBe(true);
    expect(outcomes[0].status).toBe("fulfilled");
    expect(outcomes[1].status).toBe("rejected");
    if (outcomes[1].status === "rejected") expect(String(outcomes[1].reason)).toContain("Authentication required");
    expect(sql(`select status from public.financial_transactions where id='${pending.id}'`)).toBe("PENDING");
  } finally {
    cleanupFixture();
  }
});

for (const settlement of ["outside", "branch"] as const) test(`a transaction started earlier still makes its later ${settlement} approval the effective latest target`, async () => {
  test.setTimeout(20_000);
  setupFixture();
  try {
    const payer = settlement === "branch" ? `'${branch}'` : "null";
    const olderTransaction = command(`set application_name='adjustment-old-transaction';begin;
      select pg_sleep(2);
      select public.request_time_tracking_withdrawal_adjustment('${source}',1200,${payer},'later approval from older transaction');commit;`);
    await waitForSleep("adjustment-old-transaction");
    const first = jsonResult(sql(`${identity()}select public.request_time_tracking_withdrawal_adjustment('${source}',1500,${payer},'first approval');`));
    const later = jsonResult((await olderTransaction).stdout);
    expect(Number(sql(`select adjustment_base_amount from public.financial_transactions where id='${later.id}'`))).toBe(1500);
    expect(Number(sql(`select private.latest_withdrawal_target('${source}')`))).toBe(1200);
    expect(sql(`${identity()}select public.get_withdrawal_adjustment_summaries('${employee}')->0->>'latestApprovedAdjustmentId'`).split("\n").at(-1)).toBe(later.id);
    expect(sql(`select later.approved_at > earlier.approved_at from public.financial_transactions later,public.financial_transactions earlier where later.id='${later.id}' and earlier.id='${first.id}'`)).toBe("t");
    if (settlement === "branch") {
      expect(sql(`select payload->>'direction' from private.dashboard_money_event_projection where source_id='${later.id}'`)).toBe("income");
      expect(Number(sql(`select payload->>'amount' from private.dashboard_money_event_projection where source_id='${later.id}'`))).toBe(300);
    }
    sql(`${identity()}select public.delete_time_tracking_source_permanently('transaction','${later.id}');`);
    expect(Number(sql(`select private.latest_withdrawal_target('${source}')`))).toBe(1500);
    expect(sql(`${identity()}select public.get_withdrawal_adjustment_summaries('${employee}')->0->>'latestApprovedAdjustmentId'`).split("\n").at(-1)).toBe(first.id);
  } finally {
    cleanupFixture();
  }
});

for (const mutation of ["deactivate", "revoke-scope"] as const) test(`deletion rechecks ${mutation} after waiting for a report branch`, async () => {
  test.setTimeout(20_000);
  setupFixture();
  try {
    const adjustment = jsonResult(sql(`${identity()}select public.request_time_tracking_withdrawal_adjustment('${source}',1500,null,'branch permission wait');`));
    const manager = "a7310000-0000-4000-8000-000000000009";
    sql(`insert into public.profiles(id,phone,name,role,can_access_super_admin_features) values('${manager}','0899931009','Branch-wait manager','admin',true);`);
    const change = mutation === "deactivate" ? "is_active=false" : "can_access_super_admin_features=false,can_manage_time_payroll=false";
    const blocker = command(`set application_name='adjustment-delete-branch-blocker';begin;
      select private.lock_report_locations(array['${branch}']::uuid[]);
      update public.profiles set ${change} where id='${manager}';select pg_sleep(3);commit;`);
    await waitForSleep("adjustment-delete-branch-blocker");
    const deleting = run("docker", [...args, `${identity(manager)}set application_name='adjustment-delete-branch-waiter';select public.delete_time_tracking_source_permanently('transaction','${adjustment.id}');`]);
    let waitedForBranch = false;
    for (let i = 0; i < 50; i++) {
      if (sql("select count(*) from pg_stat_activity where application_name='adjustment-delete-branch-waiter' and wait_event_type='Lock' and wait_event='advisory'") === "1") {
        waitedForBranch = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const outcomes = await Promise.allSettled([blocker, deleting]);
    expect(waitedForBranch, "The actor must pass the employee fence and wait on the branch fence").toBe(true);
    expect(outcomes[0].status).toBe("fulfilled");
    expect(outcomes[1].status).toBe("rejected");
    if (outcomes[1].status === "rejected") expect(String(outcomes[1].reason)).toContain(mutation === "deactivate" ? "Authentication required" : "Forbidden");
    expect(sql(`select count(*) from public.financial_transactions where id='${adjustment.id}'`)).toBe("1");
    expect(Number(sql(`select private.latest_withdrawal_target('${source}')`))).toBe(1500);
  } finally {
    cleanupFixture();
  }
});
