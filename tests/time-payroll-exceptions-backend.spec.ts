import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  || "";
const password = process.env.TEST_PASSWORD || "password123";
const appUrl = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";

function serviceClient() {
  expect(serviceRoleKey).toBeTruthy();
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function globalManagerClient() {
  expect(publishableKey).toBeTruthy();
  const client = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const phone = process.env.TEST_PHONE || "0800000000";
  const normalizedPhone = phone.startsWith("+") ? phone : `+66${phone.slice(1)}`;
  const signIn = await client.auth.signInWithPassword({ phone: normalizedPhone, password });
  expect(signIn.error).toBeNull();
  return client;
}

async function signedInClient(phone: string) {
  expect(publishableKey).toBeTruthy();
  const client = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await client.auth.signInWithPassword({ phone, password });
  expect(signIn.error).toBeNull();
  return client;
}

function bangkokDate(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function expectedEligibleThrough(workdayEndTime: string, instant: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant).map((part) => [part.type, part.value]));
  const [cutoffHour, cutoffMinute] = workdayEndTime.split(":").map(Number);
  const afterCutoff = Number(parts.hour) * 60 + Number(parts.minute) >= cutoffHour * 60 + cutoffMinute;
  const eligibleInstant = afterCutoff ? instant : new Date(instant.getTime() - 86_400_000);

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(eligibleInstant);
}

async function createEmployee(service: SupabaseClient, label: string) {
  const id = crypto.randomUUID();
  const phone = `+669${Date.now().toString().slice(-8)}`;
  const auth = await service.auth.admin.createUser({
    id,
    phone,
    password,
    phone_confirm: true,
    user_metadata: { name: label },
  });
  expect(auth.error).toBeNull();
  const profile = await service.from("profiles").upsert({
    id,
    phone,
    name: label,
    role: "user",
    is_active: true,
    daily_wage: 500,
    can_access_super_admin_features: false,
    can_manage_time_payroll: false,
  });
  expect(profile.error).toBeNull();
  return id;
}

async function promoteEmployee(service: SupabaseClient, id: string) {
  const result = await service.from("profiles").update({ role: "admin" }).eq("id", id);
  expect(result.error).toBeNull();
}

async function deleteEmployee(service: SupabaseClient, id: string) {
  await service.from("time_tracking_resume_schedules").delete().eq("profile_id", id);
  await service.from("time_tracking_audit_logs").delete().eq("record_id", id);
  await service.from("time_tracking_audit_logs").delete().eq("admin_id", id);
  await service.from("admin_account_audit_logs").delete().eq("target_user_id", id);
  await service.from("admin_account_audit_logs").delete().eq("actor_user_id", id);
  await service.from("financial_transactions").delete().eq("profile_id", id);
  await service.from("payroll_slips").delete().eq("profile_id", id);
  await service.from("time_segments").delete().eq("profile_id", id);
  const profile = await service.from("profiles").delete().eq("id", id);
  expect(profile.error).toBeNull();
  const auth = await service.auth.admin.deleteUser(id);
  expect(auth.error).toBeNull();
}

async function primaryLocation(service: SupabaseClient, profileId: string, locationId: string) {
  const assigned = await service.from("user_locations").upsert({
    user_id: profileId,
    location_id: locationId,
    is_primary: true,
  }, { onConflict: "user_id,location_id" });
  expect(assigned.error).toBeNull();
}

async function phoneFor(service: SupabaseClient, profileId: string) {
  const profile = await service.from("profiles").select("phone").eq("id", profileId).single();
  expect(profile.error).toBeNull();
  return profile.data!.phone;
}

test.describe.serial("Exception attendance backend contract @time-payroll-exceptions-backend", () => {
  test("direct non-array attendance replacements are rejected without erasing the month", async () => {
    const service = serviceClient();
    const manager = await globalManagerClient();
    const employeeId = await createEmployee(service, "QA attendance null guard");
    const workDate = bangkokDate(-1);
    const month = workDate.slice(0, 7);

    try {
      const enabled = await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "ENABLE",
        p_effective_date: workDate,
      });
      expect(enabled.error).toBeNull();

      const seeded = await manager.rpc("replace_time_payroll_attendance_exceptions", {
        p_profile_id: employeeId,
        p_month: month,
        p_selections: [{ date: workDate, status: "OFF" }],
      });
      expect(seeded.error).toBeNull();

      for (const invalidSelections of [null, {}, "OFF", 1, true]) {
        const rejected = await manager.rpc("replace_time_payroll_attendance_exceptions", {
          p_profile_id: employeeId,
          p_month: month,
          p_selections: invalidSelections,
        });
        expect(rejected.error?.message).toContain("INVALID_ATTENDANCE_SELECTIONS");

        const rows = await manager
          .from("time_payroll_attendance_exceptions")
          .select("work_date, status")
          .eq("profile_id", employeeId);
        expect(rows.error).toBeNull();
        expect(rows.data).toEqual([{ work_date: workDate, status: "OFF" }]);
      }

      const nullMonth = await manager.rpc("replace_time_payroll_attendance_exceptions", {
        p_profile_id: employeeId,
        p_month: null,
        p_selections: [],
      });
      expect(nullMonth.error?.message).toContain("INVALID_ATTENDANCE_SELECTIONS");

      const nullProfile = await manager.rpc("replace_time_payroll_attendance_exceptions", {
        p_profile_id: null,
        p_month: month,
        p_selections: [],
      });
      expect(nullProfile.error?.message).toContain("Forbidden");

      const finalRows = await manager
        .from("time_payroll_attendance_exceptions")
        .select("work_date, status")
        .eq("profile_id", employeeId);
      expect(finalRows.error).toBeNull();
      expect(finalRows.data).toEqual([{ work_date: workDate, status: "OFF" }]);
    } finally {
      await deleteEmployee(service, employeeId);
    }
  });

  test("a null active-period action is rejected without closing the open period or writing audit", async () => {
    const service = serviceClient();
    const manager = await globalManagerClient();
    const employeeId = await createEmployee(service, "QA active period null guard");
    const workDate = bangkokDate(-1);

    try {
      const enabled = await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "ENABLE",
        p_effective_date: workDate,
      });
      expect(enabled.error).toBeNull();

      const beforeAudit = await manager
        .from("time_tracking_audit_logs")
        .select("id", { count: "exact", head: true })
        .eq("record_id", employeeId)
        .eq("action", "SET_PAYROLL_ACTIVE_PERIOD");
      expect(beforeAudit.error).toBeNull();

      const rejected = await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: null,
        p_effective_date: workDate,
      });
      expect(rejected.error?.message).toContain("INVALID_PERIOD_ACTION");

      const nullDate = await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "END",
        p_effective_date: null,
      });
      expect(nullDate.error?.message).toContain("INVALID_PERIOD_ACTION");

      const nullProfile = await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: null,
        p_action: "END",
        p_effective_date: workDate,
      });
      expect(nullProfile.error?.message).toContain("INVALID_PERIOD_ACTION");

      const period = await manager
        .from("time_payroll_active_periods")
        .select("start_on, end_on")
        .eq("profile_id", employeeId)
        .single();
      expect(period.error).toBeNull();
      expect(period.data).toEqual({ start_on: workDate, end_on: null });

      const afterAudit = await manager
        .from("time_tracking_audit_logs")
        .select("id", { count: "exact", head: true })
        .eq("record_id", employeeId)
        .eq("action", "SET_PAYROLL_ACTIVE_PERIOD");
      expect(afterAudit.error).toBeNull();
      expect(afterAudit.count).toBe(beforeAudit.count);
    } finally {
      await deleteEmployee(service, employeeId);
    }
  });

  test("null Config input fails closed without changing state or audit", async () => {
    const manager = await globalManagerClient();
    const managerUser = await manager.auth.getUser();
    const managerId = managerUser.data.user!.id;

    const settingsBefore = await manager.rpc("get_time_payroll_settings");
    expect(settingsBefore.error).toBeNull();
    const configAuditBefore = await manager
      .from("time_tracking_audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("record_id", managerId)
      .eq("action", "UPDATE_TIME_PAYROLL_CONFIG");
    expect(configAuditBefore.error).toBeNull();

    const nullConfig = await manager.rpc("update_time_payroll_config", {
      p_workday_end_time: null,
    });
    expect(nullConfig.error?.message).toContain("INVALID_WORKDAY_END_TIME");
    const settingsAfter = await manager.rpc("get_time_payroll_settings");
    expect(settingsAfter.error).toBeNull();
    expect(settingsAfter.data).toEqual(settingsBefore.data);
    const configAuditAfter = await manager
      .from("time_tracking_audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("record_id", managerId)
      .eq("action", "UPDATE_TIME_PAYROLL_CONFIG");
    expect(configAuditAfter.error).toBeNull();
    expect(configAuditAfter.count).toBe(configAuditBefore.count);
  });

  test("active-period lifecycle and individual FULL/HALF_DAY/OFF produce the expected summary", async () => {
    const service = serviceClient();
    const manager = await globalManagerClient();
    const employeeId = await createEmployee(service, "QA attendance lifecycle");
    const startOn = bangkokDate(-5);
    const secondDay = bangkokDate(-4);
    const pauseOn = bangkokDate(-3);
    const resumeOn = bangkokDate(-2);
    const endOn = bangkokDate(-1);
    const month = startOn.slice(0, 7);

    try {
      const enabled = await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "ENABLE",
        p_effective_date: startOn,
      });
      expect(enabled.error).toBeNull();
      const duplicateOpen = await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "ENABLE",
        p_effective_date: secondDay,
      });
      expect(duplicateOpen.error?.message).toContain("ACTIVE_PERIOD_ALREADY_OPEN");
      const futureEnd = await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "END",
        p_effective_date: bangkokDate(1),
      });
      expect(futureEnd.error?.message).toContain("FUTURE_EFFECTIVE_DATE");

      const paused = await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "PAUSE",
        p_effective_date: pauseOn,
      });
      expect(paused.error).toBeNull();
      const resumed = await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "RESUME",
        p_effective_date: resumeOn,
      });
      expect(resumed.error).toBeNull();
      const ended = await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "END",
        p_effective_date: endOn,
      });
      expect(ended.error).toBeNull();

      const replaced = await manager.rpc("replace_time_payroll_attendance_exceptions", {
        p_profile_id: employeeId,
        p_month: month,
        p_selections: [
          { date: secondDay, status: "OFF" },
          { date: resumeOn, status: "HALF_DAY" },
        ],
      });
      expect(replaced.error).toBeNull();
      const attendance = await manager.rpc("get_time_payroll_attendance_month", {
        p_profile_id: employeeId,
        p_month: month,
      });
      expect(attendance.error).toBeNull();
      expect(attendance.data?.eligibleThrough).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(attendance.data).toMatchObject({
        mode: "EXCEPTIONS",
        summary: {
          fullDays: 2,
          halfDays: 1,
          offDays: 1,
          paidDays: 2.5,
          grossPay: 1250,
        },
      });

      const restoredFull = await manager.rpc("replace_time_payroll_attendance_exceptions", {
        p_profile_id: employeeId,
        p_month: month,
        p_selections: [{ date: resumeOn, status: "HALF_DAY" }],
      });
      expect(restoredFull.error).toBeNull();
      const fullAttendance = await manager.rpc("get_time_payroll_attendance_month", {
        p_profile_id: employeeId,
        p_month: month,
      });
      expect(fullAttendance.error).toBeNull();
      expect(fullAttendance.data).toMatchObject({
        summary: {
          fullDays: 3,
          halfDays: 1,
          offDays: 0,
          paidDays: 3.5,
          grossPay: 1750,
        },
      });

      const overlap = await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "RESUME",
        p_effective_date: secondDay,
      });
      expect(overlap.error).not.toBeNull();
      const periods = await manager
        .from("time_payroll_active_periods")
        .select("start_on, end_on")
        .eq("profile_id", employeeId)
        .order("start_on");
      expect(periods.error).toBeNull();
      expect(periods.data).toEqual([
        { start_on: startOn, end_on: secondDay },
        { start_on: resumeOn, end_on: endOn },
      ]);
    } finally {
      await deleteEmployee(service, employeeId);
    }
  });

  test("open active period stops calendar eligibility at the Bangkok workday cutoff", async () => {
    const service = serviceClient();
    const manager = await globalManagerClient();
    const employeeId = await createEmployee(service, "QA attendance eligibility boundary");
    const startOn = bangkokDate();
    const month = startOn.slice(0, 7);

    try {
      const enabled = await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "ENABLE",
        p_effective_date: startOn,
      });
      expect(enabled.error).toBeNull();

      const beforeRequest = new Date();
      const attendance = await manager.rpc("get_time_payroll_attendance_month", {
        p_profile_id: employeeId,
        p_month: month,
      });
      const afterRequest = new Date();

      expect(attendance.error).toBeNull();
      expect(attendance.data).toMatchObject({
        mode: "EXCEPTIONS",
        periods: [{ startOn, endOn: null }],
      });
      const workdayEndTime = String(attendance.data?.workdayEndTime);
      const eligibleCandidates = new Set([
        expectedEligibleThrough(workdayEndTime, beforeRequest),
        expectedEligibleThrough(workdayEndTime, afterRequest),
      ]);
      expect(eligibleCandidates).toContain(attendance.data?.eligibleThrough);
      expect(String(attendance.data?.eligibleThrough) <= startOn).toBe(true);
      expect(attendance.data?.summary.fullDays).toBe(attendance.data?.eligibleThrough === startOn ? 1 : 0);
    } finally {
      await deleteEmployee(service, employeeId);
    }
  });

  test("RESUME on the same day reopens the just-closed period instead of creating an overlap", async () => {
    const service = serviceClient();
    const manager = await globalManagerClient();
    const employeeId = await createEmployee(service, "QA same-day resume");
    const today = bangkokDate(0);

    try {
      const location = await service.from("locations").select("id").eq("is_active", true).limit(1).single();
      expect(location.error).toBeNull();
      await primaryLocation(service, employeeId, location.data!.id);
      expect((await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "ENABLE",
        p_effective_date: today,
      })).error).toBeNull();
      expect((await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "END",
        p_effective_date: today,
      })).error).toBeNull();

      const session = await manager.auth.getSession();
      const authorization = `Bearer ${session.data.session!.access_token}`;
      const resumed = await fetch(appUrl + "/api/lanflow/time-tracking/admin", {
        method: "POST",
        headers: { Authorization: authorization, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "SET_PAYROLL_ACTIVE_PERIOD",
          payload: { user_id: employeeId, action: "RESUME", effective_date: today },
        }),
      });
      expect(resumed.ok, await resumed.text()).toBeTruthy();

      const attendanceUpdate = await fetch(appUrl + "/api/lanflow/time-tracking/admin", {
        method: "POST",
        headers: { Authorization: authorization, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "REPLACE_ATTENDANCE_EXCEPTIONS",
          payload: { user_id: employeeId, month: today.slice(0, 7), selections: [{ date: today, status: "OFF" }] },
        }),
      });
      expect(attendanceUpdate.ok, await attendanceUpdate.text()).toBeTruthy();

      const periods = await manager
        .from("time_payroll_active_periods")
        .select("start_on, end_on")
        .eq("profile_id", employeeId);
      expect(periods.error).toBeNull();
      expect(periods.data).toEqual([{ start_on: today, end_on: null }]);
      const exceptions = await manager
        .from("time_payroll_attendance_exceptions")
        .select("work_date, status")
        .eq("profile_id", employeeId);
      expect(exceptions.error).toBeNull();
      expect(exceptions.data).toEqual([{ work_date: today, status: "OFF" }]);
    } finally {
      await deleteEmployee(service, employeeId);
    }
  });

  test("individual attendance and primary-branch permissions hold at RPC and RLS boundaries", async () => {
    const service = serviceClient();
    const globalManager = await globalManagerClient();
    const locations = await service.from("locations").select("id").eq("is_active", true).order("id").limit(2);
    expect(locations.error).toBeNull();
    expect(locations.data).toHaveLength(2);
    const [branchA, branchB] = locations.data!.map((location) => location.id);
    const delegatedId = await createEmployee(service, "QA delegated branch manager");
    const employeeA = await createEmployee(service, "QA branch A employee 1");
    const employeeB = await createEmployee(service, "QA branch A employee 2");
    const employeeOtherBranch = await createEmployee(service, "QA branch B employee");
    const workStart = bangkokDate(-2);
    const workEnd = bangkokDate(-1);
    const month = workStart.slice(0, 7);

    try {
      await promoteEmployee(service, delegatedId);
      const capability = await service
        .from("profiles")
        .update({ can_manage_time_payroll: true })
        .eq("id", delegatedId);
      expect(capability.error).toBeNull();
      await primaryLocation(service, delegatedId, branchA);
      await primaryLocation(service, employeeA, branchA);
      await primaryLocation(service, employeeB, branchA);
      await primaryLocation(service, employeeOtherBranch, branchB);
      const delegated = await signedInClient(await phoneFor(service, delegatedId));
      const employee = await signedInClient(await phoneFor(service, employeeA));

      for (const profileId of [employeeA, employeeB, employeeOtherBranch]) {
        const enabled = await globalManager.rpc("set_time_payroll_active_period", {
          p_profile_id: profileId,
          p_action: "ENABLE",
          p_effective_date: workStart,
        });
        expect(enabled.error).toBeNull();
      }

      const ownBranchRead = await delegated.rpc("get_time_payroll_attendance_month", {
        p_profile_id: employeeA,
        p_month: month,
      });
      expect(ownBranchRead.error).toBeNull();
      const otherBranchRead = await delegated.rpc("get_time_payroll_attendance_month", {
        p_profile_id: employeeOtherBranch,
        p_month: month,
      });
      expect(otherBranchRead.error?.message).toContain("Forbidden");

      const delegatedSession = await delegated.auth.getSession();
      const delegatedResponse = await fetch(appUrl + "/api/lanflow/time-tracking/admin?month=" + month, {
        headers: { Authorization: "Bearer " + delegatedSession.data.session!.access_token },
      });
      expect(delegatedResponse.status).toBe(200);
      const delegatedDashboard = await delegatedResponse.json() as {
        permissions: { canDecide: boolean };
        users: Array<{ id: string }>;
        pendingTransactions: unknown[];
        pendingSlips: unknown[];
      };
      const visibleIds = delegatedDashboard.users.map((profile) => profile.id);
      expect(visibleIds).toEqual(expect.arrayContaining([delegatedId, employeeA, employeeB]));
      expect(visibleIds).not.toContain(employeeOtherBranch);
      expect(delegatedDashboard.permissions.canDecide).toBe(false);
      expect(delegatedDashboard.pendingTransactions).toEqual([]);
      expect(delegatedDashboard.pendingSlips).toEqual([]);

      const employeeSession = await employee.auth.getSession();
      const employeeAdminRoute = await fetch(appUrl + "/api/lanflow/time-tracking/admin?month=" + month, {
        headers: { Authorization: "Bearer " + employeeSession.data.session!.access_token },
      });
      expect(employeeAdminRoute.status).toBe(403);
      const employeeOtherRoute = await fetch(
        appUrl + "/api/lanflow/time-tracking/user?userId=" + employeeB + "&month=" + month,
        { headers: { Authorization: "Bearer " + employeeSession.data.session!.access_token } },
      );
      expect(employeeOtherRoute.status).toBe(403);

      const sameBranch = await delegated.rpc("replace_time_payroll_attendance_exceptions", {
        p_profile_id: employeeA,
        p_month: month,
        p_selections: [{ date: workStart, status: "HALF_DAY" }],
      });
      expect(sameBranch.error).toBeNull();
      expect(sameBranch.data).toMatchObject({ changed: 1, month });

      const delegatedConfig = await delegated.rpc("update_time_payroll_config", {
        p_workday_end_time: "15:30",
      });
      expect(delegatedConfig.error?.message).toContain("Forbidden");
      const delegatedPeriod = await delegated.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeA,
        p_action: "END",
        p_effective_date: workEnd,
      });
      expect(delegatedPeriod.error?.message).toContain("Forbidden");
      const delegatedDecision = await delegated.rpc("decide_time_tracking_approval", {
        p_source_type: "transaction",
        p_source_id: crypto.randomUUID(),
        p_decision: "APPROVED",
        p_comment: null,
        p_expense_location_id: null,
      });
      expect(delegatedDecision.error?.message).toContain("Forbidden");

      const employeeOwnRead = await employee.rpc("get_time_payroll_attendance_month", {
        p_profile_id: employeeA,
        p_month: month,
      });
      expect(employeeOwnRead.error).toBeNull();
      const employeeOtherRead = await employee.rpc("get_time_payroll_attendance_month", {
        p_profile_id: employeeB,
        p_month: month,
      });
      expect(employeeOtherRead.error?.message).toContain("Forbidden");
      const employeeWrite = await employee.rpc("replace_time_payroll_attendance_exceptions", {
        p_profile_id: employeeA,
        p_month: month,
        p_selections: [],
      });
      expect(employeeWrite.error?.message).toContain("Forbidden");

      const directDelegatedWrite = await delegated.from("time_payroll_attendance_exceptions").insert({
        profile_id: employeeA,
        work_date: workStart,
        status: "OFF",
        created_by: delegatedId,
        updated_by: delegatedId,
      });
      expect(directDelegatedWrite.error?.message).toMatch(/permission denied/i);
    } finally {
      for (const profileId of [
        employeeA,
        employeeB,
        employeeOtherBranch,
        delegatedId,
      ]) {
        await deleteEmployee(service, profileId);
      }
    }
  });

  test("exception payroll preserves deduction idempotency, carry-forward, approvals, and payment-location gates", async () => {
    const service = serviceClient();
    const globalManager = await globalManagerClient();
    const location = await service.from("locations").select("id").eq("is_active", true).order("id").limit(1).single();
    expect(location.error).toBeNull();
    const branchId = location.data!.id;
    const debtEmployee = await createEmployee(service, "QA exception deduction");
    const positiveEmployee = await createEmployee(service, "QA positive payroll");
    const delegatedId = await createEmployee(service, "QA delegated slip creator");
    const pendingEmployee = await createEmployee(service, "QA delegated pending slip");
    const approvedEmployee = await createEmployee(service, "QA delegated approved slip");
    const currentDay = bangkokDate(-1);
    const currentMonth = currentDay.slice(0, 7);
    const firstCurrent = currentMonth + "-01";
    const previousLastDate = new Date(firstCurrent + "T12:00:00Z");
    previousLastDate.setUTCDate(previousLastDate.getUTCDate() - 1);
    const previousLast = previousLastDate.toISOString().slice(0, 10);
    const previousMonth = previousLast.slice(0, 7);

    try {
      await promoteEmployee(service, delegatedId);
      for (const profileId of [
        debtEmployee,
        positiveEmployee,
        delegatedId,
        pendingEmployee,
        approvedEmployee,
      ]) {
        await primaryLocation(service, profileId, branchId);
      }
      const delegatedCapability = await service
        .from("profiles")
        .update({ can_manage_time_payroll: true })
        .eq("id", delegatedId);
      expect(delegatedCapability.error).toBeNull();
      const delegated = await signedInClient(await phoneFor(service, delegatedId));

      expect((await globalManager.rpc("set_time_payroll_active_period", {
        p_profile_id: debtEmployee,
        p_action: "ENABLE",
        p_effective_date: previousLast,
      })).error).toBeNull();
      expect((await globalManager.rpc("set_time_payroll_active_period", {
        p_profile_id: debtEmployee,
        p_action: "END",
        p_effective_date: previousLast,
      })).error).toBeNull();
      expect((await globalManager.rpc("set_time_payroll_active_period", {
        p_profile_id: debtEmployee,
        p_action: "RESUME",
        p_effective_date: currentDay,
      })).error).toBeNull();
      expect((await globalManager.rpc("set_time_payroll_active_period", {
        p_profile_id: debtEmployee,
        p_action: "END",
        p_effective_date: currentDay,
      })).error).toBeNull();

      const debt = await globalManager.rpc("create_time_tracking_transaction", {
        p_profile_id: debtEmployee,
        p_type: "DEBT",
        p_amount: 1000,
        p_effective_date: previousLast,
        p_description: "QA carry forward",
      });
      expect(debt.error).toBeNull();
      expect(debt.data).toMatchObject({ status: "approved" });
      const debtId = (debt.data as { id: string }).id;
      const retry = await globalManager.rpc("decide_time_tracking_approval", {
        p_source_type: "transaction",
        p_source_id: debtId,
        p_decision: "APPROVED",
        p_comment: "retry",
        p_expense_location_id: null,
      });
      expect(retry.error).toBeNull();
      expect(retry.data).toMatchObject({ idempotent: true });

      const deductions = await service
        .from("financial_transactions")
        .select("amount, applied_month")
        .eq("parent_debt_id", debtId)
        .order("applied_month");
      expect(deductions.error).toBeNull();
      expect(deductions.data).toEqual([
        { amount: 500, applied_month: previousMonth + "-01" },
        { amount: 500, applied_month: currentMonth + "-01" },
      ]);
      const source = await service
        .from("financial_transactions")
        .select("remaining_amount")
        .eq("id", debtId)
        .single();
      expect(source.error).toBeNull();
      expect(Number(source.data!.remaining_amount)).toBe(0);

      const previousSlip = await globalManager.rpc("create_time_tracking_payroll_slip", {
        p_profile_id: debtEmployee,
        p_month: previousMonth,
        p_auto_start_next_month: false,
      });
      expect(previousSlip.error).toBeNull();
      expect(previousSlip.data).toMatchObject({ status: "APPROVED", net_pay: 0 });
      const currentSlip = await globalManager.rpc("create_time_tracking_payroll_slip", {
        p_profile_id: debtEmployee,
        p_month: currentMonth,
        p_auto_start_next_month: false,
      });
      expect(currentSlip.error).toBeNull();
      expect(currentSlip.data).toMatchObject({ status: "APPROVED", net_pay: 0 });

      for (const profileId of [positiveEmployee, pendingEmployee, approvedEmployee]) {
        const enabled = await globalManager.rpc("set_time_payroll_active_period", {
          p_profile_id: profileId,
          p_action: "ENABLE",
          p_effective_date: currentDay,
        });
        expect(enabled.error).toBeNull();
        const ended = await globalManager.rpc("set_time_payroll_active_period", {
          p_profile_id: profileId,
          p_action: "END",
          p_effective_date: currentDay,
        });
        expect(ended.error).toBeNull();
      }

      const positiveSlip = await globalManager.rpc("create_time_tracking_payroll_slip", {
        p_profile_id: positiveEmployee,
        p_month: currentMonth,
        p_auto_start_next_month: true,
      });
      expect(positiveSlip.error).toBeNull();
      expect(positiveSlip.data).toMatchObject({
        status: "APPROVED",
        net_pay: 500,
        auto_start_scheduled: false,
        slip_data: {
          attendance: {
            month: currentMonth,
            mode: "EXCEPTIONS",
            periods: [{ startOn: currentDay, endOn: currentDay }],
            exceptions: [],
            summary: {
              fullDays: 1,
              halfDays: 0,
              offDays: 0,
              paidDays: 1,
              grossPay: 500,
            },
          },
        },
      });
      expect(positiveSlip.data?.slip_data?.attendance?.eligibleThrough).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const positiveSlipId = (positiveSlip.data as { id: string }).id;
      const branchPayment = await globalManager.rpc("change_time_tracking_expense_location", {
        p_source_type: "payroll_slip",
        p_source_id: positiveSlipId,
        p_expense_location_id: branchId,
        p_comment: "QA branch payment",
      });
      expect(branchPayment.error).toBeNull();
      expect(branchPayment.data).toMatchObject({ status: "updated", expenseLocationId: branchId });
      const unchangedPayment = await globalManager.rpc("change_time_tracking_expense_location", {
        p_source_type: "payroll_slip",
        p_source_id: positiveSlipId,
        p_expense_location_id: branchId,
        p_comment: null,
      });
      expect(unchangedPayment.error).toBeNull();
      expect(unchangedPayment.data).toEqual({ status: "unchanged" });
      const centralPayment = await globalManager.rpc("change_time_tracking_expense_location", {
        p_source_type: "payroll_slip",
        p_source_id: positiveSlipId,
        p_expense_location_id: null,
        p_comment: null,
      });
      expect(centralPayment.error).toBeNull();
      expect(centralPayment.data).toMatchObject({ status: "updated", expenseLocationId: null });

      const delegatedPending = await delegated.rpc("create_time_tracking_payroll_slip", {
        p_profile_id: pendingEmployee,
        p_month: currentMonth,
        p_auto_start_next_month: false,
      });
      expect(delegatedPending.error).toBeNull();
      expect(delegatedPending.data).toMatchObject({ status: "PENDING", net_pay: 500 });
      const pendingSlipId = (delegatedPending.data as { id: string }).id;
      const deletedOwnPending = await delegated.rpc("delete_time_tracking_source_permanently", {
        p_source_type: "payroll_slip",
        p_source_id: pendingSlipId,
      });
      expect(deletedOwnPending.error).toBeNull();

      const delegatedApproved = await delegated.rpc("create_time_tracking_payroll_slip", {
        p_profile_id: approvedEmployee,
        p_month: currentMonth,
        p_auto_start_next_month: false,
      });
      expect(delegatedApproved.error).toBeNull();
      const approvedSlipId = (delegatedApproved.data as { id: string }).id;
      const approved = await globalManager.rpc("decide_time_tracking_approval", {
        p_source_type: "payroll_slip",
        p_source_id: approvedSlipId,
        p_decision: "APPROVED",
        p_comment: "QA approve delegated",
        p_expense_location_id: null,
      });
      expect(approved.error).toBeNull();
      const delegatedDeleteApproved = await delegated.rpc("delete_time_tracking_source_permanently", {
        p_source_type: "payroll_slip",
        p_source_id: approvedSlipId,
      });
      expect(delegatedDeleteApproved.error?.message).toContain("Forbidden");
      const delegatedMoveApproved = await delegated.rpc("change_time_tracking_expense_location", {
        p_source_type: "payroll_slip",
        p_source_id: approvedSlipId,
        p_expense_location_id: branchId,
        p_comment: null,
      });
      expect(delegatedMoveApproved.error?.message).toContain("Forbidden");
    } finally {
      for (const profileId of [
        debtEmployee,
        positiveEmployee,
        pendingEmployee,
        approvedEmployee,
        delegatedId,
      ]) {
        await deleteEmployee(service, profileId);
      }
    }
  });

  test("system manager is global while normal admin remains user-level, including audit visibility", async () => {
    const service = serviceClient();
    const systemManagerId = await createEmployee(service, "QA system manager");
    const normalAdminId = await createEmployee(service, "QA normal admin");
    const targetId = await createEmployee(service, "QA system manager target");
    const location = await service.from("locations").select("id").eq("is_active", true).order("id").limit(1).single();
    expect(location.error).toBeNull();
    const branchId = location.data!.id;
    const workDate = bangkokDate(-1);
    const month = workDate.slice(0, 7);

    try {
      expect((await service.from("profiles").update({
        role: "admin",
        can_access_super_admin_features: true,
      }).eq("id", systemManagerId)).error).toBeNull();
      expect((await service.from("profiles").update({
        role: "admin",
        can_access_super_admin_features: false,
        can_manage_time_payroll: false,
      }).eq("id", normalAdminId)).error).toBeNull();
      await primaryLocation(service, systemManagerId, branchId);
      await primaryLocation(service, normalAdminId, branchId);
      await primaryLocation(service, targetId, branchId);
      const systemManager = await signedInClient(await phoneFor(service, systemManagerId));
      const normalAdmin = await signedInClient(await phoneFor(service, normalAdminId));

      const enabled = await systemManager.rpc("set_time_payroll_active_period", {
        p_profile_id: targetId,
        p_action: "ENABLE",
        p_effective_date: workDate,
      });
      expect(enabled.error).toBeNull();
      expect((await systemManager.rpc("set_time_payroll_active_period", {
        p_profile_id: targetId,
        p_action: "END",
        p_effective_date: workDate,
      })).error).toBeNull();
      const autoApproved = await systemManager.rpc("create_time_tracking_transaction", {
        p_profile_id: targetId,
        p_type: "DEBT",
        p_amount: 100,
        p_effective_date: workDate,
        p_description: "QA system manager auto approval",
      });
      expect(autoApproved.error).toBeNull();
      expect(autoApproved.data).toMatchObject({ status: "approved" });
      const sourceId = (autoApproved.data as { id: string }).id;

      const systemAudit = await systemManager
        .from("time_tracking_audit_logs")
        .select("action")
        .eq("record_id", sourceId);
      expect(systemAudit.error).toBeNull();
      expect(systemAudit.data!.length).toBeGreaterThan(0);
      const normalAdminAudit = await normalAdmin
        .from("time_tracking_audit_logs")
        .select("action")
        .eq("record_id", sourceId);
      expect(normalAdminAudit.error).toBeNull();
      expect(normalAdminAudit.data).toEqual([]);

      const normalAdminPeriod = await normalAdmin.rpc("set_time_payroll_active_period", {
        p_profile_id: targetId,
        p_action: "RESUME",
        p_effective_date: workDate,
      });
      expect(normalAdminPeriod.error?.message).toContain("Forbidden");
      const normalAdminAttendance = await normalAdmin.rpc("get_time_payroll_attendance_month", {
        p_profile_id: targetId,
        p_month: month,
      });
      expect(normalAdminAttendance.error?.message).toContain("Forbidden");

      const directSettingsWrite = await systemManager
        .from("time_payroll_settings")
        .update({ workday_end_time: "15:00" })
        .eq("singleton", true);
      expect(directSettingsWrite.error?.message).toMatch(/permission denied/i);

      const systemSession = await systemManager.auth.getSession();
      const systemRoute = await fetch(appUrl + "/api/lanflow/time-tracking/admin?month=" + month, {
        headers: { Authorization: "Bearer " + systemSession.data.session!.access_token },
      });
      expect(systemRoute.status).toBe(200);
      const systemPayload = await systemRoute.json() as {
        permissions: { canDecide: boolean; canConfigure: boolean };
        users: Array<{ id: string }>;
      };
      expect(systemPayload.permissions).toMatchObject({ canDecide: true, canConfigure: true });
      expect(systemPayload.users.map((profile) => profile.id)).toContain(targetId);

      const normalAdminSession = await normalAdmin.auth.getSession();
      const normalAdminRoute = await fetch(appUrl + "/api/lanflow/time-tracking/admin?month=" + month, {
        headers: { Authorization: "Bearer " + normalAdminSession.data.session!.access_token },
      });
      expect(normalAdminRoute.status).toBe(403);
    } finally {
      for (const profileId of [targetId, normalAdminId, systemManagerId]) {
        await deleteEmployee(service, profileId);
      }
    }
  });
});
