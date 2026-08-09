import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { selectAppLocation } from "./helpers/select-app-location";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

async function authContext(browser: Browser, role: "user" | "admin" | "super_admin") {
  return browser.newContext({ storageState: `playwright/.auth/${role}.json` });
}

async function profile(context: BrowserContext) {
  const response = await context.request.get("/api/auth/me");
  expect(response.ok()).toBeTruthy();
  return (await response.json() as {
    profile: { id: string; name: string; phone: string };
  }).profile;
}

function service() {
  expect(serviceRoleKey).toBeTruthy();
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function insertBill({
  db,
  locationId,
  actor,
  billId,
  billNo,
  receivedAt,
  weight = 100,
  deductWeight = 10,
  paidAmount = 900,
  expectValid = true,
}: {
  db: SupabaseClient;
  locationId: string;
  actor: { id: string; name: string; phone: string };
  billId: string;
  billNo: string;
  receivedAt: string;
  weight?: number;
  deductWeight?: number;
  paidAmount?: number;
  expectValid?: boolean;
}) {
  const netRubberValue = Math.round((weight - deductWeight) * 10 * 100) / 100;
  const deductionTotal = Math.max(netRubberValue - paidAmount, 0);
  const { error } = await db.from("rubber_bills").insert({
    id: billId,
    client_temp_id: billId,
    local_bill_no: billNo,
    server_bill_no: billNo,
    idempotency_key: `rubber-export-depth:${billId}`,
    sync_status: "synced",
    record_status: "active",
    location_id: locationId,
    bill_no: billNo,
    bill_date: "2026-07-24",
    customer_name: `ลูกค้า ${billNo}`,
    bill_type: "weighing",
    deduct_weight: deductWeight,
    weight,
    rubber_value: weight * 10,
    average_price: 10,
    deduction_total: deductionTotal,
    net_total: paidAmount,
    server_received_at: receivedAt,
    created_by_user_id: actor.id,
    created_by_name: actor.name,
    created_by_phone: actor.phone,
  });
  if (!expectValid) {
    expect(error?.code).toBe("23514");
    return;
  }
  expect(error).toBeNull();
  expect((await db.from("rubber_bill_items").insert({
    bill_id: billId,
    item_type: "weigh",
    description: "ชั่ง 1",
    weight_in: weight,
    weight_out: 0,
    net_weight: weight,
    price: 10,
    total: weight * 10,
    sequence_no: 1,
  })).error).toBeNull();
}

async function createReport(context: BrowserContext, locationId: string) {
  const response = await context.request.post("/api/lanflow/reports", {
    data: { locationId },
  });
  expect(response.status(), await response.text()).toBe(201);
  return response.json() as Promise<{ id: string }>;
}

test.describe.serial("Rubber export verification depth @rubber-export", () => {
  test("covers explicit cross-report selection, branch scope, invalid sources, and concurrent numbering", async ({ browser }) => {
    test.setTimeout(120_000);
    const user = await authContext(browser, "user");
    const admin = await authContext(browser, "admin");
    const superAdmin = await authContext(browser, "super_admin");
    const db = service();
    const locationA = crypto.randomUUID();
    const locationB = crypto.randomUUID();
    const billIds: string[] = [];
    const reportIdsA: string[] = [];
    const reportIdsB: string[] = [];
    const exportIds: string[] = [];
    let branchBExportId: string | null = null;

    try {
      const [adminProfile, superProfile, userProfile] = await Promise.all([
        profile(admin),
        profile(superAdmin),
        profile(user),
      ]);
      expect((await db.from("locations").insert([
        {
          id: locationA,
          name: `สาขา depth A ${locationA.slice(0, 6)}`,
          code: `DA${locationA.slice(0, 6)}`,
          is_active: true,
        },
        {
          id: locationB,
          name: `สาขา depth B ${locationB.slice(0, 6)}`,
          code: `DB${locationB.slice(0, 6)}`,
          is_active: true,
        },
      ])).error).toBeNull();
      expect((await db.from("user_locations").insert([
        { user_id: adminProfile.id, location_id: locationA },
        { user_id: userProfile.id, location_id: locationA },
      ])).error).toBeNull();

      const firstBill = crypto.randomUUID();
      const firstTieBill = crypto.randomUUID();
      billIds.push(firstBill, firstTieBill);
      await insertBill({
        db,
        locationId: locationA,
        actor: superProfile,
        billId: firstBill,
        billNo: `DEPTH-A1-${firstBill.slice(0, 6)}`,
        receivedAt: "2026-07-23T01:00:00.000Z",
      });
      await insertBill({
        db,
        locationId: locationA,
        actor: superProfile,
        billId: firstTieBill,
        billNo: `DEPTH-A2-${firstTieBill.slice(0, 6)}`,
        receivedAt: "2026-07-23T02:00:00.000Z",
      });
      const firstReport = await createReport(admin, locationA);
      reportIdsA.push(firstReport.id);

      const secondTieBill = crypto.randomUUID();
      const laterBill = crypto.randomUUID();
      billIds.push(secondTieBill, laterBill);
      await insertBill({
        db,
        locationId: locationA,
        actor: superProfile,
        billId: secondTieBill,
        billNo: `DEPTH-A3-${secondTieBill.slice(0, 6)}`,
        receivedAt: "2026-07-23T02:00:00.000Z",
      });
      await insertBill({
        db,
        locationId: locationA,
        actor: superProfile,
        billId: laterBill,
        billNo: `DEPTH-A4-${laterBill.slice(0, 6)}`,
        receivedAt: "2026-07-23T03:00:00.000Z",
      });
      const secondReport = await createReport(admin, locationA);
      reportIdsA.push(secondReport.id);

      const branchBBill = crypto.randomUUID();
      billIds.push(branchBBill);
      await insertBill({
        db,
        locationId: locationB,
        actor: superProfile,
        billId: branchBBill,
        billNo: `DEPTH-B1-${branchBBill.slice(0, 6)}`,
        receivedAt: "2026-07-23T01:30:00.000Z",
      });
      const branchBReport = await createReport(superAdmin, locationB);
      reportIdsB.push(branchBReport.id);

      expect((await admin.request.get(
        `/api/lanflow/rubber-exports?locationId=${locationB}`,
      )).status()).toBe(403);
      expect((await user.request.get(
        `/api/lanflow/rubber-exports?locationId=${locationA}`,
      )).status()).toBe(403);

      const branchBOptionsResponse = await superAdmin.request.get(
        `/api/lanflow/rubber-exports?locationId=${locationB}`,
      );
      expect(branchBOptionsResponse.ok(), await branchBOptionsResponse.text()).toBeTruthy();
      const branchBOptions = (await branchBOptionsResponse.json() as {
        availableBills: Array<{ reportItemId: string }>;
      }).availableBills;
      expect(branchBOptions).toHaveLength(1);
      const [deleteBranchBReport, createBranchBExport] = await Promise.all([
        superAdmin.request.delete(`/api/lanflow/reports/${branchBReport.id}`),
        superAdmin.request.post("/api/lanflow/rubber-exports", {
          data: {
            locationId: locationB,
            selectedReportItemIds: [branchBOptions[0].reportItemId],
          },
        }),
      ]);
      expect([
        [200, 409],
        [409, 201],
      ]).toContainEqual([
        deleteBranchBReport.status(),
        createBranchBExport.status(),
      ]);
      if (createBranchBExport.status() === 201) {
        branchBExportId = (await createBranchBExport.json() as { id: string }).id;
        const { count: branchBItemCount, error: branchBItemCountError } = await db
          .from("rubber_export_items")
          .select("id", { count: "exact", head: true })
          .eq("export_id", branchBExportId);
        expect(branchBItemCountError).toBeNull();
        expect(branchBItemCount).toBe(1);
        const { data: activeBranchBReport, error: activeBranchBReportError } = await db
          .from("report_batches")
          .select("status")
          .eq("id", branchBReport.id)
          .single();
        expect(activeBranchBReportError).toBeNull();
        expect(activeBranchBReport?.status).toBe("active");
      } else {
        const { data: deletedBranchBReport, error: deletedBranchBReportError } = await db
          .from("report_batches")
          .select("status")
          .eq("id", branchBReport.id)
          .single();
        expect(deletedBranchBReportError).toBeNull();
        expect(deletedBranchBReport?.status).toBe("deleted");
      }

      const optionsResponse = await admin.request.get(
        `/api/lanflow/rubber-exports?locationId=${locationA}`,
      );
      expect(optionsResponse.ok(), await optionsResponse.text()).toBeTruthy();
      const options = (await optionsResponse.json() as {
        availableBills: Array<{
          reportItemId: string;
          billId: string;
          billNo: string;
          eligibilityAt: string;
        }>;
      }).availableBills;
      expect(options).toHaveLength(4);
      expect((await admin.request.post("/api/lanflow/rubber-exports", {
        data: { locationId: locationA, selectedReportItemIds: [] },
      })).status()).toBe(400);
      expect((await admin.request.post("/api/lanflow/rubber-exports", {
        data: {
          locationId: locationA,
          selectedReportItemIds: [options[0].reportItemId, options[0].reportItemId],
        },
      })).status()).toBe(400);
      expect((await admin.request.post("/api/lanflow/rubber-exports/preview", {
        data: { locationId: locationA, selectedReportItemIds: ["not-a-uuid"] },
      })).status()).toBe(400);
      expect((await admin.request.post("/api/lanflow/rubber-exports", {
        data: { locationId: locationA, selectedReportItemIds: [crypto.randomUUID()] },
      })).status()).toBe(409);
      const selectedBills = options.filter((option) =>
        [firstBill, firstTieBill, secondTieBill].includes(option.billId)
      );
      expect(selectedBills).toHaveLength(3);
      const selectedReportItemIds = selectedBills.map((option) => option.reportItemId);

      const uiPage = await admin.newPage();
      await uiPage.route("**/api/lanflow/rubber-exports/preview", async (route) => {
        const body = route.request().postDataJSON() as { selectedReportItemIds?: string[] };
        if (body.selectedReportItemIds?.length === 1) {
          await new Promise((resolve) => setTimeout(resolve, 750));
        }
        await route.continue();
      });
      await uiPage.goto("/");
      await selectAppLocation(uiPage, locationA);
      await uiPage.getByRole("button", { name: "ส่งออกยาง", exact: true }).click();
      await uiPage.getByRole("button", { name: "สร้างรายการ", exact: true }).click();
      const billCheckboxes = uiPage.getByRole("checkbox");
      await expect(billCheckboxes).toHaveCount(4);
      await expect(uiPage.getByRole("checkbox", { checked: true })).toHaveCount(0);
      await uiPage.getByRole("button", { name: "เลือกทั้งหมด", exact: true }).click();
      await expect(uiPage.getByRole("checkbox", { checked: true })).toHaveCount(4);
      await uiPage.getByRole("button", { name: "ล้างที่เลือก", exact: true }).click();
      await expect(uiPage.getByRole("checkbox", { checked: true })).toHaveCount(0);
      for (const bill of selectedBills) {
        await uiPage.getByRole("checkbox", { name: `เลือกบิล ${bill.billNo}` }).check();
      }
      const itemCountCard = uiPage.getByText("จำนวนบิล", { exact: true }).locator("..");
      await expect(itemCountCard).toContainText("3");
      await uiPage.waitForTimeout(1_000);
      await expect(itemCountCard).toContainText("3");
      await uiPage.getByRole("button", { name: "ปิด" }).click();

      const previewResponse = await admin.request.post("/api/lanflow/rubber-exports/preview", {
        data: { locationId: locationA, selectedReportItemIds },
      });
      expect(previewResponse.ok(), await previewResponse.text()).toBeTruthy();
      const preview = await previewResponse.json() as {
        itemCount: number;
        items: Array<{ billId: string; eligibilityAt: string }>;
      };
      expect(preview.itemCount).toBe(3);
      expect(preview.items.map((item) => item.billId)).toEqual([
        firstBill,
        ...[firstTieBill, secondTieBill].sort(),
      ]);

      const firstExportResponse = await admin.request.post("/api/lanflow/rubber-exports", {
        data: { locationId: locationA, selectedReportItemIds },
      });
      expect(firstExportResponse.status(), await firstExportResponse.text()).toBe(201);
      const firstExport = await firstExportResponse.json() as { id: string; exportNo: string };
      exportIds.push(firstExport.id);

      const { data: selectedItems, error: selectedItemsError } = await db
        .from("rubber_export_items")
        .select("source_report_item_id")
        .eq("export_id", firstExport.id);
      expect(selectedItemsError).toBeNull();
      const { data: selectedReportItems, error: selectedReportItemsError } = await db
        .from("report_items")
        .select("report_id")
        .in("id", (selectedItems ?? []).map((item) => item.source_report_item_id));
      expect(selectedReportItemsError).toBeNull();
      expect(new Set((selectedReportItems ?? []).map((item) => item.report_id))).toEqual(
        new Set([firstReport.id, secondReport.id]),
      );

      const remainingResponse = await admin.request.get(
        `/api/lanflow/rubber-exports?locationId=${locationA}`,
      );
      const remaining = (await remainingResponse.json() as {
        availableBills: Array<{ reportItemId: string; billId: string }>;
      }).availableBills;
      expect(remaining.map((option) => option.billId)).toEqual([laterBill]);

      const concurrent = await Promise.all([
        admin.request.post("/api/lanflow/rubber-exports", {
          data: { locationId: locationA, selectedReportItemIds: [remaining[0].reportItemId] },
        }),
        admin.request.post("/api/lanflow/rubber-exports", {
          data: { locationId: locationA, selectedReportItemIds: [remaining[0].reportItemId] },
        }),
      ]);
      expect(concurrent.map((response) => response.status()).sort()).toEqual([201, 409]);
      const secondExport = await concurrent.find(
        (response) => response.status() === 201,
      )!.json() as { id: string; exportNo: string };
      exportIds.push(secondExport.id);
      expect(secondExport.exportNo).not.toBe(firstExport.exportNo);
      expect(Number(secondExport.exportNo.slice(-3))).toBe(
        Number(firstExport.exportNo.slice(-3)) + 1,
      );
      const { data: numberedExports, error: numberedExportsError } = await db
        .from("rubber_exports")
        .select("export_no")
        .in("id", exportIds);
      expect(numberedExportsError).toBeNull();
      expect(new Set((numberedExports ?? []).map((item) => item.export_no)).size).toBe(2);

      const invalidBill = crypto.randomUUID();
      const validAfterInvalidBill = crypto.randomUUID();
      billIds.push(invalidBill, validAfterInvalidBill);
      await insertBill({
        db,
        locationId: locationA,
        actor: superProfile,
        billId: invalidBill,
        billNo: `DEPTH-BAD-${invalidBill.slice(0, 6)}`,
        receivedAt: "2026-07-23T04:00:00.000Z",
        weight: 10,
        deductWeight: 10,
        expectValid: false,
      });
      await insertBill({
        db,
        locationId: locationA,
        actor: superProfile,
        billId: validAfterInvalidBill,
        billNo: `DEPTH-A5-${validAfterInvalidBill.slice(0, 6)}`,
        receivedAt: "2026-07-23T05:00:00.000Z",
      });
      const invalidReport = await createReport(admin, locationA);
      reportIdsA.push(invalidReport.id);
      const invalidOptionsResponse = await admin.request.get(
        `/api/lanflow/rubber-exports?locationId=${locationA}`,
      );
      const invalidOptions = (await invalidOptionsResponse.json() as {
        availableBills: Array<{ reportItemId: string; billId: string }>;
      }).availableBills;
      const validOption = invalidOptions.find(
        (option) => option.billId === validAfterInvalidBill,
      );
      expect(validOption).toBeTruthy();
      expect(invalidOptions.some((option) => option.billId === invalidBill)).toBe(false);
    } finally {
      for (const exportId of exportIds.reverse()) {
        await superAdmin.request.delete(`/api/lanflow/rubber-exports/${exportId}`);
      }
      if (branchBExportId) {
        await superAdmin.request.delete(`/api/lanflow/rubber-exports/${branchBExportId}`);
      }
      for (const reportId of reportIdsA.reverse()) {
        await superAdmin.request.delete(`/api/lanflow/reports/${reportId}`);
      }
      for (const reportId of reportIdsB.reverse()) {
        await superAdmin.request.delete(`/api/lanflow/reports/${reportId}`);
      }
      await db.from("rubber_export_items").delete().in("location_id", [locationA, locationB]);
      await db.from("rubber_exports").delete().in("location_id", [locationA, locationB]);
      await db.from("report_items").delete().in("location_id", [locationA, locationB]);
      await db.from("report_batches").delete().in("location_id", [locationA, locationB]);
      await db.from("rubber_bills").delete().in("id", billIds);
      await db.from("user_locations").delete().in("location_id", [locationA, locationB]);
      await db.from("locations").delete().in("id", [locationA, locationB]);
      await Promise.all([user.close(), admin.close(), superAdmin.close()]);
    }
  });

  test("keeps rubber-export feed rows complete across filters, pagination, and source navigation", async ({ browser }) => {
    test.setTimeout(120_000);
    const admin = await authContext(browser, "admin");
    const superAdmin = await authContext(browser, "super_admin");
    const db = service();
    const locationId = crypto.randomUUID();
    const billIds: string[] = [];
    const reportIds: string[] = [];
    const exports: Array<{ id: string; exportNo: string; cost: number }> = [];

    try {
      const [adminProfile, superProfile] = await Promise.all([
        profile(admin),
        profile(superAdmin),
      ]);
      expect((await db.from("locations").insert({
        id: locationId,
        name: `สาขา feed depth ${locationId.slice(0, 6)}`,
        code: `DF${locationId.slice(0, 6)}`,
        is_active: true,
      })).error).toBeNull();
      expect((await db.from("user_locations").insert([
        { user_id: adminProfile.id, location_id: locationId },
        { user_id: superProfile.id, location_id: locationId },
      ])).error).toBeNull();

      for (let index = 1; index <= 3; index += 1) {
        const billId = crypto.randomUUID();
        billIds.push(billId);
        await insertBill({
          db,
          locationId,
          actor: superProfile,
          billId,
          billNo: `FEED-${index}-${billId.slice(0, 6)}`,
          receivedAt: `2026-07-23T1${index}:00:00.000Z`,
        });
        const report = await createReport(admin, locationId);
        reportIds.push(report.id);

        const optionsResponse = await admin.request.get(
          `/api/lanflow/rubber-exports?locationId=${locationId}`,
        );
        expect(optionsResponse.ok(), await optionsResponse.text()).toBeTruthy();
        const options = (await optionsResponse.json() as {
          availableBills: Array<{ reportItemId: string; billId: string }>;
        }).availableBills;
        const selectedBill = options.find((option) => option.billId === billId);
        expect(selectedBill).toBeTruthy();

        const createResponse = await admin.request.post("/api/lanflow/rubber-exports", {
          data: { locationId, selectedReportItemIds: [selectedBill!.reportItemId] },
        });
        expect(createResponse.status(), await createResponse.text()).toBe(201);
        const created = await createResponse.json() as { id: string; exportNo: string };
        const cost = 90 * index + 5;
        exports.push({ ...created, cost });

        const verifyResponse = await superAdmin.request.post(
          `/api/lanflow/rubber-exports/${created.id}/verify`,
          { data: { currentWeight: 80, workRate: index, otherOperatingCost: 5, expenseDestination: "branch" } },
        );
        expect(verifyResponse.ok(), await verifyResponse.text()).toBeTruthy();
      }

      const { data: verifiedRows, error: verifiedRowsError } = await db
        .from("rubber_exports")
        .select("id, verified_at")
        .in("id", exports.map((item) => item.id));
      expect(verifiedRowsError).toBeNull();
      const verifiedAt = verifiedRows?.[0]?.verified_at;
      expect(verifiedAt).toBeTruthy();
      const feedDate = new Date(new Date(verifiedAt).getTime() + 7 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

      const feedRows: Array<{
        id: string;
        txDate: string;
        title: string;
        cost: number;
        relationSourceType?: string;
        relationSourceId?: string;
      }> = [];
      let cursor: string | null = null;
      do {
        const search = new URLSearchParams({
          locationId,
          from: feedDate,
          to: feedDate,
          pageSize: "1",
        });
        if (cursor) search.set("cursor", cursor);
        const response = await admin.request.get(
          `/api/lanflow/income-expense/feed?${search}`,
        );
        expect(response.ok(), await response.text()).toBeTruthy();
        const page = await response.json() as {
          rows: typeof feedRows;
          nextCursor: string | null;
        };
        expect(page.rows).toHaveLength(1);
        feedRows.push(...page.rows);
        cursor = page.nextCursor;
      } while (cursor);

      expect(new Set(feedRows.map((row) => row.id)).size).toBe(feedRows.length);
      const rubberExportRows = feedRows.filter(
        (row) => row.relationSourceType === "rubber_export",
      );
      expect(rubberExportRows).toHaveLength(3);
      for (const item of exports) {
        expect(rubberExportRows).toContainEqual(expect.objectContaining({
          relationSourceId: item.id,
          txDate: feedDate,
          title: `ค่าทำงานส่งออกยาง — ${item.exportNo}`,
          cost: item.cost,
        }));
      }

      const previousDate = new Date(`${feedDate}T00:00:00.000Z`);
      previousDate.setUTCDate(previousDate.getUTCDate() - 1);
      const filteredResponse = await admin.request.get(
        `/api/lanflow/income-expense/feed?locationId=${locationId}`
        + `&from=${previousDate.toISOString().slice(0, 10)}`
        + `&to=${previousDate.toISOString().slice(0, 10)}`,
      );
      expect(filteredResponse.ok(), await filteredResponse.text()).toBeTruthy();
      const filteredRows = (await filteredResponse.json() as {
        rows: Array<{ relationSourceType?: string }>;
      }).rows;
      expect(filteredRows.some((row) => row.relationSourceType === "rubber_export")).toBeFalsy();

      const { data: duplicateExpenses, error: duplicateExpensesError } = await db
        .from("income_expense")
        .select("number")
        .in("number", exports.map((item) => item.exportNo));
      expect(duplicateExpensesError).toBeNull();
      expect(duplicateExpenses).toEqual([]);

      const page = await admin.newPage();
      await page.goto("/");
      await selectAppLocation(page, locationId);
      await page.getByRole("button", { name: "รับ-จ่าย", exact: true }).click();
      const sourceRow = page.locator("tbody tr").filter({ hasText: exports[0].exportNo });
      await expect(sourceRow).toBeVisible();
      await sourceRow.getByRole("button", { name: "ดูรายการส่งออกยาง" }).click();
      const detailHeading = page.locator("h2").filter({
        hasText: exports[0].exportNo,
      });
      await expect(detailHeading).toBeVisible({ timeout: 15_000 });
      await expect(
        detailHeading.locator("..").locator("p").filter({ hasText: "ตรวจสอบแล้ว" }),
      ).toBeVisible();
    } finally {
      for (let index = exports.length - 1; index >= 0; index -= 1) {
        await superAdmin.request.delete(`/api/lanflow/rubber-exports/${exports[index].id}`);
        if (reportIds[index]) {
          await superAdmin.request.delete(`/api/lanflow/reports/${reportIds[index]}`);
        }
      }
      await db.from("rubber_export_items").delete().eq("location_id", locationId);
      await db.from("rubber_exports").delete().eq("location_id", locationId);
      await db.from("report_items").delete().eq("location_id", locationId);
      await db.from("report_batches").delete().eq("location_id", locationId);
      await db.from("rubber_bills").delete().in("id", billIds);
      await db.from("user_locations").delete().eq("location_id", locationId);
      await db.from("locations").delete().eq("id", locationId);
      await Promise.all([admin.close(), superAdmin.close()]);
    }
  });

  test("keeps immutable detail snapshots after verification and deletion", async ({ browser }) => {
    test.setTimeout(120_000);
    const admin = await authContext(browser, "admin");
    const superAdmin = await authContext(browser, "super_admin");
    const db = service();
    const locationId = crypto.randomUUID();
    const billIds = Array.from({ length: 60 }, () => crypto.randomUUID());
    const originalFirstBillNo = `PRINT-ORIGINAL-${billIds[0].slice(0, 6)}`;
    const originalFirstCustomer = "ลูกค้าต้นฉบับสำหรับพิมพ์";
    const mutatedBillNo = `PRINT-MUTATED-${billIds[0].slice(0, 6)}`;
    const mutatedCustomer = "ลูกค้าที่แก้ภายหลัง";
    let sourceReportId: string | null = null;
    let exportId: string | null = null;

    try {
      const [adminProfile, superProfile] = await Promise.all([
        profile(admin),
        profile(superAdmin),
      ]);
      expect((await db.from("locations").insert({
        id: locationId,
        name: `สาขา print depth ${locationId.slice(0, 6)}`,
        code: `DP${locationId.slice(0, 6)}`,
        is_active: true,
      })).error).toBeNull();
      expect((await db.from("user_locations").insert([
        { user_id: adminProfile.id, location_id: locationId },
        { user_id: superProfile.id, location_id: locationId },
      ])).error).toBeNull();

      const bills = billIds.map((id, index) => {
        const billNo = index === 0
          ? originalFirstBillNo
          : `PRINT-${String(index + 1).padStart(2, "0")}-${id.slice(0, 6)}`;
        return {
          id,
          client_temp_id: id,
          local_bill_no: billNo,
          server_bill_no: billNo,
          idempotency_key: `rubber-export-print-depth:${id}`,
          sync_status: "synced",
          record_status: "active",
          location_id: locationId,
          bill_no: billNo,
          bill_date: "2026-07-24",
          customer_name: index === 0 ? originalFirstCustomer : `ลูกค้าพิมพ์ ${index + 1}`,
          bill_type: "weighing",
          deduct_weight: 10,
          weight: 100,
          rubber_value: 1000,
          average_price: 10,
          net_total: 900,
          server_received_at: `2026-07-22T00:${String(index).padStart(2, "0")}:00.000Z`,
          created_by_user_id: superProfile.id,
          created_by_name: superProfile.name,
          created_by_phone: superProfile.phone,
        };
      });
      expect((await db.from("rubber_bills").insert(bills)).error).toBeNull();
      expect((await db.from("rubber_bill_items").insert(
        billIds.map((billId) => ({
          bill_id: billId,
          item_type: "weigh",
          description: "ชั่ง 1",
          weight_in: 100,
          weight_out: 0,
          net_weight: 100,
          price: 10,
          total: 1000,
          sequence_no: 1,
        }))
      )).error).toBeNull();

      const sourceReport = await createReport(admin, locationId);
      sourceReportId = sourceReport.id;
      const optionsResponse = await admin.request.get(
        `/api/lanflow/rubber-exports?locationId=${locationId}`,
      );
      expect(optionsResponse.ok(), await optionsResponse.text()).toBeTruthy();
      const options = (await optionsResponse.json() as {
        availableBills: Array<{ reportItemId: string }>;
      }).availableBills;
      expect(options).toHaveLength(60);

      const createResponse = await admin.request.post("/api/lanflow/rubber-exports", {
        data: {
          locationId,
          selectedReportItemIds: options.map((option) => option.reportItemId),
        },
      });
      expect(createResponse.status(), await createResponse.text()).toBe(201);
      const created = await createResponse.json() as { id: string; exportNo: string };
      exportId = created.id;

      const verifyResponse = await superAdmin.request.post(
        `/api/lanflow/rubber-exports/${created.id}/verify`,
        { data: { currentWeight: 5000, workRate: 1, otherOperatingCost: 5, expenseDestination: "external" } },
      );
      expect(verifyResponse.ok(), await verifyResponse.text()).toBeTruthy();

      const deleteResponse = await superAdmin.request.delete(
        `/api/lanflow/rubber-exports/${created.id}`,
      );
      expect(deleteResponse.ok(), await deleteResponse.text()).toBeTruthy();
      const deleteReportResponse = await superAdmin.request.delete(
        `/api/lanflow/reports/${sourceReport.id}`,
      );
      expect(deleteReportResponse.ok(), await deleteReportResponse.text()).toBeTruthy();
      sourceReportId = null;

      const { error: mutateError } = await db
        .from("rubber_bills")
        .update({
          bill_no: mutatedBillNo,
          server_bill_no: mutatedBillNo,
          customer_name: mutatedCustomer,
          weight: 150,
          deduct_weight: 5,
          rubber_value: 1500,
          average_price: 10,
          net_total: 1450,
        })
        .eq("id", billIds[0]);
      expect(mutateError).toBeNull();

      const detailsResponse = await superAdmin.request.get(
        `/api/lanflow/rubber-exports/${created.id}`,
      );
      expect(detailsResponse.ok(), await detailsResponse.text()).toBeTruthy();
      const details = await detailsResponse.json() as {
        status: string;
        previousStatus: string;
        items: Array<{ billNo: string; customerName: string; netWeight: number }>;
      };
      expect(details).toMatchObject({
        status: "deleted",
        previousStatus: "verified",
      });
      expect(details.items).toContainEqual(expect.objectContaining({
        billNo: originalFirstBillNo,
        customerName: originalFirstCustomer,
        netWeight: 90,
      }));
      expect(details.items.some((item) => item.billNo === mutatedBillNo)).toBeFalsy();
    } finally {
      if (exportId) {
        await superAdmin.request.delete(`/api/lanflow/rubber-exports/${exportId}`);
      }
      if (sourceReportId) {
        await superAdmin.request.delete(`/api/lanflow/reports/${sourceReportId}`);
      }
      await db.from("rubber_export_items").delete().eq("location_id", locationId);
      await db.from("rubber_exports").delete().eq("location_id", locationId);
      await db.from("report_items").delete().eq("location_id", locationId);
      await db.from("report_batches").delete().eq("location_id", locationId);
      await db.from("rubber_bills").delete().in("id", billIds);
      await db.from("user_locations").delete().eq("location_id", locationId);
      await db.from("locations").delete().eq("id", locationId);
      await Promise.all([admin.close(), superAdmin.close()]);
    }
  });
});
