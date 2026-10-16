import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { selectAppLocation } from "./helpers/select-app-location";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

test("shows a report-lock alert when deletion loses a race with report creation", async ({ page }) => {
  test.skip(!serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY is required for UI verification");
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const transferId = crypto.randomUUID();
  const customerName = `ลูกค้าทดสอบแจ้งเตือน ${transferId.slice(0, 8)}`;
  const reportNo = "RPT-20260819-040";
  let deleteRequestCount = 0;

  await page.goto("/login");
  await page.locator("#phone").fill(process.env.TEST_PHONE ?? "0800000000");
  await page.locator("#password").fill(process.env.TEST_PASSWORD ?? "password123");
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await expect(page.getByText("ออกจากระบบ")).toBeVisible({ timeout: 30_000 });
  const meResponse = await page.request.get("/api/auth/me");
  const me = await meResponse.json() as {
    profile: { id: string; name: string; phone: string; locationIds: string[] };
  };
  const locationId = me.profile.locationIds[0];

  try {
    expect((await service.from("money_transfers").insert({
      id: transferId,
      client_temp_id: transferId,
      idempotency_key: `delete-alert:${transferId}`,
      location_id: locationId,
      customer_name: customerName,
      net_amount_to_pay: 100,
      transfer_type: "customer",
      transfer_method: "bank",
      transfer_status: "pending",
      sync_status: "synced",
      record_status: "active",
      created_by_user_id: me.profile.id,
      created_by_name: me.profile.name,
      created_by_phone: me.profile.phone,
    })).error).toBeNull();

    await page.route("**/rest/v1/rpc/delete_money_transfer", async (route) => {
      deleteRequestCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 100));
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          code: "P0001",
          details: null,
          hint: null,
          message: `REPORT_LOCKED:${reportNo}`,
        }),
      });
    });

    await page.goto("/");
    await selectAppLocation(page, locationId);
    await page.getByRole("button", { name: /^โอนเงิน/ }).click();

    const transferRow = page.getByRole("row").filter({ hasText: customerName });
    await expect(transferRow).toBeVisible();
    await transferRow.getByRole("button", { name: "ลบ" }).click();
    await page.getByRole("button", { name: "ลบ", exact: true }).last().dblclick();
    await expect.poll(() => deleteRequestCount).toBe(1);

    const alert = page.getByRole("alertdialog", { name: "ลบรายการไม่ได้" });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(reportNo);
    await expect(alert).toContainText("ต้องลบรายงานล่าสุดตามลำดับก่อน");
    await expect(alert.getByRole("button", { name: "รับทราบ" })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(alert).toBeHidden();
    await expect(transferRow).toBeVisible();
  } finally {
    await service.from("money_transfers").delete().eq("id", transferId);
  }
});
