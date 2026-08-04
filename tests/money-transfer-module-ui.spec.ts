import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { selectAppLocation } from "./helpers/select-app-location";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

test("paginates pending transfers and runs the automatic merge from the pending view", async ({ page }) => {
  test.skip(!serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY is required for UI verification");
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const customerId = crypto.randomUUID();
  const transferIds = Array.from({ length: 23 }, () => crypto.randomUUID());

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
    expect((await service.from("customers").insert({
      id: customerId,
      main_name: "ลูกค้ารวมจากหน้าจอ",
      created_by_name: me.profile.name,
      created_by_phone: me.profile.phone,
    })).error).toBeNull();
    expect((await service.from("money_transfers").insert(transferIds.map((id, index) => ({
      id,
      client_temp_id: id,
      idempotency_key: `merge-ui:${id}`,
      location_id: locationId,
      customer_id: index < 2 ? customerId : null,
      customer_name: index < 2 ? "ลูกค้ารวมจากหน้าจอ" : `รายการแบ่งหน้า ${index}`,
      account_number: index < 2 ? "4444444444" : null,
      net_amount_to_pay: index < 2 ? 100 : index,
      transfer_type: "customer",
      transfer_method: "bank",
      transfer_status: "pending",
      sync_status: "synced",
      record_status: "active",
      created_by_user_id: me.profile.id,
      created_by_name: me.profile.name,
      created_by_phone: me.profile.phone,
      created_at: `2099-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    })))).error).toBeNull();

    await page.goto("/");
    await selectAppLocation(page, locationId);
    await page.getByRole("button", { name: /^โอนเงิน/ }).click();
    await expect(page.getByRole("button", { name: /^รอโอน/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("tbody tr[data-transfer-id]")).toHaveCount(20);
    await page.getByRole("button", { name: "ถัดไป" }).click();
    await expect(page.getByText(/หน้า 2\//)).toBeVisible();
    await page.getByRole("button", { name: /^รอโอน/ }).click();

    const mergeButton = page.getByRole("button", { name: "รวมบิลยางและใบชั่ง" });
    await expect(mergeButton).toBeEnabled();
    await mergeButton.click();
    await expect(page.getByText(/รวมสำเร็จ 1 กลุ่ม · รวม 2 รายการ · ข้าม \d+ รายการ/)).toBeVisible();

    await expect.poll(async () => {
      const { data } = await service
        .from("money_transfers")
        .select("record_status")
        .in("id", transferIds.slice(0, 2));
      return data?.filter((row) => row.record_status === "deleted").length;
    }).toBe(1);
  } finally {
    await service.from("money_transfers").delete().in("id", transferIds);
    await service.from("customers").delete().eq("id", customerId);
  }
});
