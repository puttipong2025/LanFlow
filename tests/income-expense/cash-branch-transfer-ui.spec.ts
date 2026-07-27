import { expect, test } from "@playwright/test";
import { selectAppLocation, selectedAppLocationId } from "../helpers/select-app-location";

test.use({ storageState: "playwright/.auth/super_admin.json" });

async function setOnline(page: import("@playwright/test").Page, online: boolean) {
  await page.context().setOffline(!online);
  await page.evaluate((eventName) => window.dispatchEvent(new Event(eventName)), online ? "online" : "offline");
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(online);
  if (online) await page.waitForTimeout(250);
}

async function openIncomeExpense(page: import("@playwright/test").Page) {
  await page.goto("/");
  const incomeExpenseTab = page.locator('button:has-text("รับ-จ่าย")');
  const phoneInput = page.locator('input[type="tel"]');
  await page.locator('button:has-text("รับ-จ่าย"), input[type="tel"]').first()
    .waitFor({ state: "visible", timeout: 30_000 });
  if (await phoneInput.isVisible()) {
    await page.fill('input[type="tel"]', process.env.TEST_PHONE || "0800000000");
    await page.fill('input[type="password"]', process.env.TEST_PASSWORD || "password123");
    await page.click('button:has-text("เข้าสู่ระบบ")');
  }
  await expect(incomeExpenseTab).toBeVisible({ timeout: 30_000 });
  await incomeExpenseTab.click();
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
  test("system manager can toggle post-receipt delete approval", async ({ page }) => {
    await setOnline(page, true);
    await openIncomeExpense(page);
    await page.getByRole("button", { name: /ตั้งค่าและอนุมัติรับ-จ่าย/ }).click();
    const modal = page.locator(".fixed.inset-0").last();
    const toggle = modal.getByRole("checkbox", {
      name: /ขออนุมัติก่อนลบรายการโยกเงินที่ปลายทางรับแล้ว/,
    });
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await modal.getByRole("button", { name: "บันทึก", exact: true }).click();
    await expect(page.getByText("บันทึกการตั้งค่าอนุมัติแล้ว")).toBeVisible();
    await toggle.check();
    await modal.getByRole("button", { name: "บันทึก", exact: true }).click();
    await expect(toggle).toBeChecked();
    await modal.getByLabel("ปิด", { exact: true }).click();
  });

  test("starts receive counts at zero, finishes with difference, exposes share PDF, and requests post-receipt deletion", async ({ page }) => {
    test.setTimeout(45000);
    await setOnline(page, true);
    await openIncomeExpense(page);
    const sourceLocationId = await selectedAppLocationId(page);
    expect(sourceLocationId).toBeTruthy();
    await page.click('button:has-text("โยกเงินไปสาขาอื่น")');
    const createModal = page.locator(".fixed.inset-0").last();
    const modeSelector = createModal.getByTestId("branch-transfer-mode-selector");
    await expect(modeSelector).toBeVisible();
    await expect(modeSelector.getByRole("button", { name: "เงินสด", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(modeSelector.getByRole("button", { name: "โอนธนาคาร", exact: true })).toHaveAttribute("aria-pressed", "false");
    await expect(modeSelector).not.toHaveClass(/fixed/);
    const modalHeaderBox = await createModal.locator("header").boundingBox();
    const modeSelectorBox = await modeSelector.boundingBox();
    expect(modeSelectorBox!.y).toBeGreaterThanOrEqual(modalHeaderBox!.y + modalHeaderBox!.height - 1);

    await modeSelector.getByRole("button", { name: "โอนธนาคาร", exact: true }).click();
    await expect(createModal.getByText("สร้างรายการโอนเงินใหม่ (ระหว่างสาขา)")).toBeVisible();
    await expect(createModal.getByTestId("branch-transfer-mode-selector")).not.toHaveClass(/fixed/);
    await expect(createModal.getByRole("button", { name: "โอนธนาคาร", exact: true })).toHaveAttribute("aria-pressed", "true");
    await createModal.getByRole("button", { name: "เงินสด", exact: true }).click();
    await expect(createModal.getByText("โยกเงินไปสาขาอื่น (เงินสด)")).toBeVisible();

    const targetSelect = createModal.getByLabel("สาขาปลายทาง");
    const targetLocationId = await targetSelect.locator("option").nth(1).getAttribute("value");
    expect(targetLocationId).toBeTruthy();
    await targetSelect.selectOption(targetLocationId!);
    await expect(createModal.locator("input")).toHaveCount(9);
    for (const input of await createModal.locator("input").all()) await expect(input).toHaveValue("");
    const createBanknote1000Input = createModal.getByLabel("แบงค์ 1,000");
    await createBanknote1000Input.focus();
    await createBanknote1000Input.blur();
    await expect(createBanknote1000Input).toHaveValue("0");
    await fillCashCounts(createModal, "1");
    await createModal.getByLabel("แบงค์ 100", { exact: true }).fill("1");
    await createModal.getByLabel("เหรียญ 2", { exact: true }).fill("1");
    await createModal.getByLabel("เหรียญ 1", { exact: true }).fill("1");
    const marker = `cash-ui-${Date.now()}`;
    await createModal.locator('textarea[placeholder="หมายเหตุ (ไม่บังคับ)"]').fill(marker);
    await createModal.locator('button:has-text("บันทึก")').click();
    await expect(page.getByText("บันทึกรายการเงินสด รอปลายทางรับเงิน")).toBeVisible();

    const list = await page.request.get(`/api/lanflow/cash-branch-transfers?locationId=${await selectedAppLocationId(page)}`);
    const transfer = ((await list.json()).transfers as Array<{ id: string; money_transfer_cash_details: unknown }>).find(
      (item) => cashDetail(item)?.note === marker,
    );
    expect(transfer).toBeTruthy();
    const displayNo = `CASH-${transfer!.id.slice(0, 8)}`;
    const sourceRow = page.locator("table tbody tr", { hasText: displayNo });
    await expect(sourceRow).toBeVisible();
    const shareButton = sourceRow.locator('button[aria-label*="แชร์ PDF รายละเอียดเงินสด"]');
    const deleteButton = sourceRow.locator('button[aria-label="ลบรายการโยกเงิน"]');
    await expect(shareButton).toBeEnabled();
    await expect(shareButton).toHaveClass(/bg-amber/);
    await expect(deleteButton).toHaveClass(/bg-clay/);
    const openSourceButton = sourceRow.locator('button[aria-label="เปิดรายการต้นทาง"]');
    await expect(openSourceButton).toHaveClass(/text-xs/);
    await expect(openSourceButton).toHaveClass(/shrink-0/);
    await openSourceButton.click();
    const pendingDetails = page.locator(".fixed.inset-0").last();
    await expect(pendingDetails.getByText("รอรับเงิน", { exact: true })).toBeVisible();
    await setOnline(page, false);
    await expect(pendingDetails.locator('button:has-text("แก้ไขก่อนตรวจรับ")')).toBeDisabled();
    await expect(pendingDetails.locator('button:has-text("ลบถาวร")')).toHaveCount(0);
    await pendingDetails.locator('button:has-text("ปิด")').last().click();
    await expect(page.locator('button:has-text("โยกเงินใช้ได้เมื่อออนไลน์")')).toBeDisabled();

    await setOnline(page, true);
    await selectAppLocation(page, targetLocationId!);
    await expect(page.locator('button:has-text("รอรับเงิน")')).toBeVisible({ timeout: 10000 });
    await page.locator("section", { hasText: "คิวรอตรวจรับเงินสด" }).locator("button", { hasText: "฿123" }).click();
    const receiptModal = page.locator(".fixed.inset-0").last();
    await expect(receiptModal.locator("input")).toHaveCount(9);
    for (const input of await receiptModal.locator("input").all()) await expect(input).toHaveValue("0");
    const banknote1000Input = receiptModal.getByLabel("แบงค์ 1,000");
    await banknote1000Input.focus();
    await expect(banknote1000Input).toHaveValue("");
    await banknote1000Input.blur();
    await expect(banknote1000Input).toHaveValue("0");
    await fillCashCounts(receiptModal, "0");
    const banknote20Row = receiptModal.locator("tbody tr", { hasText: "แบงค์ 20" });
    await expect(banknote20Row).toContainText("-1");
    await expect(receiptModal.getByText("ผลต่างรวม:")).toContainText("-฿123");
    await setOnline(page, false);
    await expect(receiptModal.locator('button:has-text("ยืนยันรับเงิน")')).toBeDisabled();

    await setOnline(page, true);
    const receiptButton = receiptModal.locator('button:has-text("ยืนยันรับเงิน")');
    await expect(receiptButton).toBeEnabled();
    await expect(receiptButton).toHaveClass(/bg-commit/);
    const [receiptResponse] = await Promise.all([
      page.waitForResponse((response) => response.url().includes("/receive") && response.request().method() === "POST"),
      receiptButton.click(),
    ]);
    expect(receiptResponse.ok(), await receiptResponse.text()).toBeTruthy();
    await expect(page.getByText("ยืนยันรับเงินและบันทึกผลต่างแล้ว")).toBeVisible();
    const receivedRow = page.locator("table tbody tr", { hasText: displayNo });
    await expect(receivedRow).toContainText("รับเงินแล้ว");
    await expect(receivedRow).toContainText("ผลต่าง");
    await receivedRow.locator('button[aria-label="เปิดรายการต้นทาง"]').click();
    const receivedDetails = page.locator(".fixed.inset-0").last();
    await expect(receivedDetails.getByText(/รับเงินแล้ว · ผลต่าง/)).toBeVisible();
    await expect(receivedDetails.locator('button:has-text("ยอมรับผลต่าง")')).toHaveCount(0);
    await expect(receivedDetails.locator('button:has-text("ลบถาวร")')).toHaveCount(0);
    await receivedDetails.locator('button:has-text("ปิด")').last().click();

    await selectAppLocation(page, sourceLocationId!);
    const sourceReceivedRow = page.locator("table tbody tr", { hasText: displayNo });
    await expect(sourceReceivedRow).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    const [deleteResponse] = await Promise.all([
      page.waitForResponse((response) =>
        response.url().includes(`/cash-branch-transfers/${transfer!.id}`)
        && response.request().method() === "DELETE"
      ),
      sourceReceivedRow.locator('button[aria-label="ลบรายการโยกเงิน"]').click(),
    ]);
    const deleteResult = await deleteResponse.json() as { status: string; requestId: string };
    expect(deleteResult.status).toBe("pending_approval");
    await expect(page.getByText("ส่งคำขอลบไปที่ ตั้งค่าและอนุมัติรับ-จ่าย แล้ว")).toBeVisible();
    await page.getByRole("button", { name: /ตั้งค่าและอนุมัติรับ-จ่าย/ }).click();
    const approvalModal = page.locator(".fixed.inset-0").last();
    const deleteRequestRow = approvalModal.locator("tbody tr", { hasText: displayNo });
    await expect(deleteRequestRow).toContainText("ลบถาวรรายการโยกเงิน");
    page.once("dialog", (dialog) => dialog.accept());
    await deleteRequestRow.locator('button[title="อนุมัติการลบ"]').click();
    await expect(page.getByText("อนุมัติและลบรายการแล้ว")).toBeVisible();
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
      await selectAppLocation(targetPage, targetLocationId!);
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
      const deleted = await targetContext.request.delete(`/api/lanflow/cash-branch-transfers/${transfer!.id}`);
      const result = await deleted.json() as { status: string; requestId?: string };
      if (result.requestId) {
        await targetContext.request.post(
          `/api/lanflow/cash-branch-transfers/delete-requests/${result.requestId}/decide`,
          { data: { decision: "approved" } },
        );
      }
    } finally {
      await sourceContext.close();
      await targetContext.close();
    }
  });
});
