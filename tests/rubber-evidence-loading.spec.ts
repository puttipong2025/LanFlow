import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { selectAppLocation } from "./helpers/select-app-location";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==", "base64");

test("prepares five by three evidence cards within the bounded request budget", async ({ page }) => {
  test.skip(!serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY is required for loading verification");
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const billIds = Array.from({ length: 6 }, () => crypto.randomUUID());
  const rowsByBill = new Map<string, string[]>();
  for (const billId of billIds) {
    rowsByBill.set(billId, Array.from({ length: 3 }, () => crypto.randomUUID()));
  }
  let createdPeriodId: string | null = null;

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page.locator("#phone").fill(process.env.TEST_PHONE ?? "0800000000");
  await page.locator("#password").fill(process.env.TEST_PASSWORD ?? "password123");
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await expect(page.getByText("ออกจากระบบ")).toBeVisible({ timeout: 30_000 });

  const me = await (await page.request.get("/api/auth/me")).json() as {
    profile: { id: string; name: string; phone: string; locationIds: string[] };
  };
  const locationId = crypto.randomUUID();
  expect((await service.from("locations").insert({
    id: locationId,
    name: `สาขาทดสอบโหลด ${locationId.slice(0, 6)}`,
    code: `EL${locationId.slice(0, 6)}`,
    is_active: true,
  })).error).toBeNull();
  expect((await service.from("user_locations").insert({
    user_id: me.profile.id,
    location_id: locationId,
  })).error).toBeNull();

  let activeImages = 0;
  let maxActiveImages = 0;
  const imageRequests: string[] = [];
  const detailRequests: string[] = [];

  await page.route("**/api/lanflow/evidence/bills/*/revisions/*/detail", async (route) => {
    const match = route.request().url().match(/\/bills\/([^/]+)\/revisions\/(\d+)\/detail/);
    const billId = match?.[1] ?? "";
    const rowIds = rowsByBill.get(billId) ?? [];
    detailRequests.push(billId);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        bill: { id: billId, revisionNo: 1, billNo: `LOAD-${billId.slice(0, 6)}`, customerName: "ทดสอบโหลดหลักฐาน", clientCreatedAt: new Date().toISOString(), manualCorrectionCount: 0 },
        rows: rowIds.map((rowId, index) => ({
          id: rowId,
          sequenceNo: index + 1,
          label: `รายการ ${index + 1}`,
          inWeight: 150 + index,
          outWeight: 50,
          netWeight: 100 + index,
          rubberImageUrl: `/api/lanflow/evidence/bills/${billId}/revisions/1/rows/${rowId}/rubber/image`,
          displayInImageUrl: `/api/lanflow/evidence/bills/${billId}/revisions/1/rows/${rowId}/displayIn/image`,
          displayOutImageUrl: null,
        })),
      }),
    });
  });
  await page.route("**/api/lanflow/evidence/bills/*/revisions/*/rows/*/*/image", async (route) => {
    activeImages += 1;
    maxActiveImages = Math.max(maxActiveImages, activeImages);
    imageRequests.push(route.request().url());
    await new Promise((resolve) => setTimeout(resolve, 40));
    activeImages -= 1;
    await route.fulfill({ status: 200, contentType: "image/jpeg", body: jpeg });
  });

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
      const { data, error } = await service.from("rubber_bill_evidence_review_periods").insert({
        location_id: locationId,
        opened_at: openedAt,
        opened_by_user_id: me.profile.id,
        opened_by_name: me.profile.name,
      }).select("id").single();
      expect(error).toBeNull();
      createdPeriodId = data!.id;
    }

    const baseTime = Math.max(Date.now(), Date.parse(openedAt) + 1_000);
    const bills = billIds.map((id, index) => {
      const timestamp = new Date(baseTime + index * 1_000).toISOString();
      return {
        id,
        client_temp_id: `evidence-load-${id}`,
        local_bill_no: `LOAD-${id.slice(0, 6)}`,
        server_bill_no: `LOAD-${id.slice(0, 6)}`,
        idempotency_key: `evidence-load:${id}`,
        revision_no: 1,
        sync_status: "synced",
        record_status: "active",
        location_id: locationId,
        bill_no: `LOAD-${id.slice(0, 6)}`,
        bill_date: timestamp.slice(0, 10),
        customer_name: `ทดสอบโหลด ${index + 1}`,
        bill_type: "บิลเครื่องชั่งเล็ก",
        weight: 300,
        rubber_value: 3_000,
        average_price: 10,
        deduction_total: 0,
        net_total: 3_000,
        client_recorded_at: timestamp,
        client_created_at: timestamp,
        server_received_at: timestamp,
        created_by_user_id: me.profile.id,
        created_by_name: me.profile.name,
        created_by_phone: me.profile.phone,
      };
    });
    expect((await service.from("rubber_bills").insert(bills)).error).toBeNull();
    const rows = billIds.flatMap((billId) => (rowsByBill.get(billId) ?? []).map((id, index) => ({
      id,
      bill_id: billId,
      item_type: "weigh",
      description: `รายการ ${index + 1}`,
      weight_in: 150 + index,
      weight_out: 50,
      net_weight: 100 + index,
      price: 10,
      total: 1_000,
      sequence_no: index + 1,
    })));
    expect((await service.from("rubber_bill_items").insert(rows)).error).toBeNull();

    await page.goto("/");
    await selectAppLocation(page, locationId);
    const startedAt = performance.now();
    await page.getByRole("button", { name: /^ตรวจหลักฐาน/ }).click();
    const cards = page.locator("[data-testid^='evidence-card-']");
    await expect(cards).toHaveCount(5);
    const firstUsableMs = performance.now() - startedAt;
    expect(firstUsableMs).toBeLessThanOrEqual(3_000);

    await expect(page.locator("[data-testid^='evidence-card-'] button:has-text('ผ่าน'):not([disabled])")).toHaveCount(5, { timeout: 8_000 });
    const fullPageMs = performance.now() - startedAt;
    expect(fullPageMs).toBeLessThanOrEqual(8_000);
    expect(maxActiveImages).toBeLessThanOrEqual(3);
    expect(detailRequests).toHaveLength(5);
    expect(new Set(detailRequests).size).toBe(5);
    expect(imageRequests).toHaveLength(20);
    expect(new Set(imageRequests).size).toBe(20);
    console.log("[rubber-evidence-benchmark]", JSON.stringify({
      cards: 5,
      weighRowsPerCard: 3,
      firstUsableMs: Math.round(firstUsableMs),
      fullPageMs: Math.round(fullPageMs),
      detailRequests: detailRequests.length,
      imageRequests: imageRequests.length,
      maxConcurrentImages: maxActiveImages,
    }));

    const firstCard = cards.first();
    await firstCard.getByRole("button", { name: "สไลด์ถัดไป" }).click();
    await expect(firstCard.getByText("2 / 4", { exact: true })).toBeVisible();
    await page.getByPlaceholder("ค้นหาเลขบิลหรือลูกค้า").fill("LOAD");
    await expect(firstCard.getByText("2 / 4", { exact: true })).toBeVisible();
    await page.waitForTimeout(200);
    expect(detailRequests).toHaveLength(5);
    expect(imageRequests).toHaveLength(20);
    await page.getByPlaceholder("ค้นหาเลขบิลหรือลูกค้า").fill("");

    await page.getByRole("button", { name: "หน้าถัดไป" }).click();
    await expect(cards).toHaveCount(1);
    await expect.poll(() => detailRequests.length).toBe(6);
    await expect(page.locator("[data-testid^='evidence-card-'] button:has-text('ผ่าน'):not([disabled])")).toHaveCount(1);

    await page.getByRole("button", { name: "หน้าก่อนหน้า" }).click();
    await expect(cards).toHaveCount(5);
    await expect(page.locator("[data-testid^='evidence-card-'] button:has-text('ผ่าน'):not([disabled])")).toHaveCount(5);
    detailRequests.length = 0;
    imageRequests.length = 0;

    await page.getByTestId(`evidence-card-${billIds[0]}`).getByRole("button", { name: "ผ่าน" }).click();
    await expect(page.getByTestId(`evidence-card-${billIds[0]}`)).toHaveCount(0);
    await expect(page.getByTestId(`evidence-card-${billIds[5]}`)).toBeVisible();
    await page.waitForTimeout(300);
    expect(detailRequests).toHaveLength(0);
    expect(imageRequests).toHaveLength(0);
  } finally {
    await service.from("rubber_bills").delete().in("id", billIds);
    if (createdPeriodId) await service.from("rubber_bill_evidence_review_periods").delete().eq("id", createdPeriodId);
    await service.from("user_locations").delete().eq("user_id", me.profile.id).eq("location_id", locationId);
    await service.from("locations").delete().eq("id", locationId);
  }
});
