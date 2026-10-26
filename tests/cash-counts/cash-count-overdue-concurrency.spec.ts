import { expect, test } from "@playwright/test";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
const branch = "cc261000-0000-4000-8000-000000000011";
const target = "cc261000-0000-4000-8000-000000000012";
const actor = "cc261000-0000-4000-8000-000000000001";
const args = ["exec", "supabase_db_webapp", "psql", "-U", "postgres", "-d", "postgres", "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c"];
const sql = (query: string) => execFileSync("docker", [...args, query], { encoding: "utf8" }).trim();
const identity = `select set_config('request.jwt.claim.sub','${actor}',false);`;
const command = (query: string) => run("docker", [...args, `${identity}${query}`]);
test("concurrent unlock, submit and group disable never extend or restore a grant", async () => {
  test.setTimeout(60_000);
  sql(`begin;insert into public.locations(id,name,code) values('${branch}','Overdue concurrent','CCLOCKCON26'),('${target}','Overdue target','CCLOCKTGT26');
    insert into public.profiles(id,phone,name,role,can_access_super_admin_features) values('${actor}','0899926111','Concurrent unlocker','admin',true);commit;`);
  let group = "";
  try {
    group = JSON.parse(sql(`${identity}select public.save_cash_count_alert_group(null,array['${branch}']::uuid[],1,true,1,2);`).split("\n").at(-1)!).id;
    sql(`update public.cash_count_alert_members set joined_at=now()-interval '6 days' where location_id='${branch}';`);
    const grants = await Promise.all([command(`begin;select public.unlock_cash_count_overdue('${branch}');select pg_sleep(0.2);commit;`), command(`select public.unlock_cash_count_overdue('${branch}');`)]);
    const times = grants.map((r) => JSON.parse(r.stdout.split("\n").find((line) => line.startsWith("{"))!).states[0].unlockedUntil);
    expect(times[0]).toBe(times[1]);
    const session = JSON.parse(sql(`${identity}select public.start_cash_count_session('${branch}');`).split("\n").at(-1)!).session.id;
    const counts = JSON.stringify({ "1000": 0, "500": 0, "100": 0, "50": 0, "20": 0, "10": 0, "5": 0, "2": 0, "1": 0 });
    await Promise.all([command(`select public.submit_cash_count_v3('${session}','${counts}',array[]::uuid[]);`), command(`select public.unlock_cash_count_overdue('${branch}');`)]);
    expect(sql(`select unlocked_until is null from public.cash_count_alert_members where location_id='${branch}'`)).toBe("t");
    sql(`${identity}select public.delete_cash_count((select id from public.cash_counts where session_id='${session}'));`);
    await Promise.all([command(`select public.unlock_cash_count_overdue('${branch}');`), command(`select public.save_cash_count_alert_group('${group}',array['${branch}']::uuid[],1,false,null,null);`)]);
    expect(sql(`select unlocked_until is null from public.cash_count_alert_members where location_id='${branch}'`)).toBe("t");
    expect(sql(`select lock_enabled from public.cash_count_alert_groups where id='${group}'`)).toBe("f");
    await command(`select public.save_cash_count_alert_group('${group}',array['${branch}','${target}']::uuid[],1,false,null,null);`);
    sql(`insert into public.income_expense(local_bill_no,location_id,type,number,tx_date,title,cost,bill_option,created_by_user_id,created_by_name,created_by_phone,sync_status)
      values('CCLOCKCON26-I','${branch}','income',1,current_date,'test',100,'รายรับ','${actor}','Concurrent unlocker','0899926111','synced'),
      ('CCLOCKCON26-T','${target}','income',1,current_date,'test',100,'รายรับ','${actor}','Concurrent unlocker','0899926111','synced');`);
    await Promise.all([command(`begin;select private.lock_report_locations(array['${branch}','${target}']::uuid[]);update public.income_expense set cost=200 where local_bill_no in('CCLOCKCON26-I','CCLOCKCON26-T');commit;`),
      command(`select public.save_cash_count_alert_group('${group}',array['${branch}','${target}']::uuid[],2,false,null,null);`)]);
    expect(sql("select sum(cost) from public.income_expense where local_bill_no in('CCLOCKCON26-I','CCLOCKCON26-T')")).toBe("400.00");
  } finally {
    sql(`begin;delete from public.cash_count_alert_groups where id in(select group_id from public.cash_count_alert_members where location_id='${branch}');
      update public.cash_count_sessions set status='cancelled',ended_at=now() where location_id='${branch}' and status='active';
      delete from public.cash_counts where location_id='${branch}';delete from public.document_deletion_audits where location_id='${branch}';
      delete from public.cash_count_sessions where location_id='${branch}';delete from public.income_expense where local_bill_no in('CCLOCKCON26-I','CCLOCKCON26-T');
      set constraints all immediate;delete from public.dashboard_money_events where location_id in('${branch}','${target}');
      delete from public.dashboard_branch_snapshots where location_id in('${branch}','${target}');
      delete from public.profiles where id='${actor}';delete from public.locations where id in('${branch}','${target}');commit;`);
  }
});
