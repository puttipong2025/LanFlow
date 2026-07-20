import { test, expect, request as playwrightRequest } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const adminId = "00000000-0000-4000-8000-000000000002";

function serviceClient() {
  expect(serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY is required for Time Tracking database verification").toBeTruthy();
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function authenticatedAdminClient() {
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  expect(publishableKey, "a Supabase publishable key is required for authenticated test setup").toBeTruthy();
  const client = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({
    phone: "+66810000001",
    password: process.env.TEST_PASSWORD || "password123",
  });
  if (error) throw error;
  return client;
}

function bangkokDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

test.describe("Time Tracking branch expense @time-tracking", () => {
  test.use({ storageState: "playwright/.auth/admin.json" });

  test("approved withdrawal derives one cash-basis expense and soft-cancel hides it", async ({ request }) => {
    const meResponse = await request.get("/api/auth/me");
    expect(meResponse.ok()).toBeTruthy();
    const me = await meResponse.json() as { profile: { locationIds: string[] } };
    const locationId = me.profile.locationIds[0];
    expect(locationId).toBeTruthy();

    const marker = `E2E-TIME-TRACKING-${Date.now()}`;
    const amount = 100000 + (Date.now() % 10000);
    const dashboardResponse = await request.get("/api/lanflow/time-tracking/admin");
    expect(dashboardResponse.ok()).toBeTruthy();
    const dashboard = await dashboardResponse.json() as { users: Array<{ id: string; role: string }> };
    const employee = dashboard.users.find((user) => user.role === "user");
    expect(employee).toBeTruthy();

    const requested = await request.post("/api/lanflow/time-tracking/admin", { data: {
      action: "ADMIN_REQUEST_WITHDRAWAL",
      payload: { user_id: employee!.id, amount },
    }});
    expect(requested.ok()).toBeTruthy();

    const pendingResponse = await request.get("/api/lanflow/time-tracking/admin");
    const pending = await pendingResponse.json() as { pendingTransactions: Array<{ id: string; profile_id: string; type: string; amount: number }> };
    const withdrawal = pending.pendingTransactions.find((transaction) =>
      transaction.profile_id === employee!.id && transaction.type === "WITHDRAWAL" && Number(transaction.amount) === amount,
    );
    expect(withdrawal).toBeTruthy();

    const approved = await request.post("/api/lanflow/time-tracking/admin", { data: {
      action: "APPROVE_TRANSACTION",
      payload: { transaction_id: withdrawal!.id, status: "APPROVED", expense_location_id: locationId, admin_comment: marker },
    }});
    expect(approved.ok()).toBeTruthy();

    const retry = await request.post("/api/lanflow/time-tracking/admin", { data: {
      action: "APPROVE_TRANSACTION",
      payload: { transaction_id: withdrawal!.id, status: "APPROVED", expense_location_id: locationId, admin_comment: marker },
    }});
    expect(retry.ok()).toBeTruthy();
    expect((await retry.json()).result).toMatchObject({ idempotent: true });

    const sourceResponse = await request.get(`/api/lanflow/time-tracking/user?userId=${employee!.id}`);
    expect(sourceResponse.ok()).toBeTruthy();
    const sourceData = await sourceResponse.json() as { transactions: Array<{ id: string; status: string; expense_location_id?: string; approved_at?: string }> };
    expect(sourceData.transactions).toContainEqual(expect.objectContaining({
      id: withdrawal!.id,
      status: "APPROVED",
      expense_location_id: locationId,
    }));
    expect(sourceData.transactions.find((transaction) => transaction.id === withdrawal!.id)?.approved_at).toBeTruthy();

    const date = new Date().toISOString().slice(0, 10);
    const feed = await request.get(`/api/lanflow/income-expense/feed?locationId=${locationId}&from=${date}&to=${date}`);
    expect(feed.ok()).toBeTruthy();
    const rows = (await feed.json()).rows as Array<{ relationSourceId?: string; relationSourceType?: string; cost?: number }>;
    expect(rows).toContainEqual(expect.objectContaining({ relationSourceType: "time_tracking_withdrawal", relationSourceId: withdrawal!.id, cost: amount }));

    const cancelled = await request.post("/api/lanflow/time-tracking/admin", { data: { action: "DELETE_TRANSACTION", payload: { transaction_id: withdrawal!.id, cancel_reason: marker } } });
    expect(cancelled.ok()).toBeTruthy();
    const afterCancel = await request.get(`/api/lanflow/income-expense/feed?locationId=${locationId}&from=${date}&to=${date}`);
    const afterRows = (await afterCancel.json()).rows as Array<{ relationSourceId?: string }>;
    expect(afterRows.some((row) => row.relationSourceId === withdrawal!.id)).toBeFalsy();

    const cancelledSource = await request.get(`/api/lanflow/time-tracking/user?userId=${employee!.id}`);
    const cancelledData = await cancelledSource.json() as { transactions: Array<{ id: string; cancelled_at?: string }> };
    expect(cancelledData.transactions.find((transaction) => transaction.id === withdrawal!.id)?.cancelled_at).toBeTruthy();
  });
});

test.describe("Time Tracking zero-net payroll @time-tracking", () => {
  test.use({ storageState: "playwright/.auth/super_admin.json" });

  test("approved zero-net payroll keeps approval audit without a derived expense", async ({ request }) => {
    const adminRequest = await playwrightRequest.newContext({
      baseURL: "http://127.0.0.1:3000",
      storageState: "playwright/.auth/admin.json",
    });

    try {
      const dashboardResponse = await adminRequest.get("/api/lanflow/time-tracking/admin");
      expect(dashboardResponse.ok()).toBeTruthy();
      const dashboard = await dashboardResponse.json() as { users: Array<{ id: string; role: string }> };
      const employee = dashboard.users.find((user) => user.role === "user");
      expect(employee).toBeTruthy();

      const timestamp = Date.now();
      const month = `${2090 + (timestamp % 10)}-${String(1 + (timestamp % 12)).padStart(2, "0")}`;
      const created = await adminRequest.post("/api/lanflow/time-tracking/admin", { data: {
        action: "CREATE_PAYROLL_SLIP",
        payload: { user_id: employee!.id, month },
      }});
      expect(created.ok()).toBeTruthy();
      const { slip } = await created.json() as { slip: { id: string; net_pay: number } };
      expect(Number(slip.net_pay)).toBeLessThanOrEqual(0);

      const approved = await request.post("/api/lanflow/time-tracking/admin", { data: {
        action: "APPROVE_PAYROLL_SLIP",
        payload: { slip_id: slip.id, status: "APPROVED" },
      }});
      expect(approved.ok()).toBeTruthy();

      const slipsResponse = await request.post("/api/lanflow/time-tracking/admin", { data: {
        action: "LIST_PAYROLL_SLIPS",
        payload: { user_id: employee!.id },
      }});
      expect(slipsResponse.ok()).toBeTruthy();
      const { slips } = await slipsResponse.json() as { slips: Array<{ id: string; status: string; approved_at?: string; expense_location_id?: string }> };
      expect(slips).toContainEqual(expect.objectContaining({ id: slip.id, status: "APPROVED" }));
      const approvedSlip = slips.find((candidate) => candidate.id === slip.id);
      expect(approvedSlip?.approved_at).toBeTruthy();
      expect(approvedSlip?.expense_location_id).toBeFalsy();

      const date = new Date().toISOString().slice(0, 10);
      const meResponse = await request.get("/api/auth/me");
      const me = await meResponse.json() as { profile: { locationIds: string[] } };
      const locationId = me.profile.locationIds[0];
      expect(locationId).toBeTruthy();
      const feed = await request.get(`/api/lanflow/income-expense/feed?locationId=${locationId}&from=${date}&to=${date}`);
      expect(feed.ok()).toBeTruthy();
      const rows = (await feed.json()).rows as Array<{ relationSourceId?: string; relationSourceType?: string }>;
      expect(rows.some((row) => row.relationSourceType === "payroll_slip" && row.relationSourceId === slip.id)).toBeFalsy();
    } finally {
      await adminRequest.dispose();
    }
  });
});

test.describe("Time Tracking positive payroll feed @time-tracking", () => {
  test.use({ storageState: "playwright/.auth/super_admin.json" });

  test("derives the approved payroll net pay, not gross pay", async ({ request }) => {
    const admin = await authenticatedAdminClient();
    const adminRequest = await playwrightRequest.newContext({
      baseURL: "http://127.0.0.1:3000",
      storageState: "playwright/.auth/admin.json",
    });
    let employeeId: string | undefined;

    try {
      const dashboardResponse = await adminRequest.get("/api/lanflow/time-tracking/admin");
      const dashboard = await dashboardResponse.json() as { users: Array<{ id: string; role: string }> };
      const employee = dashboard.users.find((user) => user.role === "user");
      expect(employee).toBeTruthy();
      employeeId = employee!.id;

      const grossPay = 1000;
      const deduction = 125;
      const netPay = grossPay - deduction;

      const timestamp = Date.now();
      const month = `${2070 + (timestamp % 20)}-${String(1 + (timestamp % 12)).padStart(2, "0")}`;
      const created = await adminRequest.post("/api/lanflow/time-tracking/admin", { data: {
        action: "CREATE_PAYROLL_SLIP",
        payload: { user_id: employeeId, month },
      }});
      expect(created.ok()).toBeTruthy();
      const { slip } = await created.json() as { slip: { id: string } };
      const { error: payrollSetupError } = await admin.from("payroll_slips").update({
        gross_pay: grossPay,
        total_deductions: deduction,
        net_pay: netPay,
        total_days: 1,
        daily_wage: grossPay,
      }).eq("id", slip.id);
      expect(payrollSetupError).toBeNull();

      const meResponse = await request.get("/api/auth/me");
      const me = await meResponse.json() as { profile: { locationIds: string[] } };
      const locationId = me.profile.locationIds[0];
      expect(locationId).toBeTruthy();
      const approved = await request.post("/api/lanflow/time-tracking/admin", { data: {
        action: "APPROVE_PAYROLL_SLIP",
        payload: { slip_id: slip.id, status: "APPROVED", expense_location_id: locationId },
      }});
      expect(approved.ok()).toBeTruthy();

      const date = bangkokDate();
      const feed = await request.get(`/api/lanflow/income-expense/feed?locationId=${locationId}&from=${date}&to=${date}`);
      expect(feed.ok()).toBeTruthy();
      const rows = (await feed.json()).rows as Array<{ relationSourceId?: string; relationSourceType?: string; cost?: number }>;
      expect(rows).toContainEqual(expect.objectContaining({
        relationSourceType: "payroll_slip",
        relationSourceId: slip.id,
        cost: netPay,
      }));

      const boundaryUtc = "2040-01-01T17:30:00.000Z"; // 00:30 on 2040-01-02 in Asia/Bangkok
      const { error: boundaryUpdateError } = await admin.from("payroll_slips").update({ approved_at: boundaryUtc }).eq("id", slip.id);
      expect(boundaryUpdateError).toBeNull();
      const beforeBoundary = await request.get(`/api/lanflow/income-expense/feed?locationId=${locationId}&from=2040-01-01&to=2040-01-01`);
      expect(beforeBoundary.ok()).toBeTruthy();
      const beforeRows = (await beforeBoundary.json()).rows as Array<{ relationSourceId?: string }>;
      expect(beforeRows.some((row) => row.relationSourceId === slip.id)).toBeFalsy();
      const afterBoundary = await request.get(`/api/lanflow/income-expense/feed?locationId=${locationId}&from=2040-01-02&to=2040-01-02`);
      expect(afterBoundary.ok()).toBeTruthy();
      const afterRows = (await afterBoundary.json()).rows as Array<{ relationSourceId?: string; cost?: number }>;
      expect(afterRows).toContainEqual(expect.objectContaining({ relationSourceId: slip.id, cost: netPay }));
    } finally {
      await adminRequest.dispose();
    }
  });
});

test.describe("Time Tracking approval picker UI @time-tracking", () => {
  test.use({ storageState: "playwright/.auth/admin.json" });

  test("approval queue and payroll modal use the same branch picker", async ({ page }) => {
    const adminRequest = page.request;
    const superAdminRequest = await playwrightRequest.newContext({
      baseURL: "http://127.0.0.1:3000",
      storageState: "playwright/.auth/super_admin.json",
    });

    try {
      async function chooseExpenseLocation() {
        const locationSelect = page.locator("#expense-location");
        const firstLocationId = await locationSelect.locator("option:not([disabled])").first().getAttribute("value");
        expect(firstLocationId).toBeTruthy();
        await locationSelect.selectOption(firstLocationId!);
        await expect(locationSelect).toHaveValue(firstLocationId!);
      }

      const dashboardResponse = await adminRequest.get("/api/lanflow/time-tracking/admin");
      const dashboard = await dashboardResponse.json() as { users: Array<{ id: string; role: string }> };
      const employee = dashboard.users.find((user) => user.role === "user");
      expect(employee).toBeTruthy();

      const withdrawalAmount = 400000 + (Date.now() % 10000);
      expect((await adminRequest.post("/api/lanflow/time-tracking/admin", { data: {
        action: "ADMIN_REQUEST_WITHDRAWAL",
        payload: { user_id: employee!.id, amount: withdrawalAmount },
      }})).ok()).toBeTruthy();

      const timestamp = Date.now();
      const month = `${1000 + Math.floor(Math.random() * 8999)}-${String(1 + (timestamp % 12)).padStart(2, "0")}`;
      const payrollCreated = await superAdminRequest.post("/api/lanflow/time-tracking/admin", { data: {
        action: "CREATE_PAYROLL_SLIP",
        payload: { user_id: employee!.id, month },
      }});
      expect(payrollCreated.ok()).toBeTruthy();
      const { slip } = await payrollCreated.json() as { slip: { id: string } };
      const setupClient = await authenticatedAdminClient();
      const { error: payrollSetupError } = await setupClient.from("payroll_slips").update({
        gross_pay: 1000,
        total_deductions: 100,
        net_pay: 900,
        total_days: 1,
        daily_wage: 1000,
      }).eq("id", slip.id);
      expect(payrollSetupError).toBeNull();

      await page.goto("/");
      await page.getByRole("button", { name: "เวลาและเงินเดือน" }).click();
      await expect(page.getByRole("heading", { name: "จัดการเวลาและเงินเดือน" })).toBeVisible();

      const withdrawalRow = page.locator("li", { hasText: withdrawalAmount.toLocaleString("en-US") }).first();
      await expect(withdrawalRow).toBeVisible();
      await withdrawalRow.getByRole("button", { name: "อนุมัติ" }).click();
      const pickerHeading = page.getByRole("heading", { name: "เลือกสาขาสำหรับบันทึกค่าใช้จ่าย" });
      await expect(pickerHeading).toBeVisible();
      await chooseExpenseLocation();
      await page.getByRole("button", { name: "อนุมัติและสร้างค่าใช้จ่าย" }).click();
      await expect(pickerHeading).toBeHidden();

      const employeeRow = page.locator("tr", { hasText: "LanFlow user" }).first();
      await expect(employeeRow).toBeVisible();
      await employeeRow.getByRole("button", { name: "คำนวณเงินเดือน" }).click();
      const payrollHeading = page.getByRole("heading", { name: "สลิปเงินเดือนของ LanFlow user" });
      await expect(payrollHeading).toBeVisible();
      const slipRow = page.locator("li", { hasText: `สลิปเดือน ${month}` }).first();
      await expect(slipRow).toBeVisible();
      await slipRow.getByRole("button", { name: "อนุมัติ" }).click();
      await expect(pickerHeading).toBeVisible();
      await chooseExpenseLocation();
      await page.getByRole("button", { name: "อนุมัติและสร้างค่าใช้จ่าย" }).click();
      await expect(pickerHeading).toBeHidden();
    } finally {
      await superAdminRequest.dispose();
    }
  });
});

test.describe("Time Tracking approval authorization and concurrency @time-tracking", () => {
  test.use({ storageState: "playwright/.auth/admin.json" });

  test("rejects unassigned or inactive branches without deciding the withdrawal", async ({ request }) => {
    const admin = serviceClient();
    const marker = `E2E-TIME-TRACKING-AUTH-${Date.now()}`;
    let temporaryLocationId: string | undefined;
    let assignedLocationId: string | undefined;

    try {
      const meResponse = await request.get("/api/auth/me");
      const me = await meResponse.json() as { profile: { locationIds: string[] } };
      assignedLocationId = me.profile.locationIds[0];
      expect(assignedLocationId).toBeTruthy();

      const dashboardResponse = await request.get("/api/lanflow/time-tracking/admin");
      const dashboard = await dashboardResponse.json() as { users: Array<{ id: string; role: string }> };
      const employee = dashboard.users.find((user) => user.role === "user");
      expect(employee).toBeTruthy();

      const amount = 200000 + (Date.now() % 10000);
      const requested = await request.post("/api/lanflow/time-tracking/admin", { data: {
        action: "ADMIN_REQUEST_WITHDRAWAL",
        payload: { user_id: employee!.id, amount },
      }});
      expect(requested.ok()).toBeTruthy();
      const pendingResponse = await request.get("/api/lanflow/time-tracking/admin");
      const pending = await pendingResponse.json() as { pendingTransactions: Array<{ id: string; profile_id: string; type: string; amount: number }> };
      const withdrawal = pending.pendingTransactions.find((transaction) => transaction.profile_id === employee!.id && transaction.type === "WITHDRAWAL" && Number(transaction.amount) === amount);
      expect(withdrawal).toBeTruthy();

      const { data: temporaryLocation, error: createLocationError } = await admin.from("locations").insert({
        name: marker,
        code: `E2E-AUTH-${Date.now()}`,
        is_active: true,
      }).select("id").single();
      expect(createLocationError).toBeNull();
      temporaryLocationId = temporaryLocation!.id;

      const notAssigned = await request.post("/api/lanflow/time-tracking/admin", { data: {
        action: "APPROVE_TRANSACTION",
        payload: { transaction_id: withdrawal!.id, status: "APPROVED", expense_location_id: temporaryLocationId },
      }});
      expect(notAssigned.status()).toBe(403);

      const { error: deactivateError } = await admin.from("locations").update({ is_active: false }).eq("id", assignedLocationId);
      expect(deactivateError).toBeNull();
      const inactive = await request.post("/api/lanflow/time-tracking/admin", { data: {
        action: "APPROVE_TRANSACTION",
        payload: { transaction_id: withdrawal!.id, status: "APPROVED", expense_location_id: assignedLocationId },
      }});
      expect(inactive.status()).toBe(403);
      const { error: reactivateError } = await admin.from("locations").update({ is_active: true }).eq("id", assignedLocationId);
      expect(reactivateError).toBeNull();

      const { error: removeAssignmentError } = await admin.from("user_locations").delete().eq("user_id", adminId).eq("location_id", assignedLocationId);
      expect(removeAssignmentError).toBeNull();
      const noBranch = await request.post("/api/lanflow/time-tracking/admin", { data: {
        action: "APPROVE_TRANSACTION",
        payload: { transaction_id: withdrawal!.id, status: "APPROVED", expense_location_id: assignedLocationId },
      }});
      expect(noBranch.status()).toBe(403);
      const { error: restoreAssignmentError } = await admin.from("user_locations").upsert({ user_id: adminId, location_id: assignedLocationId });
      expect(restoreAssignmentError).toBeNull();

      const rejected = await request.post("/api/lanflow/time-tracking/admin", { data: {
        action: "APPROVE_TRANSACTION",
        payload: { transaction_id: withdrawal!.id, status: "REJECTED" },
      }});
      expect(rejected.ok()).toBeTruthy();
    } finally {
      if (assignedLocationId) {
        await admin.from("locations").update({ is_active: true }).eq("id", assignedLocationId);
        await admin.from("user_locations").upsert({ user_id: adminId, location_id: assignedLocationId });
      }
      if (temporaryLocationId) await admin.from("locations").delete().eq("id", temporaryLocationId);
    }
  });

  test("serializes competing approvals into one decision audit and one idempotent retry", async ({ request }) => {
    const adminRequest = await playwrightRequest.newContext({
      baseURL: "http://127.0.0.1:3000",
      storageState: "playwright/.auth/admin.json",
    });
    const superAdminRequest = await playwrightRequest.newContext({
      baseURL: "http://127.0.0.1:3000",
      storageState: "playwright/.auth/super_admin.json",
    });

    try {
      const meResponse = await adminRequest.get("/api/auth/me");
      const me = await meResponse.json() as { profile: { locationIds: string[] } };
      const locationId = me.profile.locationIds[0];
      expect(locationId).toBeTruthy();

      const dashboardResponse = await adminRequest.get("/api/lanflow/time-tracking/admin");
      const dashboard = await dashboardResponse.json() as { users: Array<{ id: string; role: string }> };
      const employee = dashboard.users.find((user) => user.role === "user");
      expect(employee).toBeTruthy();
      const amount = 300000 + (Date.now() % 10000);
      expect((await adminRequest.post("/api/lanflow/time-tracking/admin", { data: {
        action: "ADMIN_REQUEST_WITHDRAWAL",
        payload: { user_id: employee!.id, amount },
      }})).ok()).toBeTruthy();

      const pendingResponse = await adminRequest.get("/api/lanflow/time-tracking/admin");
      const pending = await pendingResponse.json() as { pendingTransactions: Array<{ id: string; profile_id: string; type: string; amount: number }> };
      const withdrawal = pending.pendingTransactions.find((transaction) => transaction.profile_id === employee!.id && transaction.type === "WITHDRAWAL" && Number(transaction.amount) === amount);
      expect(withdrawal).toBeTruthy();

      const payload = { action: "APPROVE_TRANSACTION", payload: { transaction_id: withdrawal!.id, status: "APPROVED", expense_location_id: locationId } };
      const [adminApproval, superAdminApproval] = await Promise.all([
        adminRequest.post("/api/lanflow/time-tracking/admin", { data: payload }),
        superAdminRequest.post("/api/lanflow/time-tracking/admin", { data: payload }),
      ]);
      expect(adminApproval.ok()).toBeTruthy();
      expect(superAdminApproval.ok()).toBeTruthy();
      const results = await Promise.all([adminApproval.json(), superAdminApproval.json()]) as Array<{ result: { idempotent: boolean } }>;
      expect(results.filter((result) => result.result.idempotent).length).toBe(1);
      expect(results.filter((result) => !result.result.idempotent).length).toBe(1);

      const auditResponse = await adminRequest.post("/api/lanflow/time-tracking/admin", { data: {
        action: "GET_AUDIT_LOGS",
        payload: { target_user_id: withdrawal!.id, action_filter: "DECIDE_TRANSACTION_APPROVAL" },
      }});
      expect(auditResponse.ok()).toBeTruthy();
      const { logs } = await auditResponse.json() as { logs: Array<{ record_id: string; action: string }> };
      expect(logs.filter((log) => log.record_id === withdrawal!.id && log.action === "DECIDE_TRANSACTION_APPROVAL")).toHaveLength(1);

      const cancelled = await adminRequest.post("/api/lanflow/time-tracking/admin", { data: {
        action: "DELETE_TRANSACTION",
        payload: { transaction_id: withdrawal!.id, cancel_reason: "E2E concurrent approval cleanup" },
      }});
      expect(cancelled.ok()).toBeTruthy();
    } finally {
      await adminRequest.dispose();
      await superAdminRequest.dispose();
    }
  });
});

test.describe("Time Tracking non-expense approvals @time-tracking", () => {
  test.use({ storageState: "playwright/.auth/admin.json" });

  test("approves DEBT and LEAVE without deriving branch expenses", async ({ request }) => {
    const marker = `E2E-TIME-TRACKING-NON-EXPENSE-${Date.now()}`;
    const meResponse = await request.get("/api/auth/me");
    const me = await meResponse.json() as { profile: { locationIds: string[] } };
    const locationId = me.profile.locationIds[0];
    expect(locationId).toBeTruthy();

    const dashboardResponse = await request.get("/api/lanflow/time-tracking/admin");
    const dashboard = await dashboardResponse.json() as { users: Array<{ id: string; role: string }> };
    const employee = dashboard.users.find((user) => user.role === "user");
    expect(employee).toBeTruthy();

    const debtCreated = await request.post("/api/lanflow/time-tracking/admin", { data: {
      action: "CREATE_DEBT",
      payload: { user_id: employee!.id, amount: 321, due_date: "2099-01-01", description: marker },
    }});
    expect(debtCreated.ok()).toBeTruthy();

    const pendingDebtResponse = await request.get("/api/lanflow/time-tracking/admin");
    const pendingDebtData = await pendingDebtResponse.json() as { pendingTransactions: Array<{ id: string; profile_id: string; type: string; description?: string }> };
    const debt = pendingDebtData.pendingTransactions.find((transaction) =>
      transaction.profile_id === employee!.id && transaction.type === "DEBT" && transaction.description === marker,
    );
    expect(debt).toBeTruthy();

    const superAdminRequest = await playwrightRequest.newContext({
      baseURL: "http://127.0.0.1:3000",
      storageState: "playwright/.auth/super_admin.json",
    });
    try {
      const debtApproved = await superAdminRequest.post("/api/lanflow/time-tracking/admin", { data: {
        action: "APPROVE_TRANSACTION",
        payload: { transaction_id: debt!.id, status: "APPROVED", admin_comment: marker },
      }});
      expect(debtApproved.ok()).toBeTruthy();
    } finally {
      await superAdminRequest.dispose();
    }

    const leaveCreated = await request.post("/api/lanflow/time-tracking/admin", { data: {
      action: "ADMIN_REQUEST_LEAVE",
      payload: { user_id: employee!.id, start_date: "2099-01-01", end_date: "2099-01-01", type: "FULL_DAY" },
    }});
    expect(leaveCreated.ok()).toBeTruthy();

    const pendingLeaveResponse = await request.get("/api/lanflow/time-tracking/admin");
    const pendingLeaveData = await pendingLeaveResponse.json() as { pendingLeaves: Array<{ id: string; profile_id: string; start_date: string; end_date: string; type: string }> };
    const leave = pendingLeaveData.pendingLeaves.find((requestLeave) =>
      requestLeave.profile_id === employee!.id
      && requestLeave.start_date === "2099-01-01"
      && requestLeave.end_date === "2099-01-01"
      && requestLeave.type === "FULL_DAY",
    );
    expect(leave).toBeTruthy();

    const leaveApproved = await request.post("/api/lanflow/time-tracking/admin", { data: {
      action: "APPROVE_LEAVE",
      payload: { request_id: leave!.id, status: "APPROVED", admin_comment: marker },
    }});
    expect(leaveApproved.ok()).toBeTruthy();

    const date = bangkokDate();
    const feed = await request.get(`/api/lanflow/income-expense/feed?locationId=${locationId}&from=${date}&to=${date}`);
    expect(feed.ok()).toBeTruthy();
    const rows = (await feed.json()).rows as Array<{ relationSourceId?: string }>;
    expect(rows.some((row) => row.relationSourceId === debt!.id || row.relationSourceId === leave!.id)).toBeFalsy();
  });
});

test.describe("Time Tracking expense correction @time-tracking", () => {
  test.use({ storageState: "playwright/.auth/admin.json" });

  test("moves an approved withdrawal only through its source and preserves soft-cancel", async ({ request }) => {
    const admin = serviceClient();
    const marker = `E2E-TIME-TRACKING-CORRECTION-${Date.now()}`;
    let correctionLocationId: string | undefined;

    try {
      const meResponse = await request.get("/api/auth/me");
      const me = await meResponse.json() as { profile: { locationIds: string[] } };
      const sourceLocationId = me.profile.locationIds[0];
      expect(sourceLocationId).toBeTruthy();

      const { data: correctionLocation, error: createLocationError } = await admin.from("locations").insert({
        name: marker,
        code: `E2E-CORR-${Date.now()}`,
        is_active: true,
      }).select("id").single();
      expect(createLocationError).toBeNull();
      correctionLocationId = correctionLocation!.id;
      const { error: assignLocationError } = await admin.from("user_locations").insert({ user_id: adminId, location_id: correctionLocationId });
      expect(assignLocationError).toBeNull();

      const dashboardResponse = await request.get("/api/lanflow/time-tracking/admin");
      const dashboard = await dashboardResponse.json() as { users: Array<{ id: string; role: string }> };
      const employee = dashboard.users.find((user) => user.role === "user");
      expect(employee).toBeTruthy();
      const amount = 500000 + (Date.now() % 10000);
      expect((await request.post("/api/lanflow/time-tracking/admin", { data: {
        action: "ADMIN_REQUEST_WITHDRAWAL",
        payload: { user_id: employee!.id, amount },
      }})).ok()).toBeTruthy();

      const pendingResponse = await request.get("/api/lanflow/time-tracking/admin");
      const pending = await pendingResponse.json() as { pendingTransactions: Array<{ id: string; profile_id: string; type: string; amount: number }> };
      const withdrawal = pending.pendingTransactions.find((transaction) =>
        transaction.profile_id === employee!.id && transaction.type === "WITHDRAWAL" && Number(transaction.amount) === amount,
      );
      expect(withdrawal).toBeTruthy();
      expect((await request.post("/api/lanflow/time-tracking/admin", { data: {
        action: "APPROVE_TRANSACTION",
        payload: { transaction_id: withdrawal!.id, status: "APPROVED", expense_location_id: sourceLocationId, admin_comment: marker },
      }})).ok()).toBeTruthy();

      const corrected = await request.post("/api/lanflow/time-tracking/admin", { data: {
        action: "CHANGE_EXPENSE_LOCATION",
        payload: { source_type: "transaction", source_id: withdrawal!.id, expense_location_id: correctionLocationId, admin_comment: marker },
      }});
      expect(corrected.ok()).toBeTruthy();

      const date = bangkokDate();
      const oldFeed = await request.get(`/api/lanflow/income-expense/feed?locationId=${sourceLocationId}&from=${date}&to=${date}`);
      const newFeed = await request.get(`/api/lanflow/income-expense/feed?locationId=${correctionLocationId}&from=${date}&to=${date}`);
      const oldRows = (await oldFeed.json()).rows as Array<{ relationSourceId?: string }>;
      const newRows = (await newFeed.json()).rows as Array<{ relationSourceId?: string; cost?: number }>;
      expect(oldRows.some((row) => row.relationSourceId === withdrawal!.id)).toBeFalsy();
      expect(newRows).toContainEqual(expect.objectContaining({ relationSourceId: withdrawal!.id, cost: amount }));

      const cancelled = await request.post("/api/lanflow/time-tracking/admin", { data: {
        action: "DELETE_TRANSACTION",
        payload: { transaction_id: withdrawal!.id, cancel_reason: marker },
      }});
      expect(cancelled.ok()).toBeTruthy();
      const afterCancel = await request.get(`/api/lanflow/income-expense/feed?locationId=${correctionLocationId}&from=${date}&to=${date}`);
      const afterCancelRows = (await afterCancel.json()).rows as Array<{ relationSourceId?: string }>;
      expect(afterCancelRows.some((row) => row.relationSourceId === withdrawal!.id)).toBeFalsy();
    } finally {
      if (correctionLocationId) {
        await admin.from("user_locations").delete().eq("user_id", adminId).eq("location_id", correctionLocationId);
        await admin.from("locations").delete().eq("id", correctionLocationId);
      }
    }
  });
});
