import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
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
  test("system manager gets super-admin verification actions for another admin's draft without reloading the app", async ({ browser }) => {
    const managerContext = await authContext(browser, "admin");
    const creatorContext = await authContext(browser, "user");
    const db = service();
    const locationId = crypto.randomUUID();
    const exportId = crypto.randomUUID();

    const [manager, creator] = await Promise.all([
      profile(managerContext),
      profile(creatorContext),
    ]);
    const [{ data: managerAccess }, { data: creatorRole }] = await Promise.all([
      db.from("profiles")
        .select("can_access_super_admin_features")
        .eq("id", manager.id)
        .single(),
      db.from("profiles")
        .select("role")
        .eq("id", creator.id)
        .single(),
    ]);

    try {
      expect((await db.from("profiles")
        .update({ can_access_super_admin_features: false })
        .eq("id", manager.id)).error).toBeNull();
      expect((await db.from("profiles")
        .update({ role: "admin" })
        .eq("id", creator.id)).error).toBeNull();
      expect((await db.from("locations").insert({
        id: locationId,
        name: `สาขา System Manager ${locationId.slice(0, 6)}`,
        code: `SM${locationId.slice(0, 6)}`,
        is_active: true,
      })).error).toBeNull();
      expect((await db.from("user_locations").insert({
        user_id: manager.id,
        location_id: locationId,
      })).error).toBeNull();
      expect((await db.from("rubber_exports").insert({
        id: exportId,
        export_no: `REX-MANAGER-${exportId.slice(0, 8)}`,
        export_date: "2026-08-09",
        sequence_no: 990,
        location_id: locationId,
        status: "draft",
        original_weight_total: 100,
        paid_total: 1000,
        average_price: 10,
        other_operating_cost: 0,
        created_by_user_id: creator.id,
        created_by_name: creator.name,
        created_by_phone: creator.phone,
      })).error).toBeNull();

      const page = await managerContext.newPage();
      await page.goto("/");
      await selectAppLocation(page, locationId);

      // The app-level profile is now deliberately stale. The module request must
      // use the server's current authorization verdict for its action controls.
      expect((await db.from("profiles")
        .update({ can_access_super_admin_features: true })
        .eq("id", manager.id)).error).toBeNull();

      await page.getByRole("button", { name: /^ส่งออกยาง/ }).click();
      await expect(page.getByRole("button", { name: "เปิดตรวจสอบ" })).toBeVisible();
      await expect(page.getByRole("button", { name: "รอผู้รับรอง" })).toHaveCount(0);

      await page.getByRole("button", {
        name: `ดูรายละเอียด REX-MANAGER-${exportId.slice(0, 8)}`,
      }).click();
      await page.getByLabel("น้ำหนักปัจจุบัน").fill("90");
      await page.getByLabel("ค่าทำงาน/กก.").fill("2");
      await expect(page.getByRole("button", { name: "ตรวจสอบแล้ว", exact: true })).toBeEnabled();
      await page.getByRole("button", { name: "ตรวจสอบแล้ว", exact: true }).click();
      await page.getByRole("button", { name: "ลงรายจ่ายสาขานี้" }).click();
      await expect(page.getByText("ตรวจสอบรายการแล้ว")).toBeVisible();
      await expect(page.getByText(/ตรวจสอบแล้ว$/).first()).toBeVisible();
    } finally {
      await db.from("rubber_exports").delete().eq("id", exportId);
      await db.from("user_locations").delete().eq("location_id", locationId);
      await db.from("locations").delete().eq("id", locationId);
      await db.from("profiles")
        .update({
          can_access_super_admin_features:
            managerAccess?.can_access_super_admin_features === true,
        })
        .eq("id", manager.id);
      await db.from("profiles")
        .update({ role: creatorRole?.role ?? "user" })
        .eq("id", creator.id);
      await managerContext.close();
      await creatorContext.close();
    }
  });

  test("draft filter badge is branch-scoped and disappears after refresh", async ({ browser }) => {
    const context = await authContext(browser, "super_admin");
    const adminContext = await authContext(browser, "admin");
    const db = service();
    const locationIds = [crypto.randomUUID(), crypto.randomUUID()];
    const exportIds = Array.from({ length: 6 }, () => crypto.randomUUID());

    try {
      const [me, adminMe] = await Promise.all([profile(context), profile(adminContext)]);
      expect((await db.from("locations").insert(locationIds.map((id, index) => ({
        id,
        name: `สาขา Draft Badge ${index + 1} ${id.slice(0, 6)}`,
        code: `DB${id.slice(0, 6)}`,
        is_active: true,
      })))).error).toBeNull();
      expect((await db.from("user_locations").insert(
        [
          ...locationIds.map((locationId) => ({ user_id: me.id, location_id: locationId })),
          { user_id: adminMe.id, location_id: locationIds[0] },
        ],
      )).error).toBeNull();
      expect((await db.from("rubber_exports").insert(exportIds.map((id, index) => ({
        ...(index < 3 ? {
        id,
        export_no: `REX-BADGE-${id.slice(0, 8)}`,
        export_date: "2026-07-29",
        sequence_no: index + 900,
        location_id: index === 0 ? locationIds[0] : locationIds[1],
        status: "draft",
        original_weight_total: 100,
        paid_total: 1000,
        average_price: 10,
        other_operating_cost: 0,
        created_by_user_id: me.id,
        created_by_name: me.name,
        created_by_phone: me.phone,
        created_at: index === 0
          ? "2026-08-03T01:00:00.000Z"
          : `2026-08-0${index + 1}T01:00:00.000Z`,
        } : index === 3 ? {
          id,
          export_no: `REX-BADGE-${id.slice(0, 8)}`,
          export_date: "2026-07-29",
          sequence_no: index + 900,
          location_id: locationIds[0],
          status: "draft",
          original_weight_total: 100,
          paid_total: 1000,
          average_price: 10,
          other_operating_cost: 0,
          created_by_user_id: me.id,
          created_by_name: me.name,
          created_by_phone: me.phone,
          created_at: "2026-08-01T01:00:00.000Z",
        } : index === 4 ? {
          id,
          export_no: `REX-BADGE-${id.slice(0, 8)}`,
          export_date: "2026-07-29",
          sequence_no: index + 900,
          location_id: locationIds[0],
          status: "verified",
          original_weight_total: 100,
          paid_total: 1000,
          average_price: 10,
          other_operating_cost: 0,
          current_weight: 90,
          weight_loss_percent: 10,
          work_rate: 1,
          work_total: 100,
          expense_destination: "external",
          created_by_user_id: me.id,
          created_by_name: me.name,
          created_by_phone: me.phone,
          created_at: "2026-08-02T01:00:00.000Z",
          verified_by_user_id: me.id,
          verified_by_name: me.name,
          verified_by_phone: me.phone,
          verified_at: "2026-08-02T02:00:00.000Z",
          age_cutoff_at: "2026-08-02T02:00:00.000Z",
          average_age_hours: 0,
          oldest_age_hours: 0,
          estimated_age_item_count: 0,
        } : {
          id,
          export_no: `REX-BADGE-${id.slice(0, 8)}`,
          export_date: "2026-07-29",
          sequence_no: index + 900,
          location_id: locationIds[0],
          status: "deleted",
          previous_status: "draft",
          original_weight_total: 100,
          paid_total: 1000,
          average_price: 10,
          other_operating_cost: 0,
          created_by_user_id: me.id,
          created_by_name: me.name,
          created_by_phone: me.phone,
          created_at: "2026-08-04T01:00:00.000Z",
          deleted_by_user_id: me.id,
          deleted_by_name: me.name,
          deleted_by_phone: me.phone,
          deleted_at: "2026-08-04T02:00:00.000Z",
        }),
      })))).error).toBeNull();

      const page = await context.newPage();
      await page.goto("/");
      await selectAppLocation(page, locationIds[0]);
      await page.getByRole("button", { name: /^ส่งออกยาง/ }).click();
      await expect(page.getByRole("button", {
        name: "ฉบับร่าง 2 รายการ",
      })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("button", { name: "ใช้งาน 3 รายการ" })).toBeVisible();
      await expect(page.getByRole("button", { name: "ตรวจสอบแล้ว 1 รายการ" })).toBeVisible();
      await expect(page.getByRole("button", { name: "ลบแล้ว 1 รายการ" })).toBeVisible();
      await expect(page.getByRole("button", { name: "ทั้งหมด 4 รายการ" })).toBeVisible();
      const activeRows = page.locator("table").first().locator("tbody > tr");
      await expect(activeRows).toHaveCount(3);
      await expect(activeRows.nth(0)).toContainText(`REX-BADGE-${exportIds[3].slice(0, 8)}`);
      await expect(activeRows.nth(1)).toContainText(`REX-BADGE-${exportIds[0].slice(0, 8)}`);
      await expect(activeRows.nth(2)).toContainText(`REX-BADGE-${exportIds[4].slice(0, 8)}`);
      await page.getByRole("button", { name: "เปิดตรวจสอบ" }).first().click();
      const auditSection = page.getByRole("heading", { name: "ประวัติรายการ" }).locator("..");
      await expect(auditSection).toBeVisible();
      await expect(auditSection.getByText(me.name, { exact: false })).toBeVisible();
      await page.getByRole("button", { name: "ปิด", exact: true }).click();

      const adminPage = await adminContext.newPage();
      await adminPage.goto("/");
      await selectAppLocation(adminPage, locationIds[0]);
      await adminPage.getByRole("button", { name: /^ส่งออกยาง/ }).click();
      await expect(adminPage.getByRole("button", { name: "รอผู้รับรอง" }).first()).toBeDisabled();
      await adminPage.getByRole("button", { name: `ดูรายละเอียด REX-BADGE-${exportIds[0].slice(0, 8)}` }).click();
      await expect(adminPage.getByText("รอ super_admin หรือผู้มีสิทธิ์จัดการระบบตรวจสอบรายการ")).toBeVisible();
      await adminPage.getByRole("button", { name: "ปิด", exact: true }).click();
      await adminPage.getByRole("button", { name: "ไปหน้ารายงาน" }).click();
      await expect(adminPage.getByRole("heading", { name: /^ชุดรายงาน/ })).toBeVisible();

      await selectAppLocation(page, locationIds[1]);
      const secondBranchDraftButton = page.getByRole("button", {
        name: "ฉบับร่าง 2 รายการ",
      });
      await expect(secondBranchDraftButton).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      const draftButtonBox = await secondBranchDraftButton.boundingBox();
      expect(draftButtonBox).not.toBeNull();
      expect(draftButtonBox!.x).toBeGreaterThanOrEqual(0);
      expect(draftButtonBox!.x + draftButtonBox!.width).toBeLessThanOrEqual(390);
      await page.setViewportSize({ width: 1280, height: 720 });

      await selectAppLocation(page, locationIds[0]);
      expect((await db.from("rubber_exports").delete().eq("id", exportIds[0])).error).toBeNull();
      await page.getByRole("button", { name: "รีเฟรช" }).click();
      await expect(page.getByRole("button", {
        name: "ฉบับร่าง 1 รายการ",
      })).toBeVisible();
    } finally {
      await db.from("rubber_exports").delete().in("id", exportIds);
      await db.from("user_locations").delete().in("location_id", locationIds);
      await db.from("locations").delete().in("id", locationIds);
      await context.close();
      await adminContext.close();
    }
  });

  test("explicit selection, reservation, derived expense, report locks, delete, and detail snapshots stay source-owned", async ({ browser }) => {
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
      expect((await db.from("rubber_bill_items").insert(
        billIds.map((billId, index) => ({
          bill_id: billId,
          item_type: "weigh",
          description: "ชั่ง 1",
          weight_in: (index + 1) * 100,
          weight_out: (index + 1) * 10,
          net_weight: (index + 1) * 90,
          price: 10,
          total: (index + 1) * 900,
          sequence_no: 1,
        }))
      )).error).toBeNull();

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
        availableBills: Array<{ reportItemId: string; billNo: string; eligibilityAt: string }>;
      };
      expect(list.availableBills).toHaveLength(6);
      const sortedBills = [...list.availableBills].sort((a, b) =>
        a.eligibilityAt.localeCompare(b.eligibilityAt)
      );
      const selectedReportItemIds = sortedBills.slice(0, 3).map((bill) => bill.reportItemId);

      const previewResponse = await admin.request.post("/api/lanflow/rubber-exports/preview", {
        data: { locationId, selectedReportItemIds },
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
          data: { locationId, selectedReportItemIds },
        }),
        admin.request.post("/api/lanflow/rubber-exports", {
          data: { locationId, selectedReportItemIds },
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
        data: {
          currentWeight: 500,
          workRate: 2,
          otherOperatingCost: 100,
          expenseDestination: "branch",
        },
      })).status()).toBe(403);
      expect((await superAdmin.request.post(`/api/lanflow/rubber-exports/${created.id}/verify`, {
        data: {
          currentWeight: 541,
          workRate: 2,
          otherOperatingCost: 100,
          expenseDestination: "branch",
        },
      })).status()).toBe(409);
      const afterRejectedVerify = await admin.request.get(`/api/lanflow/rubber-exports/${created.id}`);
      expect(await afterRejectedVerify.json()).toMatchObject({
        status: "draft",
        currentWeight: 500,
        workTotal: 1180,
      });
      const verified = await superAdmin.request.post(`/api/lanflow/rubber-exports/${created.id}/verify`, {
        data: {
          currentWeight: 500,
          workRate: 2,
          otherOperatingCost: 100,
          expenseDestination: "branch",
        },
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
        availableBills: Array<{ reportItemId: string; eligibilityAt: string }>;
      };
      expect(remaining.availableBills).toHaveLength(3);
      const remainingBills = [...remaining.availableBills].sort((a, b) =>
        a.eligibilityAt.localeCompare(b.eligibilityAt)
      );

      const externalResponse = await admin.request.post("/api/lanflow/rubber-exports", {
        data: { locationId, selectedReportItemIds: [remainingBills[0].reportItemId] },
      });
      expect(externalResponse.status(), await externalResponse.text()).toBe(201);
      const externalExport = await externalResponse.json() as { id: string };
      exportIds.push(externalExport.id);
      expect((await superAdmin.request.post(
        `/api/lanflow/rubber-exports/${externalExport.id}/verify`,
        { data: { currentWeight: 350, workRate: 1, otherOperatingCost: 10, expenseDestination: "external" } }
      )).ok()).toBeTruthy();

      const zeroOptionsResponse = await admin.request.get(
        `/api/lanflow/rubber-exports?locationId=${locationId}`
      );
      const zeroOptions = await zeroOptionsResponse.json() as {
        availableBills: Array<{ reportItemId: string; eligibilityAt: string }>;
      };
      const zeroBill = [...zeroOptions.availableBills].sort((a, b) =>
        a.eligibilityAt.localeCompare(b.eligibilityAt)
      )[0];
      const zeroResponse = await admin.request.post("/api/lanflow/rubber-exports", {
        data: { locationId, selectedReportItemIds: [zeroBill.reportItemId] },
      });
      expect(zeroResponse.status(), await zeroResponse.text()).toBe(201);
      const zeroExport = await zeroResponse.json() as { id: string };
      exportIds.push(zeroExport.id);
      const concurrentVerification = await Promise.all([
        superAdmin.request.post(`/api/lanflow/rubber-exports/${zeroExport.id}/verify`, {
          data: { currentWeight: 400, workRate: 0, otherOperatingCost: 0, expenseDestination: "branch" },
        }),
        superAdmin.request.post(`/api/lanflow/rubber-exports/${zeroExport.id}/verify`, {
          data: { currentWeight: 390, workRate: 0, otherOperatingCost: 0, expenseDestination: "branch" },
        }),
      ]);
      expect(concurrentVerification.map((response) => response.status()).sort()).toEqual([200, 409]);
      const zeroDetailsResponse = await admin.request.get(`/api/lanflow/rubber-exports/${zeroExport.id}`);
      const zeroDetails = await zeroDetailsResponse.json() as {
        status: string;
        currentWeight: number;
        workRate: number;
        workTotal: number;
      };
      expect(zeroDetails.status).toBe("verified");
      expect([390, 400]).toContain(zeroDetails.currentWeight);
      expect(zeroDetails.workRate).toBe(0);
      expect(zeroDetails.workTotal).toBe(0);

      const draftOptionsResponse = await admin.request.get(
        `/api/lanflow/rubber-exports?locationId=${locationId}`
      );
      const draftOptions = await draftOptionsResponse.json() as {
        availableBills: Array<{ reportItemId: string }>;
      };
      expect(draftOptions.availableBills).toHaveLength(1);
      const draftResponse = await admin.request.post("/api/lanflow/rubber-exports", {
        data: {
          locationId,
          selectedReportItemIds: [draftOptions.availableBills[0].reportItemId],
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
        cost: 1180,
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
        amount: 1180,
      }));
      const { data: expenseReportBalance, error: expenseReportBalanceError } = await db
        .from("report_batches")
        .select("previous_report_id, opening_balance, closing_balance")
        .eq("id", expenseReport.id)
        .single();
      expect(expenseReportBalanceError).toBeNull();
      expect(expenseReportBalance?.previous_report_id).toBe(sourceReport.id);
      expect(
        Number(expenseReportBalance?.closing_balance)
          - Number(expenseReportBalance?.opening_balance)
      ).toBe(-1180);

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

      const deletedVerifiedResponse = await superAdmin.request.get(
        `/api/lanflow/rubber-exports/${created.id}`,
      );
      expect(deletedVerifiedResponse.ok(), await deletedVerifiedResponse.text()).toBeTruthy();
      const deletedVerifiedDetails = await deletedVerifiedResponse.json();
      expect(deletedVerifiedDetails).toMatchObject({
        exportNo: created.exportNo,
        status: "deleted",
        previousStatus: "verified",
        currentWeight: 500,
        workTotal: 1180,
      });
      expect(deletedVerifiedDetails).not.toHaveProperty("createdByPhone");
      expect(deletedVerifiedDetails).not.toHaveProperty("verifiedByPhone");
      expect(deletedVerifiedDetails).not.toHaveProperty("deletedByPhone");

      const deletedDraftResponse = await superAdmin.request.get(
        `/api/lanflow/rubber-exports/${deletedDraft.id}`,
      );
      expect(deletedDraftResponse.ok(), await deletedDraftResponse.text()).toBeTruthy();
      expect(await deletedDraftResponse.json()).toMatchObject({
        exportNo: deletedDraft.exportNo,
        status: "deleted",
        previousStatus: "draft",
        currentWeight: null,
        workRate: null,
        workTotal: null,
      });
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
