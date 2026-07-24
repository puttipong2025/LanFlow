import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

async function authContext(browser: Browser, role: "user" | "admin" | "super_admin") {
  return browser.newContext({ storageState: `playwright/.auth/${role}.json` });
}

async function profile(context: BrowserContext) {
  const response = await context.request.get("/api/auth/me");
  expect(response.ok()).toBeTruthy();
  return (await response.json() as {
    profile: { id: string; name: string; phone: string; locationIds: string[] };
  }).profile;
}

function service() {
  expect(serviceRoleKey).toBeTruthy();
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

test.describe.serial("Rubber export contract @rubber-export", () => {
  test("cutoff, reservation, derived expense, report locks, delete, and print stay source-owned", async ({ browser }) => {
    test.setTimeout(90_000);
    const user = await authContext(browser, "user");
    const admin = await authContext(browser, "admin");
    const superAdmin = await authContext(browser, "super_admin");
    const db = service();
    const locationId = crypto.randomUUID();
    const billIds: string[] = [];
    let sourceReportId: string | null = null;
    let expenseReportId: string | null = null;
    const exportIds: string[] = [];

    try {
      const [adminProfile, superProfile, userProfile] = await Promise.all([
        profile(admin),
        profile(superAdmin),
        profile(user),
      ]);
      expect((await db.from("locations").insert({
        id: locationId,
        name: `สาขาทดสอบส่งออก ${locationId.slice(0, 8)}`,
        code: `RX${locationId.slice(0, 6)}`,
        is_active: true,
      })).error).toBeNull();
      expect((await db.from("user_locations").insert([
        { user_id: adminProfile.id, location_id: locationId },
        { user_id: superProfile.id, location_id: locationId },
        { user_id: userProfile.id, location_id: locationId },
      ])).error).toBeNull();

      for (let index = 1; index <= 6; index += 1) {
        const id = crypto.randomUUID();
        billIds.push(id);
        const billNo = `RX-${index}-${id.slice(0, 6)}`;
        const { error } = await db.from("rubber_bills").insert({
          id,
          client_temp_id: id,
          local_bill_no: billNo,
          server_bill_no: billNo,
          idempotency_key: `rubber-export-test:${id}`,
          sync_status: "synced",
          record_status: "active",
          location_id: locationId,
          bill_no: billNo,
          bill_date: "2026-07-24",
          customer_name: `ลูกค้าส่งออก ${index}`,
          customer_type: "สาขานี้จ่าย",
          bill_type: "weighing",
          deduct_weight: index * 10,
          weight: index * 100,
          rubber_value: index * 1000,
          average_price: 10,
          net_total: index * 900,
          server_received_at: index === 3
            ? "2026-07-23T12:00:00.000Z"
            : `2026-07-23T1${index}:00:00.000Z`,
          created_by_user_id: superProfile.id,
          created_by_name: superProfile.name,
          created_by_phone: superProfile.phone,
        });
        expect(error).toBeNull();
      }

      const sourceReportResponse = await admin.request.post("/api/lanflow/reports", {
        data: { locationId },
      });
      expect(sourceReportResponse.status(), await sourceReportResponse.text()).toBe(201);
      const sourceReport = await sourceReportResponse.json() as { id: string; reportNo: string };
      sourceReportId = sourceReport.id;

      expect((await user.request.get(`/api/lanflow/rubber-exports?locationId=${locationId}`)).status()).toBe(403);
      const listResponse = await admin.request.get(`/api/lanflow/rubber-exports?locationId=${locationId}`);
      expect(listResponse.ok(), await listResponse.text()).toBeTruthy();
      const list = await listResponse.json() as {
        cutoffOptions: Array<{ reportItemId: string; billNo: string; eligibilityAt: string }>;
      };
      expect(list.cutoffOptions).toHaveLength(6);
      const sortedCutoffs = [...list.cutoffOptions].sort((a, b) =>
        a.eligibilityAt.localeCompare(b.eligibilityAt)
      );
      const cutoff = sortedCutoffs[2];

      const previewResponse = await admin.request.post("/api/lanflow/rubber-exports/preview", {
        data: { locationId, cutoffReportItemId: cutoff.reportItemId },
      });
      expect(previewResponse.ok(), await previewResponse.text()).toBeTruthy();
      const preview = await previewResponse.json() as {
        itemCount: number;
        originalWeightTotal: number;
        paidTotal: number;
        averagePrice: number;
      };
      expect(preview).toMatchObject({
        itemCount: 3,
        originalWeightTotal: 540,
        paidTotal: 5400,
        averagePrice: 10,
      });

      const concurrent = await Promise.all([
        admin.request.post("/api/lanflow/rubber-exports", {
          data: { locationId, cutoffReportItemId: cutoff.reportItemId },
        }),
        admin.request.post("/api/lanflow/rubber-exports", {
          data: { locationId, cutoffReportItemId: cutoff.reportItemId },
        }),
      ]);
      expect(concurrent.map((response) => response.status()).sort()).toEqual([201, 409]);
      const created = await concurrent.find((response) => response.status() === 201)!.json() as {
        id: string;
        exportNo: string;
      };
      exportIds.push(created.id);
      expect(created.exportNo).toMatch(/^REX-\d{8}-\d{3}$/);

      const lockedSourceReport = await superAdmin.request.delete(`/api/lanflow/reports/${sourceReport.id}`);
      expect(lockedSourceReport.status()).toBe(409);
      expect((await lockedSourceReport.json() as { error: string }).error).toContain(created.exportNo);

      expect((await admin.request.patch(`/api/lanflow/rubber-exports/${created.id}`, {
        data: { currentWeight: 500, workRate: 2, otherOperatingCost: 100 },
      })).ok()).toBeTruthy();
      expect((await admin.request.post(`/api/lanflow/rubber-exports/${created.id}/verify`, {
        data: { expenseDestination: "branch" },
      })).status()).toBe(403);
      expect((await admin.request.patch(`/api/lanflow/rubber-exports/${created.id}`, {
        data: { currentWeight: 541, workRate: 2, otherOperatingCost: 100 },
      })).status()).toBe(409);
      const verified = await superAdmin.request.post(`/api/lanflow/rubber-exports/${created.id}/verify`, {
        data: { expenseDestination: "branch" },
      });
      expect(verified.ok(), await verified.text()).toBeTruthy();
      expect((await admin.request.patch(`/api/lanflow/rubber-exports/${created.id}`, {
        data: { currentWeight: 490, workRate: 2, otherOperatingCost: 100 },
      })).status()).toBe(409);
      expect((await admin.request.delete(
        `/api/lanflow/rubber-exports/${created.id}`
      )).status()).toBe(403);

      const remainingResponse = await admin.request.get(
        `/api/lanflow/rubber-exports?locationId=${locationId}`
      );
      const remaining = await remainingResponse.json() as {
        cutoffOptions: Array<{ reportItemId: string; eligibilityAt: string }>;
      };
      expect(remaining.cutoffOptions).toHaveLength(3);
      const remainingCutoffs = [...remaining.cutoffOptions].sort((a, b) =>
        a.eligibilityAt.localeCompare(b.eligibilityAt)
      );

      const externalResponse = await admin.request.post("/api/lanflow/rubber-exports", {
        data: { locationId, cutoffReportItemId: remainingCutoffs[0].reportItemId },
      });
      expect(externalResponse.status(), await externalResponse.text()).toBe(201);
      const externalExport = await externalResponse.json() as { id: string };
      exportIds.push(externalExport.id);
      expect((await admin.request.patch(`/api/lanflow/rubber-exports/${externalExport.id}`, {
        data: { currentWeight: 350, workRate: 1, otherOperatingCost: 10 },
      })).ok()).toBeTruthy();
      expect((await superAdmin.request.post(
        `/api/lanflow/rubber-exports/${externalExport.id}/verify`,
        { data: { expenseDestination: "external" } }
      )).ok()).toBeTruthy();

      const zeroOptionsResponse = await admin.request.get(
        `/api/lanflow/rubber-exports?locationId=${locationId}`
      );
      const zeroOptions = await zeroOptionsResponse.json() as {
        cutoffOptions: Array<{ reportItemId: string; eligibilityAt: string }>;
      };
      const zeroCutoff = [...zeroOptions.cutoffOptions].sort((a, b) =>
        a.eligibilityAt.localeCompare(b.eligibilityAt)
      )[0];
      const zeroResponse = await admin.request.post("/api/lanflow/rubber-exports", {
        data: { locationId, cutoffReportItemId: zeroCutoff.reportItemId },
      });
      expect(zeroResponse.status(), await zeroResponse.text()).toBe(201);
      const zeroExport = await zeroResponse.json() as { id: string };
      exportIds.push(zeroExport.id);
      expect((await admin.request.patch(`/api/lanflow/rubber-exports/${zeroExport.id}`, {
        data: { currentWeight: 400, workRate: 0, otherOperatingCost: 0 },
      })).ok()).toBeTruthy();
      expect((await superAdmin.request.post(
        `/api/lanflow/rubber-exports/${zeroExport.id}/verify`,
        { data: { expenseDestination: "branch" } }
      )).ok()).toBeTruthy();

      const draftOptionsResponse = await admin.request.get(
        `/api/lanflow/rubber-exports?locationId=${locationId}`
      );
      const draftOptions = await draftOptionsResponse.json() as {
        cutoffOptions: Array<{ reportItemId: string }>;
      };
      expect(draftOptions.cutoffOptions).toHaveLength(1);
      const draftResponse = await admin.request.post("/api/lanflow/rubber-exports", {
        data: {
          locationId,
          cutoffReportItemId: draftOptions.cutoffOptions[0].reportItemId,
        },
      });
      expect(draftResponse.status(), await draftResponse.text()).toBe(201);
      const deletedDraft = await draftResponse.json() as { id: string; exportNo: string };
      exportIds.push(deletedDraft.id);
      expect((await superAdmin.request.delete(
        `/api/lanflow/rubber-exports/${deletedDraft.id}`
      )).ok()).toBeTruthy();

      const feedResponse = await admin.request.get(
        `/api/lanflow/income-expense/feed?locationId=${locationId}&from=2026-07-24&to=2100-01-01`
      );
      expect(feedResponse.ok(), await feedResponse.text()).toBeTruthy();
      const feed = await feedResponse.json() as {
        rows: Array<{ relationSourceType?: string; relationSourceId?: string; cost: number; title: string }>;
      };
      expect(feed.rows).toContainEqual(expect.objectContaining({
        relationSourceType: "rubber_export",
        relationSourceId: created.id,
        cost: 1100,
        title: `ค่าทำงานส่งออกยาง — ${created.exportNo}`,
      }));
      expect(feed.rows.some((row) => row.relationSourceId === externalExport.id)).toBeFalsy();
      expect(feed.rows.some((row) => row.relationSourceId === zeroExport.id)).toBeFalsy();
      expect((await db.from("income_expense").select("id").eq("number", created.exportNo)).data).toEqual([]);

      const expenseReportResponse = await admin.request.post("/api/lanflow/reports", {
        data: { locationId },
      });
      expect(expenseReportResponse.status(), await expenseReportResponse.text()).toBe(201);
      const expenseReport = await expenseReportResponse.json() as { id: string; reportNo: string };
      expenseReportId = expenseReport.id;
      const reportDetailsResponse = await admin.request.get(`/api/lanflow/reports/${expenseReport.id}`);
      const reportDetails = await reportDetailsResponse.json() as {
        incomeExpense: Array<{ number: string; amount: number }>;
      };
      expect(reportDetails.incomeExpense).toContainEqual(expect.objectContaining({
        number: created.exportNo,
        amount: 1100,
      }));

      const lockedExportDelete = await superAdmin.request.delete(`/api/lanflow/rubber-exports/${created.id}`);
      expect(lockedExportDelete.status()).toBe(409);
      expect((await lockedExportDelete.json() as { error: string }).error).toContain(expenseReport.reportNo);

      expect((await superAdmin.request.delete(`/api/lanflow/reports/${expenseReport.id}`)).ok()).toBeTruthy();
      expenseReportId = null;
      expect((await superAdmin.request.delete(`/api/lanflow/rubber-exports/${created.id}`)).ok()).toBeTruthy();
      expect((await superAdmin.request.delete(`/api/lanflow/rubber-exports/${externalExport.id}`)).ok()).toBeTruthy();
      expect((await superAdmin.request.delete(`/api/lanflow/rubber-exports/${zeroExport.id}`)).ok()).toBeTruthy();

      const afterDeleteFeed = await admin.request.get(
        `/api/lanflow/income-expense/feed?locationId=${locationId}&from=2026-07-24&to=2100-01-01`
      );
      const afterDeleteRows = (await afterDeleteFeed.json() as {
        rows: Array<{ relationSourceId?: string }>;
      }).rows;
      expect(afterDeleteRows.some((row) => row.relationSourceId === created.id)).toBeFalsy();
      expect((await superAdmin.request.delete(`/api/lanflow/reports/${sourceReport.id}`)).ok()).toBeTruthy();
      sourceReportId = null;

      const page = await superAdmin.newPage();
      await page.addInitScript(() => { window.print = () => undefined; });
      await page.goto(`/rubber-exports/${created.id}/print`);
      await expect(page.getByText(created.exportNo)).toBeVisible();
      await expect(page.getByText("ลบแล้ว", { exact: true })).toBeVisible();
      await expect(page.getByText("540.00 กก.")).toBeVisible();
      await expect(page.getByText("฿1,100.00")).toBeVisible();

      const draftPage = await superAdmin.newPage();
      await draftPage.addInitScript(() => { window.print = () => undefined; });
      await draftPage.goto(`/rubber-exports/${deletedDraft.id}/print`);
      await expect(draftPage.getByText(deletedDraft.exportNo)).toBeVisible();
      await expect(draftPage.getByText("ลบจากสถานะ: ฉบับร่าง")).toBeVisible();
      await expect(draftPage.getByText("— กก.")).toBeVisible();
    } finally {
      if (expenseReportId) await superAdmin.request.delete(`/api/lanflow/reports/${expenseReportId}`);
      for (const id of exportIds) {
        await superAdmin.request.delete(`/api/lanflow/rubber-exports/${id}`);
      }
      if (sourceReportId) await superAdmin.request.delete(`/api/lanflow/reports/${sourceReportId}`);
      await db.from("rubber_export_items").delete().eq("location_id", locationId);
      await db.from("rubber_exports").delete().eq("location_id", locationId);
      await db.from("report_items").delete().eq("location_id", locationId);
      await db.from("report_batches").delete().eq("location_id", locationId);
      await db.from("rubber_bills").delete().in("id", billIds);
      await db.from("user_locations").delete().eq("location_id", locationId);
      await db.from("locations").delete().eq("id", locationId);
      await Promise.all([user.close(), admin.close(), superAdmin.close()]);
    }
  });
});
