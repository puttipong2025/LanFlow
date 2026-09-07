import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

async function authContext(browser: Browser, role: "admin" | "super_admin") {
  return browser.newContext({ storageState: `playwright/.auth/${role}.json` });
}

async function profile(context: BrowserContext) {
  const response = await context.request.get("/api/auth/me");
  expect(response.ok()).toBeTruthy();
  return (await response.json() as {
    profile: { id: string; name: string; phone: string; locationIds: string[] };
  }).profile;
}

test("reports and deletion audits use stable manager-scoped pages", async ({ browser }) => {
  const manager = await authContext(browser, "super_admin");
  const admin = await authContext(browser, "admin");
  const managerProfile = await profile(manager);
  const adminProfile = await profile(admin);
  const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const locationId = crypto.randomUUID();
  const reportIds = Array.from({ length: 51 }, () => crypto.randomUUID());
  const auditIds = Array.from({ length: 51 }, () => crypto.randomUUID());
  const sessionIds = Array.from({ length: 51 }, () => crypto.randomUUID());
  const cashCountIds = Array.from({ length: 51 }, () => crypto.randomUUID());
  const base = Date.now() - 100_000;

  try {
    expect((await db.from("locations").insert({
      id: locationId,
      name: "สาขาทดสอบ bounded reports",
      code: `BP${locationId.slice(0, 6)}`,
      is_active: true,
    })).error).toBeNull();
    expect((await db.from("report_batches").insert(reportIds.map((id, index) => ({
      id,
      report_no: `RPT-PAGE-${String(index + 1).padStart(3, "0")}`,
      report_date: "2026-08-19",
      sequence_no: index + 1,
      location_id: locationId,
      cutoff_at: new Date(base + index * 1_000).toISOString(),
      created_by_user_id: managerProfile.id,
      created_by_name: managerProfile.name,
      created_by_phone: managerProfile.phone,
      created_at: new Date(base + index * 1_000).toISOString(),
    })))).error).toBeNull();
    expect((await db.from("document_deletion_audits").insert(auditIds.map((id, index) => ({
      id,
      document_kind: "report_batch",
      source_id: crypto.randomUUID(),
      document_no: `RPT-DELETED-PAGE-${String(index + 1).padStart(3, "0")}`,
      location_id: locationId,
      deleted_by_user_id: managerProfile.id,
      deleted_by_name: managerProfile.name,
      deleted_at: new Date(base + index * 1_000).toISOString(),
    })))).error).toBeNull();
    expect((await db.from("cash_count_sessions").insert(sessionIds.map((id, index) => {
      const cutoff = new Date(base + index * 1_000).toISOString();
      return {
        id,
        location_id: locationId,
        cutoff_at: cutoff,
        expires_at: new Date(Date.parse(cutoff) + 30 * 60 * 1_000).toISOString(),
        status: "submitted",
        started_by_user_id: managerProfile.id,
        started_by_name: managerProfile.name,
        started_by_phone: managerProfile.phone,
        ended_at: new Date(Date.parse(cutoff) + 1_000).toISOString(),
      };
    }))).error).toBeNull();
    const zeroCounts = { "1000": 0, "500": 0, "100": 0, "50": 0, "20": 0, "10": 0, "5": 0, "2": 0, "1": 0 };
    expect((await db.from("cash_counts").insert(cashCountIds.map((id, index) => ({
      id,
      session_id: sessionIds[index],
      report_id: reportIds[index],
      location_id: locationId,
      cutoff_at: new Date(base + index * 1_000).toISOString(),
      actual_counts: zeroCounts,
      actual_total: 0,
      expected_counts: zeroCounts,
      expected_total: 0,
      difference_counts: zeroCounts,
      difference_total: 0,
      formula_version: "cash-v1-baseline",
      created_by_user_id: managerProfile.id,
      created_by_name: managerProfile.name,
      created_by_phone: managerProfile.phone,
      created_at: new Date(base + index * 1_000).toISOString(),
    })))).error).toBeNull();

    const firstResponse = await manager.request.get(`/api/lanflow/reports?locationId=${locationId}`);
    expect(firstResponse.ok(), await firstResponse.text()).toBeTruthy();
    const first = await firstResponse.json() as {
      reports: Array<{ id: string; isLatestActive: boolean }>;
      hasMore: boolean;
      nextCursor: string | null;
    };
    expect(first.reports).toHaveLength(50);
    expect(first.reports.filter((row) => row.isLatestActive)).toHaveLength(1);
    expect(first.hasMore).toBe(true);

    const secondResponse = await manager.request.get(
      `/api/lanflow/reports?locationId=${locationId}&cursor=${encodeURIComponent(first.nextCursor!)}`,
    );
    expect(secondResponse.ok(), await secondResponse.text()).toBeTruthy();
    const second = await secondResponse.json() as {
      reports: Array<{ id: string; isLatestActive: boolean }>;
      hasMore: boolean;
    };
    expect(second.reports).toHaveLength(1);
    expect(second.reports[0].isLatestActive).toBe(false);
    expect(second.hasMore).toBe(false);
    expect(new Set([...first.reports, ...second.reports].map((row) => row.id)).size).toBe(51);

    const cashFirstResponse = await manager.request.get(`/api/lanflow/cash-counts?locationId=${locationId}`);
    expect(cashFirstResponse.ok(), await cashFirstResponse.text()).toBeTruthy();
    const cashFirst = await cashFirstResponse.json() as {
      counts: Array<{ id: string }>;
      hasMore: boolean;
      nextCursor: string | null;
    };
    expect(cashFirst.counts).toHaveLength(50);
    expect(cashFirst.hasMore).toBe(true);
    const cashSecondResponse = await manager.request.get(
      `/api/lanflow/cash-counts?locationId=${locationId}&cursor=${encodeURIComponent(cashFirst.nextCursor!)}`,
    );
    expect(cashSecondResponse.ok(), await cashSecondResponse.text()).toBeTruthy();
    const cashSecond = await cashSecondResponse.json() as {
      counts: Array<{ id: string }>;
      hasMore: boolean;
    };
    expect(cashSecond.counts).toHaveLength(1);
    expect(cashSecond.hasMore).toBe(false);
    expect(new Set([...cashFirst.counts, ...cashSecond.counts].map((row) => row.id)).size).toBe(51);

    expect((await admin.request.get(
      `/api/lanflow/reports?locationId=${adminProfile.locationIds[0]}&view=deletions`,
    )).status()).toBe(403);
    for (const path of [
      `/api/lanflow/rubber-exports?locationId=${adminProfile.locationIds[0]}&view=deletions`,
      `/api/lanflow/cash-counts?locationId=${adminProfile.locationIds[0]}&view=deletions`,
    ]) {
      expect((await admin.request.get(path)).status()).toBe(403);
      expect((await manager.request.get(path)).ok()).toBe(true);
    }

    const auditFirstResponse = await manager.request.get(
      `/api/lanflow/reports?locationId=${locationId}&view=deletions`,
    );
    expect(auditFirstResponse.ok(), await auditFirstResponse.text()).toBeTruthy();
    const auditFirst = await auditFirstResponse.json() as {
      deletions: Array<{ id: string }>;
      hasMore: boolean;
      nextCursor: string | null;
    };
    expect(auditFirst.deletions).toHaveLength(50);
    expect(auditFirst.hasMore).toBe(true);
    const auditSecondResponse = await manager.request.get(
      `/api/lanflow/reports?locationId=${locationId}&view=deletions&cursor=${encodeURIComponent(auditFirst.nextCursor!)}`,
    );
    expect(auditSecondResponse.ok(), await auditSecondResponse.text()).toBeTruthy();
    const auditSecond = await auditSecondResponse.json() as { deletions: Array<{ id: string }>; hasMore: boolean };
    expect(auditSecond.deletions).toHaveLength(1);
    expect(auditSecond.hasMore).toBe(false);
    expect(new Set([...auditFirst.deletions, ...auditSecond.deletions].map((row) => row.id)).size).toBe(51);
  } finally {
    await db.from("cash_counts").delete().in("id", cashCountIds);
    await db.from("cash_count_sessions").delete().in("id", sessionIds);
    await db.from("document_deletion_audits").delete().in("id", auditIds);
    await db.from("report_batches").delete().in("id", reportIds);
    await db.from("locations").delete().eq("id", locationId);
    await Promise.all([manager.close(), admin.close()]);
  }
});

test("report detail preserves more than 1,000 parent items and source rows", async ({ browser }) => {
  test.setTimeout(60_000);
  const manager = await authContext(browser, "super_admin");
  const managerProfile = await profile(manager);
  const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const locationId = crypto.randomUUID();
  const reportId = crypto.randomUUID();
  const segmentIds = Array.from({ length: 1_001 }, () => crypto.randomUUID());
  const incomeIds = Array.from({ length: 1_500 }, () => crypto.randomUUID());
  const productId = crypto.randomUUID();
  const saleItemId = crypto.randomUUID();
  const productName = `Report cap product ${productId}`;
  const createdAt = new Date().toISOString();

  try {
    expect((await db.from("locations").insert({
      id: locationId,
      name: `สาขาทดสอบรายงานเกินพัน ${locationId.slice(0, 6)}`,
      code: `RC${locationId.replaceAll("-", "").slice(0, 6).toUpperCase()}`,
      is_active: true,
    })).error).toBeNull();
    expect((await db.from("report_batches").insert({
      id: reportId,
      report_no: `RPT-CAP-${locationId.slice(0, 8)}`,
      report_date: "2026-09-06",
      sequence_no: 1,
      location_id: locationId,
      cutoff_at: createdAt,
      created_by_user_id: managerProfile.id,
      created_by_name: managerProfile.name,
      created_by_phone: managerProfile.phone,
      created_at: createdAt,
    })).error).toBeNull();

    for (let from = 0; from < segmentIds.length; from += 250) {
      const ids = segmentIds.slice(from, from + 250);
      expect((await db.from("time_segments").insert(ids.map((id, index) => ({
        id,
        profile_id: managerProfile.id,
        start_time: new Date(Date.parse(createdAt) - (from + index + 2) * 7_200_000).toISOString(),
        end_time: new Date(Date.parse(createdAt) - (from + index + 2) * 7_200_000 + 3_600_000).toISOString(),
      })))).error).toBeNull();
      expect((await db.from("report_items").insert(ids.map((id) => ({
        report_id: reportId,
        location_id: locationId,
        entity_type: "time_segment",
        entity_id: id,
        eligibility_at: createdAt,
      })))).error).toBeNull();
    }

    expect((await db.from("stock_products").insert({ id: productId, name: productName, unit: "ชิ้น" })).error).toBeNull();
    expect((await db.from("income_sale_items").insert({
      id: saleItemId, name: productName, stock_product_id: productId,
    })).error).toBeNull();
    for (let from = 0; from < incomeIds.length; from += 250) {
      const ids = incomeIds.slice(from, from + 250);
      expect((await db.from("income_expense").insert(ids.map((id) => ({
        id, client_temp_id: id, idempotency_key: `report-cap:${id}`,
        local_bill_no: id, server_bill_no: id, number: id,
        sync_status: "synced", record_status: "active", location_id: locationId,
        type: "income", tx_date: "2026-09-06", title: "Report cap fixture",
        cost: id === incomeIds[0] ? 1_001 : 1, bill_option: id === incomeIds[0] ? "บิลขาย" : "รายรับ",
        server_received_at: createdAt, created_by_user_id: managerProfile.id,
        created_by_name: managerProfile.name, created_by_phone: managerProfile.phone,
      })))).error).toBeNull();
      expect((await db.from("report_items").insert(ids.map((id) => ({
        report_id: reportId, location_id: locationId, entity_type: "income_expense",
        entity_id: id, eligibility_at: createdAt,
      })))).error).toBeNull();
    }
    for (let from = 0; from < 1_001; from += 250) {
      expect((await db.from("income_expense_sale_lines").insert(
        Array.from({ length: Math.min(250, 1_001 - from) }, (_, index) => ({
          income_expense_id: incomeIds[0], income_sale_item_id: saleItemId,
          stock_product_id: productId, title: productName, quantity: 1, unit_price: 1,
          line_total: 1, sequence_no: from + index + 1, created_at: createdAt,
        })),
      )).error).toBeNull();
    }

    const response = await manager.request.get(`/api/lanflow/reports/${reportId}`);
    expect(response.ok(), await response.text()).toBeTruthy();
    const body = await response.json() as {
      report: { itemCount: number };
      timePayroll: Array<{ number: string }>;
      incomeExpense: Array<{ amount: number }>;
      stock: Array<{ quantity: number; amount: number }>;
      stockBalances: Array<{ product: string; quantity: number }>;
    };
    expect(body.report.itemCount).toBe(2_501);
    expect(body.timePayroll).toHaveLength(1_001);
    expect(new Set(body.timePayroll.map((row) => row.number)).size).toBe(1_001);
    expect(body.incomeExpense).toHaveLength(1_500);
    expect(body.incomeExpense.reduce((total, row) => total + row.amount, 0)).toBe(2_500);
    expect(body.stock).toHaveLength(1_001);
    expect(body.stock.reduce((total, row) => total + row.quantity, 0)).toBe(-1_001);
    expect(body.stockBalances).toEqual([{ product: productName, quantity: -1_001 }]);
  } finally {
    await db.from("report_items").delete().eq("report_id", reportId);
    await db.from("report_batches").delete().eq("id", reportId);
    for (let from = 0; from < segmentIds.length; from += 250) {
      await db.from("time_segments").delete().in("id", segmentIds.slice(from, from + 250));
    }
    for (let from = 0; from < incomeIds.length; from += 250) {
      await db.from("income_expense").delete().in("id", incomeIds.slice(from, from + 250));
    }
    await db.from("income_sale_items").delete().eq("id", saleItemId);
    await db.from("stock_products").delete().eq("id", productId);
    await db.from("locations").delete().eq("id", locationId);
    await manager.close();
  }
});
