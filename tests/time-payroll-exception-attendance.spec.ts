import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { calculateExceptionAttendance } from "@/lib/time-tracking/pay";

const migrationPath = "supabase/migrations/20260829010000_time_payroll_exception_attendance.sql";
const correctionMigrationPath = "supabase/migrations/20260829020000_time_payroll_exception_attendance_corrections.sql";
const futureDateGuardMigrationPath = "supabase/migrations/20260829030000_time_payroll_active_period_future_date_guard.sql";
const attendanceFutureDateGuardMigrationPath = "supabase/migrations/20260829040000_time_payroll_attendance_future_date_guard.sql";
const sameDayResumeMigrationPath = "supabase/migrations/20260830030000_time_payroll_same_day_resume.sql";
const calendarEligibilityMigrationPath = "supabase/migrations/20260830040000_time_payroll_calendar_eligibility_boundary.sql";
const retireTimerMigrationPath = "supabase/migrations/20260831010000_retire_time_tracking_timer.sql";
const futureSchedulingMigrationPath = "supabase/migrations/20260901030000_time_payroll_future_period_scheduling.sql";

test("counts exception attendance only after the Bangkok workday boundary", () => {
  const input = {
    month: "2026-08",
    workdayEndTime: "16:00",
    periods: [{ startOn: "2026-08-01", endOn: null }],
    exceptions: [
      { date: "2026-08-02", status: "HALF_DAY" as const },
      { date: "2026-08-03", status: "OFF" as const },
    ],
    dailyWage: 500,
  };

  expect(calculateExceptionAttendance({
    ...input,
    now: new Date("2026-08-04T08:59:59.000Z"),
  })).toEqual({ fullDays: 1, halfDays: 1, offDays: 1, paidDays: 1.5, grossPay: 750 });

  expect(calculateExceptionAttendance({
    ...input,
    now: new Date("2026-08-04T09:00:00.000Z"),
  })).toEqual({ fullDays: 2, halfDays: 1, offDays: 1, paidDays: 2.5, grossPay: 1250 });
});

test("ignores dates outside active periods and supports a closed period", () => {
  expect(calculateExceptionAttendance({
    month: "2026-08",
    workdayEndTime: "16:00",
    periods: [{ startOn: "2026-08-02", endOn: "2026-08-04" }],
    exceptions: [
      { date: "2026-08-01", status: "OFF" },
      { date: "2026-08-03", status: "HALF_DAY" },
      { date: "2026-08-05", status: "OFF" },
    ],
    dailyWage: 400,
    now: new Date("2026-08-31T17:00:00.000Z"),
  })).toEqual({ fullDays: 2, halfDays: 1, offDays: 0, paidDays: 2.5, grossPay: 1000 });
});

test("migration freezes additive schema, narrow individual writes, and explicit activation", async () => {
  const sql = await readFile(migrationPath, "utf8");

  expect(sql).toContain("create table public.time_payroll_settings");
  expect(sql).toContain("default 'TIMER'");
  expect(sql).toContain("create table public.time_payroll_active_periods");
  expect(sql).toContain("exclude using gist");
  expect(sql).toContain("create table public.time_payroll_attendance_exceptions");
  expect(sql).toContain("unique (profile_id, work_date)");
  expect(sql).toContain("create or replace function public.get_time_payroll_attendance_month");
  expect(sql).toContain("create or replace function public.replace_time_payroll_attendance_exceptions");
  expect(sql).not.toContain("apply_time_payroll_attendance_batch");
  expect(sql).toContain("create or replace function public.activate_exception_attendance");
  expect(sql).toContain("create or replace function private.is_global_time_payroll_manager");
  expect(sql).toContain("cron.unschedule");
  expect(sql).toContain("'deduct-debts-daily'");
  expect(sql).not.toContain("'time-tracking-daily-deduction'");
  expect(sql).toContain("raise exception 'DEDUCTION_LOCKED:%', p_month");
  expect(sql).toContain("ft.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')");
  expect(sql).toContain("create or replace function public.update_time_tracking_wage");
  expect(sql).toContain("update_time_tracking_wage_internal_20260829");
  expect(sql).toContain("set search_path = ''");
  expect(sql).toContain("revoke all on table public.time_payroll_attendance_exceptions from anon, authenticated");
});

test("routes expose only the exception-attendance runtime commands", async () => {
  const [admin, user] = await Promise.all([
    readFile("src/app/api/lanflow/time-tracking/admin/route.ts", "utf8"),
    readFile("src/app/api/lanflow/time-tracking/user/route.ts", "utf8"),
  ]);

  expect(admin).not.toContain("attendanceMode");
  expect(admin).toContain("canDecide");
  expect(admin).not.toContain("active_period:");
  expect(admin).toContain("period_state:");
  expect(admin).toContain("time_payroll_active_periods");
  expect(admin).toContain('body.action === "REPLACE_ATTENDANCE_EXCEPTIONS"');
  expect(admin).not.toContain("APPLY_ATTENDANCE_BATCH");
  expect(admin).not.toContain("apply_time_payroll_attendance_batch");
  expect(admin).toContain('body.action === "UPDATE_TIME_PAYROLL_CONFIG"');
  expect(admin).toContain('body.action === "SET_PAYROLL_ACTIVE_PERIOD"');
  expect(admin).toContain('body.action === "CANCEL_PAYROLL_ACTIVE_PERIOD_SCHEDULE"');
  expect(admin).not.toContain('body.action === "GET_TIME_PAYROLL_PREFLIGHT"');
  expect(admin).not.toContain('body.action === "ACTIVATE_EXCEPTION_ATTENDANCE"');
  expect(admin).not.toContain('body.action === "TOGGLE_TRACKING"');
  expect(admin).not.toContain('body.action === "ADD_BULK_SEGMENTS"');
  expect(admin).not.toContain('.from("time_segments")');
  expect(admin).toContain("ช่วงวันที่อยู่นอกช่วงทำงานของพนักงาน กรุณาเปิดหรือกลับเข้าทำงานก่อน");
  expect(user).toContain("attendance:");
  expect(user).toContain("periodState:");
  expect(user).toContain("get_time_payroll_attendance_month");
  expect(user).not.toContain('.from("time_segments")');
  expect(user).not.toContain("time_tracking_resume_schedules");
});

test("retirement migration freezes EXCEPTIONS and keeps legacy rows read-only", async () => {
  const sql = await readFile(retireTimerMigrationPath, "utf8");

  expect(sql).toContain("TIMER_RETIREMENT_BLOCKED");
  expect(sql).toContain("set mode = 'EXCEPTIONS'");
  expect(sql).toContain("alter column mode set default 'EXCEPTIONS'");
  expect(sql).toContain("check (mode = 'EXCEPTIONS')");
  expect(sql).toContain("revoke insert, update, delete on table public.time_segments from authenticated");
  expect(sql).toContain("revoke all on function public.set_time_tracking_status");
  expect(sql).toContain("revoke all on function public.replace_time_tracking_segments");
  expect(sql).not.toContain("drop table public.time_segments");
  expect(sql).not.toContain("delete from public.time_segments");
  expect(sql).toContain("'mode', 'EXCEPTIONS'");
});

test("same-day RESUME reopens the latest period without weakening overlap protection", async () => {
  const sql = await readFile(sameDayResumeMigrationPath, "utf8");

  expect(sql).toContain("if p_action = 'RESUME' and v_latest.end_on = p_effective_date then");
  expect(sql).toContain("set end_on = null, updated_by = v_actor, updated_at = now()");
  expect(sql).toContain("perform private.assert_attendance_range_open(p_profile_id, p_effective_date, v_today)");
  expect(sql).toContain("pg_advisory_xact_lock");
});

test("attendance DTO exposes the Bangkok workday eligibility boundary", async () => {
  const sql = await readFile(calendarEligibilityMigrationPath, "utf8");

  expect(sql).toContain("v_bangkok_now timestamp := now() at time zone 'Asia/Bangkok'");
  expect(sql).toContain("v_bangkok_now::time >= (v_settings ->> 'workdayEndTime')::time");
  expect(sql).toContain("then v_bangkok_now::date");
  expect(sql).toContain("else v_bangkok_now::date - 1");
  expect(sql).toContain("'eligibleThrough', v_eligible_through");
  expect(sql).toContain("create or replace function public.get_time_payroll_attendance_month(");
  expect(sql).toContain("p_profile_id = auth.uid() or private.can_manage_time_payroll_profile(p_profile_id)");
  expect(sql).toContain("grant execute on function public.get_time_payroll_attendance_month(uuid, text) to authenticated");
});

test("employee withdrawal uses the Bangkok server date and accepts no client date", async () => {
  const [sql, user] = await Promise.all([
    readFile(correctionMigrationPath, "utf8"),
    readFile("src/app/api/lanflow/time-tracking/user/route.ts", "utf8"),
  ]);

  expect(user).toContain("request_time_tracking_withdrawal");
  expect(user).not.toContain("const { amount, effective_date } = payload");
  expect(user).not.toContain("p_effective_date: effective_date");
  expect(sql).toContain("create or replace function public.request_time_tracking_withdrawal(");
  expect(sql).toContain("(now() at time zone 'Asia/Bangkok')::date");
  expect(sql).toContain("v_effective_date := v_bangkok_today");
});

test("exception payroll scans active worked months and serializes attendance before close", async () => {
  const sql = await readFile(correctionMigrationPath, "utf8");

  expect(sql).toContain("v_first_active_month");
  expect(sql).toContain("if v_mode = 'EXCEPTIONS' then");
  expect(sql).toContain("from public.time_payroll_active_periods ap");
  expect(sql).toContain("raise exception 'OLDER_WORK_MONTH:%', to_char(v_scan_month, 'YYYY-MM')");
  expect(sql).toContain("pg_advisory_xact_lock(hashtextextended('time-payroll-attendance:' || p_profile_id::text, 0))");
});

test("active-period backdates check every affected month for slip and deduction locks", async () => {
  const sql = await readFile(correctionMigrationPath, "utf8");

  expect(sql).toContain("create or replace function private.assert_attendance_range_open(");
  expect(sql).toContain("perform private.assert_attendance_month_open(p_profile_id, to_char(v_month, 'YYYY-MM'))");
  expect(sql).toContain("perform private.assert_attendance_range_open(p_profile_id, p_effective_date, v_today)");
  expect(sql).toContain("perform private.assert_attendance_range_open(p_profile_id, p_effective_date + 1, v_today)");
});

test("historical guard migration rejected future active-period dates", async () => {
  const sql = await readFile(futureDateGuardMigrationPath, "utf8");

  expect(sql).toContain("v_today date := (now() at time zone 'Asia/Bangkok')::date");
  expect(sql).toContain("if p_effective_date > v_today then raise exception 'FUTURE_EFFECTIVE_DATE'; end if;");
  expect(sql).toContain("create or replace function public.set_time_payroll_active_period(");
});

test("forward migration schedules period actions without weakening payroll month locks", async () => {
  const sql = await readFile(futureSchedulingMigrationPath, "utf8");

  expect(sql).toContain("scheduled_action");
  expect(sql).toContain("scheduled_effective_on");
  expect(sql).toContain("scheduled_activation_on");
  expect(sql).toContain("p_action = 'END' then p_effective_date + 1");
  expect(sql).toContain("create or replace function public.cancel_time_payroll_active_period_schedule");
  expect(sql).toContain("private.assert_attendance_month_open");
  expect(sql).toContain("to_char(v_pending.scheduled_activation_on, 'YYYY-MM')");
  expect(sql).toContain("or to_char(ap.scheduled_activation_on, 'YYYY-MM') = p_month");
  expect(sql).toContain("PENDING_PERIOD_ACTION");
  expect(sql).not.toContain("if v_mode = 'EXCEPTIONS' then");
  expect(sql).toContain("p_profile_id, p_month, false");
  expect(sql).toContain("pg_advisory_xact_lock(hashtextextended('time-payroll-attendance:' || p_profile_id::text, 0))");
  expect(sql).toContain("set search_path = ''");
});

test("individual attendance writes reject future Bangkok dates", async () => {
  const sql = await readFile(attendanceFutureDateGuardMigrationPath, "utf8");

  expect(sql).toContain("create or replace function public.replace_time_payroll_attendance_exceptions(");
  expect(sql).toContain("v_today date := (now() at time zone 'Asia/Bangkok')::date");
  expect(sql.match(/raise exception 'FUTURE_ATTENDANCE_DATE'/g)).toHaveLength(1);
  expect(sql).not.toContain("apply_time_payroll_attendance_batch");
  expect(sql).toContain("set search_path = ''");
});
