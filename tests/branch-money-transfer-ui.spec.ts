import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { bangkokDateString } from "../src/lib/bangkok-date";
import { selectAppLocation } from "./helpers/select-app-location";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

test.use({ storageState: "playwright/.auth/super_admin.json" });

test("creates a branch receipt once, requires detail review, and confirms it once", async ({ page }) => {
  test.skip(!serviceRoleKey, "Supabase service key is required");
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const me = await (await page.request.get("/api/auth/me")).json() as {
    profile: { id: string };
  };
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
    await expect(page.getByRole("button", { name: /รอยืนยันรับ/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(`[data-transfer-id="${transferId}"]`)).toContainText("ให้สาขา");
    expect(saveRequestCount).toBe(1);

    await page.getByRole("button", { name: /^รับ-จ่าย/ }).click();
    const queueItem = page.locator(`[data-transfer-id="${transferId}"]`);
    await expect(queueItem).toContainText("เปิดตรวจ");
    await queueItem.click();
    const receiptDialog = page.getByRole("dialog", { name: "ตรวจสอบและยืนยันรับเงิน" });
    await expect(receiptDialog).toContainText("หลักฐานการโอน (1)");
    await expect(receiptDialog.getByText("ยอดรับไม่ตรง")).toHaveCount(0);
    await expect(receiptDialog.getByRole("button", { name: /ปฏิเสธ/ })).toHaveCount(0);

    let receiveRequestCount = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes(`/api/lanflow/money-transfers/${transferId}/receive`)) {
        receiveRequestCount += 1;
      }
    });
    const expectedAccountingDate = bangkokDateString();
    const receiveResponsePromise = page.waitForResponse((response) => (
      response.request().method() === "POST"
      && response.url().includes(`/api/lanflow/money-transfers/${transferId}/receive`)
    ));
    await receiptDialog.getByRole("button", { name: "ยืนยันรับเงิน" }).dblclick();
    const receiveResponse = await receiveResponsePromise;
    expect(receiveResponse.ok()).toBeTruthy();
    await expect(receiptDialog).toBeHidden();
    await expect(queueItem).toHaveCount(0);
    expect(receiveRequestCount).toBe(1);

    const confirmed = await service.from("money_transfers")
      .select("branch_receipt_status,accounting_date,branch_received_by_user_id")
      .eq("id", transferId)
      .single();
    expect(confirmed.error).toBeNull();
    expect(confirmed.data).toMatchObject({
      branch_receipt_status: "received",
      accounting_date: expectedAccountingDate,
      branch_received_by_user_id: me.profile.id,
    });
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

test("customer transfers keep an explicitly typed recipient when rubber bills change", async ({ page }) => {
  const sourceIds = [crypto.randomUUID(), crypto.randomUUID()];
  let savedPayload: Record<string, any> = {};

  await page.route("**/rest/v1/rpc/get_money_transfer_sources", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        rows: sourceIds.map((sourceId, index) => ({
          sourceType: "rubber_bill",
          sourceId,
          sourceNumber: `RB-FREE-NAME-${index + 1}`,
          sourceDate: "2026-10-11",
          customerName: `ลูกค้าในบิล ${index + 1}`,
          amount: (index + 1) * 100,
          netWeight: 10,
          averagePrice: 10,
          rubberValue: (index + 1) * 100,
          deductedAmount: 0,
          licensePlate: null,
          transferId: null,
          reportLockNo: null,
          available: true,
          blockReason: null,
          createdAt: `2026-10-11T0${index}:00:00.000Z`,
        })),
        hasMore: false,
      }),
    });
  });
  await page.route("**/rest/v1/rpc/save_money_transfer", async (route) => {
    const payload = (route.request().postDataJSON() as { p_payload: Record<string, any> }).p_payload;
    savedPayload = payload;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: payload.id,
        client_temp_id: payload.clientTempId,
        idempotency_key: payload.idempotencyKey,
        location_id: payload.locationId,
        customer_id: payload.customerId,
        customer_name: payload.customerName,
        account_number: payload.accountNumber,
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

  const dialog = page.getByRole("dialog", { name: "สร้างรายการโอนเงินใหม่" });
  const customerName = dialog.getByPlaceholder("พิมพ์หรือค้นหาชื่อลูกค้า...");
  await dialog.getByRole("button", { name: "เลือกบิลยาง / ใบชั่ง" }).click();
  await dialog.getByRole("checkbox", { name: "เลือก RB-FREE-NAME-1" })
    .evaluate((checkbox: HTMLInputElement) => checkbox.click());
  await expect(customerName).toHaveValue("ลูกค้าในบิล 1");

  await customerName.fill("ผู้รับเงินจริงที่ไม่ตรงกับบิล");
  await expect(dialog.getByText("ไม่พบในทะเบียน — ใช้ชื่อที่พิมพ์ได้")).toBeVisible();
  await dialog.getByRole("checkbox", { name: "เลือก RB-FREE-NAME-2" })
    .evaluate((checkbox: HTMLInputElement) => checkbox.click());
  await expect(customerName).toHaveValue("ผู้รับเงินจริงที่ไม่ตรงกับบิล");

  await dialog.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect.poll(() => savedPayload.customerName).toBe("ผู้รับเงินจริงที่ไม่ตรงกับบิล");
  expect(savedPayload).toMatchObject({
    customerId: null,
    customerName: "ผู้รับเงินจริงที่ไม่ตรงกับบิล",
    netAmountToPay: 300,
  });
  expect((savedPayload.items as Array<{ customerName: string }>).map((item) => item.customerName))
    .toEqual(["ลูกค้าในบิล 1", "ลูกค้าในบิล 2"]);
});

test("editing a slip does not undo the branch-pays-remaining choice", async ({ page }) => {
  const sourceId = crypto.randomUUID();
  await page.route("**/rest/v1/rpc/get_money_transfer_sources", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        rows: [{
          sourceType: "rubber_bill",
          sourceId,
          sourceNumber: "RB-BRANCH-REMAINDER",
          sourceDate: "2026-10-11",
          customerName: "ลูกค้าทดสอบส่วนต่าง",
          amount: 100,
          netWeight: 10,
          averagePrice: 10,
          rubberValue: 100,
          deductedAmount: 0,
          licensePlate: null,
          transferId: null,
          reportLockNo: null,
          available: true,
          blockReason: null,
          createdAt: "2026-10-11T01:00:00.000Z",
        }],
        hasMore: false,
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /^โอนเงิน(?:\s|$)/ }).click();
  await page.getByRole("button", { name: "สร้างรายการโอน" }).click();
  await page.getByRole("button", { name: /โอนให้ลูกค้า/ }).click();

  const dialog = page.getByRole("dialog", { name: "สร้างรายการโอนเงินใหม่" });
  await dialog.getByRole("button", { name: "เลือกบิลยาง / ใบชั่ง" }).click();
  await dialog.getByRole("checkbox", { name: "เลือก RB-BRANCH-REMAINDER" })
    .evaluate((checkbox: HTMLInputElement) => checkbox.click());
  await dialog.getByRole("button", { name: "เพิ่มเอง" }).click();
  const amount = dialog.getByRole("spinbutton", { name: "จำนวนเงินสลิป 1" });
  await amount.fill("40");
  await dialog.getByRole("button", { name: "สาขาจ่ายส่วนต่าง" }).click();
  await expect(dialog.getByText(/โอน\+สาขาจ่าย/)).toBeVisible();

  await amount.fill("50");
  await expect(dialog.getByText(/โอน\+สาขาจ่าย/)).toBeVisible();
});

test("a bill customer name is only a recipient default until a suggestion is selected", async ({ page }) => {
  const sourceId = crypto.randomUUID();
  let sourceCustomerName = "";
  let savedPayload: Record<string, any> = {};

  await page.route("**/rest/v1/rpc/get_money_transfer_sources", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        rows: [{
          sourceType: "rubber_bill",
          sourceId,
          sourceNumber: "RB-DEFAULT-ONLY",
          sourceDate: "2026-10-11",
          customerName: sourceCustomerName,
          amount: 100,
          netWeight: 10,
          averagePrice: 10,
          rubberValue: 100,
          deductedAmount: 0,
          licensePlate: null,
          transferId: null,
          reportLockNo: null,
          available: true,
          blockReason: null,
          createdAt: "2026-10-11T01:00:00.000Z",
        }],
        hasMore: false,
      }),
    });
  });
  await page.route("**/rest/v1/rpc/save_money_transfer", async (route) => {
    savedPayload = (route.request().postDataJSON() as { p_payload: Record<string, any> }).p_payload;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: savedPayload.id,
        client_temp_id: savedPayload.clientTempId,
        idempotency_key: savedPayload.idempotencyKey,
        location_id: savedPayload.locationId,
        customer_id: savedPayload.customerId,
        customer_name: savedPayload.customerName,
        account_number: savedPayload.accountNumber,
        transfer_type: "customer",
        transfer_status: savedPayload.transferStatus,
        net_amount_to_pay: savedPayload.netAmountToPay,
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
  await page.getByRole("button", { name: /โอนให้ลูกค้า/ }).click();
  const dialog = page.getByRole("dialog", { name: "สร้างรายการโอนเงินใหม่" });
  const customerName = dialog.getByPlaceholder("พิมพ์หรือค้นหาชื่อลูกค้า...");
  await customerName.click();
  sourceCustomerName = (await customerName.locator("..").getByRole("button").first().innerText()).trim();
  await dialog.getByRole("button", { name: "เลือกบิลยาง / ใบชั่ง" }).click();
  await dialog.getByRole("checkbox", { name: "เลือก RB-DEFAULT-ONLY" })
    .evaluate((checkbox: HTMLInputElement) => checkbox.click());
  await expect(customerName).toHaveValue(sourceCustomerName);

  await dialog.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect.poll(() => savedPayload.customerName).toBe(sourceCustomerName);
  expect(savedPayload).toMatchObject({ customerId: null, accountNumber: null });
});

test("editing a free-form recipient does not silently link a same-named customer", async ({ page }) => {
  const transferId = crypto.randomUUID();
  const savedPayloads: Array<Record<string, any>> = [];
  const toRow = (payload: Record<string, any>) => ({
    id: transferId,
    client_temp_id: payload.clientTempId,
    idempotency_key: payload.idempotencyKey,
    location_id: payload.locationId,
    customer_id: null,
    customer_name: payload.customerName,
    account_number: null,
    account_name: null,
    bank_name: null,
    net_amount_to_pay: payload.netAmountToPay,
    transfer_type: "customer",
    transfer_status: payload.transferStatus,
    revision_no: savedPayloads.length > 1 ? 1 : 0,
    record_status: "active",
    sync_status: "synced",
    report_lock_no: null,
    money_transfer_slips: (payload.slips as Array<Record<string, any>>).map((slip) => ({
      id: slip.id,
      input_method: slip.inputMethod,
      amount: slip.amount,
      reference_number: slip.referenceNumber,
      fee: slip.fee,
      sender_name: slip.senderName,
      receiver_name: slip.receiverName,
      transaction_date: slip.transactionDate,
      slip_image_url: slip.slipImageUrl,
      sort_order: slip.sortOrder,
    })),
    money_transfer_items: [],
  });

  await page.route("**/rest/v1/rpc/get_money_transfer_list", async (route) => {
    const row = savedPayloads[0] ? toRow(savedPayloads[0]) : null;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        rows: row ? [row] : [],
        statusCounts: { pending: row ? 1 : 0 },
        hasMore: false,
      }),
    });
  });
  await page.route("**/rest/v1/rpc/get_money_transfer_detail", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(toRow(savedPayloads[0])),
    });
  });
  await page.route("**/rest/v1/rpc/save_money_transfer", async (route) => {
    const payload = (route.request().postDataJSON() as { p_payload: Record<string, any> }).p_payload;
    savedPayloads.push(payload);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(toRow(payload)),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /^โอนเงิน(?:\s|$)/ }).click();
  await page.getByRole("button", { name: "สร้างรายการโอน" }).click();
  await page.getByRole("button", { name: /โอนให้ลูกค้า/ }).click();

  const createDialog = page.getByRole("dialog", { name: "สร้างรายการโอนเงินใหม่" });
  const customerName = createDialog.getByPlaceholder("พิมพ์หรือค้นหาชื่อลูกค้า...");
  await customerName.click();
  const registeredName = (await customerName.locator("..").getByRole("button").first().innerText()).trim();
  await customerName.fill(registeredName);
  await createDialog.getByRole("button", { name: "เพิ่มเอง" }).click();
  await createDialog.getByRole("spinbutton", { name: "จำนวนเงินสลิป 1" }).fill("100");
  await createDialog.locator('input[type="datetime-local"]').fill("2026-10-11T10:30");
  await createDialog.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect.poll(() => savedPayloads.length).toBe(1);
  expect(savedPayloads[0]).toMatchObject({ customerId: null, customerName: registeredName });

  const transferRow = page.locator(`[data-transfer-id="${transferId}"]`);
  await expect(transferRow).toContainText(registeredName);
  await transferRow.getByRole("button", { name: "แก้" }).click();
  const editDialog = page.getByRole("dialog", { name: "แก้ไขรายการโอนเงิน" });
  await expect(editDialog.getByPlaceholder("พิมพ์หรือค้นหาชื่อลูกค้า...")).toHaveValue(registeredName);
  await editDialog.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect.poll(() => savedPayloads.length).toBe(2);
  expect(savedPayloads[1]).toMatchObject({ customerId: null, customerName: registeredName });
});

test("editing preserves linked identity and its stored account when customer master data arrives late", async ({ page }) => {
  const transferId = crypto.randomUUID();
  const customerId = crypto.randomUUID();
  const accountNumber = "1234567890";
  const currentMasterAccountNumber = "9999999999";
  const savedPayloads: Array<Record<string, any>> = [];
  let releaseCustomers = () => {};
  let customerRequestStarted = false;
  const customerGate = new Promise<void>((resolve) => {
    releaseCustomers = resolve;
  });
  const detailRow = {
    id: transferId,
    client_temp_id: "late-customer-transfer",
    idempotency_key: "late-customer-transfer-20261011",
    location_id: "00000000-0000-4000-8000-000000000102",
    customer_id: customerId,
    customer_name: "ลูกค้ามาช้า",
    account_number: accountNumber,
    account_name: "ลูกค้ามาช้า",
    bank_name: "ธนาคารทดสอบ",
    net_amount_to_pay: 0,
    transfer_type: "customer",
    transfer_status: "advance_payment",
    revision_no: 0,
    record_status: "active",
    sync_status: "synced",
    report_lock_no: null,
    money_transfer_slips: [{
      id: crypto.randomUUID(),
      input_method: "manual",
      amount: 100,
      reference_number: null,
      fee: 0,
      sender_name: null,
      receiver_name: null,
      transaction_date: "2026-10-11T03:30:00.000Z",
      slip_image_url: null,
      sort_order: 0,
    }],
    money_transfer_items: [],
  };

  await page.route("**/rest/v1/customers*", async (route) => {
    customerRequestStarted = true;
    await customerGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{
        id: customerId,
        client_temp_id: "late-customer",
        main_name: "ลูกค้ามาช้า",
        record_status: "active",
        sync_status: "synced",
        customer_contacts: [],
        customer_farms: [],
        customer_bank_accounts: [{
          id: crypto.randomUUID(),
          bank_name: "ธนาคารทะเบียนใหม่",
          account_name: "ชื่อบัญชีทะเบียนใหม่",
          account_number: accountNumber,
          is_primary: false,
        }, {
          id: crypto.randomUUID(),
          bank_name: "ธนาคารทดสอบ",
          account_name: "ลูกค้ามาช้า",
          account_number: currentMasterAccountNumber,
          is_primary: true,
        }],
      }]),
    });
  });
  await page.route("**/rest/v1/rpc/get_money_transfer_list", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ rows: [detailRow], statusCounts: { advance_payment: 1 }, hasMore: false }),
    });
  });
  await page.route("**/rest/v1/rpc/get_money_transfer_detail", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(detailRow) });
  });
  await page.route("**/rest/v1/rpc/save_money_transfer", async (route) => {
    const payload = (route.request().postDataJSON() as { p_payload: Record<string, any> }).p_payload;
    savedPayloads.push(payload);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(detailRow) });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /^โอนเงิน(?:\s|$)/ }).click();
  await expect.poll(() => customerRequestStarted).toBe(true);
  const transferRow = page.locator(`[data-transfer-id="${transferId}"]`);
  await expect(transferRow).toContainText("ลูกค้ามาช้า");
  await transferRow.getByRole("button", { name: "แก้" }).click();
  const editDialog = page.getByRole("dialog", { name: "แก้ไขรายการโอนเงิน" });
  await expect(editDialog.getByPlaceholder("พิมพ์หรือค้นหาชื่อลูกค้า...")).toHaveValue("ลูกค้ามาช้า");

  releaseCustomers();
  const accountOptions = editDialog.locator("select option");
  await expect(accountOptions).toHaveCount(2);
  expect((await accountOptions.allTextContents()).filter((label) => label.includes("[หลัก]"))).toHaveLength(1);
  await editDialog.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect.poll(() => savedPayloads.length).toBe(1);
  expect(savedPayloads[0]).toMatchObject({
    customerId,
    customerName: "ลูกค้ามาช้า",
    accountNumber,
    accountName: "ลูกค้ามาช้า",
    bankName: "ธนาคารทดสอบ",
  });

  await transferRow.getByRole("button", { name: "แก้" }).click();
  const secondEditDialog = page.getByRole("dialog", { name: "แก้ไขรายการโอนเงิน" });
  await secondEditDialog.locator("select").selectOption(currentMasterAccountNumber);
  await secondEditDialog.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect.poll(() => savedPayloads.length).toBe(2);
  expect(savedPayloads[1]).toMatchObject({
    customerId,
    accountNumber: currentMasterAccountNumber,
    accountName: "ลูกค้ามาช้า",
    bankName: "ธนาคารทดสอบ",
  });
});

test("editing a linked transfer without an account does not add the current primary account", async ({ page }) => {
  const transferId = crypto.randomUUID();
  const customerId = crypto.randomUUID();
  let savedPayload: Record<string, any> = {};
  const detailRow = {
    id: transferId,
    client_temp_id: "linked-without-account",
    idempotency_key: "linked-without-account-20261011",
    location_id: "00000000-0000-4000-8000-000000000102",
    customer_id: customerId,
    customer_name: "ลูกค้าไม่มีบัญชีเดิม",
    account_number: null,
    account_name: null,
    bank_name: null,
    net_amount_to_pay: 0,
    transfer_type: "customer",
    transfer_status: "advance_payment",
    revision_no: 0,
    record_status: "active",
    sync_status: "synced",
    report_lock_no: null,
    money_transfer_slips: [{
      id: crypto.randomUUID(),
      input_method: "manual",
      amount: 100,
      reference_number: null,
      fee: 0,
      sender_name: null,
      receiver_name: null,
      transaction_date: "2026-10-11T03:30:00.000Z",
      slip_image_url: null,
      sort_order: 0,
    }],
    money_transfer_items: [],
  };

  await page.route("**/rest/v1/customers*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{
        id: customerId,
        client_temp_id: "customer-with-new-primary",
        main_name: "ลูกค้าไม่มีบัญชีเดิม",
        record_status: "active",
        sync_status: "synced",
        customer_contacts: [],
        customer_farms: [],
        customer_bank_accounts: [{
          id: crypto.randomUUID(),
          bank_name: "ธนาคารใหม่",
          account_name: "บัญชีหลักใหม่",
          account_number: "5555555555",
          is_primary: true,
        }],
      }]),
    });
  });
  await page.route("**/rest/v1/rpc/get_money_transfer_list", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ rows: [detailRow], statusCounts: { advance_payment: 1 }, hasMore: false }),
    });
  });
  await page.route("**/rest/v1/rpc/get_money_transfer_detail", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(detailRow) });
  });
  await page.route("**/rest/v1/rpc/save_money_transfer", async (route) => {
    savedPayload = (route.request().postDataJSON() as { p_payload: Record<string, any> }).p_payload;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(detailRow) });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /^โอนเงิน(?:\s|$)/ }).click();
  const transferRow = page.locator(`[data-transfer-id="${transferId}"]`);
  await transferRow.getByRole("button", { name: "แก้" }).click();
  const editDialog = page.getByRole("dialog", { name: "แก้ไขรายการโอนเงิน" });
  const accountSelect = editDialog.locator("select");
  await expect(accountSelect).toHaveValue("");
  await editDialog.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect.poll(() => savedPayload.customerId).toBe(customerId);
  expect(savedPayload).toMatchObject({
    accountNumber: null,
    accountName: null,
    bankName: null,
  });

  savedPayload = {};
  await transferRow.getByRole("button", { name: "แก้" }).click();
  const secondEditDialog = page.getByRole("dialog", { name: "แก้ไขรายการโอนเงิน" });
  await secondEditDialog.locator("select").selectOption("5555555555");
  await secondEditDialog.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect.poll(() => savedPayload.accountNumber).toBe("5555555555");
  expect(savedPayload).toMatchObject({
    accountName: "บัญชีหลักใหม่",
    bankName: "ธนาคารใหม่",
  });
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
    p_payload: { receiptContractVersion: number; slips: Array<{ sortOrder: number }> };
  };
  expect(payload.p_payload.receiptContractVersion).toBe(1);
  expect(payload.p_payload.slips.map((slip) => slip.sortOrder)).toEqual([0, 1]);
});

test("customer and transport saves are single-flight and keep every modal close-guarded", async ({ page }) => {
  let saveRequestCount = 0;
  let customerSavePayload: Record<string, any> = {};
  const releases: Array<() => void> = [];
  await page.route("**/rest/v1/rpc/save_money_transfer", async (route) => {
    saveRequestCount += 1;
    await new Promise<void>((resolve) => releases.push(resolve));
    const payload = (route.request().postDataJSON() as { p_payload: Record<string, any> }).p_payload;
    if (payload.transferType === "customer") customerSavePayload = payload;
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
  const customerSearch = customerDialog.getByPlaceholder("พิมพ์หรือค้นหาชื่อลูกค้า...");
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
  expect(customerSavePayload.customerId).toEqual(expect.any(String));
  expect(customerSavePayload.accountNumber).toEqual(expect.any(String));

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

test("legacy branch rows open read-only and cannot be deleted regardless of target shape", async ({ page }) => {
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
  const sameTargetTransferId = crypto.randomUUID();

  try {
    const inserted = await service.from("money_transfers").insert([
      {
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
      },
      {
        id: sameTargetTransferId,
        client_temp_id: sameTargetTransferId,
        idempotency_key: `legacy-read-only:${sameTargetTransferId}`,
        location_id: sourceLocationId,
        target_location_id: sourceLocationId,
        target_location_name: "Legacy Same Target",
        net_amount_to_pay: 78,
        branch_paid_amount: 0,
        transfer_type: "branch",
        transfer_status: "paid",
        sync_status: "synced",
        record_status: "active",
        created_by_user_id: me.profile.id,
        created_by_name: me.profile.name,
        created_by_phone: me.profile.phone,
      },
    ]);
    expect(inserted.error).toBeNull();

    await page.goto("/");
    await selectAppLocation(page, sourceLocationId);
    await page.getByRole("button", { name: /^โอนเงิน/ }).click();
    await page.getByRole("button", { name: /^ทั้งหมด/ }).click();
    for (const id of [transferId, sameTargetTransferId]) {
      const row = page.locator(`[data-transfer-id="${id}"]`);
      await expect(row).toBeVisible();
      await expect(row.getByRole("button", { name: "ลบ" })).toBeDisabled();
      await row.getByRole("button", { name: "ดู", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "รายละเอียดรายการโอนระหว่างสาขารุ่นเดิม" });
      await expect(dialog).toContainText("ข้อมูลอ่านอย่างเดียว");
      await expect(dialog).toContainText("เปิดดูได้แต่แก้ไขหรือลบไม่ได้");
      await dialog.getByRole("button", { name: "ปิด" }).click();

      await row.getByRole("button", { name: /เปิดรายละเอียดการโอนให้สาขา/ }).click();
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "ปิด" }).click();
    }
  } finally {
    await service.from("money_transfers").delete().in("id", [transferId, sameTargetTransferId]);
    if (createdTargetLocationId) await service.from("locations").delete().eq("id", createdTargetLocationId);
  }
});
