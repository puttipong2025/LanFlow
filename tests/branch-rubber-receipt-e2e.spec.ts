import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { selectAppLocation } from "./helpers/select-app-location";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

test.describe("Branch rubber receipt flow @branch-rubber-receipt", () => {
  test.use({ storageState: "playwright/.auth/super_admin.json" });

  test("labels a current-branch candidate as remaining rubber", async ({ page }) => {
    const meResponse = await page.request.get("/api/auth/me");
    expect(meResponse.ok()).toBeTruthy();
    const me = (await meResponse.json() as {
      profile: { locationIds: string[] };
    }).profile;
    const locationId = me.locationIds[0];
    const exportId = crypto.randomUUID();

    await page.route("**/api/lanflow/rubber-bills/branch-receipts?destinationLocationId=*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          candidates: [{
            sourceRubberExportId: exportId,
            sourceExportNo: "REX-SAME-001",
            sourceLocationId: locationId,
            sourceLocationName: "สาขาปัจจุบัน",
            verifiedAt: "2026-08-11T01:00:00.000Z",
            currentWeight: 80,
            rubberValue: 2_400,
            sourceAverageAgeHours: 12,
            receivedAgeHours: 12,
            ageIsEstimated: false,
            isSameLocation: true,
          }],
        }),
      });
    });

    await page.goto("/");
    await selectAppLocation(page, locationId);
    await page.getByRole("button", { name: /^บิลยาง/ }).click();
    await page.getByRole("button", { name: "รับยางจากสาขา" }).click();
    const dialog = page.getByRole("dialog", { name: "รับยางจากสาขา" });
    await expect(dialog.getByText("ยางคงเหลือภายในสาขา")).toBeVisible();
    await expect(dialog.getByText("REX-SAME-001")).toBeVisible();
  });

  test("receives one verified export as a read-only zero-pay rubber bill and hides the source", async ({ page }) => {
    expect(serviceRoleKey).toBeTruthy();
    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const meResponse = await page.request.get("/api/auth/me");
    expect(meResponse.ok()).toBeTruthy();
    const profile = (await meResponse.json() as {
      profile: { id: string; name: string; phone: string };
    }).profile;

    const sourceLocationId = crypto.randomUUID();
    const destinationLocationId = crypto.randomUUID();
    const sourceExportId = crypto.randomUUID();
    const sourceBillId = crypto.randomUUID();
    const sourceReportId = crypto.randomUUID();
    const sourceReportItemId = crypto.randomUUID();
    const marker = sourceExportId.slice(0, 8);
    const sourceName = `สาขาต้นทาง E2E ${marker}`;
    const destinationName = `สาขาปลายทาง E2E ${marker}`;
    const exportNo = `REX-E2E-${marker}`;
    let receiptBillId: string | null = null;

    try {
      expect((await db.from("locations").insert([
        { id: sourceLocationId, name: sourceName, code: `S${marker.slice(0, 6)}`, is_active: true },
        { id: destinationLocationId, name: destinationName, code: `D${marker.slice(0, 6)}`, is_active: true },
      ])).error).toBeNull();
      expect((await db.from("user_locations").insert([
        { user_id: profile.id, location_id: sourceLocationId },
        { user_id: profile.id, location_id: destinationLocationId },
      ])).error).toBeNull();

      const verifiedAt = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
      expect((await db.from("rubber_exports").insert({
        id: sourceExportId,
        export_no: exportNo,
        export_date: verifiedAt.slice(0, 10),
        sequence_no: 987,
        location_id: sourceLocationId,
        status: "verified",
        original_weight_total: 100,
        paid_total: 8_000,
        average_price: 80,
        current_weight: 80,
        weight_loss_percent: 20,
        work_rate: 1,
        other_operating_cost: 0,
        work_total: 80,
        expense_destination: "branch",
        created_by_user_id: profile.id,
        created_by_name: profile.name,
        created_by_phone: profile.phone,
        verified_by_user_id: profile.id,
        verified_by_name: profile.name,
        verified_by_phone: profile.phone,
        verified_at: verifiedAt,
        age_cutoff_at: verifiedAt,
        average_age_hours: 48,
        oldest_age_hours: 60,
        estimated_age_item_count: 0,
      })).error).toBeNull();
      expect((await db.from("rubber_bills").insert({
        id: sourceBillId,
        client_temp_id: sourceBillId,
        local_bill_no: `SRC-${marker}`,
        server_bill_no: `SRC-${marker}`,
        idempotency_key: `branch-e2e:${sourceBillId}`,
        sync_status: "synced",
        record_status: "active",
        location_id: sourceLocationId,
        bill_no: `SRC-${marker}`,
        bill_date: verifiedAt.slice(0, 10),
        customer_name: "ลูกค้าต้นทาง E2E",
        bill_type: "weighing",
        weight: 100,
        deduct_weight: 0,
        rubber_value: 8_000,
        average_price: 80,
        net_total: 8_000,
        client_created_at: verifiedAt,
        created_by_user_id: profile.id,
        created_by_name: profile.name,
        created_by_phone: profile.phone,
      })).error).toBeNull();
      expect((await db.from("rubber_bill_items").insert({
        bill_id: sourceBillId,
        item_type: "weigh",
        net_weight: 100,
        quantity: 100,
        unit: "kg",
        price: 80,
        total: 8_000,
      })).error).toBeNull();
      expect((await db.from("report_batches").insert({
        id: sourceReportId,
        report_no: `RPT-SRC-${marker}`,
        report_date: verifiedAt.slice(0, 10),
        sequence_no: 987,
        location_id: sourceLocationId,
        cutoff_at: verifiedAt,
        status: "active",
        created_by_user_id: profile.id,
        created_by_name: profile.name,
        created_by_phone: profile.phone,
        opening_balance: 0,
        closing_balance: 0,
      })).error).toBeNull();
      expect((await db.from("report_items").insert({
        id: sourceReportItemId,
        report_id: sourceReportId,
        location_id: sourceLocationId,
        entity_type: "rubber_bill",
        entity_id: sourceBillId,
        eligibility_at: verifiedAt,
      })).error).toBeNull();
      expect((await db.from("rubber_export_items").insert({
        export_id: sourceExportId,
        location_id: sourceLocationId,
        source_report_item_id: sourceReportItemId,
        source_bill_id: sourceBillId,
        bill_date: verifiedAt.slice(0, 10),
        bill_no: `SRC-${marker}`,
        customer_name: "ลูกค้าต้นทาง E2E",
        eligibility_at: verifiedAt,
        net_weight: 100,
        paid_amount: 8_000,
        age_source_at: verifiedAt,
        age_is_estimated: false,
        carried_age_hours: 48,
      })).error).toBeNull();

      const receivePayload = {
        destinationLocationId,
        sourceRubberExportId: sourceExportId,
      };

      const saleReceiveRace = await Promise.all([
        page.request.patch(`/api/lanflow/rubber-exports/${sourceExportId}/sale`, {
          data: { soldOut: true },
        }),
        page.request.post("/api/lanflow/rubber-bills/branch-receipts", { data: receivePayload }),
      ]);
      const raceStatuses = saleReceiveRace.map((response) => response.status());
      expect(raceStatuses.filter((status) => status === 409)).toHaveLength(1);
      expect(raceStatuses.filter((status) => status === 200 || status === 201)).toHaveLength(1);

      if (saleReceiveRace[0].ok()) {
        const cancelSale = await page.request.patch(`/api/lanflow/rubber-exports/${sourceExportId}/sale`, {
          data: { soldOut: false },
        });
        expect(cancelSale.ok(), await cancelSale.text()).toBeTruthy();
      } else {
        const { data: racedReceipt, error: racedReceiptError } = await db
          .from("rubber_bills")
          .select("id")
          .eq("source_rubber_export_id", sourceExportId)
          .eq("record_status", "active")
          .single();
        expect(racedReceiptError).toBeNull();
        expect((await db.from("rubber_bill_items").delete().eq("bill_id", racedReceipt!.id)).error).toBeNull();
        expect((await db.from("rubber_bills").delete().eq("id", racedReceipt!.id)).error).toBeNull();
      }

      const concurrentReceives = await Promise.all([
        page.request.post("/api/lanflow/rubber-bills/branch-receipts", { data: receivePayload }),
        page.request.post("/api/lanflow/rubber-bills/branch-receipts", { data: receivePayload }),
      ]);
      expect(concurrentReceives.map((response) => response.status()).sort()).toEqual([201, 409]);
      const { data: concurrentReceipt, error: concurrentReceiptError } = await db
        .from("rubber_bills")
        .select("id")
        .eq("source_rubber_export_id", sourceExportId)
        .eq("record_status", "active")
        .single();
      expect(concurrentReceiptError).toBeNull();
      expect((await db.from("rubber_bill_items").delete().eq("bill_id", concurrentReceipt!.id)).error).toBeNull();
      expect((await db.from("rubber_bills").delete().eq("id", concurrentReceipt!.id)).error).toBeNull();

      await page.goto("/");
      await selectAppLocation(page, destinationLocationId);
      await page.getByRole("button", { name: /^บิลยาง/ }).click();
      await page.getByRole("button", { name: "รับยางจากสาขา" }).click();

      const receiveDialog = page.getByRole("dialog", { name: "รับยางจากสาขา" });
      await expect(receiveDialog).toBeVisible();
      await expect(receiveDialog.getByText(sourceName)).toBeVisible();
      await expect(receiveDialog.getByText(exportNo)).toBeVisible();
      await receiveDialog.getByRole("radio", { name: `เลือก ${exportNo} จาก ${sourceName}` }).check();
      await receiveDialog.getByRole("button", { name: "ยืนยันรับเข้าสาขา" }).click();
      await expect(page.getByText(/รับยางเข้าสาขาแล้ว/)).toBeVisible();

      const { data: receipt, error: receiptError } = await db
        .from("rubber_bills")
        .select("id, bill_no")
        .eq("source_rubber_export_id", sourceExportId)
        .eq("record_status", "active")
        .single();
      expect(receiptError).toBeNull();
      receiptBillId = receipt!.id;

      const receiptRow = page.getByRole("row").filter({ hasText: receipt!.bill_no });
      await expect(receiptRow).toContainText(`รับยางจากสาขา ${sourceName}`);
      await expect(receiptRow).toContainText("รับจากสาขา");
      await expect(receiptRow.getByRole("button", { name: "แก้ไข" })).toHaveCount(0);
      await receiptRow.getByRole("button", { name: "ดูรายละเอียด" }).click();

      const detailDialog = page.getByRole("dialog", { name: receipt!.bill_no });
      await expect(detailDialog).toContainText("อ่านอย่างเดียว");
      await expect(detailDialog).toContainText(exportNo);
      await expect(detailDialog).toContainText("฿8,000");
      await expect(detailDialog).toContainText("ยอดที่ต้องจ่ายลูกค้า");
      await expect(detailDialog).toContainText("฿0");

      const candidatesResponse = await page.request.get(
        `/api/lanflow/rubber-bills/branch-receipts?destinationLocationId=${destinationLocationId}`,
      );
      expect(candidatesResponse.ok(), await candidatesResponse.text()).toBeTruthy();
      const candidates = (await candidatesResponse.json() as {
        candidates: Array<{ sourceRubberExportId: string }>;
      }).candidates;
      expect(candidates.some((candidate) => candidate.sourceRubberExportId === sourceExportId)).toBe(false);
    } finally {
      if (receiptBillId) {
        await db.from("rubber_bill_items").delete().eq("bill_id", receiptBillId);
        await db.from("rubber_bills").delete().eq("id", receiptBillId);
      }
      await db.from("rubber_export_items").delete().eq("export_id", sourceExportId);
      await db.from("rubber_exports").delete().eq("id", sourceExportId);
      await db.from("report_items").delete().eq("id", sourceReportItemId);
      await db.from("report_batches").delete().eq("id", sourceReportId);
      await db.from("rubber_bill_items").delete().eq("bill_id", sourceBillId);
      await db.from("rubber_bills").delete().eq("id", sourceBillId);
      await db.from("user_locations").delete().in("location_id", [sourceLocationId, destinationLocationId]);
      await db.from("locations").delete().in("id", [sourceLocationId, destinationLocationId]);
    }
  });
});
