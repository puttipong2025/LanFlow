import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { selectAppLocation } from "./helpers/select-app-location";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

test.use({ storageState: "playwright/.auth/super_admin.json" });

test("creates a branch receipt once and applies manual focus-zero behavior", async ({ page }) => {
  test.skip(!serviceRoleKey, "Supabase service key is required");
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let transferId: string | null = null;
  let saveRequestCount = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/rest/v1/rpc/save_money_transfer")) {
      saveRequestCount += 1;
    }
  });

  try {
    await page.goto("/");
    await page.getByRole("button", { name: /^โอนเงิน/ }).click();
    await page.getByRole("button", { name: "สร้างรายการโอน" }).click();
    await page.getByRole("button", { name: /โอนให้สาขา/ }).click();

    const dialog = page.getByRole("dialog", { name: "สร้างรายการโอนให้สาขา" });
    await expect(dialog).toBeVisible();
    const inactiveLocations = await service.from("locations").select("id").eq("is_active", false);
    expect(inactiveLocations.error).toBeNull();
    const recipientOptions = await dialog.getByLabel("สาขาที่รับเงิน").locator("option").evaluateAll((options) => (
      options.map((option) => (option as HTMLOptionElement).value).filter(Boolean)
    ));
    for (const location of inactiveLocations.data ?? []) expect(recipientOptions).not.toContain(location.id);
    await dialog.getByRole("button", { name: "เพิ่มเอง" }).click();
    await expect(dialog.getByText("เพิ่มเอง · ไม่ใช้เลขอ้างอิง")).toBeVisible();
    await expect(dialog.getByText("หมายเลขอ้างอิง OCR")).toHaveCount(0);

    const amount = dialog.getByRole("spinbutton", { name: "จำนวนเงินสลิป 1" });
    await expect(amount).toHaveValue("0");
    await amount.focus();
    await expect(amount).toHaveValue("");
    await amount.fill("321.50");
    await dialog.locator('input[type="datetime-local"]').fill("2026-08-27T10:30");

    const saveResponsePromise = page.waitForResponse((response) => (
      response.request().method() === "POST"
      && response.url().includes("/rest/v1/rpc/save_money_transfer")
    ));
    await dialog.getByRole("button", { name: "บันทึก", exact: true }).dblclick();
    const saveResponse = await saveResponsePromise;
    expect(saveResponse.ok()).toBeTruthy();
    const saved = await saveResponse.json() as { id: string };
    transferId = saved.id;

    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: /จ่ายครบ/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(`[data-transfer-id="${transferId}"]`)).toContainText("ให้สาขา");
    expect(saveRequestCount).toBe(1);
  } finally {
    if (transferId) {
      await service.from("money_transfer_slips").delete().eq("transfer_id", transferId);
      await service.from("money_transfers").delete().eq("id", transferId);
    }
  }
});

test("customer and transport modals also start editable amounts at zero with focus-zero", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^โอนเงิน(?:\s|$)/ }).click();

  await page.getByRole("button", { name: "สร้างรายการโอน" }).click();
  await page.getByRole("button", { name: /โอนให้ลูกค้า/ }).click();
  const customerDialog = page.getByRole("dialog", { name: "สร้างรายการโอนเงินใหม่" });
  await customerDialog.getByRole("button", { name: "เพิ่มเอง" }).click();
  const customerAmount = customerDialog.getByRole("spinbutton", { name: "จำนวนเงินสลิป 1" });
  await expect(customerAmount).toHaveValue("0");
  await customerAmount.focus();
  await expect(customerAmount).toHaveValue("");
  await customerDialog.getByRole("button", { name: "ยกเลิก" }).click();

  await page.getByRole("button", { name: "สร้างรายการโอน" }).click();
  await page.getByRole("button", { name: /จ่ายค่าขนส่ง/ }).click();
  const transportDialog = page.getByRole("dialog", { name: "สร้างรายการโอนเงินใหม่ \(รถขนส่ง\)" });
  const transportCost = transportDialog.getByRole("spinbutton", { name: "ค่าขนส่ง" });
  await expect(transportCost).toHaveValue("0");
  await transportCost.focus();
  await expect(transportCost).toHaveValue("");
  await transportDialog.getByRole("button", { name: "ยกเลิก" }).click();
});

test("OCR references are read-only and non-zero OCR amounts stay intact on focus", async ({ page }) => {
  let ocrCall = 0;
  await page.route("**/rest/v1/rpc/save_money_transfer", async (route) => {
    const payload = (route.request().postDataJSON() as { p_payload: Record<string, any> }).p_payload;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: payload.id,
        client_temp_id: payload.clientTempId,
        idempotency_key: payload.idempotencyKey,
        location_id: payload.locationId,
        target_location_id: payload.targetLocationId,
        transfer_type: payload.transferType,
        transfer_status: "paid",
        net_amount_to_pay: payload.netAmountToPay,
        revision_no: 0,
        record_status: "active",
        sync_status: "synced",
        money_transfer_slips: payload.slips,
        money_transfer_items: [],
      }),
    });
  });
  await page.route("**/api/lanflow/ocr-slip", async (route) => {
    ocrCall += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        amount: ocrCall === 1 ? 765.25 : 125,
        reference_number: `OCR-READ-ONLY-${ocrCall}`,
        fee: 5,
        sender_name: "ผู้โอน OCR",
        receiver_name: "สาขาผู้รับ",
        transaction_date: "2026-08-27T10:30:00+07:00",
      }),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /^โอนเงิน(?:\s|$)/ }).click();
  await page.getByRole("button", { name: "สร้างรายการโอน" }).click();
  await page.getByRole("button", { name: /โอนให้สาขา/ }).click();
  const dialog = page.getByRole("dialog", { name: "สร้างรายการโอนให้สาขา" });

  await dialog.locator('input[type="file"]').setInputFiles([
    { name: "slip-1.png", mimeType: "image/png", buffer: Buffer.from("fake-image-1") },
    { name: "slip-2.png", mimeType: "image/png", buffer: Buffer.from("fake-image-2") },
  ]);
  const reference = dialog.getByLabel("หมายเลขอ้างอิง OCR").first();
  await expect(reference).toHaveValue("OCR-READ-ONLY-1");
  await expect(reference).toHaveAttribute("readonly", "");
  const amount = dialog.getByRole("spinbutton", { name: "จำนวนเงินสลิป 1" });
  await expect(amount).toHaveValue("765.25");
  await amount.focus();
  await expect(amount).toHaveValue("765.25");

  const saveRequest = page.waitForRequest((request) => (
    request.method() === "POST" && request.url().includes("/rest/v1/rpc/save_money_transfer")
  ));
  await dialog.getByRole("button", { name: "บันทึก", exact: true }).click();
  const payload = (await saveRequest).postDataJSON() as {
    p_payload: { slips: Array<{ sortOrder: number }> };
  };
  expect(payload.p_payload.slips.map((slip) => slip.sortOrder)).toEqual([0, 1]);
});

test("customer and transport saves are single-flight and keep every modal close-guarded", async ({ page }) => {
  let saveRequestCount = 0;
  const releases: Array<() => void> = [];
  await page.route("**/rest/v1/rpc/save_money_transfer", async (route) => {
    saveRequestCount += 1;
    await new Promise<void>((resolve) => releases.push(resolve));
    const payload = (route.request().postDataJSON() as { p_payload: Record<string, any> }).p_payload;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: payload.id,
        client_temp_id: payload.clientTempId,
        idempotency_key: payload.idempotencyKey,
        location_id: payload.locationId,
        transfer_type: payload.transferType,
        transfer_status: payload.transferStatus,
        net_amount_to_pay: payload.netAmountToPay,
        branch_paid_amount: payload.branchPaidAmount,
        revision_no: payload.revisionNo,
        record_status: "active",
        sync_status: "synced",
        money_transfer_slips: [],
        money_transfer_items: [],
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /^โอนเงิน(?:\s|$)/ }).click();

  await page.getByRole("button", { name: "สร้างรายการโอน" }).click();
  await page.getByRole("button", { name: /โอนให้ลูกค้า/ }).click();
  const customerDialog = page.getByRole("dialog", { name: "สร้างรายการโอนเงินใหม่" });
  const customerSearch = customerDialog.getByPlaceholder("ค้นหาชื่อลูกค้า...");
  await customerSearch.click();
  await customerSearch.locator("..").getByRole("button").first().click();
  await customerDialog.getByRole("button", { name: "เพิ่มเอง" }).click();
  await customerDialog.getByRole("spinbutton", { name: "จำนวนเงินสลิป 1" }).fill("100");
  await customerDialog.locator('input[type="datetime-local"]').fill("2026-08-27T10:30");
  await customerDialog.getByRole("button", { name: "บันทึก", exact: true }).dblclick();
  await expect.poll(() => releases.length).toBe(1);
  await expect(customerDialog.getByRole("button", { name: "กำลังบันทึก..." })).toBeDisabled();
  await expect(customerDialog.getByRole("button", { name: "กำลังดำเนินการ ไม่สามารถปิดได้" })).toBeDisabled();
  releases.shift()?.();
  await expect(customerDialog).toBeHidden();

  await page.getByRole("button", { name: "สร้างรายการโอน" }).click();
  await page.getByRole("button", { name: /จ่ายค่าขนส่ง/ }).click();
  const transportDialog = page.getByRole("dialog", { name: "สร้างรายการโอนเงินใหม่ \(รถขนส่ง\)" });
  await transportDialog.getByPlaceholder("พิมพ์ชื่อรถขนส่ง...").fill("รถทดสอบ single flight");
  await transportDialog.getByRole("spinbutton", { name: "ค่าขนส่ง" }).fill("100");
  await transportDialog.getByRole("button", { name: "บันทึก", exact: true }).dblclick();
  await expect.poll(() => releases.length).toBe(1);
  await expect(transportDialog.getByRole("button", { name: "กำลังบันทึก..." })).toBeDisabled();
  await expect(transportDialog.getByRole("button", { name: "กำลังดำเนินการ ไม่สามารถปิดได้" })).toBeDisabled();
  releases.shift()?.();
  await expect(transportDialog).toBeHidden();
  expect(saveRequestCount).toBe(2);
});

test("a failed branch save keeps the draft and allows one clean retry", async ({ page }) => {
  let attempt = 0;
  await page.route("**/rest/v1/rpc/save_money_transfer", async (route) => {
    attempt += 1;
    if (attempt === 1) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ code: "P0001", message: "MT_TEST_FAILURE: ทดสอบบันทึกล้มเหลว" }),
      });
      return;
    }
    const payload = (route.request().postDataJSON() as { p_payload: Record<string, any> }).p_payload;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: payload.id,
        client_temp_id: payload.clientTempId,
        idempotency_key: payload.idempotencyKey,
        location_id: payload.locationId,
        target_location_id: payload.targetLocationId,
        target_location_name: payload.targetLocationName,
        transfer_type: "branch",
        transfer_status: "paid",
        net_amount_to_pay: 88,
        branch_paid_amount: 0,
        revision_no: 0,
        record_status: "active",
        sync_status: "synced",
        money_transfer_slips: [],
        money_transfer_items: [],
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /^โอนเงิน(?:\s|$)/ }).click();
  await page.getByRole("button", { name: "สร้างรายการโอน" }).click();
  await page.getByRole("button", { name: /โอนให้สาขา/ }).click();
  const dialog = page.getByRole("dialog", { name: "สร้างรายการโอนให้สาขา" });
  await dialog.getByRole("button", { name: "เพิ่มเอง" }).click();
  const amount = dialog.getByRole("spinbutton", { name: "จำนวนเงินสลิป 1" });
  await amount.fill("88");
  await dialog.locator('input[type="datetime-local"]').fill("2026-08-27T10:30");

  await dialog.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(amount).toHaveValue("88");
  await expect(dialog.getByRole("button", { name: "บันทึก", exact: true })).toBeEnabled();

  await dialog.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(attempt).toBe(2);
});

test("legacy inter-branch rows open read-only and cannot be deleted", async ({ page }) => {
  test.skip(!serviceRoleKey, "Supabase service key is required");
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const me = await (await page.request.get("/api/auth/me")).json() as {
    profile: { id: string; name: string; phone: string; locationIds: string[] };
  };
  const sourceLocationId = me.profile.locationIds[0];
  const targetLocationResult = await service.from("locations")
    .select("id,name")
    .eq("is_active", true)
    .neq("id", sourceLocationId)
    .limit(1)
    .maybeSingle();
  expect(targetLocationResult.error).toBeNull();
  let targetLocation = targetLocationResult.data;
  let createdTargetLocationId: string | null = null;
  if (!targetLocation) {
    createdTargetLocationId = crypto.randomUUID();
    const created = await service.from("locations").insert({
      id: createdTargetLocationId,
      name: "สาขาทดสอบ legacy read-only",
      code: `LG${createdTargetLocationId.slice(0, 6).toUpperCase()}`,
      is_active: true,
      created_by: me.profile.id,
    }).select("id,name").single();
    expect(created.error).toBeNull();
    targetLocation = created.data;
  }
  const transferId = crypto.randomUUID();

  try {
    const inserted = await service.from("money_transfers").insert({
      id: transferId,
      client_temp_id: transferId,
      idempotency_key: `legacy-read-only:${transferId}`,
      location_id: sourceLocationId,
      target_location_id: targetLocation!.id,
      target_location_name: targetLocation!.name,
      net_amount_to_pay: 77,
      branch_paid_amount: 0,
      transfer_type: "branch",
      transfer_status: "paid",
      sync_status: "synced",
      record_status: "active",
      created_by_user_id: me.profile.id,
      created_by_name: me.profile.name,
      created_by_phone: me.profile.phone,
    });
    expect(inserted.error).toBeNull();

    await page.goto("/");
    await selectAppLocation(page, sourceLocationId);
    await page.getByRole("button", { name: /^โอนเงิน/ }).click();
    await page.getByRole("button", { name: /^ทั้งหมด/ }).click();
    const row = page.locator(`[data-transfer-id="${transferId}"]`);
    await expect(row).toBeVisible();
    await expect(row.getByRole("button", { name: "ลบ" })).toBeDisabled();
    await row.getByRole("button", { name: "ดู", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "รายละเอียดรายการโอนระหว่างสาขารุ่นเดิม" });
    await expect(dialog).toContainText("ข้อมูลอ่านอย่างเดียว");
    await expect(dialog).toContainText("เปิดดูได้แต่แก้ไขหรือลบไม่ได้");
  } finally {
    await service.from("money_transfers").delete().eq("id", transferId);
    if (createdTargetLocationId) await service.from("locations").delete().eq("id", createdTargetLocationId);
  }
});
