import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  || "";
const password = process.env.TEST_PASSWORD || "password123";

function serviceClient() {
  expect(serviceRoleKey).toBeTruthy();
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function managerClient() {
  expect(publishableKey).toBeTruthy();
  const client = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const testPhone = process.env.TEST_PHONE || "0800000000";
  const { error } = await client.auth.signInWithPassword({
    phone: testPhone.startsWith("+") ? testPhone : `+66${testPhone.slice(1)}`,
    password,
  });
  expect(error).toBeNull();
  return client;
}

function bangkokToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addMonths(month: string, delta: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function paidSegments(profileId: string, month: string, days: number) {
  return Array.from({ length: days }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return {
      profile_id: profileId,
      start_time: `${month}-${day}T07:00:00+07:00`,
      end_time: `${month}-${day}T15:00:00+07:00`,
    };
  });
}

async function createEmployee(
  service: SupabaseClient,
  dailyWage: number,
  suffix: string,
) {
  const phone = `+669${String(Date.now()).slice(-7)}${suffix}`.slice(0, 12);
  const { data, error } = await service.auth.admin.createUser({
    phone,
    password,
    phone_confirm: true,
    user_metadata: { name: `หักทันที ${suffix}` },
  });
  expect(error).toBeNull();
  expect(data.user).toBeTruthy();

  const profileId = data.user!.id;
  const { error: profileError } = await service
    .from("profiles")
    .upsert({
      id: profileId,
      phone,
      name: `หักทันที ${suffix}`,
      role: "user",
      is_active: true,
      daily_wage: dailyWage,
      can_access_super_admin_features: false,
    });
  expect(profileError).toBeNull();
  return { profileId, phone };
}

async function deleteEmployee(service: SupabaseClient, profileId: string) {
  await service.from("time_tracking_audit_logs").delete().eq("record_id", profileId);
  await service.from("financial_transactions").delete().eq("profile_id", profileId);
  await service.from("time_segments").delete().eq("profile_id", profileId);
  await service.from("payroll_slips").delete().eq("profile_id", profileId);
  await service.auth.admin.deleteUser(profileId);
}

test.describe("Time Tracking immediate deduction @time-tracking", () => {
  test("deducts 30,000 across two 15,000 wage months exactly once without a negative balance", async () => {
    const service = serviceClient();
    const manager = await managerClient();
    const currentMonth = bangkokToday().slice(0, 7);
    const firstMonth = addMonths(currentMonth, -2);
    const secondMonth = addMonths(currentMonth, -1);
    const employee = await createEmployee(service, 500, "1");

    try {
      const { error: segmentError } = await service.from("time_segments").insert([
        ...paidSegments(employee.profileId, firstMonth, 30),
        ...paidSegments(employee.profileId, secondMonth, 30),
      ]);
      expect(segmentError).toBeNull();

      const { data: created, error: createError } = await manager.rpc(
        "create_time_tracking_transaction",
        {
          p_profile_id: employee.profileId,
          p_type: "DEBT",
          p_amount: 30_000,
          p_effective_date: `${firstMonth}-01`,
          p_description: "ทดสอบยกยอดสองเดือน",
        },
      );
      expect(createError).toBeNull();
      const sourceId = (created as { id: string }).id;

      const firstApproval = await manager.rpc("decide_time_tracking_approval", {
        p_source_type: "transaction",
        p_source_id: sourceId,
        p_decision: "APPROVED",
        p_comment: "อนุมัติทดสอบ",
      });
      expect(firstApproval.error).toBeNull();
      expect(firstApproval.data).toMatchObject({ idempotent: false });

      const retry = await manager.rpc("decide_time_tracking_approval", {
        p_source_type: "transaction",
        p_source_id: sourceId,
        p_decision: "APPROVED",
        p_comment: "อนุมัติทดสอบ",
      });
      expect(retry.error).toBeNull();
      expect(retry.data).toMatchObject({ idempotent: true });

      const { data: source } = await service
        .from("financial_transactions")
        .select("remaining_amount")
        .eq("id", sourceId)
        .single();
      expect(Number(source?.remaining_amount)).toBe(0);

      const { data: deductions, error: deductionError } = await service
        .from("financial_transactions")
        .select("amount, applied_month")
        .eq("parent_debt_id", sourceId)
        .order("applied_month");
      expect(deductionError).toBeNull();
      expect(deductions).toEqual([
        expect.objectContaining({ amount: 15_000, applied_month: `${firstMonth}-01` }),
        expect.objectContaining({ amount: 15_000, applied_month: `${secondMonth}-01` }),
      ]);
      expect(deductions?.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(30_000);

      const editDeductedMonth = await manager.rpc("replace_time_tracking_segments", {
        p_profile_id: employee.profileId,
        p_selections: [{ date: `${firstMonth}-01`, work_type: "NONE" }],
        p_full_snapshot: {},
        p_comment: "ต้องถูกล็อกหลังหักเงินจริง",
      });
      expect(editDeductedMonth.error?.message).toContain(`DEDUCTION_LOCKED:${firstMonth}`);
      const editWageAfterDeduction = await manager.rpc("update_time_tracking_wage", {
        p_profile_id: employee.profileId,
        p_daily_wage: 1,
      });
      expect(editWageAfterDeduction.error?.message).toContain("DEDUCTION_WAGE_LOCKED");

      const slip = await manager.rpc("create_time_tracking_payroll_slip", {
        p_profile_id: employee.profileId,
        p_month: firstMonth,
        p_auto_start_next_month: false,
      });
      expect(slip.error).toBeNull();
      expect(Number((slip.data as { net_pay: number }).net_pay)).toBe(0);

      const closedMonthAttempt = await manager.rpc("create_time_tracking_transaction", {
        p_profile_id: employee.profileId,
        p_type: "DEBT",
        p_amount: 1,
        p_effective_date: `${firstMonth}-15`,
        p_description: "ต้องถูกบล็อก",
      });
      expect(closedMonthAttempt.error?.message).toContain(`MONTH_CLOSED:${firstMonth}`);

      const deleteSlip = await manager.rpc("delete_time_tracking_source_permanently", {
        p_source_type: "payroll_slip",
        p_source_id: (slip.data as { id: string }).id,
      });
      expect(deleteSlip.error).toBeNull();
    } finally {
      await deleteEmployee(service, employee.profileId);
    }
  });

  test("lets a user create/delete only their pending withdrawal and forbids time controls and debt", async () => {
    const service = serviceClient();
    const employee = await createEmployee(service, 500, "2");
    const user = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    try {
      const signIn = await user.auth.signInWithPassword({
        phone: employee.phone,
        password,
      });
      expect(signIn.error).toBeNull();

      const startAttempt = await user.rpc("set_time_tracking_status", {
        p_profile_id: employee.profileId,
        p_status: "RUNNING",
      });
      expect(startAttempt.error?.message).toContain("Forbidden");

      const debtAttempt = await user.rpc("create_time_tracking_transaction", {
        p_profile_id: employee.profileId,
        p_type: "DEBT",
        p_amount: 100,
        p_effective_date: bangkokToday(),
        p_description: "หนี้",
      });
      expect(debtAttempt.error?.message).toContain("Forbidden");

      const withdrawal = await user.rpc("create_time_tracking_transaction", {
        p_profile_id: employee.profileId,
        p_type: "WITHDRAWAL",
        p_amount: 100,
        p_effective_date: bangkokToday(),
        p_description: null,
      });
      expect(withdrawal.error).toBeNull();

      const deleted = await user.rpc("delete_time_tracking_source_permanently", {
        p_source_type: "transaction",
        p_source_id: (withdrawal.data as { id: string }).id,
      });
      expect(deleted.error).toBeNull();

      const futureAttempt = await user.rpc("create_time_tracking_transaction", {
        p_profile_id: employee.profileId,
        p_type: "WITHDRAWAL",
        p_amount: 100,
        p_effective_date: "2099-01-01",
        p_description: null,
      });
      expect(futureAttempt.error?.message).toContain("FUTURE_EFFECTIVE_DATE");
    } finally {
      await deleteEmployee(service, employee.profileId);
    }
  });

  test("blocks payroll on pending items and enforces oldest worked month while skipping empty months", async () => {
    const service = serviceClient();
    const manager = await managerClient();
    const currentMonth = bangkokToday().slice(0, 7);
    const workedMonth = addMonths(currentMonth, -2);
    const emptyMonth = addMonths(currentMonth, -1);
    const employee = await createEmployee(service, 500, "6");

    try {
      const segmentInsert = await service
        .from("time_segments")
        .insert(paidSegments(employee.profileId, workedMonth, 1));
      expect(segmentInsert.error).toBeNull();

      const pending = await manager.rpc("create_time_tracking_transaction", {
        p_profile_id: employee.profileId,
        p_type: "DEBT",
        p_amount: 100,
        p_effective_date: `${workedMonth}-01`,
        p_description: "รายการรออนุมัติ",
      });
      expect(pending.error).toBeNull();

      const pendingBlockedSlip = await manager.rpc("create_time_tracking_payroll_slip", {
        p_profile_id: employee.profileId,
        p_month: currentMonth,
        p_auto_start_next_month: false,
      });
      expect(pendingBlockedSlip.error?.message).toContain("PENDING_BLOCKER");

      const rejected = await manager.rpc("decide_time_tracking_approval", {
        p_source_type: "transaction",
        p_source_id: (pending.data as { id: string }).id,
        p_decision: "REJECTED",
        p_comment: "ปฏิเสธเพื่อออกสลิป",
      });
      expect(rejected.error).toBeNull();

      const olderBlockedSlip = await manager.rpc("create_time_tracking_payroll_slip", {
        p_profile_id: employee.profileId,
        p_month: currentMonth,
        p_auto_start_next_month: false,
      });
      expect(olderBlockedSlip.error?.message).toContain(`OLDER_WORK_MONTH:${workedMonth}`);

      const historicalSlip = await manager.rpc("create_time_tracking_payroll_slip", {
        p_profile_id: employee.profileId,
        p_month: workedMonth,
        p_auto_start_next_month: false,
      });
      expect(historicalSlip.error).toBeNull();

      const currentSlip = await manager.rpc("create_time_tracking_payroll_slip", {
        p_profile_id: employee.profileId,
        p_month: currentMonth,
        p_auto_start_next_month: false,
      });
      expect(currentSlip.error).toBeNull();
      expect(emptyMonth).not.toBe(workedMonth);

      const deleteCurrent = await manager.rpc("delete_time_tracking_source_permanently", {
        p_source_type: "payroll_slip",
        p_source_id: (currentSlip.data as { id: string }).id,
      });
      expect(deleteCurrent.error).toBeNull();
      const deleteHistorical = await manager.rpc("delete_time_tracking_source_permanently", {
        p_source_type: "payroll_slip",
        p_source_id: (historicalSlip.data as { id: string }).id,
      });
      expect(deleteHistorical.error).toBeNull();
    } finally {
      await deleteEmployee(service, employee.profileId);
    }
  });

  test("current-month close schedules only previously running staff and a manual manager stop cancels auto-start", async () => {
    const service = serviceClient();
    const manager = await managerClient();
    const currentMonth = bangkokToday().slice(0, 7);
    const employee = await createEmployee(service, 500, "7");
    const manuallyStopped = await createEmployee(service, 500, "8");

    try {
      const started = await manager.rpc("set_time_tracking_status", {
        p_profile_id: employee.profileId,
        p_status: "RUNNING",
      });
      expect(started.error).toBeNull();

      const slip = await manager.rpc("create_time_tracking_payroll_slip", {
        p_profile_id: employee.profileId,
        p_month: currentMonth,
        p_auto_start_next_month: true,
      });
      expect(slip.error).toBeNull();
      expect(slip.data).toMatchObject({ auto_start_scheduled: true });

      const { data: activeAfterClose } = await service
        .from("time_segments")
        .select("id")
        .eq("profile_id", employee.profileId)
        .is("end_time", null);
      expect(activeAfterClose).toHaveLength(0);
      const { data: schedules } = await service
        .from("time_tracking_resume_schedules")
        .select("profile_id, resume_at")
        .eq("profile_id", employee.profileId);
      expect(schedules).toHaveLength(1);
      const resumeBangkokDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Bangkok",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(schedules![0].resume_at));
      expect(resumeBangkokDate).toBe(`${addMonths(currentMonth, 1)}-01`);

      expect((await manager.rpc("set_time_tracking_status", {
        p_profile_id: manuallyStopped.profileId,
        p_status: "RUNNING",
      })).error).toBeNull();
      expect((await manager.rpc("set_time_tracking_status", {
        p_profile_id: manuallyStopped.profileId,
        p_status: "PAUSED",
      })).error).toBeNull();
      const { data: manualSchedules } = await service
        .from("time_tracking_resume_schedules")
        .select("profile_id")
        .eq("profile_id", manuallyStopped.profileId);
      expect(manualSchedules).toHaveLength(0);

      const deleteSlip = await manager.rpc("delete_time_tracking_source_permanently", {
        p_source_type: "payroll_slip",
        p_source_id: (slip.data as { id: string }).id,
      });
      expect(deleteSlip.error).toBeNull();
    } finally {
      await deleteEmployee(service, employee.profileId);
      await deleteEmployee(service, manuallyStopped.profileId);
    }
  });

  test("serializes concurrent approval retries into one deduction and one decision audit", async () => {
    const service = serviceClient();
    const firstManager = await managerClient();
    const secondManager = await managerClient();
    const currentMonth = bangkokToday().slice(0, 7);
    const employee = await createEmployee(service, 500, "9");

    try {
      expect((await service
        .from("time_segments")
        .insert(paidSegments(employee.profileId, currentMonth, 1))).error).toBeNull();
      const created = await firstManager.rpc("create_time_tracking_transaction", {
        p_profile_id: employee.profileId,
        p_type: "DEBT",
        p_amount: 500,
        p_effective_date: `${currentMonth}-01`,
        p_description: "อนุมัติพร้อมกัน",
      });
      expect(created.error).toBeNull();
      const sourceId = (created.data as { id: string }).id;

      const approvals = await Promise.all([
        firstManager.rpc("decide_time_tracking_approval", {
          p_source_type: "transaction",
          p_source_id: sourceId,
          p_decision: "APPROVED",
          p_comment: "พร้อมกัน",
        }),
        secondManager.rpc("decide_time_tracking_approval", {
          p_source_type: "transaction",
          p_source_id: sourceId,
          p_decision: "APPROVED",
          p_comment: "พร้อมกัน",
        }),
      ]);
      expect(approvals.every((result) => result.error === null)).toBeTruthy();
      expect(approvals.map((result) => (result.data as { idempotent: boolean }).idempotent).sort())
        .toEqual([false, true]);

      const deductions = await service
        .from("financial_transactions")
        .select("id, amount")
        .eq("parent_debt_id", sourceId);
      expect(deductions.error).toBeNull();
      expect(deductions.data).toHaveLength(1);
      expect(Number(deductions.data?.[0].amount)).toBe(500);

      const audit = await service
        .from("time_tracking_audit_logs")
        .select("id")
        .eq("record_id", sourceId)
        .eq("action", "DECIDE_TRANSACTION_APPROVAL");
      expect(audit.error).toBeNull();
      expect(audit.data).toHaveLength(1);
    } finally {
      await deleteEmployee(service, employee.profileId);
    }
  });
});
