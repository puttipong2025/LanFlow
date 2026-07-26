import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

test.use({ storageState: "playwright/.auth/super_admin.json" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

test("downloads a completed transfer PDF and leaves transfer data unchanged", async ({ page, request }) => {
  test.setTimeout(60_000);
  test.skip(!serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY is required for UI verification");

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const meResponse = await request.get("/api/auth/me");
  expect(meResponse.ok()).toBeTruthy();
  const me = await meResponse.json() as {
    profile: { id: string; name: string; phone: string; locationIds: string[] };
  };
  const locationId = me.profile.locationIds[0];
  expect(locationId).toBeTruthy();

  const paidId = crypto.randomUUID();
  const pendingId = crypto.randomUUID();
  const sourceId = crypto.randomUUID();
  const marker = `print-ui-${paidId.slice(0, 8)}`;

  try {
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
      rubber_value: 1200,
      average_price: 12,
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
      price: 12,
      total: 1200,
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
    ]);
    expect(children[0].error).toBeNull();
    expect(children[1].error).toBeNull();

    const before = await admin.from("money_transfers")
      .select("transfer_status,revision_no,updated_at")
      .eq("id", paidId)
      .single();
    expect(before.error).toBeNull();

    await page.goto("/");
    const locationSelect = page.locator('select[aria-label="เลือกสาขา"]').first();
    await expect(locationSelect).toBeVisible();
    if (await locationSelect.inputValue() !== locationId) {
      await locationSelect.selectOption(locationId);
    }
    await page.getByRole("button", { name: /^โอนเงิน/ }).click();

    const paidRow = page.locator(`[data-transfer-id="${paidId}"]`);
    const pendingRow = page.locator(`[data-transfer-id="${pendingId}"]`);
    await expect(paidRow).toBeVisible({ timeout: 15_000 });
    await expect(pendingRow).toBeVisible();

    const paidDownload = paidRow.getByRole("button", { name: `ดาวน์โหลด PDF รายการโอนเงิน ${paidId.replaceAll("-", "").slice(0, 8).toUpperCase()}` });
    const pendingDownload = pendingRow.getByRole("button", { name: /ดาวน์โหลด PDF รายการโอนเงิน/ });
    await expect(paidDownload).toBeEnabled();
    await expect(pendingDownload).toBeDisabled();
    await expect(pendingDownload).toHaveAttribute("title", "ดาวน์โหลด PDF ได้เมื่อจ่ายเสร็จสิ้น");

    const writeRequests: string[] = [];
    page.on("request", (browserRequest) => {
      if (!["GET", "HEAD", "OPTIONS"].includes(browserRequest.method())) {
        writeRequests.push(`${browserRequest.method()} ${browserRequest.url()}`);
      }
    });
    const downloadPromise = page.waitForEvent("download");
    await paidDownload.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(
      `LanFlow-money-transfer-${paidId.replaceAll("-", "").slice(0, 8).toUpperCase()}-80mm.pdf`
    );
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const pdf = await readFile(downloadPath!);
    expect(pdf.subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");
    expect(pdf.length).toBeGreaterThan(1_000);
    const pdfOutputDir = join(process.cwd(), "output", "pdf");
    await mkdir(pdfOutputDir, { recursive: true });
    await download.saveAs(join(pdfOutputDir, "money-transfer-receipt-80mm.pdf"));
    await expect(paidDownload).toBeEnabled();
    expect(writeRequests).toEqual([]);

    const after = await admin.from("money_transfers")
      .select("transfer_status,revision_no,updated_at")
      .eq("id", paidId)
      .single();
    expect(after.error).toBeNull();
    expect(after.data).toEqual(before.data);
  } finally {
    await admin.from("money_transfers").delete().in("id", [paidId, pendingId]);
    await admin.from("rubber_bills").delete().eq("id", sourceId);
  }
});
