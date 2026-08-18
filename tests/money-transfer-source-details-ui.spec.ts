import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { selectAppLocation } from "./helpers/select-app-location";

test.use({ storageState: { cookies: [], origins: [] } });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

test("opens mixed rubber-bill and OCR details through the secured detail RPC", async ({ page }) => {
  test.setTimeout(60_000);
  test.skip(!serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY is required for UI verification");

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

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
  const transferId = crypto.randomUUID();
  const emptyTransferId = crypto.randomUUID();
  const cancelledTransferId = crypto.randomUUID();
  const rubberBillId = crypto.randomUUID();
  const ocrTicketId = crypto.randomUUID();
  const cancelledOcrTicketId = crypto.randomUUID();
  const reportId = crypto.randomUUID();
  const rubberBillNo = `RB-DETAIL-${rubberBillId.slice(0, 8)}`;
  const ocrTicketNo = `OCR-DETAIL-${ocrTicketId.slice(0, 8)}`;
  const cancelledOcrTicketNo = `OCR-CANCELLED-${cancelledOcrTicketId.slice(0, 8)}`;
  const reportNo = `RPT-DETAIL-${reportId.slice(0, 8)}`;

  try {
    expect((await service.from("rubber_bills").insert({
      id: rubberBillId,
      client_temp_id: rubberBillId,
      local_bill_no: rubberBillNo,
      server_bill_no: rubberBillNo,
      idempotency_key: `source-detail:${rubberBillId}`,
      sync_status: "synced",
      record_status: "active",
      location_id: locationId,
      bill_no: rubberBillNo,
      bill_date: "2026-08-09",
      customer_name: "ลูกค้ารายละเอียดบิลยาง",
      bill_type: "weighing",
      weight: 100,
      deduct_weight: 5,
      rubber_value: 1_300,
      average_price: 13,
      deduction_total: 35,
      net_total: 1_200,
      created_at: "2026-08-10T01:00:00.000Z",
      server_received_at: "2026-08-10T01:00:00.000Z",
      created_by_user_id: me.profile.id,
      created_by_name: me.profile.name,
      created_by_phone: me.profile.phone,
    })).error).toBeNull();
    expect((await service.from("rubber_bill_items").insert({
      bill_id: rubberBillId,
      item_type: "weigh",
      description: "ชั่ง 1",
      weight_in: 120,
      weight_out: 20,
      net_weight: 100,
      price: 13,
      total: 1_300,
      sequence_no: 1,
    })).error).toBeNull();
    expect((await service.from("ocr_tickets").insert({
      id: ocrTicketId,
      client_temp_id: ocrTicketId,
      idempotency_key: `source-detail:${ocrTicketId}`,
      location_id: locationId,
      file_name: `${ocrTicketNo}.jpg`,
      ticket_id: ocrTicketNo,
      date_in: "2026-08-10",
      weight_in: 50,
      weight_out: 10,
      weight_net: 40,
      weight_deducted: 0,
      weight_remaining: 40,
      total_amount: 800,
      money_deducted: 50,
      sync_status: "synced",
      record_status: "active",
      created_at: "2026-08-10T02:00:00.000Z",
      created_by_user_id: me.profile.id,
      created_by_name: me.profile.name,
      created_by_phone: me.profile.phone,
    })).error).toBeNull();
    expect((await service.from("ocr_tickets").insert({
      id: cancelledOcrTicketId,
      client_temp_id: cancelledOcrTicketId,
      idempotency_key: `source-detail:${cancelledOcrTicketId}`,
      location_id: locationId,
      file_name: `${cancelledOcrTicketNo}.jpg`,
      ticket_id: cancelledOcrTicketNo,
      date_in: "2026-08-10",
      weight_in: 12,
      weight_out: 2,
      weight_net: 10,
      weight_deducted: 0,
      weight_remaining: 10,
      total_amount: 100,
      money_deducted: 0,
      sync_status: "synced",
      record_status: "active",
      created_at: "2026-08-10T03:00:00.000Z",
      created_by_user_id: me.profile.id,
      created_by_name: me.profile.name,
      created_by_phone: me.profile.phone,
    })).error).toBeNull();
    expect((await service.from("money_transfers").insert([
      {
        id: transferId,
        client_temp_id: transferId,
        idempotency_key: `source-detail:${transferId}`,
        location_id: locationId,
        customer_name: "รายการรายละเอียดผสม",
        net_amount_to_pay: 1_950,
        transfer_type: "customer",
        transfer_status: "paid",
        sync_status: "synced",
        record_status: "active",
        created_by_user_id: me.profile.id,
        created_by_name: me.profile.name,
        created_by_phone: me.profile.phone,
      },
      {
        id: emptyTransferId,
        client_temp_id: emptyTransferId,
        idempotency_key: `source-detail:${emptyTransferId}`,
        location_id: locationId,
        customer_name: "รายการไม่มีต้นทาง",
        net_amount_to_pay: 0,
        transfer_type: "customer",
        transfer_status: "cancelled",
        sync_status: "synced",
        record_status: "active",
        created_by_user_id: me.profile.id,
        created_by_name: me.profile.name,
        created_by_phone: me.profile.phone,
      },
      {
        id: cancelledTransferId,
        client_temp_id: cancelledTransferId,
        idempotency_key: `source-detail:${cancelledTransferId}`,
        location_id: locationId,
        customer_name: "รายการยกเลิกที่มีต้นทาง",
        net_amount_to_pay: 100,
        transfer_type: "customer",
        transfer_status: "cancelled",
        sync_status: "synced",
        record_status: "active",
        created_by_user_id: me.profile.id,
        created_by_name: me.profile.name,
        created_by_phone: me.profile.phone,
      },
    ])).error).toBeNull();
    expect((await service.from("money_transfer_items").insert([
      {
        transfer_id: transferId,
        source_type: "rubber_bill",
        source_id: rubberBillId,
        customer_name: "ลูกค้ารายละเอียดบิลยาง",
        amount: 1_200,
      },
      {
        transfer_id: transferId,
        source_type: "ocr_ticket",
        source_id: ocrTicketId,
        customer_name: "ลูกค้ารายละเอียด OCR",
        amount: 750,
      },
      {
        transfer_id: cancelledTransferId,
        source_type: "ocr_ticket",
        source_id: cancelledOcrTicketId,
        customer_name: "ลูกค้ารายการยกเลิก",
        amount: 100,
      },
    ])).error).toBeNull();
    expect((await service.from("money_transfer_slips").insert({
      transfer_id: transferId,
      amount: 1_950,
      reference_number: `source-detail:${transferId}`,
      sort_order: 1,
    })).error).toBeNull();
    expect((await service.from("report_batches").insert({
      id: reportId,
      report_no: reportNo,
      report_date: "2099-01-01",
      sequence_no: 1,
      location_id: locationId,
      cutoff_at: "2099-01-01T00:00:00.000Z",
      status: "active",
      created_by_user_id: me.profile.id,
      created_by_name: me.profile.name,
      created_by_phone: me.profile.phone,
    })).error).toBeNull();
    expect((await service.from("report_items").insert({
      report_id: reportId,
      location_id: locationId,
      entity_type: "bank_transfer_source",
      entity_id: transferId,
      eligibility_at: "2026-08-10T04:00:00.000Z",
      active: true,
    })).error).toBeNull();

    let rubberBillsRequestCount = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith("/rest/v1/rubber_bills")) rubberBillsRequestCount += 1;
    });

    await page.goto("/");
    await selectAppLocation(page, locationId);
    await page.getByRole("button", { name: /^โอนเงิน/ }).click();
    await page.getByRole("button", { name: /^ทั้งหมด/ }).click();
    expect(rubberBillsRequestCount).toBe(0);

    const transferRow = page.locator(`[data-transfer-id="${transferId}"]`);
    const emptyRow = page.locator(`[data-transfer-id="${emptyTransferId}"]`);
    const cancelledRow = page.locator(`[data-transfer-id="${cancelledTransferId}"]`);
    await expect(transferRow).toBeVisible({ timeout: 15_000 });
    await expect(emptyRow).toBeVisible();
    await expect(cancelledRow).toBeVisible();

    const headerLabels = await page.locator("thead tr").filter({ hasText: "จัดการ" }).first()
      .getByRole("columnheader").allTextContents();
    expect(headerLabels.slice(0, 9).map((label) => label.trim())).toEqual([
      "จัดการ",
      "#",
      "รายการ",
      "ปลายทาง",
      "บัญชีธนาคาร",
      "ยอดที่ต้องจ่าย",
      "ยอดรวมสลิป",
      "สลิป",
      "ประเภท",
    ]);

    const detailButton = transferRow.getByRole("button", { name: /ดูรายละเอียดต้นทาง 2 รายการ/ });
    const emptyButton = emptyRow.getByRole("button", { name: /ดูรายละเอียดต้นทาง 0 รายการ/ });
    await expect(detailButton).toBeEnabled();
    await expect(emptyButton).toBeDisabled();
    await expect(transferRow.getByRole("button", { name: /แก้/ })).toBeDisabled();
    await expect(transferRow.getByRole("button", { name: /ลบ/ })).toBeDisabled();

    const detailRpcRequests: string[] = [];
    const writeRequests: string[] = [];
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.endsWith("/rest/v1/rpc/get_money_transfer_receipt_source_details")) {
        detailRpcRequests.push(`${request.method()} ${pathname}`);
      }
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method())
        && !pathname.endsWith("/rest/v1/rpc/get_money_transfer_detail")
        && !pathname.endsWith("/rest/v1/rpc/get_money_transfer_receipt_source_details")) {
        writeRequests.push(`${request.method()} ${pathname}`);
      }
    });

    await detailButton.click();
    const dialog = page.getByRole("dialog", { name: "รายละเอียดต้นทางรายการโอนเงิน" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("2 รายการ");
    await expect(dialog.getByRole("columnheader")).toHaveText([
      "ประเภท",
      "เลขที่บิล/ใบชั่ง",
      "น้ำหนักสุทธิ",
      "ราคาเฉลี่ย",
      "มูลค่ายาง",
      "ยอดหักเงิน (บาท)",
      "ยอดที่ต้องจ่ายลูกค้า",
    ]);

    const sourceRows = dialog.locator("tbody tr[data-source-id]");
    await expect(sourceRows).toHaveCount(2);
    await expect(sourceRows.nth(0)).toHaveAttribute("data-source-id", ocrTicketId);
    await expect(sourceRows.nth(0)).toContainText(ocrTicketNo);
    await expect(sourceRows.nth(0)).toContainText("OCR");
    await expect(sourceRows.nth(0)).toContainText("40.00");
    await expect(sourceRows.nth(0)).toContainText("฿20.00");
    await expect(sourceRows.nth(0)).toContainText("฿800.00");
    await expect(sourceRows.nth(0)).toContainText("฿50.00");
    await expect(sourceRows.nth(0)).toContainText("฿750.00");
    await expect(sourceRows.nth(1)).toHaveAttribute("data-source-id", rubberBillId);
    await expect(sourceRows.nth(1)).toContainText(rubberBillNo);
    await expect(sourceRows.nth(1)).toContainText("บิลยาง");
    await expect(sourceRows.nth(1)).toContainText("95.00");
    await expect(sourceRows.nth(1)).toContainText("฿13.00");
    await expect(sourceRows.nth(1)).toContainText("฿1,235.00");
    await expect(sourceRows.nth(1)).toContainText("฿35.00");
    await expect(sourceRows.nth(1)).toContainText("฿1,200.00");

    const totalRow = dialog.locator("tfoot tr");
    await expect(totalRow).toContainText("รวม");
    await expect(totalRow).toContainText("135.00");
    await expect(totalRow).toContainText("฿15.07");
    await expect(totalRow).toContainText("฿2,035.00");
    await expect(totalRow).toContainText("฿85.00");
    await expect(totalRow).toContainText("฿1,950.00");
    expect(detailRpcRequests).toHaveLength(1);
    expect(writeRequests).toEqual([]);
    expect(rubberBillsRequestCount).toBe(0);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    const cancelledDetailButton = cancelledRow.getByRole("button", { name: /ดูรายละเอียดต้นทาง 1 รายการ/ });
    await expect(cancelledDetailButton).toBeEnabled();
    await cancelledDetailButton.click();
    const cancelledDialog = page.getByRole("dialog", { name: "รายละเอียดต้นทางรายการโอนเงิน" });
    await expect(cancelledDialog).toContainText(cancelledOcrTicketNo);
    await page.keyboard.press("Escape");
    await expect(cancelledDialog).toBeHidden();

    await page.setViewportSize({ width: 390, height: 844 });
    await detailButton.click();
    const mobileDialog = page.getByRole("dialog", { name: "รายละเอียดต้นทางรายการโอนเงิน" });
    await expect(mobileDialog).toBeVisible();
    const dialogBox = await mobileDialog.boundingBox();
    expect(dialogBox).not.toBeNull();
    expect(dialogBox!.width).toBeLessThanOrEqual(390);
    const scrollArea = mobileDialog.locator('[data-testid="source-details-scroll"]');
    await expect(scrollArea).toHaveJSProperty("scrollLeft", 0);
    const scrollSize = await scrollArea.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(scrollSize.scrollWidth).toBeGreaterThan(scrollSize.clientWidth);
  } finally {
    await service.from("report_items").delete().eq("report_id", reportId);
    await service.from("report_batches").delete().eq("id", reportId);
    await service.from("money_transfer_slips").delete().eq("transfer_id", transferId);
    await service.from("money_transfer_items").delete().in("transfer_id", [transferId, cancelledTransferId]);
    await service.from("money_transfers").delete().in("id", [transferId, emptyTransferId, cancelledTransferId]);
    await service.from("rubber_bill_items").delete().eq("bill_id", rubberBillId);
    await service.from("rubber_bills").delete().eq("id", rubberBillId);
    await service.from("ocr_tickets").delete().in("id", [ocrTicketId, cancelledOcrTicketId]);
  }
});
