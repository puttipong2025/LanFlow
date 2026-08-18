import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { selectAppLocation } from "./helpers/select-app-location";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

test("opens the evidence module inside Android and desktop viewports without overflow", async ({ page }, testInfo) => {
  test.skip(!serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY is required for UI verification");
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const billId = crypto.randomUUID();
  const rowId = crypto.randomUUID();
  let createdPeriodId: string | null = null;

  await page.setViewportSize({ width: 412, height: 915 });
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
    const { data: existingPeriod } = await service
      .from("rubber_bill_evidence_review_periods")
      .select("id, opened_at")
      .eq("location_id", locationId)
      .is("closed_at", null)
      .maybeSingle();
    let openedAt = existingPeriod?.opened_at as string | undefined;
    if (!openedAt) {
      openedAt = new Date(Date.now() - 60_000).toISOString();
      const { data, error } = await service
        .from("rubber_bill_evidence_review_periods")
        .insert({
          location_id: locationId,
          opened_at: openedAt,
          opened_by_user_id: me.profile.id,
          opened_by_name: me.profile.name,
        })
        .select("id")
        .single();
      expect(error).toBeNull();
      createdPeriodId = data!.id;
    }

    const clientCreatedAt = new Date(Math.max(Date.now(), Date.parse(openedAt) + 1_000)).toISOString();
    const marker = billId.slice(0, 8);
    const { error: billError } = await service.from("rubber_bills").insert({
      id: billId,
      client_temp_id: `evidence-ui-${marker}`,
      local_bill_no: `EUI-${marker}`,
      server_bill_no: `EUI-${marker}`,
      idempotency_key: `evidence-ui:${billId}`,
      revision_no: 1,
      sync_status: "synced",
      record_status: "active",
      location_id: locationId,
      bill_no: `EUI-${marker}`,
      bill_date: clientCreatedAt.slice(0, 10),
      customer_name: "ทดสอบหน้าตรวจหลักฐาน",
      bill_type: "บิลเครื่องชั่งเล็ก",
      weight: 100,
      rubber_value: 1_000,
      average_price: 10,
      deduction_total: 0,
      net_total: 1_000,
      client_recorded_at: clientCreatedAt,
      client_created_at: clientCreatedAt,
      server_received_at: clientCreatedAt,
      created_by_user_id: me.profile.id,
      created_by_name: me.profile.name,
      created_by_phone: me.profile.phone,
    });
    expect(billError).toBeNull();
    expect((await service.from("rubber_bill_items").insert({
      id: rowId,
      bill_id: billId,
      item_type: "weigh",
      description: "ยางก้อนถ้วย",
      weight_in: 150,
      weight_out: 50,
      net_weight: 100,
      price: 10,
      total: 1_000,
      sequence_no: 1,
    })).error).toBeNull();

    await page.goto("/");
    await selectAppLocation(page, locationId);
    await page.getByRole("button", { name: /^ตรวจหลักฐาน/ }).click();
    const module = page.getByRole("region", { name: "ตรวจหลักฐาน" });
    await expect(module.getByRole("heading", { name: "ตรวจหลักฐาน" })).toBeVisible();
    const card = module.getByTestId(`evidence-card-${billId}`);
    await expect(card.getByText("รอตรวจ", { exact: true })).toBeVisible();
    await expect(card.getByText("ไม่พบรูปหลักฐาน", { exact: true })).toBeVisible();
    await expect(card.getByText("ไม่มี mapping รูปจอชั่งเข้า")).toBeVisible();
    await expect(card.getByRole("button", { name: "ผ่าน" })).toBeVisible();
    await expect(card.getByRole("button", { name: "ควรปรับปรุง" })).toBeVisible();
    const passAllButton = module.getByRole("button", { name: "ตรวจทั้งหมดให้ผ่าน" });
    if (await passAllButton.isVisible()) {
      await passAllButton.click();
      const passAllDialog = page.getByRole("alertdialog", { name: "ตรวจทั้งหมดให้ผ่าน?" });
      await expect(passAllDialog).toContainText("1 รายการ");
      await passAllDialog.getByRole("button", { name: "ยกเลิก" }).click();
    }
    const closePeriodButton = module.getByRole("button", { name: "ปิดการตรวจ" });
    if (await closePeriodButton.isVisible()) {
      await closePeriodButton.click();
      const closeDialog = page.getByRole("alertdialog", { name: "ปิดรอบตรวจ?" });
      await expect(closeDialog).toBeVisible();
      await closeDialog.getByRole("button", { name: "ยกเลิก" }).click();
    }
    for (const viewport of [
      { name: "android-small", width: 360, height: 640 },
      { name: "android-target", width: 390, height: 844 },
      { name: "desktop", width: 1440, height: 900 },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const box = await card.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      expect(box!.width).toBeLessThanOrEqual(viewport.width);
      await testInfo.attach(`rubber-evidence-${viewport.name}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    }
    await page.setViewportSize({ width: 390, height: 844 });

    await page.route(`**/api/lanflow/evidence/bills/${billId}/revisions/1/detail`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          bill: { id: billId, revisionNo: 1, billNo: `EUI-${marker}`, customerName: "ทดสอบหน้าตรวจหลักฐาน", clientCreatedAt, manualCorrectionCount: 0 },
          rows: [{
            id: rowId,
            sequenceNo: 1,
            label: "ยางก้อนถ้วย",
            inWeight: 150,
            outWeight: 50,
            netWeight: 100,
            rubberImageUrl: null,
            displayInImageUrl: `/api/lanflow/evidence/bills/${billId}/revisions/1/rows/${rowId}/displayIn/image`,
            displayOutImageUrl: null,
          }],
        }),
      });
    });
    await page.route(`**/api/lanflow/evidence/bills/${billId}/revisions/1/rows/${rowId}/displayIn/image`, async (route) => {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "fixture failure" }) });
    });
    await page.getByRole("button", { name: /^บิลยาง/ }).click();
    const billRow = page.getByRole("row").filter({ hasText: `EUI-${marker}` });
    await billRow.getByRole("button", { name: "เปิดหลักฐานน้ำหนัก" }).click();
    await expect(page).toHaveURL(new RegExp(`tab=rubber-evidence.*bill=${billId}`));
    const failedCard = page.getByTestId(`evidence-card-${billId}`);
    await expect(failedCard).toBeVisible();
    await expect(failedCard.getByText(/โหลดรูปที่มี mapping ไม่สำเร็จ/)).toBeVisible();
    await expect(failedCard.getByRole("button", { name: "ผ่าน" })).toBeDisabled();
    await expect(page.getByRole("dialog", { name: "ตรวจหลักฐานน้ำหนัก" })).toHaveCount(0);
  } finally {
    await service.from("rubber_bills").delete().eq("id", billId);
    if (createdPeriodId) {
      await service.from("rubber_bill_evidence_review_periods").delete().eq("id", createdPeriodId);
    }
  }
});
