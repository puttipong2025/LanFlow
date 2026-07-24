import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const zeroCounts = {
  coin1: 0,
  coin2: 0,
  coin5: 0,
  coin10: 0,
  banknote20: 0,
  banknote50: 0,
  banknote100: 0,
  banknote500: 0,
  banknote1000: 0,
};

async function authContext(browser: Browser, role: "user" | "admin" | "super_admin") {
  return browser.newContext({ storageState: `playwright/.auth/${role}.json` });
}

async function profile(context: BrowserContext) {
  const response = await context.request.get("/api/auth/me");
  expect(response.ok()).toBeTruthy();
  return (await response.json() as {
    profile: { id: string; locationIds: string[]; name: string; phone: string };
  }).profile;
}

function service() {
  expect(serviceRoleKey).toBeTruthy();
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function addIncomeExpense(
  admin: ReturnType<typeof service>,
  locationId: string,
  actor: { id: string; name: string; phone: string },
  title: string,
  serverReceivedAt: string | null = new Date().toISOString()
) {
  const id = crypto.randomUUID();
  const number = `RPT-T-${id.slice(0, 8)}`;
  const { error } = await admin.from("income_expense").insert({
    id,
    client_temp_id: id,
    local_bill_no: number,
    server_bill_no: number,
    idempotency_key: `report-test:${id}`,
    sync_status: "synced",
    record_status: "active",
    location_id: locationId,
    type: "income",
    number,
    tx_date: new Date().toISOString().slice(0, 10),
    title,
    cost: 1250,
    bill_option: "รายรับ",
    server_received_at: serverReceivedAt,
    revision_no: 0,
    created_by_user_id: actor.id,
    created_by_name: actor.name,
    created_by_phone: actor.phone,
  });
  expect(error).toBeNull();
  return id;
}

async function addIncomeExpenses(
  admin: ReturnType<typeof service>,
  locationId: string,
  actor: { id: string; name: string; phone: string },
  count: number
) {
  const ids = Array.from({ length: count }, () => crypto.randomUUID());
  const now = new Date();
  const { error } = await admin.from("income_expense").insert(ids.map((id, index) => {
    const number = `RPT-L-${id.slice(0, 8)}`;
    return {
      id,
      client_temp_id: id,
      local_bill_no: number,
      server_bill_no: number,
      idempotency_key: `report-long:${id}`,
      sync_status: "synced",
      record_status: "active",
      location_id: locationId,
      type: index % 2 === 0 ? "income" : "expense",
      number,
      tx_date: now.toISOString().slice(0, 10),
      title: `รายการภาษาไทยสำหรับทดสอบหลายหน้า ${index + 1}`,
      cost: 100 + index,
      bill_option: index % 2 === 0 ? "รายรับ" : "ค่าใช้จ่าย",
      server_received_at: new Date(now.getTime() + index).toISOString(),
      revision_no: 0,
      created_by_user_id: actor.id,
      created_by_name: actor.name,
      created_by_phone: actor.phone,
    };
  }));
  expect(error).toBeNull();
  return ids;
}

async function createReport(context: BrowserContext, locationId: string) {
  const response = await context.request.post("/api/lanflow/reports", {
    data: { locationId },
  });
  const body = await response.json() as { id?: string; reportNo?: string; error?: string };
  expect(response.status(), body.error).toBe(201);
  return { id: body.id!, reportNo: body.reportNo! };
}

async function deleteReport(context: BrowserContext, reportId: string) {
  return context.request.delete(`/api/lanflow/reports/${reportId}`);
}

test.describe.serial("Report batch contract @report-batch", () => {
  test("roles, no-empty, active lock, latest-only delete, and recreate are enforced", async ({ browser }) => {
    const user = await authContext(browser, "user");
    const adminContext = await authContext(browser, "admin");
    const superAdmin = await authContext(browser, "super_admin");
    const db = service();
    const emptyLocationId = crypto.randomUUID();

    try {
      const [adminProfile, superProfile] = await Promise.all([
        profile(adminContext),
        profile(superAdmin),
      ]);
      const locationId = adminProfile.locationIds[0];
      expect(locationId).toBeTruthy();

      expect((await user.request.get(`/api/lanflow/reports?locationId=${locationId}`)).status()).toBe(403);
      expect((await db.from("locations").insert({
        id: emptyLocationId,
        name: `สาขาว่างทดสอบรายงาน ${emptyLocationId.slice(0, 8)}`,
        code: `R${emptyLocationId.slice(0, 7)}`,
        is_active: true,
      })).error).toBeNull();
      expect((await superAdmin.request.post("/api/lanflow/reports", {
        data: { locationId: emptyLocationId },
      })).status()).toBe(409);

      const firstSourceId = await addIncomeExpense(db, locationId, superProfile, "รายรับสำหรับรายงานชุดแรก");
      const fallbackSourceId = await addIncomeExpense(db, locationId, superProfile, "รายการ fallback timestamp", null);
      const futureSourceId = await addIncomeExpense(db, locationId, superProfile, "รายการหลัง cutoff", "2100-01-01T00:00:00.000Z");
      const concurrent = await Promise.all([
        adminContext.request.post("/api/lanflow/reports", { data: { locationId } }),
        adminContext.request.post("/api/lanflow/reports", { data: { locationId } }),
      ]);
      expect(concurrent.map((response) => response.status()).sort()).toEqual([201, 409]);
      const first = await concurrent.find((response) => response.status() === 201)!.json() as {
        id: string;
        reportNo: string;
      };
      expect(first.reportNo).toMatch(/^RPT-\d{8}-\d{3}$/);
      const firstSequence = Number(first.reportNo.slice(-3));

      const duplicate = await Promise.all([
        adminContext.request.post("/api/lanflow/reports", { data: { locationId } }),
        adminContext.request.post("/api/lanflow/reports", { data: { locationId } }),
      ]);
      expect(duplicate.map((response) => response.status()).sort()).toEqual([409, 409]);

      const locked = await db.from("income_expense").update({ title: "ห้ามแก้" }).eq("id", firstSourceId);
      expect(locked.error?.message).toContain(`REPORT_LOCKED:${first.reportNo}`);

      const firstDetails = await adminContext.request.get(`/api/lanflow/reports/${first.id}`);
      expect(firstDetails.ok(), await firstDetails.text()).toBeTruthy();
      const firstBody = await firstDetails.json() as {
        incomeExpense: Array<Record<string, unknown>>;
      };
      expect(firstBody.incomeExpense).toContainEqual(expect.objectContaining({
        type: "income",
        title: "รายรับสำหรับรายงานชุดแรก",
        amount: 1250,
      }));
      expect(firstBody.incomeExpense.map((row) => row.title)).toContain("รายการ fallback timestamp");
      expect(firstBody.incomeExpense.map((row) => row.title)).not.toContain("รายการหลัง cutoff");

      const secondSourceId = await addIncomeExpense(db, locationId, superProfile, "รายรับสำหรับรายงานชุดสอง");
      expect((await db.from("income_expense").update({
        server_received_at: new Date().toISOString(),
      }).eq("id", futureSourceId)).error).toBeNull();
      const second = await createReport(adminContext, locationId);
      expect(Number(second.reportNo.slice(-3))).toBe(firstSequence + 1);

      const oldDelete = await deleteReport(superAdmin, first.id);
      expect(oldDelete.status()).toBe(409);
      expect((await deleteReport(adminContext, second.id)).status()).toBe(403);
      expect((await deleteReport(superAdmin, second.id)).ok()).toBeTruthy();
      expect((await db.from("income_expense").update({ title: "ปลดล็อกชุดสอง" }).eq("id", secondSourceId)).error).toBeNull();
      expect((await deleteReport(superAdmin, first.id)).ok()).toBeTruthy();
      expect((await db.from("income_expense").update({ title: "ปลดล็อกชุดแรก" }).eq("id", firstSourceId)).error).toBeNull();

      const recreated = await createReport(adminContext, locationId);
      expect(Number(recreated.reportNo.slice(-3))).toBe(firstSequence + 2);
      const recreatedDetails = await adminContext.request.get(`/api/lanflow/reports/${recreated.id}`);
      const recreatedBody = await recreatedDetails.json() as { incomeExpense: Array<{ title: string }> };
      expect(recreatedBody.incomeExpense.map((row) => row.title)).toEqual(expect.arrayContaining([
        "ปลดล็อกชุดแรก",
        "ปลดล็อกชุดสอง",
        "รายการ fallback timestamp",
        "รายการหลัง cutoff",
      ]));
      expect((await deleteReport(superAdmin, recreated.id)).ok()).toBeTruthy();

      await db.from("income_expense").delete().in("id", [
        firstSourceId,
        fallbackSourceId,
        futureSourceId,
        secondSourceId,
      ]);
    } finally {
      await db.from("locations").delete().eq("id", emptyLocationId);
      await Promise.all([user.close(), adminContext.close(), superAdmin.close()]);
    }
  });

  test("system manager can manage every branch and source relations stay locked", async ({ browser }) => {
    const adminContext = await authContext(browser, "admin");
    const superAdmin = await authContext(browser, "super_admin");
    const db = service();
    const adminProfile = await profile(adminContext);
    const superProfile = await profile(superAdmin);
    const foreignLocationId = superProfile.locationIds.find((id) => !adminProfile.locationIds.includes(id));
    expect(foreignLocationId).toBeTruthy();

    let managerReportId: string | null = null;
    let managerSourceId: string | null = null;
    try {
      expect((await adminContext.request.get(`/api/lanflow/reports?locationId=${foreignLocationId}`)).status()).toBe(403);
      expect((await db.from("profiles").update({ can_access_super_admin_features: true }).eq("id", adminProfile.id)).error).toBeNull();

      managerSourceId = await addIncomeExpense(db, foreignLocationId!, superProfile, "รายรับทดสอบผู้จัดการระบบ");
      const managerReport = await createReport(adminContext, foreignLocationId!);
      managerReportId = managerReport.id;
      expect((await adminContext.request.get(`/api/lanflow/reports?locationId=${foreignLocationId}`)).ok()).toBeTruthy();
      expect((await deleteReport(adminContext, managerReport.id)).ok()).toBeTruthy();
      managerReportId = null;

      const rubberId = crypto.randomUUID();
      const rubberNumber = `RB-T-${rubberId.slice(0, 8)}`;
      const { error: rubberError } = await db.from("rubber_bills").insert({
        id: rubberId,
        client_temp_id: rubberId,
        local_bill_no: rubberNumber,
        server_bill_no: rubberNumber,
        idempotency_key: `report-rubber:${rubberId}`,
        sync_status: "synced",
        record_status: "active",
        location_id: adminProfile.locationIds[0],
        bill_no: rubberNumber,
        bill_date: new Date().toISOString().slice(0, 10),
        customer_name: "ลูกค้าทดสอบ",
        customer_type: "สาขานี้จ่าย",
        bill_type: "weighing",
        weight: 10,
        rubber_value: 100,
        average_price: 10,
        net_total: 100,
        server_received_at: new Date().toISOString(),
        created_by_user_id: superProfile.id,
        created_by_name: superProfile.name,
        created_by_phone: superProfile.phone,
      });
      expect(rubberError).toBeNull();

      const rubberReport = await createReport(superAdmin, adminProfile.locationIds[0]);
      const computedLock = await db
        .from("rubber_bills")
        .select("id, report_lock_no")
        .eq("id", rubberId)
        .single();
      expect(computedLock.error).toBeNull();
      expect((computedLock.data as { report_lock_no: string }).report_lock_no).toBe(rubberReport.reportNo);
      const transferId = crypto.randomUUID();
      const { error: transferError } = await db.from("money_transfers").insert({
        id: transferId,
        client_temp_id: transferId,
        idempotency_key: `report-relation:${transferId}`,
        location_id: adminProfile.locationIds[0],
        customer_name: "ลูกค้าทดสอบ",
        net_amount_to_pay: 100,
        transfer_status: "paid",
        sync_status: "synced",
        record_status: "active",
        transfer_type: "customer",
        transfer_method: "bank",
        created_by_user_id: superProfile.id,
        created_by_name: superProfile.name,
        created_by_phone: superProfile.phone,
      });
      expect(transferError).toBeNull();

      const lockedRelation = await db.from("money_transfer_items").insert({
        transfer_id: transferId,
        source_type: "rubber_bill",
        source_id: rubberId,
        customer_name: "ลูกค้าทดสอบ",
        amount: 100,
      });
      expect(lockedRelation.error?.message).toContain(`REPORT_LOCKED:${rubberReport.reportNo}`);
      expect((await db.from("rubber_bill_items").insert({
        bill_id: rubberId,
        item_type: "weigh",
        total: 0,
      })).error?.message).toContain(`REPORT_LOCKED:${rubberReport.reportNo}`);

      expect((await deleteReport(superAdmin, rubberReport.id)).ok()).toBeTruthy();
      expect((await db.from("money_transfer_items").insert({
        transfer_id: transferId,
        source_type: "rubber_bill",
        source_id: rubberId,
        customer_name: "ลูกค้าทดสอบ",
        amount: 100,
      })).error).toBeNull();

      await db.from("money_transfer_items").delete().eq("transfer_id", transferId);
      await db.from("money_transfers").delete().eq("id", transferId);
      await db.from("rubber_bills").delete().eq("id", rubberId);
      await db.from("income_expense").delete().eq("id", managerSourceId);
      managerSourceId = null;
    } finally {
      if (managerReportId) await deleteReport(adminContext, managerReportId);
      if (managerSourceId) await db.from("income_expense").delete().eq("id", managerSourceId);
      await db.from("profiles").update({ can_access_super_admin_features: false }).eq("id", adminProfile.id);
      await Promise.all([adminContext.close(), superAdmin.close()]);
    }
  });

  test("partial customer transfer can be saved when its unchanged source bill is report locked", async ({ browser }) => {
    const superAdmin = await authContext(browser, "super_admin");
    const db = service();
    const actor = await profile(superAdmin);
    const locationId = actor.locationIds[0];
    const rubberId = crypto.randomUUID();
    const transferId = crypto.randomUUID();
    const transferItemId = crypto.randomUUID();
    const slipId = crypto.randomUUID();
    const customerName = `ลูกค้าค้างจ่าย ${transferId.slice(0, 8)}`;
    const rubberNumber = `RB-P-${rubberId.slice(0, 8)}`;
    let reportId: string | null = null;

    try {
      expect((await db.from("rubber_bills").insert({
        id: rubberId,
        client_temp_id: rubberId,
        local_bill_no: rubberNumber,
        server_bill_no: rubberNumber,
        idempotency_key: `report-partial-rubber:${rubberId}`,
        sync_status: "synced",
        record_status: "active",
        location_id: locationId,
        bill_no: rubberNumber,
        bill_date: new Date().toISOString().slice(0, 10),
        customer_name: customerName,
        customer_type: "สาขานี้จ่าย",
        bill_type: "weighing",
        weight: 10,
        rubber_value: 100,
        average_price: 10,
        net_total: 100,
        server_received_at: new Date().toISOString(),
        created_by_user_id: actor.id,
        created_by_name: actor.name,
        created_by_phone: actor.phone,
      })).error).toBeNull();

      expect((await db.from("money_transfers").insert({
        id: transferId,
        client_temp_id: transferId,
        idempotency_key: `report-partial-transfer:${transferId}`,
        location_id: locationId,
        customer_name: customerName,
        net_amount_to_pay: 100,
        transfer_status: "partial",
        sync_status: "synced",
        record_status: "active",
        transfer_type: "customer",
        transfer_method: "bank",
        created_by_user_id: actor.id,
        created_by_name: actor.name,
        created_by_phone: actor.phone,
      })).error).toBeNull();

      expect((await db.from("money_transfer_items").insert({
        id: transferItemId,
        transfer_id: transferId,
        source_type: "rubber_bill",
        source_id: rubberId,
        customer_name: customerName,
        amount: 100,
      })).error).toBeNull();

      expect((await db.from("money_transfer_slips").insert({
        id: slipId,
        transfer_id: transferId,
        amount: 40,
        transaction_date: new Date().toISOString().slice(0, 10),
        sort_order: 0,
      })).error).toBeNull();

      const report = await createReport(superAdmin, locationId);
      reportId = report.id;

      const { data: locks, error: locksError } = await db
        .from("money_transfers")
        .select("report_lock_no, money_transfer_items(source_id)")
        .eq("id", transferId)
        .single();
      expect(locksError).toBeNull();
      expect(locks?.report_lock_no).toBeNull();
      expect(locks?.money_transfer_items).toEqual([
        expect.objectContaining({ source_id: rubberId }),
      ]);

      const parentOnlyUpdate = await db
        .from("money_transfers")
        .update({ revision_no: 1 })
        .eq("id", transferId);
      expect(parentOnlyUpdate.error).toBeNull();

      const slipOnlyUpdate = await db
        .from("money_transfer_slips")
        .update({ reference_number: "unchanged-source-test" })
        .eq("id", slipId);
      expect(slipOnlyUpdate.error).toBeNull();

      const lockedItemDelete = await db
        .from("money_transfer_items")
        .delete()
        .eq("id", transferItemId);
      expect(lockedItemDelete.error?.message).toContain(`REPORT_LOCKED:${report.reportNo}`);

      const page = await superAdmin.newPage();
      await page.goto("/");
      await page.getByLabel("เลือกสาขา").selectOption(locationId);
      await page.getByRole("button", { name: /^โอนเงิน/ }).click();

      const transferRow = page.getByRole("row").filter({ hasText: customerName });
      await expect(transferRow).toContainText("ค้างจ่าย");
      await transferRow.getByTitle("แก้ไข").click();
      await expect(page.getByRole("heading", { name: "แก้ไขรายการโอนเงิน" })).toBeVisible();
      await page.getByRole("button", { name: "บันทึก" }).click();

      await expect(page.getByText("บันทึกรายการโอนเงินสำเร็จ")).toBeVisible();
      await expect(page.getByRole("heading", { name: "แก้ไขรายการโอนเงิน" })).toBeHidden();

      const { data: items, error: itemsError } = await db
        .from("money_transfer_items")
        .select("id, source_id")
        .eq("transfer_id", transferId);
      expect(itemsError).toBeNull();
      expect(items).toEqual([{ id: transferItemId, source_id: rubberId }]);
    } finally {
      if (reportId) await deleteReport(superAdmin, reportId);
      await db.from("money_transfer_slips").delete().eq("transfer_id", transferId);
      await db.from("money_transfer_items").delete().eq("transfer_id", transferId);
      await db.from("money_transfers").delete().eq("id", transferId);
      await db.from("rubber_bills").delete().eq("id", rubberId);
      await superAdmin.close();
    }
  });

  test("cash sent and received legs report once, preserve receipt, and block hard delete", async ({ browser }) => {
    const superAdmin = await authContext(browser, "super_admin");
    const db = service();
    try {
      const actor = await profile(superAdmin);
      const [sourceLocationId, targetLocationId] = actor.locationIds;
      expect(sourceLocationId).toBeTruthy();
      expect(targetLocationId).toBeTruthy();

      const transferId = crypto.randomUUID();
      const create = await superAdmin.request.post("/api/lanflow/cash-branch-transfers", {
        data: {
          id: transferId,
          clientTempId: transferId,
          idempotencyKey: `report-cash:${transferId}`,
          sourceLocationId,
          targetLocationId,
          sent: { ...zeroCounts, banknote100: 2 },
        },
      });
      expect(create.ok(), await create.text()).toBeTruthy();

      const sourceReport = await createReport(superAdmin, sourceLocationId);
      const sourceDetailResponse = await superAdmin.request.get(`/api/lanflow/reports/${sourceReport.id}`);
      const sourceDetails = await sourceDetailResponse.json() as {
        incomeExpense: Array<{ number: string; type: string; amount: number }>;
        bankTransfers: unknown[];
      };
      expect(sourceDetails.incomeExpense.filter((row) => row.number === `CASH-${transferId.slice(0, 8)}`)).toEqual([
        expect.objectContaining({ type: "expense", amount: 200 }),
      ]);
      expect(sourceDetails.bankTransfers).toEqual([]);
      expect(JSON.stringify(sourceDetails)).not.toMatch(/denomination|difference|accepted|coin|banknote/i);

      const lockedEdit = await superAdmin.request.patch(`/api/lanflow/cash-branch-transfers/${transferId}`, {
        data: {
          targetLocationId,
          sent: { ...zeroCounts, banknote100: 3 },
        },
      });
      expect(lockedEdit.status()).toBe(409);

      const receive = await superAdmin.request.post(`/api/lanflow/cash-branch-transfers/${transferId}/receive`, {
        data: { received: { ...zeroCounts, banknote100: 1 } },
      });
      expect(receive.ok(), await receive.text()).toBeTruthy();

      const targetReport = await createReport(superAdmin, targetLocationId);
      const targetDetailResponse = await superAdmin.request.get(`/api/lanflow/reports/${targetReport.id}`);
      const targetDetails = await targetDetailResponse.json() as {
        incomeExpense: Array<{ number: string; type: string; amount: number }>;
        bankTransfers: unknown[];
      };
      expect(targetDetails.incomeExpense.filter((row) => row.number === `CASH-${transferId.slice(0, 8)}`)).toEqual([
        expect.objectContaining({ type: "income", amount: 100 }),
      ]);
      expect(targetDetails.bankTransfers).toEqual([]);

      const accepted = await superAdmin.request.post(`/api/lanflow/cash-branch-transfers/${transferId}/accept-difference`, {
        data: { reason: "ตรวจสอบแล้ว" },
      });
      expect(accepted.ok(), await accepted.text()).toBeTruthy();
      expect((await superAdmin.request.delete(`/api/lanflow/cash-branch-transfers/${transferId}`)).status()).toBe(409);

      expect((await deleteReport(superAdmin, targetReport.id)).ok()).toBeTruthy();
      expect((await superAdmin.request.delete(`/api/lanflow/cash-branch-transfers/${transferId}`)).status()).toBe(409);
      expect((await deleteReport(superAdmin, sourceReport.id)).ok()).toBeTruthy();
      expect((await superAdmin.request.delete(`/api/lanflow/cash-branch-transfers/${transferId}`)).ok()).toBeTruthy();

      const { data: remaining } = await db.from("money_transfers").select("id").eq("id", transferId);
      expect(remaining).toEqual([]);
    } finally {
      await superAdmin.close();
    }
  });

  test("time tracking permanent delete exposes the report number and stays locked", async ({ browser }) => {
    const superAdmin = await authContext(browser, "super_admin");
    try {
      const actor = await profile(superAdmin);
      const locationId = actor.locationIds[0];
      const dashboardResponse = await superAdmin.request.get("/api/lanflow/time-tracking/admin");
      expect(dashboardResponse.ok()).toBeTruthy();
      const dashboard = await dashboardResponse.json() as {
        users: Array<{ id: string; role: string }>;
      };
      const employee = dashboard.users.find((user) => user.role === "user");
      expect(employee).toBeTruthy();

      const amount = 700000 + (Date.now() % 10000);
      expect((await superAdmin.request.post("/api/lanflow/time-tracking/admin", {
        data: {
          action: "ADMIN_REQUEST_WITHDRAWAL",
          payload: { user_id: employee!.id, amount },
        },
      })).ok()).toBeTruthy();

      const pendingResponse = await superAdmin.request.get("/api/lanflow/time-tracking/admin");
      const pending = await pendingResponse.json() as {
        pendingTransactions: Array<{ id: string; profile_id: string; amount: number }>;
      };
      const withdrawal = pending.pendingTransactions.find((item) =>
        item.profile_id === employee!.id && Number(item.amount) === amount
      );
      expect(withdrawal).toBeTruthy();
      expect((await superAdmin.request.post("/api/lanflow/time-tracking/admin", {
        data: {
          action: "APPROVE_TRANSACTION",
          payload: {
            transaction_id: withdrawal!.id,
            status: "APPROVED",
            expense_location_id: locationId,
            admin_comment: "report permanent-delete test",
          },
        },
      })).ok()).toBeTruthy();

      const report = await createReport(superAdmin, locationId);
      const sourceResponse = await superAdmin.request.get(
        `/api/lanflow/time-tracking/user?userId=${employee!.id}`
      );
      const source = await sourceResponse.json() as {
        transactions: Array<{ id: string; report_lock_no?: string }>;
      };
      expect(source.transactions).toContainEqual(expect.objectContaining({
        id: withdrawal!.id,
        report_lock_no: report.reportNo,
      }));

      const lockedDelete = await superAdmin.request.post("/api/lanflow/time-tracking/admin", {
        data: {
          action: "DELETE_TRANSACTION",
          payload: { transaction_id: withdrawal!.id },
        },
      });
      expect(lockedDelete.status()).toBe(409);
      expect((await lockedDelete.json() as { error: string }).error).toContain(report.reportNo);

      expect((await deleteReport(superAdmin, report.id)).ok()).toBeTruthy();
      expect((await superAdmin.request.post("/api/lanflow/time-tracking/admin", {
        data: {
          action: "DELETE_TRANSACTION",
          payload: { transaction_id: withdrawal!.id },
        },
      })).ok()).toBeTruthy();
    } finally {
      await superAdmin.close();
    }
  });

  test("report tab is hidden from user and print route is reusable after print cancellation", async ({ browser }) => {
    test.setTimeout(60_000);
    const user = await authContext(browser, "user");
    const superAdmin = await authContext(browser, "super_admin");
    const db = service();
    try {
      const actor = await profile(superAdmin);
      const locationId = actor.locationIds[0];
      const sourceId = await addIncomeExpense(db, locationId, actor, "รายรับสำหรับหน้า print");
      const longReportSourceIds = await addIncomeExpenses(db, locationId, actor, 70);
      const report = await createReport(superAdmin, locationId);

      const userPage = await user.newPage();
      await userPage.goto("/");
      await expect(userPage.getByRole("button", { name: "รายงาน" })).toHaveCount(0);

      const page = await superAdmin.newPage();
      await page.addInitScript(() => {
        window.print = () => undefined;
      });
      await page.goto(`/reports/${report.id}/print`);
      await expect(page.getByText(report.reportNo)).toBeVisible();
      await expect(page.getByRole("heading", { name: "3. รับ–จ่ายรวม" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "6. โอนเงิน (ธนาคารเท่านั้น)" })).toBeVisible();
      await expect(page.getByText("รายรับสำหรับหน้า print")).toBeVisible();
      const hasA4LandscapeRule = await page.evaluate(() =>
        [...document.styleSheets].some((sheet) => {
          try {
            return [...(sheet.cssRules ?? [])].some((rule) =>
              rule.cssText.toLowerCase().includes("size: a4 landscape")
            );
          } catch {
            return false;
          }
        })
      );
      expect(hasA4LandscapeRule).toBeTruthy();
      await expect(page.getByText("รายการภาษาไทยสำหรับทดสอบหลายหน้า 70")).toBeVisible();
      const clippedThaiCells = await page.locator("th, td").evaluateAll((cells) =>
        cells.filter((cell) =>
          cell.scrollWidth > cell.clientWidth + 1 ||
          cell.scrollHeight > cell.clientHeight + 1
        ).length
      );
      expect(clippedThaiCells).toBe(0);
      const pdf = await page.pdf({ format: "A4", landscape: true, printBackground: true });
      const pdfPageCount = (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;
      expect(pdfPageCount).toBeGreaterThan(1);
      await expect(page.locator("body")).not.toContainText("denomination");
      await expect(page.locator("body")).not.toContainText("ผลต่าง");
      await page.reload();
      await expect(page.getByText(report.reportNo)).toBeVisible();

      const list = await superAdmin.request.get(`/api/lanflow/reports?locationId=${locationId}`);
      const reports = (await list.json() as { reports: Array<{ id: string; status: string }> }).reports;
      expect(reports).toContainEqual(expect.objectContaining({ id: report.id, status: "active" }));

      expect((await deleteReport(superAdmin, report.id)).ok()).toBeTruthy();
      await db.from("income_expense").delete().in("id", [sourceId, ...longReportSourceIds]);
    } finally {
      await Promise.all([user.close(), superAdmin.close()]);
    }
  });
});
