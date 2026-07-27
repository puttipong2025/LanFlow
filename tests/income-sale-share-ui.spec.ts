import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { selectAppLocation } from "./helpers/select-app-location";

test.use({ storageState: { cookies: [], origins: [] } });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

test("shows one share button for a complete synced sale group", async ({ page }) => {
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
  const groupId = crypto.randomUUID();
  const clientIds = [crypto.randomUUID(), crypto.randomUUID()];
  const incompleteClientId = crypto.randomUUID();
  const referenceNo = `SALE${clientIds[0].replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  const incompleteReferenceNo = `WAIT${incompleteClientId.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  const today = new Date().toISOString().slice(0, 10);

  try {
    const inserted = await service.from("income_expense").insert([
      ...clientIds.map((clientTempId, index) => ({
        client_temp_id: clientTempId,
        local_bill_no: `LOCAL-${clientTempId.slice(0, 8)}`,
        server_bill_no: index === 0 ? referenceNo : `${referenceNo}-2`,
        idempotency_key: `test:${clientTempId}`,
        sync_status: "synced",
        record_status: "active",
        location_id: locationId,
        type: "income",
        number: index === 0 ? referenceNo : `${referenceNo}-2`,
        tx_date: today,
        title: `สินค้าทดสอบแชร์ ${index + 1}`,
        cost: (index + 1) * 25,
        unit: String(index + 1),
        price: 25,
        bill_option: "บิลขาย",
        sale_group_id: groupId,
        sale_line_order: index + 1,
        sale_expected_lines: 2,
        client_recorded_at: new Date().toISOString(),
        client_created_at: new Date().toISOString(),
        server_received_at: new Date().toISOString(),
        revision_no: 1,
        created_by_user_id: me.profile.id,
        created_by_name: me.profile.name,
        created_by_phone: me.profile.phone,
      })),
      {
        client_temp_id: incompleteClientId,
        local_bill_no: `LOCAL-${incompleteClientId.slice(0, 8)}`,
        server_bill_no: incompleteReferenceNo,
        idempotency_key: `test:${incompleteClientId}`,
        sync_status: "synced",
        record_status: "active",
        location_id: locationId,
        type: "income",
        number: incompleteReferenceNo,
        tx_date: today,
        title: "สินค้ารอสมาชิกกลุ่ม",
        cost: 25,
        unit: "1",
        price: 25,
        bill_option: "บิลขาย",
        sale_group_id: crypto.randomUUID(),
        sale_line_order: 1,
        sale_expected_lines: 2,
        client_recorded_at: new Date().toISOString(),
        client_created_at: new Date().toISOString(),
        server_received_at: new Date().toISOString(),
        revision_no: 1,
        created_by_user_id: me.profile.id,
        created_by_name: me.profile.name,
        created_by_phone: me.profile.phone,
      },
    ]);
    expect(inserted.error).toBeNull();

    await page.goto("/");
    await selectAppLocation(page, locationId);
    await page.getByRole("navigation").getByRole("button", {
      name: /^รับ-จ่าย(?: มีงานที่จัดการได้ \d+ รายการ)?$/,
    }).click();

    const leaderShare = page.getByRole("button", {
      name: `แชร์ PDF บิลขาย ${referenceNo}`,
    });
    await expect(leaderShare).toBeVisible({ timeout: 15_000 });
    await expect(leaderShare).toBeEnabled();
    const leaderRow = leaderShare.locator("xpath=ancestor::tr");
    const secondRow = page.locator("tr").filter({
      has: page.getByText(`${referenceNo}-2`, { exact: true }),
    }).first();
    expect(await leaderRow.getByRole("button", { name: /แชร์ PDF บิลขาย/ }).count()).toBe(1);
    expect(await secondRow.getByRole("button", { name: /แชร์ PDF บิลขาย/ }).count()).toBe(0);
    const incompleteShare = page.getByRole("button", {
      name: `แชร์ PDF บิลขาย ${incompleteReferenceNo}`,
    });
    await expect(incompleteShare).toBeDisabled();
    await expect(incompleteShare).toHaveAttribute(
      "title",
      "รอโหลดหรือซิงก์รายการบิลขายให้ครบ 2 รายการ"
    );

    const before = await service.from("income_expense")
      .select("revision_no,updated_at")
      .in("client_temp_id", clientIds)
      .order("sale_line_order");
    expect(before.error).toBeNull();
    const writeRequests: string[] = [];
    page.on("request", (request) => {
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
        writeRequests.push(`${request.method()} ${request.url()}`);
      }
    });

    await leaderShare.click();
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
    await leaderShare.click();
    const download = await downloadPromise;
    const outputDir = join(process.cwd(), "output", "pdf");
    await mkdir(outputDir, { recursive: true });
    await download.saveAs(join(outputDir, "sale-bill-receipt-80mm.pdf"));

    const after = await service.from("income_expense")
      .select("revision_no,updated_at")
      .in("client_temp_id", clientIds)
      .order("sale_line_order");
    expect(after.error).toBeNull();
    expect(after.data).toEqual(before.data);
  } finally {
    await service.from("income_expense").delete().in("client_temp_id", [
      ...clientIds,
      incompleteClientId,
    ]);
  }
});
