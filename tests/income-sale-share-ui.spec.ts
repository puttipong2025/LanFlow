import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { selectAppLocation } from "./helpers/select-app-location";

test.use({ storageState: { cookies: [], origins: [] } });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

test("shows one read-only share action for one synced sale parent", async ({ page }) => {
  test.skip(!serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY is required");
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: (data: ShareData) => data.files?.[0]?.type === "application/pdf",
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        const file = data.files?.[0];
        (window as typeof window & {
          sharedSaleReceipt?: { name: string; size: number; type: string };
        }).sharedSaleReceipt = file
          ? { name: file.name, size: file.size, type: file.type }
          : undefined;
      },
    });
  });

  await page.goto("/login");
  await page.locator("#phone").fill(process.env.TEST_PHONE ?? "0800000000");
  await page.locator("#password").fill(process.env.TEST_PASSWORD ?? "password123");
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await expect(page.getByText("ออกจากระบบ")).toBeVisible({ timeout: 30_000 });

  const meResponse = await page.request.get("/api/auth/me");
  expect(meResponse.ok()).toBeTruthy();
  const me = await meResponse.json() as {
    profile: { id: string; name: string; phone: string; locationIds: string[] };
  };
  const locationId = me.profile.locationIds[0];
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const saleItem = await service
    .from("income_sale_items")
    .select("id,name,stock_product_id")
    .eq("is_active", true)
    .not("stock_product_id", "is", null)
    .limit(1)
    .single();
  expect(saleItem.error).toBeNull();

  const clientTempId = crypto.randomUUID();
  const referenceNo = `SALE${clientTempId.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  const today = new Date().toISOString().slice(0, 10);

  try {
    const inserted = await service.from("income_expense").insert({
      client_temp_id: clientTempId,
      local_bill_no: `LOCAL-${clientTempId.slice(0, 8)}`,
      server_bill_no: referenceNo,
      idempotency_key: `test:${clientTempId}`,
      sync_status: "synced",
      record_status: "active",
      location_id: locationId,
      type: "income",
      number: referenceNo,
      tx_date: today,
      title: "บิลขาย — 2 รายการ",
      cost: 75,
      bill_option: "บิลขาย",
      client_recorded_at: new Date().toISOString(),
      client_created_at: new Date().toISOString(),
      server_received_at: new Date().toISOString(),
      revision_no: 1,
      created_by_user_id: me.profile.id,
      created_by_name: me.profile.name,
      created_by_phone: me.profile.phone,
    }).select("id").single();
    expect(inserted.error).toBeNull();

    const insertedLines = await service.from("income_expense_sale_lines").insert([
      {
        income_expense_id: inserted.data!.id,
        income_sale_item_id: saleItem.data!.id,
        stock_product_id: saleItem.data!.stock_product_id,
        title: saleItem.data!.name,
        quantity: 2,
        unit_price: 25,
        line_total: 50,
        sequence_no: 1,
      },
      {
        income_expense_id: inserted.data!.id,
        income_sale_item_id: saleItem.data!.id,
        stock_product_id: saleItem.data!.stock_product_id,
        title: saleItem.data!.name,
        quantity: 1,
        unit_price: 25,
        line_total: 25,
        sequence_no: 2,
      },
    ]);
    expect(insertedLines.error).toBeNull();

    await page.goto("/");
    await selectAppLocation(page, locationId);
    await page.getByRole("navigation").getByRole("button", {
      name: /^รับ-จ่าย(?: มีงานที่จัดการได้ \d+ รายการ)?$/,
    }).click();

    const share = page.getByRole("button", {
      name: `แชร์ PDF บิลขาย ${referenceNo}`,
    });
    await expect(share).toBeVisible({ timeout: 15_000 });
    await expect(share).toBeEnabled();
    expect(await page.getByRole("button", { name: /แชร์ PDF บิลขาย/ }).count()).toBe(1);

    await page.getByRole("button", { name: "ดูรายละเอียดบิลขาย" }).click();
    await expect(page.getByRole("heading", { name: `รายละเอียด ${referenceNo}` })).toBeVisible();
    await expect(page.locator("table").filter({ hasText: "ราคา/หน่วย" }).locator("tbody tr")).toHaveCount(2);
    await page.getByRole("button", { name: "ปิด" }).click();

    const before = await service.from("income_expense")
      .select("revision_no,updated_at")
      .eq("client_temp_id", clientTempId)
      .single();
    const writeRequests: string[] = [];
    page.on("request", (request) => {
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
        writeRequests.push(`${request.method()} ${request.url()}`);
      }
    });

    await share.click();
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & {
        sharedSaleReceipt?: { name: string; size: number; type: string };
      }).sharedSaleReceipt
    )).not.toBeUndefined();
    const shared = await page.evaluate(() =>
      (window as typeof window & {
        sharedSaleReceipt?: { name: string; size: number; type: string };
      }).sharedSaleReceipt
    );
    expect(shared).toMatchObject({
      name: `LanFlow-sale-bill-${referenceNo}-80mm.pdf`,
      type: "application/pdf",
    });
    expect(shared!.size).toBeGreaterThan(1_000);
    expect(writeRequests).toEqual([]);

    await page.evaluate(() => {
      Object.defineProperty(navigator, "canShare", {
        configurable: true,
        value: () => {
          throw new Error("unsupported");
        },
      });
    });
    const downloadPromise = page.waitForEvent("download");
    await share.click();
    const download = await downloadPromise;
    const outputDir = join(process.cwd(), "output", "pdf");
    await mkdir(outputDir, { recursive: true });
    await download.saveAs(join(outputDir, "sale-bill-receipt-80mm.pdf"));

    const after = await service.from("income_expense")
      .select("revision_no,updated_at")
      .eq("client_temp_id", clientTempId)
      .single();
    expect(after.data).toEqual(before.data);
  } finally {
    await service.from("income_expense").delete().eq("client_temp_id", clientTempId);
  }
});
