import { expect, test } from "@playwright/test";

test.use({ storageState: "playwright/.auth/super_admin.json" });

async function setOnline(page: import("@playwright/test").Page, online: boolean) {
  await page.context().setOffline(!online);
  await page.evaluate((eventName) => window.dispatchEvent(new Event(eventName)), online ? "online" : "offline");
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(online);
  if (online) await page.waitForTimeout(250);
}

async function openIncomeExpense(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.click('button:has-text("รับ-จ่าย")');
  await expect(page.locator('button:has-text("โยกเงินไปสาขาอื่น")')).toBeVisible({ timeout: 10000 });
}

async function fillCashCounts(modal: import("@playwright/test").Locator, banknote20: string) {
  for (const input of await modal.locator("input").all()) await input.fill("0");
  await modal.getByLabel("แบงค์ 20").fill(banknote20);
}

function cashDetail(transfer: { money_transfer_cash_details: unknown }) {
  return (Array.isArray(transfer.money_transfer_cash_details)
    ? transfer.money_transfer_cash_details[0]
    : transfer.money_transfer_cash_details) as { note?: string };
}

test.describe.serial("Cash branch transfer UI @cash-transfer-ui", () => {
  test("starts counts blank, shows per-kind differences, locks actions offline, accepts mismatch, and hard deletes", async ({ page }) => {
    await setOnline(page, true);
    await openIncomeExpense(page);
    await page.click('button:has-text("โยกเงินไปสาขาอื่น")');
    const createModal = page.locator(".fixed.inset-0").last();
    const targetSelect = createModal.getByLabel("สาขาปลายทาง");
    const targetLocationId = await targetSelect.locator("option").nth(1).getAttribute("value");
    expect(targetLocationId).toBeTruthy();
    await targetSelect.selectOption(targetLocationId!);
    await expect(createModal.locator("input")).toHaveCount(9);
    for (const input of await createModal.locator("input").all()) await expect(input).toHaveValue("");
    await fillCashCounts(createModal, "1");
    await createModal.getByLabel("แบงค์ 100", { exact: true }).fill("1");
    await createModal.getByLabel("เหรียญ 2", { exact: true }).fill("1");
    await createModal.getByLabel("เหรียญ 1", { exact: true }).fill("1");
    const marker = `cash-ui-${Date.now()}`;
    await createModal.locator('textarea[placeholder="หมายเหตุ (ไม่บังคับ)"]').fill(marker);
    await createModal.locator('button:has-text("บันทึก")').click();
    await expect(page.getByText("บันทึกรายการเงินสด รอปลายทางรับเงิน")).toBeVisible();

    const list = await page.request.get(`/api/lanflow/cash-branch-transfers?locationId=${await page.locator('select[aria-label="เลือกสาขา"]').first().inputValue()}`);
    const transfer = ((await list.json()).transfers as Array<{ id: string; money_transfer_cash_details: unknown }>).find(
      (item) => cashDetail(item)?.note === marker,
    );
    expect(transfer).toBeTruthy();
    const displayNo = `CASH-${transfer!.id.slice(0, 8)}`;
    const sourceRow = page.locator("table tbody tr", { hasText: displayNo });
    await expect(sourceRow).toBeVisible();
    await sourceRow.locator('button[aria-label="เปิดรายการต้นทาง"]').click();
    const pendingDetails = page.locator(".fixed.inset-0").last();
    await expect(pendingDetails.getByText("รอรับเงิน", { exact: true })).toBeVisible();
    await setOnline(page, false);
    await expect(pendingDetails.locator('button:has-text("แก้ไขก่อนตรวจรับ")')).toBeDisabled();
    await expect(pendingDetails.locator('button:has-text("ลบถาวร")')).toBeDisabled();
    await pendingDetails.locator('button:has-text("ปิด")').last().click();
    await expect(page.locator('button:has-text("โยกเงินใช้ได้เมื่อออนไลน์")')).toBeDisabled();

    await setOnline(page, true);
    await page.locator('select[aria-label="เลือกสาขา"]').first().selectOption(targetLocationId!);
    await expect(page.locator('button:has-text("รอรับเงิน")')).toBeVisible({ timeout: 10000 });
    await page.locator("section", { hasText: "คิวรอตรวจรับเงินสด" }).locator("button", { hasText: "฿123" }).click();
    const receiptModal = page.locator(".fixed.inset-0").last();
    await expect(receiptModal.locator("input")).toHaveCount(9);
    for (const input of await receiptModal.locator("input").all()) await expect(input).toHaveValue("");
    await fillCashCounts(receiptModal, "0");
    const banknote20Row = receiptModal.locator("tbody tr", { hasText: "แบงค์ 20" });
    await expect(banknote20Row).toContainText("-1");
    await expect(receiptModal.getByText("ผลต่างรวม:")).toContainText("-฿123");
    await setOnline(page, false);
    await expect(receiptModal.locator('button:has-text("ยืนยันรับเงิน")')).toBeDisabled();

    await setOnline(page, true);
    const receiptButton = receiptModal.locator('button:has-text("ยืนยันรับเงิน")');
    await expect(receiptButton).toBeEnabled();
    const [receiptResponse] = await Promise.all([
      page.waitForResponse((response) => response.url().includes("/receive") && response.request().method() === "POST"),
      receiptButton.click(),
    ]);
    expect(receiptResponse.ok(), await receiptResponse.text()).toBeTruthy();
    await expect(page.getByText("บันทึกยอดไม่ตรงแล้ว")).toBeVisible();
    const mismatchRow = page.locator("table tbody tr", { hasText: displayNo });
    await expect(mismatchRow).toBeVisible();
    await mismatchRow.locator('button[aria-label="เปิดรายการต้นทาง"]').click();
    const mismatchDetails = page.locator(".fixed.inset-0").last();
    await setOnline(page, false);
    await expect(mismatchDetails.locator('button:has-text("ยอมรับผลต่าง")')).toBeDisabled();
    await expect(mismatchDetails.locator('button:has-text("ลบถาวร")')).toBeDisabled();

    await setOnline(page, true);
    await mismatchDetails.locator('textarea[placeholder="เหตุผลยอมรับผลต่าง"]').fill("ตรวจนับและยอมรับผลต่าง");
    await mismatchDetails.locator('button:has-text("ยอมรับผลต่าง")').click();
    await expect(page.locator("table tbody tr", { hasText: displayNo })).toContainText("ยอมรับผลต่าง");
    const acceptedRow = page.locator("table tbody tr", { hasText: displayNo });
    await acceptedRow.locator('button[aria-label="เปิดรายการต้นทาง"]').click();
    const acceptedDetails = page.locator(".fixed.inset-0").last();
    page.once("dialog", (dialog) => dialog.accept());
    await acceptedDetails.locator('button:has-text("ลบถาวร")').click();
    await expect(page.locator("table tbody tr", { hasText: displayNo })).toBeHidden();
  });

  test("queue badge auto-refreshes while the destination module remains open", async ({ browser }) => {
    test.setTimeout(45000);
    const sourceContext = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
    const targetContext = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
    try {
      const sourcePage = await sourceContext.newPage();
      const targetPage = await targetContext.newPage();
      await openIncomeExpense(sourcePage);
      await openIncomeExpense(targetPage);

      await sourcePage.click('button:has-text("โยกเงินไปสาขาอื่น")');
      const createModal = sourcePage.locator(".fixed.inset-0").last();
      const targetSelect = createModal.getByLabel("สาขาปลายทาง");
      const targetLocationId = await targetSelect.locator("option").nth(1).getAttribute("value");
      await targetSelect.selectOption(targetLocationId!);
      await targetPage.locator('select[aria-label="เลือกสาขา"]').first().selectOption(targetLocationId!);
      const marker = `cash-refresh-${Date.now()}`;
      await createModal.locator('textarea[placeholder="หมายเหตุ (ไม่บังคับ)"]').fill(marker);
      await fillCashCounts(createModal, "0");
      await createModal.getByLabel("แบงค์ 500", { exact: true }).fill("1");
      await createModal.getByLabel("แบงค์ 100", { exact: true }).fill("2");
      await createModal.getByLabel("แบงค์ 50", { exact: true }).fill("1");
      await createModal.getByLabel("แบงค์ 20", { exact: true }).fill("1");
      await createModal.getByLabel("เหรียญ 5", { exact: true }).fill("1");
      await createModal.getByLabel("เหรียญ 2", { exact: true }).fill("1");
      await expect(targetPage.locator("section", { hasText: "คิวรอตรวจรับเงินสด" }).locator("button", { hasText: "฿777" })).toBeHidden();
      await createModal.locator('button:has-text("บันทึก")').click();
      await expect(targetPage.locator("section", { hasText: "คิวรอตรวจรับเงินสด" }).locator("button", { hasText: "฿777" })).toBeVisible({ timeout: 20000 });

      const list = await targetContext.request.get(`/api/lanflow/cash-branch-transfers?locationId=${targetLocationId}`);
      const transfer = ((await list.json()).transfers as Array<{ id: string; money_transfer_cash_details: unknown }>).find(
        (item) => cashDetail(item)?.note === marker,
      );
      await targetContext.request.delete(`/api/lanflow/cash-branch-transfers/${transfer!.id}`);
    } finally {
      await sourceContext.close();
      await targetContext.close();
    }
  });
});
