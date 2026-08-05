import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { selectAppLocation } from "./helpers/select-app-location";
import { bangkokDateString } from "../src/lib/bangkok-date";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

test("edits the OCR product amount and persists the corrected value @ocr-ticket-edit", async ({ page }) => {
  expect(serviceRoleKey).toBeTruthy();
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  await page.goto("/login");
  await page.fill('input[type="tel"]', process.env.TEST_PHONE || "0800000000");
  await page.fill('input[type="password"]', process.env.TEST_PASSWORD || "password123");
  await page.click('button:has-text("เข้าสู่ระบบ")');
  await expect(page.locator("text=ออกจากระบบ")).toBeVisible({ timeout: 30000 });

  const meResponse = await page.request.get("/api/auth/me");
  expect(meResponse.ok()).toBeTruthy();
  const profile = (await meResponse.json() as { profile: { locationIds: string[] } }).profile;
  const locationId = profile.locationIds[0];
  const id = crypto.randomUUID();
  const marker = `OCR-EDIT-${Date.now()}`;
  const today = bangkokDateString();

  const { error: insertError } = await service.from("ocr_tickets").insert({
    id,
    client_temp_id: id,
    idempotency_key: `ocr-edit:${id}`,
    location_id: locationId,
    file_name: `${marker}.jpg`,
    ticket_id: marker,
    date_in: today,
    weight_in: 1000,
    weight_out: 200,
    weight_net: 800,
    weight_deducted: 0,
    weight_remaining: 800,
    total_amount: 2750,
    money_deducted: 50,
    sync_status: "synced",
    record_status: "active",
    revision_no: 0,
  });
  expect(insertError).toBeNull();

  try {
    await page.goto("/");
    await selectAppLocation(page, locationId);
    await page.getByRole("button", { name: "อ่านใบชั่ง", exact: true }).click();

    const row = page.locator("table tbody tr", { hasText: marker });
    await expect(row).toBeVisible({ timeout: 15000 });
    await row.getByRole("button", { name: "แก้ไข", exact: true }).click();

    const modal = page.locator(".fixed.inset-0", { hasText: "แก้ไขข้อมูลใบชั่ง" }).last();
    const amountInput = modal.getByLabel("ยอดเงินสินค้า (฿)");
    await expect(amountInput).toBeEditable();
    await expect(amountInput).toHaveValue("2750");
    await amountInput.fill("3200");
    await expect(modal.getByText("ยอดสุทธิที่ต้องจ่ายลูกค้า").locator("..")).toContainText("฿3,150");
    await modal.getByRole("button", { name: "บันทึก", exact: true }).click();
    await expect(modal).toBeHidden({ timeout: 10000 });

    await expect.poll(async () => {
      const { data } = await service
        .from("ocr_tickets")
        .select("total_amount,money_deducted,revision_no")
        .eq("id", id)
        .single();
      return data;
    }).toEqual(expect.objectContaining({
      total_amount: 3200,
      money_deducted: 50,
      revision_no: 1,
    }));
  } finally {
    const { error: cleanupError } = await service.from("ocr_tickets").delete().eq("id", id);
    expect(cleanupError).toBeNull();
  }
});
