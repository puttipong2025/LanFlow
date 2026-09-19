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

async function signedInClient(phone: string) {
  expect(publishableKey).toBeTruthy();
  const client = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await client.auth.signInWithPassword({ phone, password });
  expect(signIn.error).toBeNull();
  return client;
}

async function managerClient() {
  const phone = process.env.TEST_PHONE || "0800000000";
  return signedInClient(phone.startsWith("+") ? phone : `+66${phone.slice(1)}`);
}

function bangkokDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function createEmployee(service: SupabaseClient) {
  const id = crypto.randomUUID();
  const phone = `+668${String(Date.now()).slice(-8)}`;
  const auth = await service.auth.admin.createUser({
    id,
    phone,
    password,
    phone_confirm: true,
    user_metadata: { name: "QA ปรับยอดเบิก" },
  });
  expect(auth.error).toBeNull();
  const profile = await service.from("profiles").upsert({
    id,
    phone,
    name: "QA ปรับยอดเบิก",
    role: "user",
    is_active: true,
    daily_wage: 0,
    can_access_super_admin_features: false,
    can_manage_time_payroll: false,
  });
  expect(profile.error).toBeNull();
  return { id, phone };
}

async function lockInReport(
  service: SupabaseClient,
  actor: { id: string; name: string; phone: string },
  locationId: string,
  sourceIds: string | string[],
) {
  const reportId = crypto.randomUUID();
  const sequence = 100_000 + Math.floor(Math.random() * 800_000);
  const report = await service.from("report_batches").insert({
    id: reportId,
    report_no: `RPT-WADJ-${reportId.slice(0, 8)}`,
    report_date: bangkokDate(),
    sequence_no: sequence,
    location_id: locationId,
    cutoff_at: new Date().toISOString(),
    created_by_user_id: actor.id,
    created_by_name: actor.name,
    created_by_phone: actor.phone,
  });
  expect(report.error).toBeNull();
  const item = await service.from("report_items").insert(
    (Array.isArray(sourceIds) ? sourceIds : [sourceIds]).map((sourceId) => ({
      report_id: reportId,
      location_id: locationId,
      entity_type: "financial_transaction",
      entity_id: sourceId,
      eligibility_at: new Date().toISOString(),
    })),
  );
  expect(item.error).toBeNull();
  return reportId;
}

test.describe.serial("locked withdrawal adjustment @time-payroll-withdrawal-adjustment", () => {
  test("records the dashboard deletion when an unlocked source removes an approved adjustment", async () => {
    const service = serviceClient();
    const manager = await managerClient();
    const employee = await createEmployee(service);
    const managerUser = await manager.auth.getUser();
    expect(managerUser.error).toBeNull();
    const managerProfile = await manager.from("profiles")
      .select("id, name, phone")
      .eq("id", managerUser.data.user!.id)
      .single();
    expect(managerProfile.error).toBeNull();
    const location = await service.from("locations").select("id").eq("is_active", true).limit(1).single();
    expect(location.error).toBeNull();
    const assigned = await service.from("user_locations").insert({
      user_id: employee.id,
      location_id: location.data!.id,
      is_primary: true,
    });
    expect(assigned.error).toBeNull();

    const created = await manager.rpc("create_time_tracking_transaction", {
      p_profile_id: employee.id,
      p_type: "WITHDRAWAL",
      p_amount: 1000,
      p_effective_date: bangkokDate(),
      p_description: "ตรวจ dashboard delete ของ adjustment",
      p_expense_location_id: location.data!.id,
      p_comment: null,
    });
    expect(created.error).toBeNull();
    const source = await service.from("financial_transactions")
      .select("id")
      .eq("profile_id", employee.id)
      .eq("type", "WITHDRAWAL")
      .single();
    expect(source.error).toBeNull();
    const reportId = await lockInReport(service, managerProfile.data!, location.data!.id, source.data!.id);

    const adjusted = await manager.rpc("request_time_tracking_withdrawal_adjustment", {
      p_withdrawal_id: source.data!.id,
      p_target_amount: 700,
      p_expense_location_id: location.data!.id,
      p_reason: "คืนยอดบางส่วน",
    });
    expect(adjusted.error).toBeNull();

    const unlocked = await manager.rpc("delete_report_batch", { p_report_id: reportId });
    expect(unlocked.error).toBeNull();
    const deleted = await manager.rpc("delete_time_tracking_source_permanently", {
      p_source_type: "transaction",
      p_source_id: source.data!.id,
    });
    expect(deleted.error).toBeNull();

    const events = await service.from("dashboard_money_events")
      .select("action")
      .eq("source_type", "withdrawal_adjustment")
      .eq("source_id", adjusted.data.id)
      .order("occurred_at", { ascending: true });
    expect(events.error).toBeNull();
    expect(events.data?.map((event) => event.action)).toEqual(["create", "delete"]);
  });

  test("uses append-only targets, signed branch deltas, zero snapshot hiding, and a closed-slip floor", async () => {
    const service = serviceClient();
    const manager = await managerClient();
    const employee = await createEmployee(service);
    const managerUser = await manager.auth.getUser();
    expect(managerUser.error).toBeNull();
    const managerProfile = await manager.from("profiles")
      .select("id, name, phone")
      .eq("id", managerUser.data.user!.id)
      .single();
    expect(managerProfile.error).toBeNull();
    const location = await service.from("locations").select("id").eq("is_active", true).limit(1).single();
    expect(location.error).toBeNull();
    const assigned = await service.from("user_locations").insert({
      user_id: employee.id,
      location_id: location.data!.id,
      is_primary: true,
    });
    expect(assigned.error).toBeNull();

    const created = await manager.rpc("create_time_tracking_transaction", {
      p_profile_id: employee.id,
      p_type: "WITHDRAWAL",
      p_amount: 1000,
      p_effective_date: bangkokDate(),
      p_description: "เงินเบิกต้นทางสำหรับทดสอบ",
      p_expense_location_id: location.data!.id,
      p_comment: "ทดสอบปรับยอด",
    });
    expect(created.error).toBeNull();
    const source = await service.from("financial_transactions")
      .select("id, amount, status")
      .eq("profile_id", employee.id)
      .eq("type", "WITHDRAWAL")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    expect(source.error).toBeNull();
    expect(source.data).toMatchObject({ amount: 1000, status: "APPROVED" });
    await lockInReport(service, managerProfile.data!, location.data!.id, source.data!.id);

    for (const invalidTarget of ["NaN", "Infinity", "-Infinity"]) {
      const invalid = await manager.rpc("request_time_tracking_withdrawal_adjustment", {
        p_withdrawal_id: source.data!.id,
        p_target_amount: invalidTarget,
        p_expense_location_id: location.data!.id,
        p_reason: null,
      });
      expect(invalid.error?.message).toContain("INVALID_ADJUSTMENT_TARGET");
    }

    const openDeduction = await service.from("financial_transactions").insert({
      profile_id: employee.id,
      type: "WITHDRAWAL_DEDUCTION",
      amount: 400,
      remaining_amount: 0,
      status: "APPROVED",
      parent_debt_id: source.data!.id,
      applied_month: `${bangkokDate().slice(0, 7)}-01`,
      approved_by: managerProfile.data!.id,
      approved_at: new Date().toISOString(),
    });
    expect(openDeduction.error).toBeNull();

    const reduced = await manager.rpc("request_time_tracking_withdrawal_adjustment", {
      p_withdrawal_id: source.data!.id,
      p_target_amount: 0,
      p_expense_location_id: location.data!.id,
      p_reason: "คืนเต็มจำนวน",
    });
    expect(reduced.error).toBeNull();
    expect(reduced.data).toMatchObject({ status: "approved" });

    const unchangedSource = await service.from("financial_transactions")
      .select("amount, remaining_amount")
      .eq("id", source.data!.id)
      .single();
    expect(unchangedSource.error).toBeNull();
    expect(unchangedSource.data).toEqual({ amount: 1000, remaining_amount: 0 });
    const rebuiltOpenDeductions = await service.from("financial_transactions")
      .select("id")
      .eq("parent_debt_id", source.data!.id)
      .eq("type", "WITHDRAWAL_DEDUCTION")
      .eq("applied_month", `${bangkokDate().slice(0, 7)}-01`);
    expect(rebuiltOpenDeductions.error).toBeNull();
    expect(rebuiltOpenDeductions.data).toEqual([]);

    const zeroSnapshot = await service.from("payroll_slips").insert({
      profile_id: employee.id,
      month: "2026-08",
      gross_pay: 0,
      total_deductions: 0,
      net_pay: 0,
      total_days: 0,
      daily_wage: 0,
      status: "REJECTED",
      created_by: managerProfile.data!.id,
      slip_data: { transactions: [{ id: source.data!.id, type: "WITHDRAWAL", amount: 1000 }] },
    }).select("slip_data").single();
    expect(zeroSnapshot.error).toBeNull();
    expect(zeroSnapshot.data!.slip_data.transactions).toEqual([]);

    const increased = await manager.rpc("request_time_tracking_withdrawal_adjustment", {
      p_withdrawal_id: source.data!.id,
      p_target_amount: 1200,
      p_expense_location_id: location.data!.id,
      p_reason: "เพิ่มตามหลักฐาน",
    });
    expect(increased.error).toBeNull();
    expect(increased.data).toMatchObject({ status: "approved" });
    const increasedBalance = await service.from("financial_transactions")
      .select("remaining_amount")
      .eq("id", source.data!.id)
      .single();
    expect(increasedBalance.error).toBeNull();
    expect(increasedBalance.data!.remaining_amount).toBe(1200);

    const managerSession = await manager.auth.getSession();
    expect(managerSession.error).toBeNull();
    const adjustmentNumber = `TWA-${String(increased.data.id).slice(0, 8)}`;
    const latestOperationalFeedResponse = await fetch(
      `${appUrl}/api/lanflow/income-expense/feed?locationId=${location.data!.id}&mode=latest`,
      { headers: { Authorization: `Bearer ${managerSession.data.session!.access_token}` } },
    );
    expect(latestOperationalFeedResponse.status).toBe(200);
    const latestOperationalFeed = await latestOperationalFeedResponse.json();
    expect(latestOperationalFeed.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `time-tracking-withdrawal-adjustment:${increased.data.id}` }),
    ]));

    const operationalFeedResponse = await fetch(
      `${appUrl}/api/lanflow/income-expense/feed?locationId=${location.data!.id}&mode=latest&search=${encodeURIComponent(adjustmentNumber)}`,
      { headers: { Authorization: `Bearer ${managerSession.data.session!.access_token}` } },
    );
    expect(operationalFeedResponse.status).toBe(200);
    const operationalFeed = await operationalFeedResponse.json();
    expect(operationalFeed.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: `time-tracking-withdrawal-adjustment:${increased.data.id}`,
        number: adjustmentNumber,
        type: "expense",
        cost: 1200,
      }),
    ]));

    const feed = await manager.rpc("get_income_expense_feed", {
      p_location_id: location.data!.id,
      p_from_date: bangkokDate(),
      p_to_date: bangkokDate(),
      p_page_size: 100,
    });
    expect(feed.error).toBeNull();
    const adjustmentRows = feed.data.rows.filter(
      (row: { relationSourceType?: string }) => row.relationSourceType === "time_tracking_withdrawal_adjustment",
    );
    expect(adjustmentRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "income", cost: 1000 }),
      expect.objectContaining({ type: "expense", cost: 1200 }),
    ]));
    const dashboardEvents = await service.from("dashboard_money_events")
      .select("direction, amount")
      .eq("source_type", "withdrawal_adjustment")
      .order("occurred_at", { ascending: true });
    expect(dashboardEvents.error).toBeNull();
    expect(dashboardEvents.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ direction: "income", amount: 1000 }),
      expect.objectContaining({ direction: "expense", amount: 1200 }),
    ]));

    const approvedAdjustments = await service.from("financial_transactions")
      .select("id")
      .eq("parent_debt_id", source.data!.id)
      .eq("type", "ADJUSTMENT")
      .eq("status", "APPROVED")
      .order("approved_at", { ascending: true });
    expect(approvedAdjustments.error).toBeNull();
    const adjustmentReportId = await lockInReport(
      service,
      managerProfile.data!,
      location.data!.id,
      approvedAdjustments.data!.map((row) => row.id),
    );
    const reportRows = await manager.rpc("get_report_income_expense_rows_json", {
      p_report_id: adjustmentReportId,
    });
    expect(reportRows.error).toBeNull();
    const adjustmentReportRows = reportRows.data.filter(
      (row: { number?: string }) => row.number?.startsWith("TWA-"),
    );
    expect(adjustmentReportRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ entry_type: "income", amount: 1000 }),
      expect.objectContaining({ entry_type: "expense", amount: 1200 }),
    ]));

    const closedDeduction = await service.from("financial_transactions").insert({
      profile_id: employee.id,
      type: "WITHDRAWAL_DEDUCTION",
      amount: 300,
      remaining_amount: 0,
      status: "APPROVED",
      parent_debt_id: source.data!.id,
      applied_month: "2026-07-01",
      approved_by: managerProfile.data!.id,
      approved_at: new Date().toISOString(),
    });
    expect(closedDeduction.error).toBeNull();
    const closedSlip = await service.from("payroll_slips").insert({
      profile_id: employee.id,
      month: "2026-07",
      gross_pay: 300,
      total_deductions: 300,
      net_pay: 0,
      total_days: 0,
      daily_wage: 0,
      status: "APPROVED",
      created_by: managerProfile.data!.id,
      approved_by: managerProfile.data!.id,
      approved_at: new Date().toISOString(),
      slip_data: { transactions: [] },
    });
    expect(closedSlip.error).toBeNull();

    const belowFloor = await manager.rpc("request_time_tracking_withdrawal_adjustment", {
      p_withdrawal_id: source.data!.id,
      p_target_amount: 299,
      p_expense_location_id: location.data!.id,
      p_reason: "ต้องถูกปฏิเสธ",
    });
    expect(belowFloor.error?.message).toContain("ADJUSTMENT_BELOW_CLOSED_FLOOR:300");
    const rolledBack = await service.from("financial_transactions")
      .select("id")
      .eq("parent_debt_id", source.data!.id)
      .eq("type", "ADJUSTMENT")
      .eq("amount", 299);
    expect(rolledBack.error).toBeNull();
    expect(rolledBack.data).toEqual([]);

    const wrongBranch = await manager.rpc("request_time_tracking_withdrawal_adjustment", {
      p_withdrawal_id: source.data!.id,
      p_target_amount: 700,
      p_expense_location_id: crypto.randomUUID(),
      p_reason: null,
    });
    expect(wrongBranch.error?.message).toContain("ADJUSTMENT_BRANCH_REQUIRED");

    const employeeClient = await signedInClient(employee.phone);
    const forbiddenBranch = await employeeClient.rpc("request_time_tracking_withdrawal_adjustment", {
      p_withdrawal_id: source.data!.id,
      p_target_amount: 900,
      p_expense_location_id: location.data!.id,
      p_reason: "พนักงานเลือกสาขาเองไม่ได้",
    });
    expect(forbiddenBranch.error?.message).toContain("Forbidden");
    const concurrentPending = await Promise.all([900, 800].map((target) => employeeClient.rpc(
      "request_time_tracking_withdrawal_adjustment",
      {
        p_withdrawal_id: source.data!.id,
        p_target_amount: target,
        p_expense_location_id: null,
        p_reason: "พนักงานส่งคำขอพร้อมกัน",
      },
    )));
    const pending = concurrentPending.find((result) => result.error === null)!;
    const duplicate = concurrentPending.find((result) => result.error !== null)!;
    expect(pending.data).toMatchObject({ status: "pending" });
    expect(duplicate.error?.message).toContain("ADJUSTMENT_PENDING_EXISTS");
    const invalidDecision = await manager.rpc("decide_time_tracking_withdrawal_adjustment", {
      p_adjustment_id: pending.data.id,
      p_decision: null,
      p_expense_location_id: location.data!.id,
      p_comment: null,
    });
    expect(invalidDecision.error?.message).toContain("INVALID_ADJUSTMENT_DECISION");
    const pendingSlip = await service.from("payroll_slips").insert({
      profile_id: employee.id,
      month: bangkokDate().slice(0, 7),
      status: "REJECTED",
      created_by: managerProfile.data!.id,
    });
    expect(pendingSlip.error?.message).toContain("PENDING_BLOCKER:ADJUSTMENT");
    const withdrawn = await employeeClient.rpc("withdraw_time_tracking_withdrawal_adjustment", {
      p_adjustment_id: pending.data.id,
    });
    expect(withdrawn.error).toBeNull();
    expect(withdrawn.data).toMatchObject({ status: "withdrawn" });

    const noOp = await employeeClient.rpc("request_time_tracking_withdrawal_adjustment", {
      p_withdrawal_id: source.data!.id,
      p_target_amount: 1200,
      p_expense_location_id: null,
      p_reason: null,
    });
    expect(noOp.error?.message).toContain("ADJUSTMENT_NO_OP");

    const rejectedRequest = await employeeClient.rpc("request_time_tracking_withdrawal_adjustment", {
      p_withdrawal_id: source.data!.id,
      p_target_amount: 800,
      p_expense_location_id: null,
      p_reason: "ขอปรับลดก่อนตรวจเอกสาร",
    });
    expect(rejectedRequest.error).toBeNull();
    const rejected = await manager.rpc("decide_time_tracking_withdrawal_adjustment", {
      p_adjustment_id: rejectedRequest.data.id,
      p_decision: "REJECTED",
      p_expense_location_id: null,
      p_comment: "เอกสารยังไม่ครบ",
    });
    expect(rejected.error).toBeNull();
    expect(rejected.data).toMatchObject({ status: "rejected" });
    const rejectedRetry = await manager.rpc("decide_time_tracking_withdrawal_adjustment", {
      p_adjustment_id: rejectedRequest.data.id,
      p_decision: "REJECTED",
      p_expense_location_id: null,
      p_comment: null,
    });
    expect(rejectedRetry.error).toBeNull();
    expect(rejectedRetry.data).toMatchObject({ idempotent: true });

    const approvedRequest = await employeeClient.rpc("request_time_tracking_withdrawal_adjustment", {
      p_withdrawal_id: source.data!.id,
      p_target_amount: 700,
      p_expense_location_id: null,
      p_reason: "คืนเงินเบิกส่วนเกิน",
    });
    expect(approvedRequest.error).toBeNull();
    expect(approvedRequest.data).toMatchObject({ status: "pending", baseAmount: 1200, delta: -500 });
    const missingBranch = await manager.rpc("decide_time_tracking_withdrawal_adjustment", {
      p_adjustment_id: approvedRequest.data.id,
      p_decision: "APPROVED",
      p_expense_location_id: null,
      p_comment: null,
    });
    expect(missingBranch.error?.message).toContain("ADJUSTMENT_BRANCH_REQUIRED");
    const approved = await manager.rpc("decide_time_tracking_withdrawal_adjustment", {
      p_adjustment_id: approvedRequest.data.id,
      p_decision: "APPROVED",
      p_expense_location_id: location.data!.id,
      p_comment: "หลักฐานครบ",
    });
    expect(approved.error).toBeNull();
    expect(approved.data).toMatchObject({ status: "approved", targetAmount: 700, delta: -500 });
    const reducedBalance = await service.from("financial_transactions")
      .select("remaining_amount")
      .eq("id", source.data!.id)
      .single();
    expect(reducedBalance.error).toBeNull();
    expect(reducedBalance.data!.remaining_amount).toBe(400);
    const approvedRetry = await manager.rpc("decide_time_tracking_withdrawal_adjustment", {
      p_adjustment_id: approvedRequest.data.id,
      p_decision: "APPROVED",
      p_expense_location_id: location.data!.id,
      p_comment: null,
    });
    expect(approvedRetry.error).toBeNull();
    expect(approvedRetry.data).toMatchObject({ idempotent: true });

    const latest = await manager.rpc("get_withdrawal_adjustment_summaries", {
      p_profile_id: employee.id,
    });
    expect(latest.error).toBeNull();
    expect(latest.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ withdrawalId: source.data!.id, latestTarget: 700, closedSlipFloor: 300 }),
    ]));
    const finalEvents = await service.from("dashboard_money_events")
      .select("direction, amount")
      .eq("source_type", "withdrawal_adjustment")
      .eq("source_id", approvedRequest.data.id);
    expect(finalEvents.error).toBeNull();
    expect(finalEvents.data).toEqual([expect.objectContaining({ direction: "income", amount: 500 })]);
    const finalSnapshot = await service.from("payroll_slips").insert({
      profile_id: employee.id,
      month: "2026-09",
      gross_pay: 0,
      total_deductions: 0,
      net_pay: 0,
      total_days: 0,
      daily_wage: 0,
      status: "REJECTED",
      created_by: managerProfile.data!.id,
      slip_data: { transactions: [{ id: source.data!.id, type: "WITHDRAWAL", amount: 1000 }] },
    }).select("slip_data").single();
    expect(finalSnapshot.error).toBeNull();
    expect(finalSnapshot.data!.slip_data.transactions).toEqual([
      expect.objectContaining({ id: source.data!.id, amount: 700 }),
    ]);

    const staleRequest = await employeeClient.rpc("request_time_tracking_withdrawal_adjustment", {
      p_withdrawal_id: source.data!.id,
      p_target_amount: 600,
      p_expense_location_id: null,
      p_reason: "ตรวจ stale base",
    });
    expect(staleRequest.error).toBeNull();
    const staleFixture = await service.from("financial_transactions")
      .update({ adjustment_base_amount: 699 })
      .eq("id", staleRequest.data.id);
    expect(staleFixture.error).toBeNull();
    const staleDecision = await manager.rpc("decide_time_tracking_withdrawal_adjustment", {
      p_adjustment_id: staleRequest.data.id,
      p_decision: "APPROVED",
      p_expense_location_id: location.data!.id,
      p_comment: null,
    });
    expect(staleDecision.error?.message).toContain("ADJUSTMENT_STALE");
    const withdrawnStale = await employeeClient.rpc("withdraw_time_tracking_withdrawal_adjustment", {
      p_adjustment_id: staleRequest.data.id,
    });
    expect(withdrawnStale.error).toBeNull();

    const oldSourcePending = await employeeClient.rpc("request_time_tracking_withdrawal_adjustment", {
      p_withdrawal_id: source.data!.id,
      p_target_amount: 650,
      p_expense_location_id: null,
      p_reason: "ตรวจรายการเก่าที่หลุดจาก 50 แถวล่าสุด",
    });
    expect(oldSourcePending.error).toBeNull();
    let visibleSource = false;
    let visibleApprovedSource = false;
    let approvedOldSource = false;
    try {
      const newerTransactions = await service.from("financial_transactions").insert(
        Array.from({ length: 51 }, (_, index) => ({
          profile_id: employee.id,
          type: "DEBT",
          amount: index + 1,
          remaining_amount: 0,
          status: "APPROVED",
          effective_date: bangkokDate(),
        })),
      );
      expect(newerTransactions.error).toBeNull();
      const session = await employeeClient.auth.getSession();
      expect(session.error).toBeNull();
      const response = await fetch(`${appUrl}/api/lanflow/time-tracking/user`, {
        headers: { Authorization: `Bearer ${session.data.session!.access_token}` },
      });
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.transactions).toHaveLength(51);
      expect(payload.adjustments).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: oldSourcePending.data.id, parent_debt_id: source.data!.id }),
      ]));
      expect(payload.adjustmentSummaries).toEqual(expect.arrayContaining([
        expect.objectContaining({ withdrawalId: source.data!.id, pendingAdjustmentId: oldSourcePending.data.id }),
      ]));
      visibleSource = payload.transactions.some((row: { id: string }) => row.id === source.data!.id);
      expect(visibleSource).toBe(true);

      const approvedOldSourceResult = await manager.rpc("decide_time_tracking_withdrawal_adjustment", {
        p_adjustment_id: oldSourcePending.data.id,
        p_decision: "APPROVED",
        p_expense_location_id: location.data!.id,
        p_comment: null,
      });
      expect(approvedOldSourceResult.error).toBeNull();
      approvedOldSource = true;

      const approvedResponse = await fetch(`${appUrl}/api/lanflow/time-tracking/user`, {
        headers: { Authorization: `Bearer ${session.data.session!.access_token}` },
      });
      expect(approvedResponse.status).toBe(200);
      const approvedPayload = await approvedResponse.json();
      expect(approvedPayload.adjustments).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: oldSourcePending.data.id, status: "APPROVED" }),
      ]));
      visibleApprovedSource = approvedPayload.transactions.some(
        (row: { id: string }) => row.id === source.data!.id,
      );
    } finally {
      if (!approvedOldSource) {
        const withdrawnOldSource = await employeeClient.rpc("withdraw_time_tracking_withdrawal_adjustment", {
          p_adjustment_id: oldSourcePending.data.id,
        });
        expect(withdrawnOldSource.error).toBeNull();
      }
    }
    expect(visibleApprovedSource).toBe(true);
  });
});
