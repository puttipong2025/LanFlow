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

function nextBangkokMonthBoundary() {
  const [year, month] = bangkokDate().split("-").map(Number);
  const activation = new Date(Date.UTC(year, month, 1));
  return {
    effectiveDate: activation.toISOString().slice(0, 10),
    activationMonth: activation.toISOString().slice(0, 7),
  };
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

async function latestStartedPeriodId(client: SupabaseClient, profileId: string) {
  const result = await client
    .from("time_payroll_active_periods")
    .select("id")
    .eq("profile_id", profileId)
    .lte("start_on", bangkokDate())
    .order("start_on", { ascending: false })
    .limit(1)
    .single();
  expect(result.error).toBeNull();
  return result.data!.id as string;
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

let temporaryLocationId: string | null = null;

test.describe.serial("Exception attendance backend contract @time-payroll-exceptions-backend", () => {
  test.use({ storageState: "playwright/.auth/super_admin.json" });

  test.beforeAll(async () => {
    const service = serviceClient();
    const existing = await service.from("locations").select("id").eq("is_active", true);
    expect(existing.error).toBeNull();
    if ((existing.data?.length ?? 0) < 2) {
      temporaryLocationId = crypto.randomUUID();
      expect((await service.from("locations").insert({
        id: temporaryLocationId,
        name: `สาขาทดสอบข้อยกเว้น ${temporaryLocationId.slice(0, 6)}`,
        code: `TE${temporaryLocationId.replaceAll("-", "").slice(0, 6).toUpperCase()}`,
        is_active: true,
      })).error).toBeNull();
    }
  });

  test.afterAll(async () => {
    if (temporaryLocationId) {
      await serviceClient().from("locations").delete().eq("id", temporaryLocationId);
    }
  });

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
      expect(nullProfile.error?.message).toContain("Forbidden");

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

  test("RESUME without period or END history is rejected without creating a period", async () => {
    const service = serviceClient();
    const manager = await globalManagerClient();
    const employeeId = await createEmployee(service, "QA resume requires history");

    try {
      const resumed = await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "RESUME",
        p_effective_date: bangkokDate(-30),
      });
      expect(resumed.error?.message).toContain("NO_PERIOD_HISTORY_TO_RESUME");

      const periods = await manager
        .from("time_payroll_active_periods")
        .select("id")
        .eq("profile_id", employeeId);
      expect(periods.error).toBeNull();
      expect(periods.data).toEqual([]);
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

  test("RESUME accepts a previous open payroll month without touching withdrawal balance", async () => {
    const service = serviceClient();
    const manager = await globalManagerClient();
    const employeeId = await createEmployee(service, "QA resume month boundary");
    const firstCurrent = `${bangkokDate().slice(0, 7)}-01`;
    const previousMonthEnd = new Date(`${firstCurrent}T12:00:00Z`);
    previousMonthEnd.setUTCDate(previousMonthEnd.getUTCDate() - 1);
    const previousMonth = previousMonthEnd.toISOString().slice(0, 7);
    const previousStart = `${previousMonth}-01`;
    const previousPause = `${previousMonth}-02`;
    const previousResume = previousMonthEnd.toISOString().slice(0, 10);

    try {
      expect((await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "ENABLE",
        p_effective_date: previousStart,
      })).error).toBeNull();
      expect((await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "PAUSE",
        p_effective_date: previousPause,
      })).error).toBeNull();
      const withdrawal = await manager.rpc("create_time_tracking_transaction", {
        p_profile_id: employeeId,
        p_type: "WITHDRAWAL",
        p_amount: 1000,
        p_effective_date: firstCurrent,
        p_description: "QA RESUME financial no-op",
      });
      expect(withdrawal.error).toBeNull();
      const withdrawalId = (withdrawal.data as { id: string }).id;
      const beforeResume = await service
        .from("financial_transactions")
        .select("remaining_amount")
        .eq("id", withdrawalId)
        .single();
      expect(beforeResume.error).toBeNull();
      expect(Number(beforeResume.data!.remaining_amount)).toBe(1000);

      const resumed = await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "RESUME",
        p_effective_date: previousResume,
      });
      expect(resumed.error).toBeNull();
      const afterResume = await service
        .from("financial_transactions")
        .select("remaining_amount")
        .eq("id", withdrawalId)
        .single();
      expect(afterResume.error).toBeNull();
      expect(Number(afterResume.data!.remaining_amount)).toBe(1000);
    } finally {
      await deleteEmployee(service, employeeId);
    }
  });

  test("corrects the latest period start without audit or financial side effects", async () => {
    const service = serviceClient();
    const manager = await globalManagerClient();
    const employeeId = await createEmployee(service, "QA resume date correction");
    const firstCurrent = `${bangkokDate().slice(0, 7)}-01`;
    const previousMonthEndValue = new Date(`${firstCurrent}T12:00:00Z`);
    previousMonthEndValue.setUTCDate(previousMonthEndValue.getUTCDate() - 1);
    const previousMonthEnd = previousMonthEndValue.toISOString().slice(0, 10);
    const previousMonth = previousMonthEnd.slice(0, 7);

    try {
      expect((await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "ENABLE",
        p_effective_date: `${previousMonth}-01`,
      })).error).toBeNull();
      expect((await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "PAUSE",
        p_effective_date: `${previousMonth}-02`,
      })).error).toBeNull();
      const withdrawal = await manager.rpc("create_time_tracking_transaction", {
        p_profile_id: employeeId,
        p_type: "WITHDRAWAL",
        p_amount: 1000,
        p_effective_date: firstCurrent,
        p_description: "QA correction financial no-op",
      });
      expect(withdrawal.error).toBeNull();
      const withdrawalId = (withdrawal.data as { id: string }).id;
      expect((await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "RESUME",
        p_effective_date: firstCurrent,
      })).error).toBeNull();
      expect((await manager.rpc("replace_time_payroll_attendance_exceptions", {
        p_profile_id: employeeId,
        p_month: firstCurrent.slice(0, 7),
        p_selections: [{ date: firstCurrent, status: "HALF_DAY" }],
      })).error).toBeNull();
      const pendingPauseOn = bangkokDate(1);
      expect((await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "PAUSE",
        p_effective_date: pendingPauseOn,
      })).error).toBeNull();
      const session = await manager.auth.getSession();
      const authorization = `Bearer ${session.data.session!.access_token}`;
      const stateResponse = await fetch(`${appUrl}/api/lanflow/time-tracking/admin?month=${firstCurrent.slice(0, 7)}`, {
        headers: { Authorization: authorization },
      });
      expect(stateResponse.status).toBe(200);
      const statePayload = await stateResponse.json() as {
        users: Array<{ id: string; period_state: { periodStartCorrection: {
          periodId: string;
          currentStartOn: string;
          earliestOn: string | null;
          latestOn: string;
          endOn: string | null;
        } | null } }>;
      };
      const periodCorrection = statePayload.users.find((user) => user.id === employeeId)?.period_state.periodStartCorrection;
      expect(periodCorrection).toEqual({
        periodId: expect.any(String),
        currentStartOn: firstCurrent,
        earliestOn: `${previousMonth}-02`,
        latestOn: bangkokDate(),
        endOn: bangkokDate(),
      });
      const periodId = periodCorrection!.periodId;
      const auditBefore = await service
        .from("time_tracking_audit_logs")
        .select("id", { count: "exact", head: true })
        .eq("record_id", employeeId);
      expect(auditBefore.error).toBeNull();

      const overlapping = await manager.rpc("correct_time_payroll_period_start", {
        p_profile_id: employeeId,
        p_period_id: periodId,
        p_start_on: `${previousMonth}-01`,
      });
      expect(overlapping.error?.message).toContain("PERIOD_START_OVERLAPS_PREVIOUS");
      const future = await manager.rpc("correct_time_payroll_period_start", {
        p_profile_id: employeeId,
        p_period_id: periodId,
        p_start_on: pendingPauseOn,
      });
      expect(future.error?.message).toContain("PERIOD_START_CORRECTION_DATE_IN_FUTURE");

      const corrected = await fetch(`${appUrl}/api/lanflow/time-tracking/admin`, {
        method: "POST",
        headers: { Authorization: authorization, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CORRECT_PAYROLL_PERIOD_START",
          payload: { user_id: employeeId, period_id: periodId, start_on: previousMonthEnd },
        }),
      });
      expect(corrected.status, await corrected.text()).toBe(200);
      const correctedAgain = await manager.rpc("correct_time_payroll_period_start", {
        p_profile_id: employeeId,
        p_period_id: periodId,
        p_start_on: firstCurrent,
      });
      expect(correctedAgain.error).toBeNull();
      const noOpCorrection = await manager.rpc("correct_time_payroll_period_start", {
        p_profile_id: employeeId,
        p_period_id: periodId,
        p_start_on: firstCurrent,
      });
      expect(noOpCorrection.error?.message).toContain("INVALID_PERIOD_START_CORRECTION");

      const periods = await manager
        .from("time_payroll_active_periods")
        .select("start_on,end_on,scheduled_action,scheduled_effective_on")
        .eq("profile_id", employeeId)
        .order("start_on", { ascending: true });
      expect(periods.error).toBeNull();
      expect(periods.data?.at(-1)).toEqual({
        start_on: firstCurrent,
        end_on: bangkokDate(),
        scheduled_action: "PAUSE",
        scheduled_effective_on: pendingPauseOn,
      });
      const exceptions = await manager
        .from("time_payroll_attendance_exceptions")
        .select("work_date,status")
        .eq("profile_id", employeeId);
      expect(exceptions.error).toBeNull();
      expect(exceptions.data).toEqual([{ work_date: firstCurrent, status: "HALF_DAY" }]);

      const auditAfter = await service
        .from("time_tracking_audit_logs")
        .select("id", { count: "exact", head: true })
        .eq("record_id", employeeId);
      expect(auditAfter.error).toBeNull();
      expect(auditAfter.count).toBe(auditBefore.count);

      const transactionAfter = await service
        .from("financial_transactions")
        .select("remaining_amount")
        .eq("id", withdrawalId)
        .single();
      expect(transactionAfter.error).toBeNull();
      expect(Number(transactionAfter.data!.remaining_amount)).toBe(1000);
    } finally {
      await deleteEmployee(service, employeeId);
    }
  });

  test("corrects an initial closed period in place and rejects a stale period id", async () => {
    const service = serviceClient();
    const manager = await globalManagerClient();
    const managerUser = await manager.auth.getUser();
    const managerId = managerUser.data.user!.id;
    const employeeId = await createEmployee(service, "QA initial closed period correction");
    const today = bangkokDate();
    const initialStart = `${today.slice(0, 7)}-01`;
    const closedEnd = bangkokDate(-1);
    const previousMonthEndValue = new Date(`${initialStart}T12:00:00Z`);
    previousMonthEndValue.setUTCDate(previousMonthEndValue.getUTCDate() - 1);
    const correctedStart = previousMonthEndValue.toISOString().slice(0, 10);

    try {
      expect((await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "ENABLE",
        p_effective_date: initialStart,
      })).error).toBeNull();
      expect((await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "PAUSE",
        p_effective_date: today,
      })).error).toBeNull();

      const periodId = await latestStartedPeriodId(manager, employeeId);
      const employee = await signedInClient(await phoneFor(service, employeeId));
      const forbiddenRpc = await employee.rpc("correct_time_payroll_period_start", {
        p_profile_id: employeeId,
        p_period_id: periodId,
        p_start_on: correctedStart,
      });
      expect(forbiddenRpc.error?.message).toContain("Forbidden");
      const employeeSession = await employee.auth.getSession();
      const forbiddenRoute = await fetch(`${appUrl}/api/lanflow/time-tracking/admin`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${employeeSession.data.session!.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "CORRECT_PAYROLL_PERIOD_START",
          payload: { user_id: employeeId, period_id: periodId, start_on: correctedStart },
        }),
      });
      expect(forbiddenRoute.status).toBe(403);

      const stale = await manager.rpc("correct_time_payroll_period_start", {
        p_profile_id: employeeId,
        p_period_id: crypto.randomUUID(),
        p_start_on: correctedStart,
      });
      expect(stale.error?.message).toContain("PERIOD_START_CORRECTION_STALE");

      const currentMonthSlip = await service.from("payroll_slips").insert({
        profile_id: employeeId,
        month: initialStart.slice(0, 7),
        status: "PENDING",
        created_by: managerId,
      });
      expect(currentMonthSlip.error).toBeNull();

      const session = await manager.auth.getSession();
      const response = await fetch(`${appUrl}/api/lanflow/time-tracking/admin`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.data.session!.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "CORRECT_PAYROLL_PERIOD_START",
          payload: { user_id: employeeId, period_id: periodId, start_on: correctedStart },
        }),
      });
      const responseBody = await response.json() as {
        result?: { affectedFrom?: string; affectedThrough?: string };
        error?: string;
      };
      expect(response.status, JSON.stringify(responseBody)).toBe(200);
      expect(responseBody.result).toMatchObject({
        affectedFrom: correctedStart,
        affectedThrough: correctedStart,
      });

      const corrected = await manager
        .from("time_payroll_active_periods")
        .select("id,start_on,end_on")
        .eq("profile_id", employeeId)
        .single();
      expect(corrected.error).toBeNull();
      expect(corrected.data).toEqual({ id: periodId, start_on: correctedStart, end_on: closedEnd });

      const movedForward = await manager.rpc("correct_time_payroll_period_start", {
        p_profile_id: employeeId,
        p_period_id: periodId,
        p_start_on: initialStart,
      });
      expect(movedForward.error).toBeNull();
    } finally {
      await deleteEmployee(service, employeeId);
    }
  });

  test("corrects only the head row of the latest contiguous period chain", async () => {
    const service = serviceClient();
    const manager = await globalManagerClient();
    const employeeId = await createEmployee(service, "QA contiguous period correction");
    const correctedStart = bangkokDate(-2);
    const chainHeadStart = bangkokDate(-1);
    const chainTailStart = bangkokDate();

    try {
      expect((await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "ENABLE",
        p_effective_date: chainHeadStart,
      })).error).toBeNull();
      expect((await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "PAUSE",
        p_effective_date: chainTailStart,
      })).error).toBeNull();
      expect((await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "RESUME",
        p_effective_date: chainTailStart,
      })).error).toBeNull();

      const before = await manager
        .from("time_payroll_active_periods")
        .select("id,start_on,end_on")
        .eq("profile_id", employeeId)
        .order("start_on", { ascending: true });
      expect(before.error).toBeNull();
      expect(before.data).toHaveLength(2);
      const chainHeadId = before.data![0].id;
      const chainTailId = before.data![1].id;

      const staleTail = await manager.rpc("correct_time_payroll_period_start", {
        p_profile_id: employeeId,
        p_period_id: chainTailId,
        p_start_on: correctedStart,
      });
      expect(staleTail.error?.message).toContain("PERIOD_START_CORRECTION_STALE");

      const corrected = await manager.rpc("correct_time_payroll_period_start", {
        p_profile_id: employeeId,
        p_period_id: chainHeadId,
        p_start_on: correctedStart,
      });
      expect(corrected.error).toBeNull();

      const periods = await manager
        .from("time_payroll_active_periods")
        .select("id,start_on,end_on")
        .eq("profile_id", employeeId)
        .order("start_on", { ascending: true });
      expect(periods.error).toBeNull();
      expect(periods.data).toEqual([{
        id: chainHeadId,
        start_on: correctedStart,
        end_on: chainHeadStart,
      }, {
        id: chainTailId,
        start_on: chainTailStart,
        end_on: null,
      }]);
    } finally {
      await deleteEmployee(service, employeeId);
    }
  });

  test("period start correction reports the first payroll, report, or real-deduction blocker atomically", async () => {
    const service = serviceClient();
    const manager = await globalManagerClient();
    const managerUser = await manager.auth.getUser();
    const managerId = managerUser.data.user!.id;
    const managerProfile = await service
      .from("profiles")
      .select("name,phone")
      .eq("id", managerId)
      .single();
    expect(managerProfile.error).toBeNull();
    const employeeId = await createEmployee(service, "QA period correction blockers");
    const locationId = crypto.randomUUID();
    const reportId = crypto.randomUUID();
    const reportNo = `RPT-CORRECT-${reportId.replaceAll("-", "").slice(0, 10).toUpperCase()}`;
    const firstCurrent = `${bangkokDate().slice(0, 7)}-01`;
    const previousMonthEndValue = new Date(`${firstCurrent}T12:00:00Z`);
    previousMonthEndValue.setUTCDate(previousMonthEndValue.getUTCDate() - 1);
    const previousMonthEnd = previousMonthEndValue.toISOString().slice(0, 10);
    const previousMonth = previousMonthEnd.slice(0, 7);
    let slipId: string | null = null;

    try {
      expect((await service.from("locations").insert({
        id: locationId,
        name: `สาขาทดสอบ correction ${locationId.slice(0, 6)}`,
        code: `RC${locationId.replaceAll("-", "").slice(0, 6).toUpperCase()}`,
        is_active: true,
      })).error).toBeNull();
      expect((await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "ENABLE",
        p_effective_date: `${previousMonth}-01`,
      })).error).toBeNull();
      expect((await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "PAUSE",
        p_effective_date: `${previousMonth}-02`,
      })).error).toBeNull();
      expect((await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "RESUME",
        p_effective_date: firstCurrent,
      })).error).toBeNull();

      const slip = await service.from("payroll_slips").insert({
        profile_id: employeeId,
        month: previousMonth,
        status: "PENDING",
        created_by: managerId,
      }).select("id").single();
      expect(slip.error).toBeNull();
      slipId = slip.data!.id;
      expect((await service.from("report_batches").insert({
        id: reportId,
        report_no: reportNo,
        report_date: bangkokDate(),
        sequence_no: 1,
        location_id: locationId,
        cutoff_at: `${bangkokDate()}T16:00:00+07:00`,
        created_by_user_id: managerId,
        created_by_name: managerProfile.data!.name,
        created_by_phone: managerProfile.data!.phone,
      })).error).toBeNull();
      expect((await service.from("report_items").insert({
        report_id: reportId,
        location_id: locationId,
        entity_type: "payroll_slip",
        entity_id: slipId,
        eligibility_at: `${bangkokDate()}T16:00:00+07:00`,
      })).error).toBeNull();

      const periodId = await latestStartedPeriodId(manager, employeeId);
      const reportBlocked = await manager.rpc("correct_time_payroll_period_start", {
        p_profile_id: employeeId,
        p_period_id: periodId,
        p_start_on: previousMonthEnd,
      });
      expect(reportBlocked.error?.message).toContain(
        `REPORT_LOCKED:${reportNo}:PAYROLL_SLIP:${previousMonth}:PENDING:${slipId}`,
      );
      const session = await manager.auth.getSession();
      const reportBlockedResponse = await fetch(`${appUrl}/api/lanflow/time-tracking/admin`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.data.session!.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "CORRECT_PAYROLL_PERIOD_START",
          payload: { user_id: employeeId, period_id: periodId, start_on: previousMonthEnd },
        }),
      });
      const reportBlockedPayload = await reportBlockedResponse.json();
      expect(reportBlockedResponse.status).toBe(409);
      expect(reportBlockedPayload.error).toContain(previousMonth);
      expect(reportBlockedPayload.error).toContain(reportNo);

      expect((await service.from("report_items").delete().eq("report_id", reportId)).error).toBeNull();
      expect((await service.from("report_batches").delete().eq("id", reportId)).error).toBeNull();
      const slipBlocked = await manager.rpc("correct_time_payroll_period_start", {
        p_profile_id: employeeId,
        p_period_id: periodId,
        p_start_on: previousMonthEnd,
      });
      expect(slipBlocked.error?.message).toContain(
        `MONTH_CLOSED:${previousMonth}:PAYROLL_SLIP:PENDING:${slipId}`,
      );
      expect((await service.from("payroll_slips").delete().eq("id", slipId)).error).toBeNull();
      slipId = null;

      const withdrawal = await manager.rpc("create_time_tracking_transaction", {
        p_profile_id: employeeId,
        p_type: "WITHDRAWAL",
        p_amount: 1000,
        p_effective_date: previousMonthEnd,
        p_description: "QA applied correction blocker",
      });
      expect(withdrawal.error).toBeNull();
      const deductionBlocked = await manager.rpc("correct_time_payroll_period_start", {
        p_profile_id: employeeId,
        p_period_id: periodId,
        p_start_on: previousMonthEnd,
      });
      expect(deductionBlocked.error?.message).toMatch(
        new RegExp(`DEDUCTION_LOCKED:${previousMonth}:WITHDRAWAL_DEDUCTION:[0-9a-f-]+`),
      );

      const openPeriod = await manager
        .from("time_payroll_active_periods")
        .select("start_on")
        .eq("profile_id", employeeId)
        .is("end_on", null)
        .single();
      expect(openPeriod.error).toBeNull();
      expect(openPeriod.data?.start_on).toBe(firstCurrent);
    } finally {
      await service.from("report_items").delete().eq("report_id", reportId);
      await service.from("report_batches").delete().eq("id", reportId);
      if (slipId) await service.from("payroll_slips").delete().eq("id", slipId);
      await deleteEmployee(service, employeeId);
      await service.from("locations").delete().eq("id", locationId);
    }
  });

  test("period start correction and payroll close serialize to one consistent month snapshot", async () => {
    const service = serviceClient();
    const manager = await globalManagerClient();
    const employeeId = await createEmployee(service, "QA correction payroll race");
    const firstCurrent = `${bangkokDate().slice(0, 7)}-01`;
    const previousMonthEndValue = new Date(`${firstCurrent}T12:00:00Z`);
    previousMonthEndValue.setUTCDate(previousMonthEndValue.getUTCDate() - 1);
    const previousMonthEnd = previousMonthEndValue.toISOString().slice(0, 10);
    const previousMonth = previousMonthEnd.slice(0, 7);

    try {
      expect((await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "ENABLE",
        p_effective_date: `${previousMonth}-01`,
      })).error).toBeNull();
      expect((await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "PAUSE",
        p_effective_date: `${previousMonth}-02`,
      })).error).toBeNull();
      expect((await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "RESUME",
        p_effective_date: firstCurrent,
      })).error).toBeNull();

      const periodId = await latestStartedPeriodId(manager, employeeId);
      const [correction, slip] = await Promise.all([
        manager.rpc("correct_time_payroll_period_start", {
          p_profile_id: employeeId,
          p_period_id: periodId,
          p_start_on: previousMonthEnd,
        }),
        manager.rpc("create_time_tracking_payroll_slip", {
          p_profile_id: employeeId,
          p_month: previousMonth,
          p_auto_start_next_month: false,
        }),
      ]);
      expect(slip.error).toBeNull();

      const slipDays = Number((slip.data as { total_days: number }).total_days);
      if (correction.error) {
        expect(correction.error.message).toContain(`MONTH_CLOSED:${previousMonth}`);
        expect(slipDays).toBe(1);
      } else {
        expect(slipDays).toBe(2);
      }

      const current = await manager
        .from("time_payroll_active_periods")
        .select("start_on")
        .eq("profile_id", employeeId)
        .is("end_on", null)
        .single();
      expect(current.error).toBeNull();
      expect(current.data?.start_on).toBe(correction.error ? firstCurrent : previousMonthEnd);
    } finally {
      await deleteEmployee(service, employeeId);
    }
  });

  test("initial closed-period correction stays usable at 360px", async ({ page }) => {
    const service = serviceClient();
    const manager = await globalManagerClient();
    const employeeName = `QA correction browser ${Date.now()}`;
    const employeeId = await createEmployee(service, employeeName);
    const today = bangkokDate();
    const lastPaidDate = bangkokDate(-1);
    const firstCurrent = `${today.slice(0, 7)}-01`;
    const previousMonthEndValue = new Date(`${firstCurrent}T12:00:00Z`);
    previousMonthEndValue.setUTCDate(previousMonthEndValue.getUTCDate() - 1);
    const previousMonthEnd = previousMonthEndValue.toISOString().slice(0, 10);

    try {
      expect((await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "ENABLE",
        p_effective_date: firstCurrent,
      })).error).toBeNull();
      expect((await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "PAUSE",
        p_effective_date: today,
      })).error).toBeNull();

      await page.setViewportSize({ width: 360, height: 800 });
      await page.goto("/");
      await page.getByRole("button", { name: "เวลาและเงินเดือน", exact: true }).click();
      await expect(page.getByRole("heading", { name: "จัดการเวลาและเงินเดือน" })).toBeVisible({ timeout: 30_000 });
      await page.getByRole("button", { name: "ทั้งหมด", exact: true }).click();
      const calendarButton = page.getByRole("button", {
        name: `จัดการปฏิทินวันทำงานของ ${employeeName}`,
      });
      await expect(calendarButton).toBeVisible();
      await calendarButton.click();

      const employeeDialog = page.getByRole("dialog", { name: "ข้อมูลของพนักงาน" });
      await expect(employeeDialog.getByText("จัดการการคิดค่าแรง")).toBeVisible();
      await expect(employeeDialog.getByText("สถานะปัจจุบัน: ไม่ได้คิดค่าแรง")).toBeVisible();
      await expect(employeeDialog.getByText("ปฏิทินวันทำงาน")).toBeVisible();
      const correctionButton = employeeDialog.getByRole("button", { name: "แก้ไขวันเริ่ม" });
      await correctionButton.click();

      const correctionDialog = page.getByRole("dialog", { name: "แก้ไขวันเริ่มช่วงล่าสุด" });
      const correctionInput = correctionDialog.getByLabel("วันเริ่มที่ถูกต้อง");
      await expect(correctionInput).not.toHaveAttribute("min", /.+/);
      await expect(correctionInput).toHaveAttribute("max", lastPaidDate);
      await correctionInput.fill(previousMonthEnd);
      await expect(correctionDialog.getByRole("button", { name: "ยืนยันแก้ไขวันเริ่ม" })).toBeEnabled();
      await expect(correctionDialog).toContainText("ระบบจะตรวจเดือนที่ได้รับผล");
      await expect(correctionDialog).not.toContainText(today.slice(0, 7));
      const dimensions = await correctionDialog.evaluate((element) => ({
        width: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);

      await page.setViewportSize({ width: 393, height: 852 });
      const widerDimensions = await correctionDialog.evaluate((element) => ({
        width: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      expect(widerDimensions.scrollWidth).toBeLessThanOrEqual(widerDimensions.width);

      await page.keyboard.press("Escape");
      await expect(correctionDialog).toBeHidden();
      await expect(correctionButton).toBeFocused();

      const resumeButton = employeeDialog.getByRole("button", { name: "กลับมาคิดค่าแรง", exact: true });
      await resumeButton.click();
      const resumeDialog = page.getByRole("dialog", { name: "กลับมาคิดค่าแรง" });
      await expect(resumeDialog.getByLabel("วันแรกที่กลับมาคิดค่าแรง")).toHaveValue(today);
      await expect(resumeDialog).toContainText("กำหนดให้");
      await page.keyboard.press("Escape");
      await expect(resumeDialog).toBeHidden();
      await expect(resumeButton).toBeFocused();
    } finally {
      await deleteEmployee(service, employeeId);
    }
  });

  test("active-period history and individual FULL/HALF_DAY/OFF produce the expected summary", async () => {
    const service = serviceClient();
    const manager = await globalManagerClient();
    const employeeId = await createEmployee(service, "QA attendance lifecycle");
    const previousMonthEnd = new Date(`${bangkokDate().slice(0, 7)}-01T00:00:00Z`);
    previousMonthEnd.setUTCDate(previousMonthEnd.getUTCDate() - 1);
    const lifecycleDate = (offsetDays: number) => new Date(
      previousMonthEnd.getTime() + offsetDays * 86_400_000,
    ).toISOString().slice(0, 10);
    const startOn = lifecycleDate(-4);
    const secondDay = lifecycleDate(-3);
    const resumeOn = lifecycleDate(-1);
    const endOn = lifecycleDate(0);
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
      expect(futureEnd.error).toBeNull();
      expect(futureEnd.data).toMatchObject({ scheduled: true, activationOn: bangkokDate(1) });

      const ended = await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "END",
        p_effective_date: endOn,
      });
      expect(ended.error?.message).toContain("END_DATE_IN_PAST");
      expect((await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "PAUSE",
        p_effective_date: lifecycleDate(1),
      })).error).toBeNull();

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
          fullDays: 3,
          halfDays: 1,
          offDays: 1,
          paidDays: 3.5,
          grossPay: 1750,
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
          fullDays: 4,
          halfDays: 1,
          offDays: 0,
          paidDays: 4.5,
          grossPay: 2250,
        },
      });

      const overlappingResume = await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "RESUME",
        p_effective_date: secondDay,
      });
      expect(overlappingResume.error?.message).toContain("RESUME_OVERLAPS_PREVIOUS_PERIOD");
      const periods = await manager
        .from("time_payroll_active_periods")
        .select("start_on, end_on")
        .eq("profile_id", employeeId)
        .order("start_on");
      expect(periods.error).toBeNull();
      expect(periods.data).toEqual([
        { start_on: startOn, end_on: endOn },
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

  test("END today is immediate and same-day RESUME does not duplicate attendance", async () => {
    const service = serviceClient();
    const manager = await globalManagerClient();
    const employeeId = await createEmployee(service, "QA same-day resume");
    const today = bangkokDate();
    const yesterday = bangkokDate(-1);

    try {
      const location = await service.from("locations").select("id").eq("is_active", true).limit(1).single();
      expect(location.error).toBeNull();
      await primaryLocation(service, employeeId, location.data!.id);
      expect((await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "ENABLE",
        p_effective_date: yesterday,
      })).error).toBeNull();
      const initialCorrection = await manager.rpc("correct_time_payroll_resume_start", {
        p_profile_id: employeeId,
        p_start_on: today,
      });
      expect(initialCorrection.error?.message).toContain("NO_RESUME_PERIOD_TO_CORRECT");
      const settings = await manager.rpc("get_time_payroll_settings");
      expect(settings.error).toBeNull();
      const beforeEnd = new Date();
      const ended = await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "END",
        p_effective_date: today,
      });
      const afterEnd = new Date();
      expect(ended.error).toBeNull();
      expect(ended.data).toMatchObject({ scheduled: false, activationOn: today });

      const endedPeriod = await manager
        .from("time_payroll_active_periods")
        .select("start_on, end_on, scheduled_action, scheduled_effective_on, scheduled_activation_on")
        .eq("profile_id", employeeId)
        .single();
      expect(endedPeriod.error).toBeNull();
      const cutoff = String(settings.data?.workdayEndTime);
      const allowedEndDates = new Set([
        expectedEligibleThrough(cutoff, beforeEnd),
        expectedEligibleThrough(cutoff, afterEnd),
      ]);
      expect(allowedEndDates).toContain(endedPeriod.data!.end_on);
      expect(endedPeriod.data).toMatchObject({
        start_on: yesterday,
        scheduled_action: null,
        scheduled_effective_on: null,
        scheduled_activation_on: null,
      });

      const noPending = await manager.rpc("cancel_time_payroll_active_period_schedule", {
        p_profile_id: employeeId,
      });
      expect(noPending.error?.message).toContain("NO_PENDING_PERIOD_ACTION");

      const resumed = await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "RESUME",
        p_effective_date: today,
      });
      expect(resumed.error).toBeNull();
      const reopenedCorrection = await manager.rpc("correct_time_payroll_resume_start", {
        p_profile_id: employeeId,
        p_start_on: today,
      });
      if (endedPeriod.data!.end_on === today) {
        expect(reopenedCorrection.error?.message).toContain("NO_RESUME_PERIOD_TO_CORRECT");
      } else {
        expect(reopenedCorrection.error?.message).toContain("INVALID_RESUME_CORRECTION");
      }
      const resumedPeriods = await manager
        .from("time_payroll_active_periods")
        .select("start_on, end_on")
        .eq("profile_id", employeeId)
        .order("start_on");
      expect(resumedPeriods.error).toBeNull();
      expect(resumedPeriods.data?.filter((period) => period.end_on === null)).toHaveLength(1);
      expect(resumedPeriods.data?.filter((period) => period.start_on <= today && (period.end_on === null || period.end_on >= today))).toHaveLength(1);

      const audits = await manager
        .from("time_tracking_audit_logs")
        .select("id", { count: "exact", head: true })
        .eq("record_id", employeeId)
        .eq("action", "SET_PAYROLL_ACTIVE_PERIOD");
      expect(audits.error).toBeNull();
      expect(audits.count).toBe(3);

      const session = await manager.auth.getSession();
      const authorization = `Bearer ${session.data.session!.access_token}`;

      const attendanceUpdate = await fetch(appUrl + "/api/lanflow/time-tracking/admin", {
        method: "POST",
        headers: { Authorization: authorization, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "REPLACE_ATTENDANCE_EXCEPTIONS",
          payload: { user_id: employeeId, month: today.slice(0, 7), selections: [{ date: today, status: "OFF" }] },
        }),
      });
      expect(attendanceUpdate.ok, await attendanceUpdate.text()).toBeTruthy();

      const periodsAfterAttendance = await manager
        .from("time_payroll_active_periods")
        .select("start_on, end_on")
        .eq("profile_id", employeeId);
      expect(periodsAfterAttendance.error).toBeNull();
      expect(periodsAfterAttendance.data).toEqual(resumedPeriods.data);
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

  test("END before cutoff removes a zero-day period but audit history still offers RESUME", async () => {
    const service = serviceClient();
    const manager = await globalManagerClient();
    const employeeId = await createEmployee(service, "QA zero-day END history");
    const today = bangkokDate();
    const settings = await manager.rpc("get_time_payroll_settings");
    expect(settings.error).toBeNull();
    test.skip(
      expectedEligibleThrough(String(settings.data?.workdayEndTime), new Date()) === today,
      "This integration path only applies before the current Bangkok workday cutoff",
    );

    try {
      expect((await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "ENABLE",
        p_effective_date: today,
      })).error).toBeNull();
      const ended = await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "END",
        p_effective_date: today,
      });
      expect(ended.error).toBeNull();
      expect(ended.data).toMatchObject({ endDayEarned: false, scheduled: false });

      const rows = await manager
        .from("time_payroll_active_periods")
        .select("id")
        .eq("profile_id", employeeId);
      expect(rows.error).toBeNull();
      expect(rows.data).toEqual([]);

      const session = await manager.auth.getSession();
      const response = await fetch(
        appUrl + `/api/lanflow/time-tracking/user?userId=${employeeId}&month=${today.slice(0, 7)}`,
        {
        headers: { Authorization: `Bearer ${session.data.session!.access_token}` },
        },
      );
      const body = await response.json();
      expect(response.ok, JSON.stringify(body)).toBeTruthy();
      expect(body.periodState).toMatchObject({
        currentStatus: "INACTIVE",
        hasPeriodHistory: true,
        resumeEarliestOn: today,
      });

      const backdatedResume = await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "RESUME",
        p_effective_date: bangkokDate(-1),
      });
      expect(backdatedResume.error?.message).toContain("RESUME_BEFORE_LAST_END_DATE");

      expect((await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "RESUME",
        p_effective_date: today,
      })).error).toBeNull();
      const resumed = await manager
        .from("time_payroll_active_periods")
        .select("start_on, end_on")
        .eq("profile_id", employeeId);
      expect(resumed.error).toBeNull();
      expect(resumed.data).toEqual([{ start_on: today, end_on: null }]);
    } finally {
      await deleteEmployee(service, employeeId);
    }
  });

  test("future period scheduling reschedules atomically and blocks payroll close in both directions", async ({ page }) => {
    const service = serviceClient();
    const manager = await globalManagerClient();
    const scheduledEmployeeName = `QA future period schedule ${Date.now()}`;
    const scheduledEmployee = await createEmployee(service, scheduledEmployeeName);
    const closedEmployee = await createEmployee(service, "QA future period closed month");
    const tomorrow = bangkokDate(1);
    const later = bangkokDate(2);
    const month = tomorrow.slice(0, 7);

    try {
      const first = await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: scheduledEmployee,
        p_action: "ENABLE",
        p_effective_date: tomorrow,
      });
      expect(first.error).toBeNull();
      expect(first.data).toMatchObject({
        action: "ENABLE",
        selectedEffectiveOn: tomorrow,
        activationOn: tomorrow,
        scheduled: true,
      });

      const rescheduled = await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: scheduledEmployee,
        p_action: "ENABLE",
        p_effective_date: later,
      });
      expect(rescheduled.error).toBeNull();
      const scheduledRows = await manager
        .from("time_payroll_active_periods")
        .select("start_on, end_on, scheduled_action, scheduled_effective_on, scheduled_activation_on")
        .eq("profile_id", scheduledEmployee);
      expect(scheduledRows.error).toBeNull();
      expect(scheduledRows.data).toEqual([{
        start_on: later,
        end_on: null,
        scheduled_action: "ENABLE",
        scheduled_effective_on: later,
        scheduled_activation_on: later,
      }]);

      const session = await manager.auth.getSession();
      const scheduleStateResponse = await fetch(
        appUrl + `/api/lanflow/time-tracking/user?userId=${scheduledEmployee}&month=${month}`,
        { headers: { Authorization: `Bearer ${session.data.session!.access_token}` } },
      );
      const scheduleStateBody = await scheduleStateResponse.json();
      expect(scheduleStateResponse.ok, JSON.stringify(scheduleStateBody)).toBeTruthy();
      expect(scheduleStateBody.periodState).toMatchObject({
        currentStatus: "INACTIVE",
        hasPeriodHistory: false,
        nextAction: { action: "ENABLE", activationOn: later },
      });

      const blockedSlip = await manager.rpc("create_time_tracking_payroll_slip", {
        p_profile_id: scheduledEmployee,
        p_month: month,
        p_auto_start_next_month: false,
      });
      expect(blockedSlip.error?.message).toContain(`PENDING_PERIOD_ACTION:${month}`);

      await page.setViewportSize({ width: 360, height: 800 });
      await page.goto("/");
      await page.getByRole("button", { name: "เวลาและเงินเดือน", exact: true }).click();
      await expect(page.getByRole("heading", { name: "จัดการเวลาและเงินเดือน" })).toBeVisible({ timeout: 30_000 });
      await page.getByLabel("ค้นหาพนักงาน").fill(scheduledEmployeeName);
      const calendarButton = page.getByRole("button", { name: `จัดการปฏิทินวันทำงานของ ${scheduledEmployeeName}` });
      await calendarButton.click();
      const employeeDialog = page.getByRole("dialog", { name: "ข้อมูลของพนักงาน" });
      await expect(employeeDialog.getByText("กำหนดไว้: เริ่มคิดค่าแรง")).toBeVisible();
      await expect(employeeDialog.getByRole("button", { name: "แก้ไขวันเริ่ม" })).toHaveCount(0);
      const editScheduleButton = employeeDialog.getByRole("button", { name: "แก้กำหนดการ" });
      await editScheduleButton.click();
      const scheduleDialog = page.getByRole("dialog", { name: "เริ่มคิดค่าแรง" });
      await expect(scheduleDialog.getByLabel("วันเริ่มคิดค่าแรง")).toHaveValue(later);
      await expect(scheduleDialog).toContainText("กำหนดการนี้จะแทนที่");
      await expect(scheduleDialog.getByRole("button", { name: "ยืนยันและแทนที่กำหนดเดิม" })).toBeVisible();
      const scheduleDimensions = await scheduleDialog.evaluate((element) => ({
        width: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      expect(scheduleDimensions.scrollWidth).toBeLessThanOrEqual(scheduleDimensions.width);
      await page.keyboard.press("Escape");
      await expect(scheduleDialog).toBeHidden();
      await expect(editScheduleButton).toBeFocused();

      const cancelled = await manager.rpc("cancel_time_payroll_active_period_schedule", {
        p_profile_id: scheduledEmployee,
      });
      expect(cancelled.error).toBeNull();
      const afterCancel = await manager
        .from("time_payroll_active_periods")
        .select("id")
        .eq("profile_id", scheduledEmployee);
      expect(afterCancel.data).toEqual([]);

      const today = bangkokDate();
      expect((await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: closedEmployee,
        p_action: "ENABLE",
        p_effective_date: today,
      })).error).toBeNull();
      const closedSlip = await manager.rpc("create_time_tracking_payroll_slip", {
        p_profile_id: closedEmployee,
        p_month: today.slice(0, 7),
        p_auto_start_next_month: false,
      });
      expect(closedSlip.error).toBeNull();
      const blockedSchedule = await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: closedEmployee,
        p_action: "END",
        p_effective_date: today,
      });
      expect(blockedSchedule.error?.message).toContain(`MONTH_CLOSED:${today.slice(0, 7)}`);
    } finally {
      await deleteEmployee(service, scheduledEmployee);
      await deleteEmployee(service, closedEmployee);
    }
  });

  test("END at month boundary locks the activation month for set, reschedule, cancel, and payroll close", async () => {
    const service = serviceClient();
    const manager = await globalManagerClient();
    const existingSlipEmployee = await createEmployee(service, "QA END activation month lock");
    const scheduledEmployee = await createEmployee(service, "QA END activation pending lock");
    const { effectiveDate, activationMonth } = nextBangkokMonthBoundary();
    let futureSlipId: string | null = null;
    let scheduledFutureSlipId: string | null = null;

    try {
      for (const profileId of [existingSlipEmployee, scheduledEmployee]) {
        expect((await manager.rpc("set_time_payroll_active_period", {
          p_profile_id: profileId,
          p_action: "ENABLE",
          p_effective_date: bangkokDate(),
        })).error).toBeNull();
      }

      const futureSlip = await service.from("payroll_slips").insert({
        profile_id: existingSlipEmployee,
        month: activationMonth,
        status: "PENDING",
        created_by: existingSlipEmployee,
      }).select("id").single();
      expect(futureSlip.error).toBeNull();
      futureSlipId = futureSlip.data!.id;

      const blockedSet = await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: existingSlipEmployee,
        p_action: "END",
        p_effective_date: effectiveDate,
      });
      expect(blockedSet.error?.message).toContain(`MONTH_CLOSED:${activationMonth}`);

      expect((await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: scheduledEmployee,
        p_action: "END",
        p_effective_date: effectiveDate,
      })).error).toBeNull();

      const blockedClose = await manager.rpc("create_time_tracking_payroll_slip", {
        p_profile_id: scheduledEmployee,
        p_month: activationMonth,
        p_auto_start_next_month: false,
      });
      expect(blockedClose.error?.message).toContain(`PENDING_PERIOD_ACTION:${activationMonth}`);

      const scheduledFutureSlip = await service.from("payroll_slips").insert({
        profile_id: scheduledEmployee,
        month: activationMonth,
        status: "PENDING",
        created_by: scheduledEmployee,
      }).select("id").single();
      expect(scheduledFutureSlip.error).toBeNull();
      scheduledFutureSlipId = scheduledFutureSlip.data!.id;

      const blockedReschedule = await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: scheduledEmployee,
        p_action: "END",
        p_effective_date: effectiveDate,
      });
      expect(blockedReschedule.error?.message).toContain(`MONTH_CLOSED:${activationMonth}`);

      const blockedCancel = await manager.rpc("cancel_time_payroll_active_period_schedule", {
        p_profile_id: scheduledEmployee,
      });
      expect(blockedCancel.error?.message).toContain(`MONTH_CLOSED:${activationMonth}`);
    } finally {
      if (futureSlipId) await service.from("payroll_slips").delete().eq("id", futureSlipId);
      if (scheduledFutureSlipId) await service.from("payroll_slips").delete().eq("id", scheduledFutureSlipId);
      await deleteEmployee(service, existingSlipEmployee);
      await deleteEmployee(service, scheduledEmployee);
    }
  });

  test("future PAUSE and RESUME preserve today's state and audit the activation time", async () => {
    const service = serviceClient();
    const manager = await globalManagerClient();
    const pauseEmployee = await createEmployee(service, "QA future pause");
    const resumeEmployee = await createEmployee(service, "QA future resume");
    const yesterday = bangkokDate(-1);
    const today = bangkokDate();
    const tomorrow = bangkokDate(1);

    try {
      for (const profileId of [pauseEmployee, resumeEmployee]) {
        expect((await manager.rpc("set_time_payroll_active_period", {
          p_profile_id: profileId,
          p_action: "ENABLE",
          p_effective_date: yesterday,
        })).error).toBeNull();
      }
      expect((await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: resumeEmployee,
        p_action: "PAUSE",
        p_effective_date: today,
      })).error).toBeNull();

      const futurePause = await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: pauseEmployee,
        p_action: "PAUSE",
        p_effective_date: tomorrow,
      });
      const futureResume = await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: resumeEmployee,
        p_action: "RESUME",
        p_effective_date: tomorrow,
      });
      expect(futurePause.error).toBeNull();
      expect(futurePause.data).toMatchObject({ scheduled: true, activationOn: tomorrow });
      expect(futureResume.error).toBeNull();
      expect(futureResume.data).toMatchObject({ scheduled: true, activationOn: tomorrow });

      const pausedPeriod = await manager
        .from("time_payroll_active_periods")
        .select("start_on, end_on, scheduled_action, scheduled_activation_on")
        .eq("profile_id", pauseEmployee)
        .single();
      expect(pausedPeriod.data).toEqual({
        start_on: yesterday,
        end_on: today,
        scheduled_action: "PAUSE",
        scheduled_activation_on: tomorrow,
      });
      const resumedPeriods = await manager
        .from("time_payroll_active_periods")
        .select("start_on, end_on, scheduled_action, scheduled_activation_on")
        .eq("profile_id", resumeEmployee)
        .order("start_on");
      expect(resumedPeriods.data).toEqual([
        { start_on: yesterday, end_on: yesterday, scheduled_action: null, scheduled_activation_on: null },
        { start_on: tomorrow, end_on: null, scheduled_action: "RESUME", scheduled_activation_on: tomorrow },
      ]);

      const audit = await manager
        .from("time_tracking_audit_logs")
        .select("comment")
        .eq("record_id", resumeEmployee)
        .eq("action", "SET_PAYROLL_ACTIVE_PERIOD")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      expect(audit.error).toBeNull();
      expect(audit.data?.comment).toContain(`มีผล ${tomorrow} 00:00 Asia/Bangkok`);
    } finally {
      await deleteEmployee(service, pauseEmployee);
      await deleteEmployee(service, resumeEmployee);
    }
  });

  test("period scheduling serializes schedule and payroll-slip races per employee", async () => {
    const service = serviceClient();
    const manager = await globalManagerClient();
    const payrollRaceEmployee = await createEmployee(service, "QA schedule slip race");
    const scheduleRaceEmployee = await createEmployee(service, "QA schedule schedule race");
    const today = bangkokDate();
    const tomorrow = bangkokDate(1);
    const later = bangkokDate(2);

    try {
      expect((await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: payrollRaceEmployee,
        p_action: "ENABLE",
        p_effective_date: today,
      })).error).toBeNull();

      const [scheduleResult, slipResult] = await Promise.all([
        manager.rpc("set_time_payroll_active_period", {
          p_profile_id: payrollRaceEmployee,
          p_action: "END",
          p_effective_date: today,
        }),
        manager.rpc("create_time_tracking_payroll_slip", {
          p_profile_id: payrollRaceEmployee,
          p_month: today.slice(0, 7),
          p_auto_start_next_month: false,
        }),
      ]);
      const raceErrors = [scheduleResult.error?.message, slipResult.error?.message].filter(Boolean);
      expect(raceErrors.length).toBeLessThanOrEqual(1);
      for (const error of raceErrors) expect(error).toMatch(/MONTH_CLOSED|NO_WORK_MONTH/);

      const concurrentSchedules = await Promise.all([
        manager.rpc("set_time_payroll_active_period", {
          p_profile_id: scheduleRaceEmployee,
          p_action: "ENABLE",
          p_effective_date: tomorrow,
        }),
        manager.rpc("set_time_payroll_active_period", {
          p_profile_id: scheduleRaceEmployee,
          p_action: "ENABLE",
          p_effective_date: later,
        }),
      ]);
      expect(concurrentSchedules.every((result) => result.error === null)).toBe(true);
      const pendingRows = await manager
        .from("time_payroll_active_periods")
        .select("start_on, scheduled_action, scheduled_activation_on")
        .eq("profile_id", scheduleRaceEmployee);
      expect(pendingRows.error).toBeNull();
      expect(pendingRows.data).toHaveLength(1);
      expect(pendingRows.data?.[0].scheduled_action).toBe("ENABLE");
      expect([tomorrow, later]).toContain(pendingRows.data?.[0].scheduled_activation_on);
    } finally {
      await deleteEmployee(service, payrollRaceEmployee);
      await deleteEmployee(service, scheduleRaceEmployee);
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
      expect(delegatedDashboard.permissions.canDecide).toBe(true);
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
        p_action: "PAUSE",
        p_effective_date: bangkokDate(),
      });
      expect(delegatedPeriod.error).toBeNull();
      expect((await employee.rpc("request_time_tracking_withdrawal", { p_amount: 5 })).error).toBeNull();
      const pendingWithdrawal = await employee
        .from("financial_transactions")
        .select("id")
        .eq("profile_id", employeeA)
        .eq("type", "WITHDRAWAL")
        .eq("status", "PENDING")
        .single();
      expect(pendingWithdrawal.error).toBeNull();
      const delegatedDecision = await delegated.rpc("decide_time_tracking_approval", {
        p_source_type: "transaction",
        p_source_id: pendingWithdrawal.data!.id,
        p_decision: "APPROVED",
        p_comment: null,
        p_expense_location_id: branchA,
      });
      expect(delegatedDecision.error).toBeNull();
      const delegatedDelete = await delegated.rpc("delete_time_tracking_source_permanently", {
        p_source_type: "transaction",
        p_source_id: pendingWithdrawal.data!.id,
      });
      expect(delegatedDelete.error).toBeNull();

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
      })).error?.message).toContain("END_DATE_IN_PAST");
      expect((await globalManager.rpc("set_time_payroll_active_period", {
        p_profile_id: debtEmployee,
        p_action: "PAUSE",
        p_effective_date: firstCurrent,
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
      })).error?.message).toContain("END_DATE_IN_PAST");
      expect((await globalManager.rpc("set_time_payroll_active_period", {
        p_profile_id: debtEmployee,
        p_action: "PAUSE",
        p_effective_date: bangkokDate(),
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
        expect(ended.error?.message).toContain("END_DATE_IN_PAST");
        expect((await globalManager.rpc("set_time_payroll_active_period", {
          p_profile_id: profileId,
          p_action: "PAUSE",
          p_effective_date: bangkokDate(),
        })).error).toBeNull();
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

      const delegatedCreated = await delegated.rpc("create_time_tracking_payroll_slip", {
        p_profile_id: pendingEmployee,
        p_month: currentMonth,
        p_auto_start_next_month: false,
      });
      expect(delegatedCreated.error).toBeNull();
      expect(delegatedCreated.data).toMatchObject({ status: "APPROVED", net_pay: 500 });
      const createdSlipId = (delegatedCreated.data as { id: string }).id;
      const deletedOwnCreated = await delegated.rpc("delete_time_tracking_source_permanently", {
        p_source_type: "payroll_slip",
        p_source_id: createdSlipId,
      });
      expect(deletedOwnCreated.error).toBeNull();

      const delegatedApproved = await delegated.rpc("create_time_tracking_payroll_slip", {
        p_profile_id: approvedEmployee,
        p_month: currentMonth,
        p_auto_start_next_month: false,
      });
      expect(delegatedApproved.error).toBeNull();
      expect(delegatedApproved.data).toMatchObject({ status: "APPROVED", net_pay: 500 });
      const approvedSlipId = (delegatedApproved.data as { id: string }).id;
      const delegatedMoveApproved = await delegated.rpc("change_time_tracking_expense_location", {
        p_source_type: "payroll_slip",
        p_source_id: approvedSlipId,
        p_expense_location_id: branchId,
        p_comment: null,
      });
      expect(delegatedMoveApproved.error).toBeNull();
      const delegatedDeleteApproved = await delegated.rpc("delete_time_tracking_source_permanently", {
        p_source_type: "payroll_slip",
        p_source_id: approvedSlipId,
      });
      expect(delegatedDeleteApproved.error).toBeNull();
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

  test("daily wage keeps four decimals and payroll rounds .49 down and .50 up with initial audit fields", async () => {
    const service = serviceClient();
    const globalManager = await globalManagerClient();
    const location = await service.from("locations").select("id").eq("is_active", true).order("id").limit(1).single();
    expect(location.error).toBeNull();
    const branchId = location.data!.id;
    const workDate = bangkokDate(-1);
    const month = workDate.slice(0, 7);
    const cases = [
      { label: "QA payroll round down", wage: 1000.49, net: 1000, adjustment: -0.49 },
      { label: "QA payroll round up", wage: 1000.5, net: 1001, adjustment: 0.5 },
      { label: "QA payroll round zero", wage: 0.49, net: 0, adjustment: -0.49 },
      { label: "QA payroll round one", wage: 0.5, net: 1, adjustment: 0.5 },
      { label: "QA payroll four decimals", wage: 500.1234, net: 500, adjustment: -0.12 },
    ];
    const employeeIds: string[] = [];
    for (const item of cases) employeeIds.push(await createEmployee(service, item.label));

    try {
      for (const [index, profileId] of employeeIds.entries()) {
        const expected = cases[index];
        await primaryLocation(service, profileId, branchId);

        const wage = await globalManager.rpc("update_time_tracking_wage", {
          p_profile_id: profileId,
          p_daily_wage: expected.wage,
        });
        expect(wage.error).toBeNull();
        expect(Number(wage.data?.dailyWage)).toBe(expected.wage);

        const storedWage = await service.from("profiles").select("daily_wage").eq("id", profileId).single();
        expect(storedWage.error).toBeNull();
        expect(Number(storedWage.data!.daily_wage)).toBe(expected.wage);

        expect((await globalManager.rpc("set_time_payroll_active_period", {
          p_profile_id: profileId,
          p_action: "ENABLE",
          p_effective_date: workDate,
        })).error).toBeNull();
        expect((await globalManager.rpc("set_time_payroll_active_period", {
          p_profile_id: profileId,
          p_action: "END",
          p_effective_date: workDate,
        })).error?.message).toContain("END_DATE_IN_PAST");
        expect((await globalManager.rpc("set_time_payroll_active_period", {
          p_profile_id: profileId,
          p_action: "PAUSE",
          p_effective_date: bangkokDate(),
        })).error).toBeNull();

        const created = await globalManager.rpc("create_time_tracking_payroll_slip", {
          p_profile_id: profileId,
          p_month: month,
          p_auto_start_next_month: false,
        });
        expect(created.error).toBeNull();
        expect(Number(created.data?.net_pay)).toBe(expected.net);
        expect(Number(created.data?.slip_data?.netPayBeforeRounding)).toBe(
          Math.trunc(expected.wage * 100) / 100,
        );
        expect(Number(created.data?.slip_data?.roundingAdjustment)).toBeCloseTo(expected.adjustment, 8);

        const createAudit = await service
          .from("time_tracking_audit_logs")
          .select("new_data")
          .eq("record_id", created.data!.id)
          .eq("action", "CREATE_PAYROLL_SLIP")
          .single();
        expect(createAudit.error).toBeNull();
        expect(Number(createAudit.data!.new_data.slip_data.netPayBeforeRounding)).toBe(
          Math.trunc(expected.wage * 100) / 100,
        );
        expect(Number(createAudit.data!.new_data.slip_data.roundingAdjustment)).toBeCloseTo(
          expected.adjustment,
          8,
        );
      }

      const excessivePrecision = await globalManager.rpc("update_time_tracking_wage", {
        p_profile_id: employeeIds[0],
        p_daily_wage: 500.12345,
      });
      expect(excessivePrecision.error?.message).toContain("INVALID_WAGE_PRECISION");

      const directConstraint = await service
        .from("profiles")
        .update({ daily_wage: 500.12345 })
        .eq("id", employeeIds[0]);
      expect(directConstraint.error?.message).toContain("profiles_daily_wage_precision");
    } finally {
      for (const profileId of employeeIds) await deleteEmployee(service, profileId);
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
    const futureResumeDate = nextBangkokMonthBoundary().effectiveDate;

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
      })).error?.message).toContain("END_DATE_IN_PAST");
      expect((await systemManager.rpc("set_time_payroll_active_period", {
        p_profile_id: targetId,
        p_action: "PAUSE",
        p_effective_date: bangkokDate(),
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
      expect((await systemManager.rpc("set_time_payroll_active_period", {
        p_profile_id: targetId,
        p_action: "RESUME",
        p_effective_date: futureResumeDate,
      })).error).toBeNull();
      const normalAdminCancel = await normalAdmin.rpc("cancel_time_payroll_active_period_schedule", {
        p_profile_id: targetId,
      });
      expect(normalAdminCancel.error?.message).toContain("Forbidden");
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
        users: Array<{
          id: string;
          period_state: {
            currentStatus: string;
            nextAction: { action: string; activationOn: string } | null;
          };
        }>;
      };
      expect(systemPayload.permissions).toMatchObject({ canDecide: true, canConfigure: true });
      expect(systemPayload.users.map((profile) => profile.id)).toContain(targetId);
      expect(systemPayload.users.find((profile) => profile.id === targetId)?.period_state).toMatchObject({
        currentStatus: "INACTIVE",
        nextAction: { action: "RESUME", activationOn: futureResumeDate },
      });

      const targetClient = await signedInClient(await phoneFor(service, targetId));
      const targetSession = await targetClient.auth.getSession();
      const targetRoute = await fetch(appUrl + "/api/lanflow/time-tracking/user?month=" + month, {
        headers: { Authorization: "Bearer " + targetSession.data.session!.access_token },
      });
      expect(targetRoute.status).toBe(200);
      expect((await targetRoute.json()).periodState).toMatchObject({
        currentStatus: "INACTIVE",
        nextAction: { action: "RESUME", activationOn: futureResumeDate },
      });

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

  test("reported withdrawal still settles through payroll while direct balance edits stay locked", async () => {
    const service = serviceClient();
    const manager = await globalManagerClient();
    const managerUser = await manager.auth.getUser();
    const managerId = managerUser.data.user!.id;
    const managerProfile = await service
      .from("profiles")
      .select("name, phone")
      .eq("id", managerId)
      .single();
    expect(managerProfile.error).toBeNull();

    const employeeId = await createEmployee(service, "QA reported payroll settlement");
    const locationId = crypto.randomUUID();
    const reportId = crypto.randomUUID();
    const reportNo = `RPT-LOCK-${reportId.replaceAll("-", "").slice(0, 12).toUpperCase()}`;
    let withdrawalId: string | null = null;

    try {
      expect((await service.from("locations").insert({
        id: locationId,
        name: `สาขาทดสอบ payroll lock ${locationId.slice(0, 6)}`,
        code: `PL${locationId.replaceAll("-", "").slice(0, 6).toUpperCase()}`,
        is_active: true,
      })).error).toBeNull();
      await primaryLocation(service, employeeId, locationId);
      expect((await service.from("profiles").update({ daily_wage: 0 }).eq("id", employeeId)).error)
        .toBeNull();

      expect((await manager.rpc("set_time_payroll_active_period", {
        p_profile_id: employeeId,
        p_action: "ENABLE",
        p_effective_date: "2026-08-01",
      })).error).toBeNull();
      const withdrawal = await manager.rpc("create_time_tracking_transaction", {
        p_profile_id: employeeId,
        p_type: "WITHDRAWAL",
        p_amount: 1000,
        p_effective_date: "2026-08-08",
        p_description: "QA reported withdrawal",
      });
      expect(withdrawal.error).toBeNull();
      expect(withdrawal.data).toMatchObject({ status: "approved" });
      withdrawalId = (withdrawal.data as { id: string }).id;
      expect((await manager.rpc("update_time_tracking_wage", {
        p_profile_id: employeeId,
        p_daily_wage: 500,
      })).error).toBeNull();

      expect((await service.from("report_batches").insert({
        id: reportId,
        report_no: reportNo,
        report_date: "2026-08-08",
        sequence_no: 1,
        location_id: locationId,
        cutoff_at: "2026-08-08T16:00:00+07:00",
        created_by_user_id: managerId,
        created_by_name: managerProfile.data!.name,
        created_by_phone: managerProfile.data!.phone,
      })).error).toBeNull();
      expect((await service.from("report_items").insert({
        report_id: reportId,
        location_id: locationId,
        entity_type: "financial_transaction",
        entity_id: withdrawalId,
        eligibility_at: "2026-08-08T16:00:00+07:00",
      })).error).toBeNull();

      const directBeforePayroll = await service
        .from("financial_transactions")
        .update({ remaining_amount: 999 })
        .eq("id", withdrawalId);
      expect(directBeforePayroll.error?.message).toContain(`REPORT_LOCKED:${reportNo}`);

      const slip = await manager.rpc("create_time_tracking_payroll_slip", {
        p_profile_id: employeeId,
        p_month: "2026-08",
        p_auto_start_next_month: false,
      });
      expect(slip.error).toBeNull();
      expect(slip.data).toMatchObject({ status: "APPROVED", total_deductions: 1000 });

      const source = await service
        .from("financial_transactions")
        .select("amount, remaining_amount")
        .eq("id", withdrawalId)
        .single();
      expect(source.error).toBeNull();
      expect(Number(source.data!.amount)).toBe(1000);
      expect(Number(source.data!.remaining_amount)).toBe(0);

      const deductions = await service
        .from("financial_transactions")
        .select("type, amount, applied_month")
        .eq("parent_debt_id", withdrawalId);
      expect(deductions.error).toBeNull();
      expect(deductions.data).toEqual([{
        type: "WITHDRAWAL_DEDUCTION",
        amount: 1000,
        applied_month: "2026-08-01",
      }]);
      const reportItem = await service
        .from("report_items")
        .select("active")
        .eq("report_id", reportId)
        .eq("entity_id", withdrawalId)
        .single();
      expect(reportItem.error).toBeNull();
      expect(reportItem.data!.active).toBe(true);

      const directAfterPayroll = await service
        .from("financial_transactions")
        .update({ remaining_amount: 100 })
        .eq("id", withdrawalId);
      expect(directAfterPayroll.error?.message).toContain(`REPORT_LOCKED:${reportNo}`);
    } finally {
      await service.from("report_items").delete().eq("report_id", reportId);
      await service.from("report_batches").delete().eq("id", reportId);
      await deleteEmployee(service, employeeId);
      await service.from("locations").delete().eq("id", locationId);
    }
  });
});
