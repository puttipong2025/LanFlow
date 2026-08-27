import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { selectAppLocation } from "../helpers/select-app-location";
import type { ReportDetails } from "@/types/reports";
import { bangkokDateString } from "../../src/lib/bangkok-date";

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
  const context = await browser.newContext({ storageState: `playwright/.auth/${role}.json` });
  const me = await context.request.get("/api/auth/me");
  if (!me.ok()) {
    const phoneByRole = {
      user: "0820000001",
      admin: "0810000001",
      super_admin: process.env.TEST_PHONE || "0800000000",
    };
    const page = await context.newPage();
    await page.goto("/login");
    await page.fill('input[type="tel"]', phoneByRole[role]);
    await page.fill('input[type="password"]', process.env.TEST_PASSWORD || "password123");
    await page.click('button:has-text("เข้าสู่ระบบ")');
    await expect(page.locator('text=ออกจากระบบ')).toBeVisible({ timeout: 30000 });
    await page.close();
  }
  return context;
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

async function findActiveLocation(
  admin: ReturnType<typeof service>,
  locationIds: string[],
) {
  const { data, error } = await admin
    .from("locations")
    .select("id")
    .in("id", locationIds)
    .eq("is_active", true)
    .limit(1)
    .single();
  expect(error).toBeNull();
  return data!.id;
}

async function activateAlternateLocation(
  admin: ReturnType<typeof service>,
  excludedLocationId: string,
  allowedLocationIds?: string[],
) {
  let query = admin
    .from("locations")
    .select("id, is_active")
    .neq("id", excludedLocationId)
    .order("created_at", { ascending: true })
    .limit(1);
  if (allowedLocationIds) query = query.in("id", allowedLocationIds);

  const { data, error } = await query.single();
  expect(error).toBeNull();
  if (!data!.is_active) {
    expect((await admin.from("locations").update({ is_active: true }).eq("id", data!.id)).error)
      .toBeNull();
  }

  return {
    id: data!.id,
    restore: async () => {
      if (!data!.is_active) {
        expect((await admin.from("locations").update({ is_active: false }).eq("id", data!.id)).error)
          .toBeNull();
      }
    },
  };
}

async function addIncomeExpense(
  admin: ReturnType<typeof service>,
  locationId: string,
  actor: { id: string; name: string; phone: string },
  title: string,
  serverReceivedAt: string | null = new Date().toISOString(),
  entry: { type?: "income" | "expense"; cost?: number } = {},
) {
  const id = crypto.randomUUID();
  const number = `RPT-T-${id.slice(0, 8)}`;
  const type = entry.type ?? "income";
  const { error } = await admin.from("income_expense").insert({
    id,
    client_temp_id: id,
    local_bill_no: number,
    server_bill_no: number,
    idempotency_key: `report-test:${id}`,
    sync_status: "synced",
    record_status: "active",
    location_id: locationId,
    type,
    number,
    tx_date: bangkokDateString(),
    title,
    cost: entry.cost ?? 1250,
    bill_option: type === "income" ? "รายรับ" : "ค่าใช้จ่าย",
    server_received_at: serverReceivedAt,
    revision_no: 0,
    created_by_user_id: actor.id,
    created_by_name: actor.name,
    created_by_phone: actor.phone,
  });
  expect(error).toBeNull();
  return id;
}

function bangkokDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
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
      tx_date: bangkokDateString(now),
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

async function addRubberBill(
  admin: ReturnType<typeof service>,
  locationId: string,
  actor: { id: string; name: string; phone: string },
  prices: number[],
  billDate = bangkokDateString()
) {
  const id = crypto.randomUUID();
  const number = `RB-PAY-${id.slice(0, 8)}`;
  const totals = prices.map((price) => 10 * price);
  const netTotal = totals.reduce((sum, total) => sum + total, 0);
  const { error: billError } = await admin.from("rubber_bills").insert({
    id,
    client_temp_id: id,
    local_bill_no: number,
    server_bill_no: number,
    idempotency_key: `report-payable:${id}`,
    sync_status: "synced",
    record_status: "active",
    location_id: locationId,
    bill_no: number,
    bill_date: billDate,
    customer_name: "ลูกค้าทดสอบกฎจ่าย",
    bill_type: "weighing",
    weight: prices.length * 10,
    rubber_value: netTotal,
    average_price: prices.reduce((sum, price) => sum + price, 0) / prices.length,
    net_total: netTotal,
    server_received_at: new Date().toISOString(),
    created_by_user_id: actor.id,
    created_by_name: actor.name,
    created_by_phone: actor.phone,
  });
  expect(billError).toBeNull();

  const { error: itemsError } = await admin.from("rubber_bill_items").insert(
    prices.map((price, index) => ({
      bill_id: id,
      item_type: "weigh",
      description: `ชั่ง ${index + 1}`,
      weight_in: 20,
      weight_out: 10,
      net_weight: 10,
      price,
      total: totals[index],
      sequence_no: index + 1,
    }))
  );
  expect(itemsError).toBeNull();
  return id;
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
      expect((await user.request.get(`/api/lanflow/reports/${first.id}`)).status()).toBe(403);

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
        report: { cutoffAt: string };
        incomeExpense: Array<{
          date: string;
          number: string;
          type: "income" | "expense";
          title: string;
          amount: number;
        }>;
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
      const firstBalance = firstBody.incomeExpense.reduce(
        (balance, row) => balance + (row.type === "income" ? row.amount : -row.amount),
        0,
      );
      const secondDetails = await adminContext.request.get(`/api/lanflow/reports/${second.id}`);
      expect(secondDetails.ok(), await secondDetails.text()).toBeTruthy();
      const secondBody = await secondDetails.json() as {
        incomeExpense: Array<{
          date: string;
          number: string;
          type: "income" | "expense";
          title: string;
          amount: number;
        }>;
      };
      expect(secondBody.incomeExpense[0]).toEqual({
        date: bangkokDate(firstBody.report.cutoffAt),
        number: first.reportNo,
        type: firstBalance >= 0 ? "income" : "expense",
        title: "ยอดยกมา",
        amount: Math.abs(firstBalance),
      });

      const oldDelete = await deleteReport(superAdmin, first.id);
      expect(oldDelete.status()).toBe(409);
      expect((await deleteReport(adminContext, second.id)).status()).toBe(403);
      expect((await deleteReport(superAdmin, second.id)).ok()).toBeTruthy();
      expect((await db.from("income_expense").update({ title: "ปลดล็อกชุดสอง" }).eq("id", secondSourceId)).error).toBeNull();
      expect((await deleteReport(superAdmin, first.id)).ok()).toBeTruthy();
      expect((await db.from("income_expense").update({ title: "ปลดล็อกชุดแรก" }).eq("id", firstSourceId)).error).toBeNull();
      const [{ data: removedReports }, { data: removedItems }] = await Promise.all([
        db.from("report_batches").select("id").in("id", [first.id, second.id]),
        db.from("report_items").select("id").in("report_id", [first.id, second.id]),
      ]);
      expect(removedReports).toEqual([]);
      expect(removedItems).toEqual([]);
      expect((await adminContext.request.get(`/api/lanflow/reports/${first.id}`)).status()).toBe(404);
      expect((await deleteReport(superAdmin, first.id)).ok()).toBeTruthy();

      const forbiddenDeletionHistory = await adminContext.request.get(
        `/api/lanflow/reports?locationId=${locationId}&view=deletions`,
      );
      expect(forbiddenDeletionHistory.status()).toBe(403);
      const deletionHistory = await superAdmin.request.get(
        `/api/lanflow/reports?locationId=${locationId}&view=deletions`,
      );
      expect(deletionHistory.ok(), await deletionHistory.text()).toBeTruthy();
      expect((await deletionHistory.json()).deletions).toEqual(expect.arrayContaining([
        expect.objectContaining({ documentKind: "report_batch", documentNo: first.reportNo }),
        expect.objectContaining({ documentKind: "report_batch", documentNo: second.reportNo }),
      ]));

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

  test("first report has no carry row and signed balances carry in the matching column", async ({ browser }) => {
    const superAdmin = await authContext(browser, "super_admin");
    const db = service();
    const actor = await profile(superAdmin);
    const locationId = crypto.randomUUID();
    const sourceIds: string[] = [];
    const reportIds: string[] = [];

    try {
      expect((await db.from("locations").insert({
        id: locationId,
        name: `สาขาทดสอบยอดยกมา ${locationId.slice(0, 8)}`,
        code: `OB${locationId.slice(0, 6)}`,
        is_active: true,
      })).error).toBeNull();

      sourceIds.push(await addIncomeExpense(
        db,
        locationId,
        actor,
        "รายรับสำหรับยอดยกมาบวก",
        new Date().toISOString(),
        { type: "income", cost: 5000 },
      ));
      const first = await createReport(superAdmin, locationId);
      reportIds.push(first.id);
      const firstResponse = await superAdmin.request.get(`/api/lanflow/reports/${first.id}`);
      expect(firstResponse.ok(), await firstResponse.text()).toBeTruthy();
      const firstDetails = await firstResponse.json() as ReportDetails;
      expect(firstDetails.incomeExpense.map((row) => row.title)).not.toContain("ยอดยกมา");

      sourceIds.push(await addIncomeExpense(
        db,
        locationId,
        actor,
        "รายจ่ายทำให้ยอดติดลบ",
        new Date().toISOString(),
        { type: "expense", cost: 7000 },
      ));
      const second = await createReport(superAdmin, locationId);
      reportIds.push(second.id);
      const secondResponse = await superAdmin.request.get(`/api/lanflow/reports/${second.id}`);
      expect(secondResponse.ok(), await secondResponse.text()).toBeTruthy();
      const secondDetails = await secondResponse.json() as ReportDetails;

      expect(secondDetails.incomeExpense[0]).toEqual({
        date: bangkokDate(firstDetails.report.cutoffAt),
        number: first.reportNo,
        type: "income",
        title: "ยอดยกมา",
        amount: 5000,
      });

      sourceIds.push(await addIncomeExpense(
        db,
        locationId,
        actor,
        "รายรับหลังยอดติดลบ",
        new Date().toISOString(),
        { type: "income", cost: 1000 },
      ));
      const third = await createReport(superAdmin, locationId);
      reportIds.push(third.id);
      const thirdResponse = await superAdmin.request.get(`/api/lanflow/reports/${third.id}`);
      expect(thirdResponse.ok(), await thirdResponse.text()).toBeTruthy();
      const thirdDetails = await thirdResponse.json() as ReportDetails;

      expect(thirdDetails.incomeExpense[0]).toEqual({
        date: bangkokDate(secondDetails.report.cutoffAt),
        number: second.reportNo,
        type: "expense",
        title: "ยอดยกมา",
        amount: 2000,
      });
    } finally {
      for (const reportId of reportIds.reverse()) {
        const response = await deleteReport(superAdmin, reportId);
        expect(response.ok(), await response.text()).toBeTruthy();
      }
      if (sourceIds.length > 0) {
        await db.from("income_expense").delete().in("id", sourceIds);
      }
      await db.from("document_deletion_audits").delete().eq("location_id", locationId);
      await db.from("locations").delete().eq("id", locationId);
      await superAdmin.close();
    }
  });

  test("rubber bill groups follow the current customer class and default to farmer", async ({ browser }) => {
    const adminContext = await authContext(browser, "admin");
    const superAdmin = await authContext(browser, "super_admin");
    const db = service();
    const customerIds = [crypto.randomUUID(), crypto.randomUUID()];
    const billIds: string[] = [];
    let reportId: string | null = null;

    try {
      const actor = await profile(adminContext);
      const locationId = actor.locationIds[0];
      const marker = crypto.randomUUID().slice(0, 8);
      const traderName = `ผู้ค้าขายรายงาน ${marker}`;
      const farmerName = `ชาวสวนรายงาน ${marker}`;
      const fallbackName = `ชาวสวนไม่มีทะเบียน ${marker}`;

      const { error: customerError } = await db.from("customers").insert([
        {
          id: customerIds[0],
          client_temp_id: customerIds[0],
          idempotency_key: `report-customer:${customerIds[0]}`,
          class: "สาขาใหญ่จ่าย",
          main_name: traderName,
          default_location_id: locationId,
          created_by_user_id: actor.id,
          created_by_name: actor.name,
          created_by_phone: actor.phone,
        },
        {
          id: customerIds[1],
          client_temp_id: customerIds[1],
          idempotency_key: `report-customer:${customerIds[1]}`,
          class: "สาขานี้จ่าย",
          main_name: farmerName,
          default_location_id: locationId,
          created_by_user_id: actor.id,
          created_by_name: actor.name,
          created_by_phone: actor.phone,
        },
      ]);
      expect(customerError).toBeNull();

      billIds.push(
        await addRubberBill(db, locationId, actor, [20]),
        await addRubberBill(db, locationId, actor, [21]),
        await addRubberBill(db, locationId, actor, [22])
      );
      const billCustomers = [
        { id: billIds[0], customer_id: customerIds[0], customer_name: traderName },
        { id: billIds[1], customer_id: customerIds[1], customer_name: farmerName },
        { id: billIds[2], customer_id: null, customer_name: fallbackName },
      ];
      for (const bill of billCustomers) {
        const { error } = await db.from("rubber_bills")
          .update({ customer_id: bill.customer_id, customer_name: bill.customer_name })
          .eq("id", bill.id);
        expect(error).toBeNull();
      }

      reportId = (await createReport(adminContext, locationId)).id;
      const firstResponse = await adminContext.request.get(`/api/lanflow/reports/${reportId}`);
      expect(firstResponse.ok(), await firstResponse.text()).toBeTruthy();
      const first = await firstResponse.json() as ReportDetails;
      const firstGroups = new Map(first.rubberBills.map((bill) => [bill.customer, bill.customerGroup]));
      expect(firstGroups.get(traderName)).toBe("trader");
      expect(firstGroups.get(farmerName)).toBe("farmer");
      expect(firstGroups.get(fallbackName)).toBe("farmer");

      expect((await db.from("customers")
        .update({ class: "สาขานี้จ่าย" })
        .eq("id", customerIds[0])).error).toBeNull();
      const updatedResponse = await adminContext.request.get(`/api/lanflow/reports/${reportId}`);
      expect(updatedResponse.ok(), await updatedResponse.text()).toBeTruthy();
      const updated = await updatedResponse.json() as ReportDetails;
      const updatedTrader = updated.rubberBills.find((bill) => bill.customer === traderName);
      expect(updatedTrader?.customerGroup).toBe("farmer");
    } finally {
      if (reportId) await deleteReport(superAdmin, reportId);
      if (billIds.length > 0) await db.from("rubber_bills").delete().in("id", billIds);
      await db.from("customers").delete().in("id", customerIds);
      await Promise.all([adminContext.close(), superAdmin.close()]);
    }
  });

  test("system manager can manage every branch and source relations stay locked", async ({ browser }) => {
    const adminContext = await authContext(browser, "admin");
    const superAdmin = await authContext(browser, "super_admin");
    const db = service();
    const adminProfile = await profile(adminContext);
    const alternateLocation = await activateAlternateLocation(db, adminProfile.locationIds[0]);

    let managerReportId: string | null = null;
    let managerSourceId: string | null = null;
    try {
      const superProfile = await profile(superAdmin);
      const foreignLocationId = alternateLocation.id;
      expect(superProfile.locationIds).toContain(foreignLocationId);
      expect((await adminContext.request.get(`/api/lanflow/reports?locationId=${foreignLocationId}`)).status()).toBe(403);
      expect((await db.from("profiles").update({ can_access_super_admin_features: true }).eq("id", adminProfile.id)).error).toBeNull();

      managerSourceId = await addIncomeExpense(db, foreignLocationId!, superProfile, "รายรับทดสอบผู้จัดการระบบ");
      const managerReport = await createReport(adminContext, foreignLocationId!);
      managerReportId = managerReport.id;
      expect((await adminContext.request.get(`/api/lanflow/reports?locationId=${foreignLocationId}`)).ok()).toBeTruthy();
      expect((await deleteReport(adminContext, managerReport.id)).ok()).toBeTruthy();
      managerReportId = null;

      const rubberId = await addRubberBill(
        db,
        adminProfile.locationIds[0],
        superProfile,
        [10]
      );

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
      await alternateLocation.restore();
      await Promise.all([adminContext.close(), superAdmin.close()]);
    }
  });

  test("zero-priced rubber bills stay editable and cannot enter reports or transfers", async ({ browser }) => {
    const superAdmin = await authContext(browser, "super_admin");
    const db = service();
    const actor = await profile(superAdmin);
    const locationId = actor.locationIds[0];
    const billDate = "2099-12-31";
    const incomeId = await addIncomeExpense(db, locationId, actor, "ตัวค้ำสำหรับรายงานกฎราคา 0");
    const zeroBillId = await addRubberBill(db, locationId, actor, [0], billDate);
    const mixedBillId = await addRubberBill(db, locationId, actor, [20, 0], billDate);
    const payableBillId = await addRubberBill(db, locationId, actor, [20], billDate);
    const transferId = crypto.randomUUID();
    let reportId: string | undefined;

    try {
      const feedResponse = await superAdmin.request.get(
        `/api/lanflow/income-expense/feed?locationId=${locationId}&from=${billDate}&to=${billDate}`
      );
      expect(feedResponse.ok()).toBeTruthy();
      const feed = await feedResponse.json() as {
        rows: Array<{ relationSourceType?: string; relationSourceId?: string; cost: number; title: string }>;
      };
      const rubberFeed = feed.rows.filter(
        (row) => row.relationSourceType === "rubber_bill_daily" && row.relationSourceId === billDate
      );
      expect(rubberFeed).toHaveLength(1);
      expect(Number(rubberFeed[0].cost)).toBe(200);
      expect(rubberFeed[0].title).toContain("1 ใบ");

      const blockedReport = await superAdmin.request.post("/api/lanflow/reports", {
        data: { locationId },
      });
      expect(blockedReport.status()).toBe(409);
      expect(await blockedReport.json()).toEqual({
        error: "สร้างรายงานไม่สำเร็จ",
        errorGroups: ["บิลยาง"],
      });

      expect((await db.from("money_transfers").insert({
        id: transferId,
        client_temp_id: transferId,
        idempotency_key: `zero-price-transfer:${transferId}`,
        location_id: locationId,
        customer_name: "ลูกค้าทดสอบกฎจ่าย",
        net_amount_to_pay: 200,
      })).error).toBeNull();

      const zeroTransfer = await db.from("money_transfer_items").insert({
        transfer_id: transferId,
        source_type: "rubber_bill",
        source_id: zeroBillId,
        customer_name: "ลูกค้าทดสอบกฎจ่าย",
        amount: 0,
      });
      const mixedTransfer = await db.from("money_transfer_items").insert({
        transfer_id: transferId,
        source_type: "rubber_bill",
        source_id: mixedBillId,
        customer_name: "ลูกค้าทดสอบกฎจ่าย",
        amount: 200,
      });
      const payableTransfer = await db.from("money_transfer_items").insert({
        transfer_id: transferId,
        source_type: "rubber_bill",
        source_id: payableBillId,
        customer_name: "ลูกค้าทดสอบกฎจ่าย",
        amount: 200,
      });

      expect.soft(zeroTransfer.error?.message).toContain("ราคา 0");
      expect.soft(mixedTransfer.error?.message).toContain("ราคา 0");
      expect.soft(payableTransfer.error).toBeNull();

      await db.from("money_transfer_items").delete().eq("transfer_id", transferId);
      await db.from("money_transfers").delete().eq("id", transferId);
      expect((await db.from("rubber_bill_items").update({ price: 20, total: 200 })
        .in("bill_id", [zeroBillId, mixedBillId])
        .eq("price", 0)).error).toBeNull();
      expect((await db.from("rubber_bills").update({
        average_price: 20,
        rubber_value: 200,
        net_total: 200,
      }).eq("id", zeroBillId)).error).toBeNull();

      const report = await createReport(superAdmin, locationId);
      reportId = report.id;
      const { data: reportItems, error: reportItemsError } = await db
        .from("report_items")
        .select("entity_id")
        .eq("report_id", report.id)
        .eq("entity_type", "rubber_bill")
        .in("entity_id", [zeroBillId, mixedBillId, payableBillId]);
      expect(reportItemsError).toBeNull();
      expect(new Set((reportItems ?? []).map((item) => item.entity_id))).toEqual(
        new Set([zeroBillId, mixedBillId, payableBillId]),
      );
    } finally {
      await db.from("money_transfers").delete().eq("id", transferId);
      if (reportId) await deleteReport(superAdmin, reportId);
      await db.from("rubber_bills").delete().in("id", [zeroBillId, mixedBillId, payableBillId]);
      await db.from("income_expense").delete().eq("id", incomeId);
      await superAdmin.close();
    }
  });

  test("pending rubber-bill create and change requests block the whole report", async ({ browser }) => {
    const superAdmin = await authContext(browser, "super_admin");
    const admin = await authContext(browser, "admin");
    const db = service();
    const actor = await profile(superAdmin);
    const adminActor = await profile(admin);
    const locationId = await findActiveLocation(db, adminActor.locationIds);
    const otherLocation = await activateAlternateLocation(db, locationId);
    const incomeId = await addIncomeExpense(db, locationId, actor, "ตัวค้ำสำหรับงานบิลยางค้าง");
    const rubberId = await addRubberBill(db, locationId, actor, [20]);
    const createRequestId = crypto.randomUUID();
    const changeRequestId = crypto.randomUUID();
    const otherBranchRequestId = crypto.randomUUID();
    const futureRequestId = crypto.randomUUID();
    let reportId: string | null = null;

    const requestBase = {
      location_id: locationId,
      base_revision_no: 0,
      configured_price_snapshot: 10,
      edit_window_minutes_snapshot: 30,
      proposed_payload: {},
      requested_by_user_id: actor.id,
      requested_by_name: actor.name,
      requested_by_phone: actor.phone,
    };

    try {
      expect((await db.from("rubber_bill_approval_requests").insert({
        ...requestBase,
        id: createRequestId,
        operation: "create",
        client_temp_id: createRequestId,
        idempotency_key: `report-pending-create:${createRequestId}`,
        matched_reasons: ["price"],
      })).error).toBeNull();

      const adminPage = await admin.newPage();
      await adminPage.goto("/");
      await selectAppLocation(adminPage, locationId);
      await expect(
        adminPage.getByRole("navigation").getByRole("button", {
          name: "บิลยาง",
          exact: true,
        }),
      ).toBeVisible();
      await adminPage.close();

      let blocked = await admin.request.post("/api/lanflow/reports", {
        data: { locationId },
      });
      expect(blocked.status()).toBe(409);
      expect((await blocked.json()).errorGroups).toEqual(["บิลยาง"]);

      expect((await db.from("rubber_bill_approval_requests")
        .delete().eq("id", createRequestId)).error).toBeNull();

      expect((await db.from("rubber_bill_approval_requests").insert({
        ...requestBase,
        id: otherBranchRequestId,
        location_id: otherLocation.id,
        operation: "create",
        client_temp_id: otherBranchRequestId,
        idempotency_key: `report-other-branch:${otherBranchRequestId}`,
        matched_reasons: ["price"],
      })).error).toBeNull();
      reportId = (await createReport(admin, locationId)).id;
      expect((await deleteReport(superAdmin, reportId)).ok()).toBeTruthy();
      reportId = null;
      expect((await db.from("rubber_bill_approval_requests")
        .delete().eq("id", otherBranchRequestId)).error).toBeNull();

      expect((await db.from("rubber_bill_approval_requests").insert({
        ...requestBase,
        id: futureRequestId,
        operation: "create",
        client_temp_id: futureRequestId,
        idempotency_key: `report-future:${futureRequestId}`,
        matched_reasons: ["price"],
        requested_at: new Date(Date.now() + 60_000).toISOString(),
      })).error).toBeNull();
      reportId = (await createReport(admin, locationId)).id;
      expect((await deleteReport(superAdmin, reportId)).ok()).toBeTruthy();
      reportId = null;
      expect((await db.from("rubber_bill_approval_requests")
        .delete().eq("id", futureRequestId)).error).toBeNull();

      expect((await db.from("rubber_bill_approval_requests").insert({
        ...requestBase,
        id: changeRequestId,
        operation: "update",
        bill_id: rubberId,
        client_temp_id: changeRequestId,
        idempotency_key: `report-pending-change:${changeRequestId}`,
        matched_reasons: ["time"],
        original_payload: {},
      })).error).toBeNull();

      blocked = await superAdmin.request.post("/api/lanflow/reports", {
        data: { locationId },
      });
      expect(blocked.status()).toBe(409);
      expect((await blocked.json()).errorGroups).toEqual(["บิลยาง"]);

      expect((await db.from("rubber_bill_approval_requests")
        .delete().eq("id", changeRequestId)).error).toBeNull();
      const report = await createReport(superAdmin, locationId);
      reportId = report.id;
    } finally {
      if (reportId) await deleteReport(superAdmin, reportId);
      await db.from("rubber_bill_approval_requests")
        .delete().in("id", [
          createRequestId,
          changeRequestId,
          otherBranchRequestId,
          futureRequestId,
        ]);
      await db.from("rubber_bills").delete().eq("id", rubberId);
      await db.from("income_expense").delete().eq("id", incomeId);
      await otherLocation.restore();
      await admin.close();
      await superAdmin.close();
    }
  });

  test("advance payments stay unfinished and out of reports", async ({ browser }) => {
    const superAdmin = await authContext(browser, "super_admin");
    const db = service();
    const actor = await profile(superAdmin);
    const locationId = actor.locationIds[0];
    const transferId = crypto.randomUUID();
    let reportId: string | null = null;
    const incomeId = await addIncomeExpense(
      db,
      locationId,
      actor,
      "รายรับสำหรับยืนยันว่าเงินล่วงหน้าไม่เข้ารายงาน",
    );

    expect((await db.from("money_transfers").insert({
      id: transferId,
      client_temp_id: transferId,
      idempotency_key: `report-advance:${transferId}`,
      location_id: locationId,
      customer_name: "ลูกค้าจ่ายล่วงหน้า",
      net_amount_to_pay: 0,
      transfer_method: "bank",
      transfer_type: "customer",
      transfer_status: "advance_payment",
      created_by_user_id: actor.id,
      created_by_name: actor.name,
      created_by_phone: actor.phone,
    })).error).toBeNull();

    try {
      const report = await createReport(superAdmin, locationId);
      reportId = report.id;
      const { data: reportItems, error: reportItemsError } = await db
        .from("report_items")
        .select("entity_id")
        .eq("report_id", report.id)
        .eq("entity_id", transferId);
      expect(reportItemsError).toBeNull();
      expect(reportItems).toEqual([]);

      const { data: transfer, error: transferError } = await db
        .from("money_transfers")
        .select("report_lock_no,transfer_status")
        .eq("id", transferId)
        .single();
      expect(transferError).toBeNull();
      expect(transfer).toEqual({
        report_lock_no: null,
        transfer_status: "advance_payment",
      });
    } finally {
      if (reportId) await deleteReport(superAdmin, reportId);
      await db.from("money_transfers").delete().eq("id", transferId);
      await db.from("income_expense").delete().eq("id", incomeId);
      await superAdmin.close();
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
        bill_date: bangkokDateString(),
        customer_name: customerName,
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
      expect((await db.from("rubber_bill_items").insert({
        bill_id: rubberId,
        item_type: "weigh",
        description: "ชั่ง 1",
        weight_in: 20,
        weight_out: 10,
        net_weight: 10,
        price: 10,
        total: 100,
        sequence_no: 1,
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
        transaction_date: bangkokDateString(),
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
      await selectAppLocation(page, locationId);
      await page.getByRole("button", { name: /^โอนเงิน/ }).click();
      await page.getByRole("button", { name: /^ค้างจ่าย/ }).click();

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
    const transferId = crypto.randomUUID();
    let sourceReportId: string | null = null;
    let targetReportId: string | null = null;
    let restoreAlternateLocation: (() => Promise<void>) | null = null;
    try {
      const actor = await profile(superAdmin);
      const sourceLocationId = await findActiveLocation(db, actor.locationIds);
      const targetLocation = await activateAlternateLocation(
        db,
        sourceLocationId,
      );
      const targetLocationId = targetLocation.id;
      restoreAlternateLocation = targetLocation.restore;

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
      sourceReportId = sourceReport.id;
      const sourceDetailResponse = await superAdmin.request.get(`/api/lanflow/reports/${sourceReport.id}`);
      const sourceDetails = await sourceDetailResponse.json() as {
        incomeExpense: Array<{ number: string; type: string; amount: number }>;
        bankTransfers: Array<{ number: string }>;
      };
      expect(sourceDetails.incomeExpense.filter((row) => row.number === `CASH-${transferId.slice(0, 8)}`)).toEqual([
        expect.objectContaining({ type: "expense", amount: 200 }),
      ]);
      expect(sourceDetails.bankTransfers.filter((row) => row.number === `CASH-${transferId.slice(0, 8)}`)).toEqual([]);
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
      targetReportId = targetReport.id;
      const targetDetailResponse = await superAdmin.request.get(`/api/lanflow/reports/${targetReport.id}`);
      const targetDetails = await targetDetailResponse.json() as {
        incomeExpense: Array<{ number: string; type: string; amount: number }>;
        bankTransfers: Array<{ number: string }>;
      };
      expect(targetDetails.incomeExpense.filter((row) => row.number === `CASH-${transferId.slice(0, 8)}`)).toEqual([
        expect.objectContaining({ type: "income", amount: 100 }),
      ]);
      expect(targetDetails.bankTransfers.filter((row) => row.number === `CASH-${transferId.slice(0, 8)}`)).toEqual([]);

      expect((await superAdmin.request.delete(`/api/lanflow/cash-branch-transfers/${transferId}`)).status()).toBe(409);

      expect((await deleteReport(superAdmin, targetReport.id)).ok()).toBeTruthy();
      targetReportId = null;
      expect((await superAdmin.request.delete(`/api/lanflow/cash-branch-transfers/${transferId}`)).status()).toBe(409);
      expect((await deleteReport(superAdmin, sourceReport.id)).ok()).toBeTruthy();
      sourceReportId = null;
      const requested = await superAdmin.request.delete(`/api/lanflow/cash-branch-transfers/${transferId}`);
      expect(requested.ok(), await requested.text()).toBeTruthy();
      const requestResult = await requested.json() as { status: string; requestId: string };
      expect(requestResult.status).toBe("pending_approval");
      const approved = await superAdmin.request.post(
        `/api/lanflow/cash-branch-transfers/delete-requests/${requestResult.requestId}/decide`,
        { data: { decision: "approved" } },
      );
      expect(approved.ok(), await approved.text()).toBeTruthy();

      const { data: remaining } = await db.from("money_transfers").select("id").eq("id", transferId);
      expect(remaining).toEqual([]);
    } finally {
      if (targetReportId) await deleteReport(superAdmin, targetReportId);
      if (sourceReportId) await deleteReport(superAdmin, sourceReportId);
      await db.from("money_transfers").delete().eq("id", transferId);
      await restoreAlternateLocation?.();
      await superAdmin.close();
    }
  });

  test("time tracking permanent delete exposes the report number and stays locked", async ({ browser }) => {
    const superAdmin = await authContext(browser, "super_admin");
    const db = service();
    let reportId: string | undefined;
    let withdrawalId: string | undefined;
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
          payload: { user_id: employee!.id, amount, effective_date: bangkokDate(new Date().toISOString()) },
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
      withdrawalId = withdrawal!.id;
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
      reportId = report.id;
      const detailResponse = await superAdmin.request.get(`/api/lanflow/reports/${report.id}`);
      expect(detailResponse.ok(), await detailResponse.text()).toBeTruthy();
      const details = await detailResponse.json() as {
        timePayroll: Array<{ number: string; amount: number }>;
      };
      expect(details.timePayroll).toContainEqual(expect.objectContaining({
        number: `FT-${withdrawal!.id.slice(0, 8)}`,
        amount,
      }));

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
      reportId = undefined;
      expect((await superAdmin.request.post("/api/lanflow/time-tracking/admin", {
        data: {
          action: "DELETE_TRANSACTION",
          payload: { transaction_id: withdrawal!.id },
        },
      })).ok()).toBeTruthy();
      withdrawalId = undefined;
    } finally {
      if (reportId) {
        await deleteReport(superAdmin, reportId);
      }
      if (withdrawalId) {
        await db.from("financial_transactions").delete().eq("id", withdrawalId);
      }
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
      await expect(page.getByRole("heading", { name: "2. รับ–จ่ายรวม" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "5. โอนเงิน (ธนาคารเท่านั้น)" })).toBeVisible();
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
