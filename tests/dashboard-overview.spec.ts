import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function bangkokToday() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
}

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function bangkokTimestamp(date: string, hour: number, second = 0) {
  const time = `${String(hour).padStart(2, "0")}:00:${String(second).padStart(2, "0")}`;
  return new Date(`${date}T${time}+07:00`).toISOString();
}

test.describe("Dashboard overview @dashboard", () => {
  test.use({ storageState: "playwright/.auth/user.json" });

  test("renders the new cards and hides all figures offline", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /ภาพรวม ·/ })).toBeVisible({ timeout: 15_000 });
    for (const label of [
      "ซื้อยางวันนี้",
      "ยอดซื้อเฉลี่ย 7 วัน",
      "ต้นทุนซื้อเฉลี่ย 7 วัน",
      "รับ–จ่ายสุทธิสะสม",
      "ภาระดำเนินงานต่อยอดซื้อสะสม",
      "น้ำหนักยางคงเหลือ",
      "น้ำหาย 7 วัน",
      "สต็อกสินค้า",
    ]) {
      await expect(page.getByText(label, { exact: true }).last()).toBeVisible();
    }
    await expect(page.getByText(/^สูตร:/)).toHaveCount(8);
    await expect(page.getByRole("heading", { name: "รายการเงินล่าสุด" })).toBeVisible();
    await expect(page.getByRole("button", { name: "ย้อนกลับ" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "หน้าถัดไป" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /บิลยาง ·/ })).toHaveCount(0);

    await page.context().setOffline(true);
    await expect(page.getByText("ต้องออนไลน์เพื่อดูภาพรวมล่าสุด", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "รายการเงินล่าสุด" })).toHaveCount(0);
    await page.context().setOffline(false);
  });

  test("calculates the agreed metrics and paginates individual money rows", async ({ request }) => {
    expect(serviceRoleKey).toBeTruthy();
    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const meResponse = await request.get("/api/auth/me");
    const me = await meResponse.json() as {
      profile: { id: string; name: string; phone: string };
    };

    const locationId = crypto.randomUUID();
    const sourceLocationId = crypto.randomUUID();
    const billIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    const incomeExpenseIds = Array.from({ length: 14 }, () => crypto.randomUUID());
    const productIds = [crypto.randomUUID(), crypto.randomUUID()];
    const stockEntryId = crypto.randomUUID();
    const transferIds = [crypto.randomUUID(), crypto.randomUUID()];
    const reportId = crypto.randomUUID();
    const reportItemId = crypto.randomUUID();
    const exportIds = [crypto.randomUUID(), crypto.randomUUID()];
    const today = bangkokToday();
    const oldDate = shiftDate(today, -8);
    const marker = `DASH-${locationId.slice(0, 8)}`;

    try {
      expect((await db.from("locations").insert([
        { id: locationId, name: `${marker}-สาขา`, code: marker.slice(0, 10), is_active: true },
        { id: sourceLocationId, name: `${marker}-ต้นทาง`, code: `${marker.slice(0, 8)}S`, is_active: true },
      ])).error).toBeNull();
      expect((await db.from("user_locations").insert({
        user_id: me.profile.id,
        location_id: locationId,
      })).error).toBeNull();

      const emptyResponse = await request.get(`/api/lanflow/dashboard?locationId=${locationId}`);
      expect(emptyResponse.ok(), await emptyResponse.text()).toBeTruthy();
      const emptyOverview = await emptyResponse.json();
      expect(emptyOverview.summary.purchaseToday).toEqual({
        billCount: 0,
        netWeight: 0,
        paidTotal: 0,
      });
      expect(emptyOverview.summary.purchase7Days.averageCostPerKg).toBeNull();
      expect(emptyOverview.summary.operatingExpenseAccumulated).toBe(0);
      expect(emptyOverview.summary.rubberInventoryWeight).toBe(0);
      expect(emptyOverview.summary.waterLoss7Days.percent).toBeNull();
      expect(emptyOverview.rows).toEqual([]);

      expect((await request.get(
        `/api/lanflow/dashboard?locationId=${locationId}&cursor=not-a-cursor`
      )).status()).toBe(400);
      expect((await request.get(
        `/api/lanflow/dashboard?locationId=${sourceLocationId}`
      )).status()).toBe(403);

      expect((await db.from("stock_products").insert([
        { id: productIds[0], name: `${marker}-สินค้า`, unit: "ถัง", is_active: true },
        { id: productIds[1], name: `${marker}-สินค้าหมด`, unit: "ชิ้น", is_active: true },
      ])).error).toBeNull();
      expect((await db.from("stock_entries").insert({
        id: stockEntryId,
        tx_date: today,
        product_id: productIds[0],
        product_name: `${marker}-สินค้า`,
        quantity_delta: 5,
        amount: 500,
        location_id: locationId,
        tx_type: "receive",
        record_status: "active",
        created_by_user_id: me.profile.id,
        created_by_name: me.profile.name,
      })).error).toBeNull();

      const billRows = [
        { id: billIds[0], date: today, weight: 100, total: 1000, time: bangkokTimestamp(today, 10) },
        { id: billIds[1], date: today, weight: 200, total: 3000, time: bangkokTimestamp(today, 9) },
        { id: billIds[2], date: oldDate, weight: 50, total: 500, time: bangkokTimestamp(oldDate, 10) },
      ];
      expect((await db.from("rubber_bills").insert(billRows.map((bill, index) => ({
        id: bill.id,
        client_temp_id: bill.id,
        local_bill_no: `${marker}-RB-${index + 1}`,
        server_bill_no: `${marker}-RB-${index + 1}`,
        idempotency_key: `${marker}:rubber:${index + 1}`,
        sync_status: "synced",
        record_status: "active",
        location_id: locationId,
        bill_no: `${marker}-RB-${index + 1}`,
        bill_date: bill.date,
        customer_name: `${marker}-ลูกค้า-${index + 1}`,
        bill_type: "weighing",
        weight: bill.weight,
        rubber_value: bill.total,
        average_price: bill.total / bill.weight,
        net_total: bill.total,
        client_recorded_at: bill.time,
        client_created_at: bill.time,
        server_received_at: bill.time,
        created_at: bill.time,
        created_by_user_id: me.profile.id,
        created_by_name: me.profile.name,
        created_by_phone: me.profile.phone,
      })))).error).toBeNull();
      expect((await db.from("rubber_bill_items").insert(billRows.map((bill) => ({
        bill_id: bill.id,
        item_type: "weigh",
        description: "ชั่ง 1",
        weight_in: bill.weight,
        weight_out: 0,
        net_weight: bill.weight,
        price: bill.total / bill.weight,
        total: bill.total,
        sequence_no: 1,
      })))).error).toBeNull();

      const directRows = incomeExpenseIds.map((id, index) => ({
        id,
        client_temp_id: id,
        local_bill_no: `${marker}-IE-${index + 1}`,
        server_bill_no: `${marker}-IE-${index + 1}`,
        idempotency_key: `${marker}:income-expense:${index + 1}`,
        sync_status: "synced",
        record_status: index === 13 ? "deleted" : "active",
        location_id: locationId,
        type: index === 0 || index === 12 ? "expense" : "income",
        number: `${marker}-IE-${index + 1}`,
        tx_date: index === 12 ? oldDate : today,
        title: `${marker}-รายการ-${index + 1}`,
        cost: index === 0 ? 700 : index === 1 ? 5000 : index === 12 ? 300 : index === 13 ? 99999 : 1,
        bill_option: index === 0 || index === 12 ? "ค่าใช้จ่าย" : "รายรับ",
        client_recorded_at: bangkokTimestamp(index === 12 ? oldDate : today, 18, index),
        client_created_at: bangkokTimestamp(index === 12 ? oldDate : today, 18, index),
        created_by_user_id: me.profile.id,
        created_by_name: me.profile.name,
        created_by_phone: me.profile.phone,
      }));
      expect((await db.from("income_expense").insert(directRows)).error).toBeNull();

      expect((await db.from("money_transfers").insert([
        {
          id: transferIds[0],
          client_temp_id: transferIds[0],
          idempotency_key: `${marker}:paid-transfer`,
          location_id: sourceLocationId,
          target_location_id: locationId,
          target_location_name: `${marker}-สาขา`,
          net_amount_to_pay: 2000,
          transfer_type: "branch",
          transfer_method: "bank",
          transfer_status: "paid",
          record_status: "active",
          created_by_user_id: me.profile.id,
          created_by_name: me.profile.name,
          created_by_phone: me.profile.phone,
        },
        {
          id: transferIds[1],
          client_temp_id: transferIds[1],
          idempotency_key: `${marker}:pending-transfer`,
          location_id: locationId,
          target_location_id: sourceLocationId,
          target_location_name: `${marker}-ต้นทาง`,
          net_amount_to_pay: 999,
          transfer_type: "branch",
          transfer_method: "bank",
          transfer_status: "pending",
          record_status: "active",
          created_by_user_id: me.profile.id,
          created_by_name: me.profile.name,
          created_by_phone: me.profile.phone,
        },
      ])).error).toBeNull();

      expect((await db.from("report_batches").insert({
        id: reportId,
        report_no: `${marker}-REPORT`,
        report_date: today,
        sequence_no: 1,
        location_id: locationId,
        cutoff_at: bangkokTimestamp(today, 11),
        status: "active",
        created_by_user_id: me.profile.id,
        created_by_name: me.profile.name,
        created_by_phone: me.profile.phone,
      })).error).toBeNull();
      expect((await db.from("report_items").insert({
        id: reportItemId,
        report_id: reportId,
        location_id: locationId,
        entity_type: "rubber_bill",
        entity_id: billIds[2],
        eligibility_at: bangkokTimestamp(today, 11),
        active: true,
      })).error).toBeNull();
      expect((await db.from("rubber_exports").insert([
        {
          id: exportIds[0],
          export_no: `${marker}-EXPORT-1`,
          export_date: today,
          sequence_no: 1,
          location_id: locationId,
          status: "verified",
          original_weight_total: 50,
          paid_total: 500,
          average_price: 10,
          current_weight: 45,
          weight_loss_percent: 10,
          work_rate: 2,
          other_operating_cost: 10,
          work_total: 100,
          expense_destination: "branch",
          created_by_user_id: me.profile.id,
          created_by_name: me.profile.name,
          created_by_phone: me.profile.phone,
          verified_by_user_id: me.profile.id,
          verified_by_name: me.profile.name,
          verified_by_phone: me.profile.phone,
          verified_at: bangkokTimestamp(today, 12),
        },
        {
          id: exportIds[1],
          export_no: `${marker}-EXPORT-2`,
          export_date: today,
          sequence_no: 2,
          location_id: locationId,
          status: "verified",
          original_weight_total: 50,
          paid_total: 500,
          average_price: 10,
          current_weight: 40,
          weight_loss_percent: 20,
          work_rate: 0,
          other_operating_cost: 0,
          work_total: 0,
          expense_destination: "branch",
          created_by_user_id: me.profile.id,
          created_by_name: me.profile.name,
          created_by_phone: me.profile.phone,
          verified_by_user_id: me.profile.id,
          verified_by_name: me.profile.name,
          verified_by_phone: me.profile.phone,
          verified_at: bangkokTimestamp(today, 13),
        },
      ])).error).toBeNull();

      const { count: activeProductCount, error: productCountError } = await db
        .from("stock_products")
        .select("*", { count: "exact", head: true })
        .eq("is_active", true);
      expect(productCountError).toBeNull();

      const response = await request.get(`/api/lanflow/dashboard?locationId=${locationId}`);
      expect(response.ok(), await response.text()).toBeTruthy();
      const firstPage = await response.json() as {
        summary: {
          purchaseToday: { billCount: number; netWeight: number; paidTotal: number };
          purchase7Days: { paidTotal: number; dailyAverage: number; netWeight: number; averageCostPerKg: number };
          netCashFlow: number;
          operatingExpenseAccumulated: number;
          rubberInventoryWeight: number;
          waterLoss7Days: { exportCount: number; weight: number; percent: number };
          stock: { inStockCount: number; outOfStockCount: number; items: Array<{ productId: string; balance: number }> };
        };
        rows: Array<{ id: string; kind: string; number: string }>;
        nextCursor: string | null;
      };

      expect(firstPage.summary.purchaseToday).toEqual({
        billCount: 2,
        netWeight: 300,
        paidTotal: 4000,
      });
      expect(firstPage.summary.purchase7Days).toEqual({
        paidTotal: 4000,
        dailyAverage: 571.43,
        netWeight: 300,
        averageCostPerKg: 13.33,
      });
      expect(firstPage.summary.netCashFlow).toBe(1410);
      expect(firstPage.summary.operatingExpenseAccumulated).toBe(1100);
      expect(firstPage.summary.rubberInventoryWeight).toBe(250);
      expect(firstPage.summary.waterLoss7Days).toEqual({
        exportCount: 2,
        weight: 15,
        percent: 15,
      });
      expect(firstPage.summary.stock.inStockCount).toBe(1);
      expect(firstPage.summary.stock.outOfStockCount).toBe((activeProductCount ?? 0) - 1);
      expect(firstPage.summary.stock.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ productId: productIds[0], balance: 5 }),
        expect.objectContaining({ productId: productIds[1], balance: 0 }),
      ]));
      expect(firstPage.rows).toHaveLength(10);
      expect(firstPage.nextCursor).toBeTruthy();

      const secondResponse = await request.get(
        `/api/lanflow/dashboard?locationId=${locationId}&cursor=${encodeURIComponent(firstPage.nextCursor!)}`
      );
      expect(secondResponse.ok(), await secondResponse.text()).toBeTruthy();
      const secondPage = await secondResponse.json() as {
        rows: Array<{ id: string; kind: string; number: string }>;
        nextCursor: string | null;
      };
      const allRows = [...firstPage.rows, ...secondPage.rows];
      expect(new Set(allRows.map((row) => row.id)).size).toBe(allRows.length);
      expect(allRows.filter((row) => row.kind === "rubber_bill").map((row) => row.number)).toEqual(
        expect.arrayContaining([`${marker}-RB-1`, `${marker}-RB-2`, `${marker}-RB-3`])
      );
      expect(allRows.some((row) => row.number === `TR-${transferIds[1].slice(0, 8)}`)).toBeFalsy();
    } finally {
      await db.from("rubber_exports").delete().in("id", exportIds);
      await db.from("report_items").delete().eq("id", reportItemId);
      await db.from("report_batches").delete().eq("id", reportId);
      await db.from("money_transfers").delete().in("id", transferIds);
      await db.from("income_expense").delete().in("id", incomeExpenseIds);
      await db.from("rubber_bill_items").delete().in("bill_id", billIds);
      await db.from("rubber_bills").delete().in("id", billIds);
      await db.from("stock_entries").delete().eq("id", stockEntryId);
      await db.from("stock_products").delete().in("id", productIds);
      await db.from("user_locations").delete().eq("location_id", locationId);
      await db.from("locations").delete().in("id", [locationId, sourceLocationId]);
    }
  });
});
