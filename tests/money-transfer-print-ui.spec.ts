import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { selectAppLocation } from "./helpers/select-app-location";

test.use({ storageState: { cookies: [], origins: [] } });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

test("shares a completed transfer PDF and leaves transfer data unchanged", async ({ page }) => {
  test.setTimeout(60_000);
  test.skip(!serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY is required for UI verification");

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
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
  expect(locationId).toBeTruthy();

  const paidId = crypto.randomUUID();
  const pendingId = crypto.randomUUID();
  const partialId = crypto.randomUUID();
  const advanceId = crypto.randomUUID();
  const sourceId = crypto.randomUUID();
  const marker = `print-ui-${paidId.slice(0, 8)}`;

  try {
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
            sharedTransferReceipt?: { name: string; size: number; type: string };
          }).sharedTransferReceipt = file
            ? { name: file.name, size: file.size, type: file.type }
            : undefined;
        },
      });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            (window as typeof window & { copiedText?: string }).copiedText = value;
          },
        },
      });
    });
    const sourceBillNo = `RB-PRINT-${sourceId.slice(0, 8)}`;
    expect((await admin.from("rubber_bills").insert({
      id: sourceId,
      client_temp_id: sourceId,
      local_bill_no: sourceBillNo,
      server_bill_no: sourceBillNo,
      idempotency_key: `print-source:${sourceId}`,
      sync_status: "synced",
      record_status: "active",
      location_id: locationId,
      bill_no: sourceBillNo,
      bill_date: "2026-07-25",
      customer_name: "ลูกค้าต้นทาง",
      bill_type: "weighing",
      weight: 100,
      deduct_weight: 5,
      rubber_value: 1300,
      average_price: 13,
      deduction_total: 35,
      net_total: 1200,
      server_received_at: new Date().toISOString(),
      created_by_user_id: me.profile.id,
      created_by_name: me.profile.name,
      created_by_phone: me.profile.phone,
    })).error).toBeNull();
    expect((await admin.from("rubber_bill_items").insert({
      bill_id: sourceId,
      item_type: "weigh",
      description: "ชั่ง 1",
      weight_in: 120,
      weight_out: 20,
      net_weight: 100,
      price: 13,
      total: 1300,
      sequence_no: 1,
    })).error).toBeNull();

    const inserted = await admin.from("money_transfers").insert([
      {
        id: paidId,
        client_temp_id: `client-${paidId}`,
        idempotency_key: `test:${paidId}`,
        location_id: locationId,
        customer_name: `${marker}-paid`,
        account_number: "1234567890",
        account_name: "ผู้รับทดสอบ",
        bank_name: "ธนาคารทดสอบ",
        net_amount_to_pay: 1200,
        transfer_type: "customer",
        transfer_status: "paid",
        created_by_user_id: me.profile.id,
        created_by_name: me.profile.name,
        created_by_phone: me.profile.phone,
      },
      {
        id: pendingId,
        client_temp_id: `client-${pendingId}`,
        idempotency_key: `test:${pendingId}`,
        location_id: locationId,
        customer_name: `${marker}-pending`,
        net_amount_to_pay: 500,
        transfer_type: "customer",
        transfer_status: "pending",
        created_by_user_id: me.profile.id,
        created_by_name: me.profile.name,
        created_by_phone: me.profile.phone,
      },
      {
        id: partialId,
        client_temp_id: `client-${partialId}`,
        idempotency_key: `test:${partialId}`,
        location_id: locationId,
        customer_name: `${marker}-partial`,
        net_amount_to_pay: 1000,
        transfer_type: "customer",
        transfer_status: "partial",
        created_by_user_id: me.profile.id,
        created_by_name: me.profile.name,
        created_by_phone: me.profile.phone,
      },
      {
        id: advanceId,
        client_temp_id: `client-${advanceId}`,
        idempotency_key: `test:${advanceId}`,
        location_id: locationId,
        customer_name: `${marker}-advance`,
        net_amount_to_pay: 0,
        transfer_type: "customer",
        transfer_status: "advance_payment",
        created_by_user_id: me.profile.id,
        created_by_name: me.profile.name,
        created_by_phone: me.profile.phone,
      },
    ]);
    expect(inserted.error).toBeNull();

    const children = await Promise.all([
      admin.from("money_transfer_slips").insert([
        {
          transfer_id: paidId,
          amount: 700,
          fee: 10,
          reference_number: `${marker}-second`,
          sender_name: "ผู้ส่ง 2",
          receiver_name: "ผู้รับ 2",
          transaction_date: "2026-07-25T07:00:00.000Z",
          slip_image_url: "https://example.invalid/must-not-print.jpg",
          sort_order: 2,
        },
        {
          transfer_id: paidId,
          amount: 500,
          fee: 5,
          reference_number: `${marker}-first`,
          sender_name: "ผู้ส่ง 1",
          receiver_name: "ผู้รับ 1",
          transaction_date: "2026-07-25T06:00:00.000Z",
          sort_order: 1,
        },
      ]),
      admin.from("money_transfer_items").insert({
        transfer_id: paidId,
        source_type: "rubber_bill",
        source_id: sourceId,
        customer_name: "ลูกค้าต้นทาง",
        amount: 1200,
      }),
      admin.from("money_transfer_slips").insert({
        transfer_id: partialId,
        amount: 400,
        fee: 0,
        reference_number: `${marker}-partial`,
        transaction_date: "2026-07-25T07:30:00.000Z",
        sort_order: 1,
      }),
      admin.from("money_transfer_slips").insert({
        transfer_id: advanceId,
        amount: 500,
        fee: 0,
        reference_number: `${marker}-advance`,
        transaction_date: "2026-07-25T08:00:00.000Z",
        sort_order: 1,
      }),
    ]);
    expect(children[0].error).toBeNull();
    expect(children[1].error).toBeNull();
    expect(children[2].error).toBeNull();
    expect(children[3].error).toBeNull();
    const sourceRelation = await admin
      .from("money_transfer_items")
      .select("rubber_bill_id,ocr_ticket_id")
      .eq("transfer_id", paidId)
      .single();
    expect(sourceRelation.error).toBeNull();
    expect(sourceRelation.data).toEqual({
      rubber_bill_id: sourceId,
      ocr_ticket_id: null,
    });

    const before = await admin.from("money_transfers")
      .select("transfer_status,revision_no,updated_at")
      .eq("id", paidId)
      .single();
    expect(before.error).toBeNull();

    await page.goto("/");
    await selectAppLocation(page, locationId);
    await page.getByRole("button", { name: /^โอนเงิน/ }).click();
    await page.getByRole("button", { name: /^ทั้งหมด/ }).click();

    const paidRow = page.locator(`[data-transfer-id="${paidId}"]`);
    const pendingRow = page.locator(`[data-transfer-id="${pendingId}"]`);
    const partialRow = page.locator(`[data-transfer-id="${partialId}"]`);
    const advanceRow = page.locator(`[data-transfer-id="${advanceId}"]`);
    await expect(paidRow).toBeVisible({ timeout: 15_000 });
    await expect(pendingRow).toBeVisible();
    await expect(partialRow).toBeVisible();
    await expect(advanceRow).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "บัญชีธนาคาร" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "ยอดรวมสลิป" })).toBeVisible();
    await expect(advanceRow).toContainText("฿500.00");
    await expect(paidRow).toContainText("ธนาคารทดสอบ");
    await expect(paidRow).toContainText("1234567890");
    await expect(paidRow).toContainText("ผู้รับทดสอบ");

    await paidRow.getByRole("button", { name: "คัดลอกเลขบัญชี 1234567890" }).click();
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & { copiedText?: string }).copiedText
    )).toBe("1234567890");
    await expect(page.getByText("คัดลอกเลขบัญชีแล้ว")).toBeVisible();

    const paidAmountCopy = paidRow.getByRole("button", { name: "คัดลอกยอด 1,200.00 บาท" });
    await expect(paidAmountCopy).toBeDisabled();
    await expect(paidAmountCopy).toHaveAttribute("title", "คัดลอกยอดได้เฉพาะรายการรอโอนหรือค้างจ่าย");
    await expect(advanceRow.getByRole("button", { name: "คัดลอกยอด 0.00 บาท" })).toBeDisabled();

    await pendingRow.getByRole("button", { name: "คัดลอกยอด 500.00 บาท" }).click();
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & { copiedText?: string }).copiedText
    )).toBe("500.00");
    await expect(page.getByText("คัดลอกยอด 500.00 บาทแล้ว")).toBeVisible();

    await expect(partialRow).toContainText("คงเหลือ ฿600.00");
    await partialRow.getByRole("button", { name: "คัดลอกยอด 600.00 บาท" }).click();
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & { copiedText?: string }).copiedText
    )).toBe("600.00");
    await expect(page.getByText("คัดลอกยอด 600.00 บาทแล้ว")).toBeVisible();

    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async () => { throw new Error("permission denied"); } },
      });
    });
    await paidRow.getByRole("button", { name: "คัดลอกเลขบัญชี 1234567890" }).click();
    await expect(page.getByText("คัดลอกไม่สำเร็จ กรุณาลองใหม่")).toBeVisible();

    const paidShare = paidRow.getByRole("button", { name: `แชร์ PDF รายการโอนเงิน ${paidId.replaceAll("-", "").slice(0, 8).toUpperCase()}` });
    const pendingShare = pendingRow.getByRole("button", { name: /แชร์ PDF รายการโอนเงิน/ });
    await expect(paidShare).toBeEnabled();
    await expect(pendingShare).toBeDisabled();
    await expect(pendingShare).toHaveAttribute("title", "แชร์ PDF ได้เมื่อจ่ายเสร็จสิ้น");

    const receiptDetailRequests: string[] = [];
    const unexpectedWriteRequests: string[] = [];
    page.on("request", (browserRequest) => {
      if (!["GET", "HEAD", "OPTIONS"].includes(browserRequest.method())) {
        const requestLabel = `${browserRequest.method()} ${browserRequest.url()}`;
        if (
          browserRequest.method() === "POST"
          && new URL(browserRequest.url()).pathname.endsWith(
            "/rest/v1/rpc/get_money_transfer_receipt_source_details",
          )
        ) {
          receiptDetailRequests.push(requestLabel);
        } else {
          unexpectedWriteRequests.push(requestLabel);
        }
      }
    });
    await paidShare.click();
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & {
        sharedTransferReceipt?: { name: string; size: number; type: string };
      }).sharedTransferReceipt
    )).not.toBeUndefined();
    const shared = await page.evaluate(() =>
      (window as typeof window & {
        sharedTransferReceipt?: { name: string; size: number; type: string };
      }).sharedTransferReceipt
    );
    expect(shared).toMatchObject({
      name: `LanFlow-money-transfer-${paidId.replaceAll("-", "").slice(0, 8).toUpperCase()}-80mm.pdf`,
      type: "application/pdf",
    });
    expect(shared!.size).toBeGreaterThan(1_000);
    await expect(paidShare).toBeEnabled();

    await page.evaluate(() => {
      Object.defineProperty(navigator, "canShare", {
        configurable: true,
        value: () => {
          throw new Error("unsupported");
        },
      });
    });
    const downloadPromise = page.waitForEvent("download");
    await paidShare.click();
    const download = await downloadPromise;
    const outputDir = join(process.cwd(), "output", "pdf");
    await mkdir(outputDir, { recursive: true });
    await download.saveAs(join(outputDir, "money-transfer-receipt-80mm.pdf"));
    expect(receiptDetailRequests).toHaveLength(2);
    expect(unexpectedWriteRequests).toEqual([]);

    const after = await admin.from("money_transfers")
      .select("transfer_status,revision_no,updated_at")
      .eq("id", paidId)
      .single();
    expect(after.error).toBeNull();
    expect(after.data).toEqual(before.data);

    await page.getByRole("button", { name: /^สร้างรายการโอน/ }).click();
    await page.getByRole("button", { name: /โอนให้ลูกค้า/ }).click();
    const transferDialog = page.getByRole("dialog");
    await expect(transferDialog.getByRole("heading", { name: "สร้างรายการโอนเงินใหม่" })).toBeVisible();
    await transferDialog.getByRole("button", { name: "เลือกบิลยาง / ใบชั่ง" }).click();
    const reportLockToggle = transferDialog.getByRole("button", { name: "ซ่อนรายการที่ล็อกแล้ว" });
    await expect(reportLockToggle).toHaveAttribute("aria-pressed", "false");
    await reportLockToggle.click();
    await expect(transferDialog.getByRole("button", { name: "แสดงรายการที่ล็อกแล้ว" })).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(transferDialog).toBeHidden();
  } finally {
    await admin.from("money_transfers").delete().in("id", [paidId, pendingId, partialId, advanceId]);
    await admin.from("rubber_bills").delete().eq("id", sourceId);
  }
});
