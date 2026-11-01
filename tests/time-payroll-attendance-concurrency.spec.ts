import { expect, test } from "@playwright/test";
import postgres from "postgres";

test("the waiting attendance writer checks its revision after the first writer commits", async () => {
  // Fixed Local target; never read production credentials for this test.
  const sql = postgres({ host: "127.0.0.1", port: 55422, user: "postgres", password: "postgres", database: "postgres", max: 3 });
  const id = crypto.randomUUID();
  const phone = `08${Date.now().toString().slice(-8)}`;
  try {
    await sql`insert into public.profiles(id,phone,name,role,is_active,daily_wage,can_access_super_admin_features)
      values(${id},${phone},'Attendance concurrent test','admin',true,100,true)`;
    await sql`insert into public.time_payroll_active_periods(profile_id,start_on,created_by,updated_by)
      values(${id},(date_trunc('month',now() at time zone 'Asia/Bangkok')-interval '1 month')::date,${id},${id})`;
    const [snapshot] = await sql`select to_char((now() at time zone 'Asia/Bangkok')-interval '1 month','YYYY-MM') as month`;
    let release!: () => void;
    let locked!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const acquired = new Promise<void>(resolve => { locked = resolve; });
    const revision = await sql.begin(async tx => {
      await tx.unsafe("select set_config('request.jwt.claim.sub',$1,true)", [id]);
      const [row] = await tx.unsafe("select public.get_time_payroll_attendance_month($1,$2)->>'revision' as revision", [id, snapshot.month]);
      return row.revision as string;
    });
    const first = sql.begin(async tx => {
      await tx.unsafe("select set_config('request.jwt.claim.sub',$1,true)", [id]);
      await tx.unsafe("select public.replace_time_payroll_attendance_exceptions($1,$2,$3::text::jsonb,$4)",
        [id, snapshot.month, JSON.stringify([{ date: `${snapshot.month}-01`, status: "OFF" }]), revision]);
      locked();
      await gate;
    });
    await acquired;
    const second = sql.begin(async tx => {
      await tx.unsafe("set local statement_timeout = '5s'");
      await tx.unsafe("select set_config('request.jwt.claim.sub',$1,true)", [id]);
      return tx.unsafe("select public.replace_time_payroll_attendance_exceptions($1,$2,'[]'::jsonb,$3)", [id, snapshot.month, revision]);
    }).then(() => "overwritten", (error: Error) => error.message);
    release();
    await first;
    expect(await second).toContain("ATTENDANCE_STALE");
    const [row] = await sql`select count(*)::int as count from public.time_payroll_attendance_exceptions where profile_id=${id}`;
    expect(row.count).toBe(1);
  } finally {
    await sql`delete from public.time_tracking_audit_logs where record_id=${id} or admin_id=${id}`;
    await sql`delete from public.time_payroll_attendance_exceptions where profile_id=${id}`;
    await sql`delete from public.time_payroll_active_periods where profile_id=${id}`;
    await sql`delete from public.profiles where id=${id}`;
    await sql.end();
  }
});
