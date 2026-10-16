import { expect, test } from "@playwright/test";

for (const previewCase of ["valid", "incomplete", "duplicate"]) {
test(`customer bundle preview ${previewCase === "valid" ? "confirms a selectable destination account" : `blocks ${previewCase} membership`}`, async ({ page }) => {
  test.setTimeout(60_000);
  const customerId = "d3000000-0000-4000-8000-000000000001";
  const singletonId = "d3000000-0000-4000-8000-000000000002";
  const bundleId = "d4000000-0000-4000-8000-000000000001";
  const children = [1, 2].map((n) => ({
    id: `d5000000-0000-4000-8000-00000000000${n}`, customer_id: customerId,
    customer_name: "ลูกค้าชุดทดสอบ", account_number: `old-${n}`,
    net_amount_to_pay: 100, outstanding_amount: 100,
    transfer_status: n === 1 ? "pending" : "partial", transfer_type: "customer",
    created_at: `2026-10-0${n}T00:00:00+00:00`,
  }));
  let confirmations = 0;
  let submitted: Record<string, unknown> | null = null;
  const detail = {
    id: bundleId, customer_id: customerId, customer_name: "ลูกค้าชุดทดสอบ",
    is_payment_bundle: true, revision_no: 0, account_number: "alternate",
    transfer_type: "customer", transfer_status: "pending", net_amount_to_pay: 200,
    money_transfer_slips: [], children, has_more_children: false,
    bundle_summary: { childCount: 2, amountDue: 200 },
  };
  await page.route(/\/rest\/v1\/customers\?/, (route) => route.fulfill({ json: [
    { id: customerId, main_name: "ลูกค้าชุดทดสอบ", customer_bank_accounts: [
      { id: "other", account_number: "alternate", bank_name: "ธนาคารรอง", is_primary: false },
      { id: "main", account_number: "primary", bank_name: "ธนาคารหลัก", is_primary: true },
    ] },
    { id: singletonId, main_name: "ลูกค้ามีรายการเดียว", customer_bank_accounts: [] },
  ] }));
  await page.route("**/rest/v1/rpc/get_payment_bundle_customer_options", (route) => route.fulfill({
    json: [{ customer_id: customerId, eligible_count: 2 }],
  }));
  await page.route("**/rest/v1/rpc/get_payment_bundle_candidates", (route) => {
    const second = Boolean(route.request().postDataJSON().p_cursor_id);
    return route.fulfill({ json: {
      rows: [children[second && previewCase !== "duplicate" ? 1 : 0]], eligibleCount: previewCase === "incomplete" ? 3 : 2, eligibleAmount: 200,
      hasMore: !second, nextCreatedAt: children[0].created_at, nextId: children[0].id,
    } });
  });
  await page.route("**/rest/v1/rpc/create_or_update_payment_bundle", (route) => {
    confirmations += 1;
    submitted = route.request().postDataJSON();
    return route.fulfill({ json: detail });
  });
  await page.route("**/rest/v1/rpc/get_payment_bundle_detail", (route) => route.fulfill({ json: detail }));
  await page.route("**/rest/v1/rpc/get_money_transfer_receipt_source_details", (route) => route.fulfill({ json: {
    items: [{ itemId: "source-row", sourceType: "rubber_bill", sourceId: "source-bill", sourceNumber: "BILL-CHILD-1", netPayableAmount: 100 }],
  } }));

  await page.goto("/login");
  await page.locator("#phone").fill(process.env.TEST_PHONE ?? "0800000000");
  await page.locator("#password").fill(process.env.TEST_PASSWORD ?? "password123");
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await expect(page.getByText("ออกจากระบบ")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /^โอนเงิน/ }).click();
  await expect(page.getByRole("button", { name: "รวมรายการ", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "สร้างชุดจ่ายรวม", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "สร้างชุดจ่ายรวม", exact: true });
  await dialog.getByRole("button", { name: "โอนเงินลูกค้า", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "สร้างชุดรวม", exact: true })).toBeDisabled();
  const customer = dialog.getByRole("combobox", { name: "ลูกค้า", exact: true });
  await expect(customer.locator("option")).toHaveCount(2);
  await customer.selectOption(customerId);
  if (previewCase !== "valid") {
    await expect(dialog.getByRole("alert")).toContainText("รายการที่จะรวมเปลี่ยนแปลง");
    await expect(dialog.getByRole("button", { name: "สร้างชุดรวม", exact: true })).toBeDisabled();
    expect(confirmations).toBe(0);
    return;
  }
  await expect(dialog.getByRole("combobox", { name: "บัญชีรับเงิน", exact: true })).toHaveValue("primary");
  await expect(dialog.getByText(/บัญชีเดิม old-1/)).toBeVisible();
  await expect(dialog.getByText(/บัญชีเดิม old-2/)).toBeVisible();
  expect(confirmations).toBe(0);
  await dialog.getByRole("combobox", { name: "บัญชีรับเงิน", exact: true }).selectOption("alternate");
  await dialog.getByRole("button", { name: "สร้างชุดรวม", exact: true }).click();
  await expect.poll(() => confirmations).toBe(1);
  expect(submitted).toMatchObject({ p_customer_id: customerId, p_account_number: "alternate" });
  const bundleDialog = page.getByRole("dialog", { name: "รายละเอียดชุดจ่ายรวม" });
  await expect(bundleDialog).toBeVisible();
  const copyBalance = bundleDialog.getByRole("button", { name: "คัดลอกยอดคงเหลือ", exact: true });
  await expect(copyBalance).toHaveCount(1);
  await expect(copyBalance.locator("..").locator("strong")).toContainText("200");
  await expect(copyBalance).toHaveText("");
  const add = bundleDialog.getByRole("button", { name: "เพิ่มเอง", exact: true });
  const read = bundleDialog.getByRole("button", { name: "อ่านสลิป", exact: true });
  await expect(add).toBeVisible();
  await expect(read).toBeVisible();
  const addBounds = await add.boundingBox();
  const readBounds = await read.boundingBox();
  expect(addBounds!.x).toBeLessThan(readBounds!.x);
  const eye = bundleDialog.getByRole("button", { name: "ดูบิลรายการลูก 1" });
  const previousUrl = page.url();
  await eye.click();
  const source = page.getByRole("dialog", { name: "รายละเอียดต้นทางรายการโอนเงิน" });
  await expect(source).toBeVisible();
  await expect(source).toContainText("BILL-CHILD-1");
  expect(page.url()).toBe(previousUrl);
  await page.keyboard.press("Escape");
  await expect(source).toBeHidden();
  await expect(bundleDialog).toBeVisible();
  await expect(eye).toBeFocused();
});
}
