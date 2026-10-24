import { expect, test } from "@playwright/test";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const branch = "cc240000-0000-4000-8000-000000000011";
const actor = "cc240000-0000-4000-8000-000000000012";
const otherActor = "cc240000-0000-4000-8000-000000000013";
const args = ["exec", "supabase_db_webapp", "psql", "-U", "postgres", "-d", "postgres", "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c"];
const sql = (text: string) => execFileSync("docker", [...args, text], { encoding: "utf8" }).trim();
const identity = `select set_config('request.jwt.claim.sub','${actor}',false);`;
test("branch fence serializes real concurrent connections and reads the committed baseline", async () => {
  test.setTimeout(20_000);
  sql(`begin;
    insert into public.locations(id,name,code) values('${branch}','Concurrent cash test','CCCON24');
    insert into public.profiles(id,phone,name,role,can_access_super_admin_features) values('${actor}','0899924012','Concurrent reviewer','admin',true);
    insert into public.profiles(id,phone,name,role,can_access_super_admin_features) values('${otherActor}','0899924013','Second reviewer','admin',true);
    insert into public.income_expense(local_bill_no,location_id,type,number,tx_date,title,cost,bill_option,created_by_user_id,created_by_name,created_by_phone,sync_status)
      values('CCCON24-I','${branch}','income',1,current_date,'test',100,'รายรับ','${actor}','Concurrent reviewer','0899924012','synced');commit;`);
  try {
    // A mutation already in progress commits first; start must observe its new total.
    const mutation = run("docker", [...args, `begin;update public.income_expense set cost=200 where local_bill_no='CCCON24-I';select pg_sleep(1);commit;`]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const count = run("docker", [...args, `${identity}select public.start_cash_count_session('${branch}');`]);
    const [, result] = await Promise.all([mutation, count]);
    const session = JSON.parse(result.stdout.trim().split("\n").at(-1)!).session;
    expect(session.systemBalance).toBe(200);
    // A different connection cannot mutate while this committed session is active.
    await expect(run("docker", [...args, "update public.income_expense set cost=300 where local_bill_no='CCCON24-I'" ]))
      .rejects.toThrow(/CASH_COUNT_ACTIVE/);
    // The fence is time based even before anyone refreshes the session status.
    sql(`update public.cash_count_sessions set cutoff_at=now()-interval '31 minutes',expires_at=now()-interval '1 minute' where id='${session.id}';`);
    expect(sql("update public.income_expense set cost=300 where local_bill_no='CCCON24-I' returning cost")).toContain("300.00");
    const next = JSON.parse(sql(`${identity}select public.start_cash_count_session('${branch}');`).split("\n").at(-1)!).session;
    const counts = JSON.stringify({ "1000": 0, "500": 0, "100": 0, "50": 0, "20": 0, "10": 0, "5": 0, "2": 0, "1": 0 });
    const saved = JSON.parse(sql(`${identity}select public.submit_cash_count_v2('${next.id}','${counts}',null);`).split("\n").at(-1)!);
    const checkFirst = `${identity}select public.check_cash_count('${saved.id}');`;
    const checkSecond = `select set_config('request.jwt.claim.sub','${otherActor}',false);select public.check_cash_count('${saved.id}');`;
    await Promise.all([run("docker", [...args, checkFirst]), run("docker", [...args, checkSecond])]);
    const winner = sql(`select checked_by_name from public.cash_counts where id='${saved.id}'`);
    expect(["Concurrent reviewer", "Second reviewer"]).toContain(winner);
    sql(checkSecond); expect(sql(`select checked_by_name from public.cash_counts where id='${saved.id}'`)).toBe(winner);
    const racing = await Promise.allSettled([run("docker", [...args, checkFirst]), run("docker", [...args, `${identity}select public.delete_cash_count('${saved.id}');`])]);
    expect(racing.some((result) => result.status === "fulfilled")).toBe(true);
    expect(sql(`select status from public.cash_counts where id='${saved.id}'`)).toBe("deleted");
  } finally {
    sql(`begin;update public.cash_count_sessions set status='cancelled',ended_at=now() where location_id='${branch}' and status='active';
      delete from public.cash_counts where location_id='${branch}';
      delete from public.document_deletion_audits where location_id='${branch}';
      delete from public.cash_count_sessions where location_id='${branch}';
      delete from public.income_expense where location_id='${branch}';
      set constraints all immediate;
      delete from public.dashboard_money_events where location_id='${branch}';
      delete from public.dashboard_branch_snapshots where location_id='${branch}';
      delete from public.profiles where id in('${actor}','${otherActor}');delete from public.locations where id='${branch}';commit;`);
  }
});
