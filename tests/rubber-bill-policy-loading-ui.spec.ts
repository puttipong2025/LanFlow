import { expect, test, type Page } from "@playwright/test";

test.use({ storageState: "playwright/.auth/super_admin.json" });

async function openRubberPage(page: Page) {
  const notice = page.getByRole("alertdialog", { name: "แจ้งเตือน", exact: true });
  await page.addLocatorHandler(notice, async () => {
    await notice.getByRole("button", { name: "รับทราบ", exact: true }).click();
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "ออกจากระบบ" })).toBeVisible({ timeout: 30_000 });
  const initialPolicy = page.waitForResponse((response) => response.url().includes("/rubber-bills/approval-settings?"));
  await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
  const policy = await (await initialPolicy).json();
  await expect(page.getByRole("button", { name: "เพิ่มบิลยาง", exact: true })).toBeVisible();
  return policy;
}

async function openBill(page: Page) {
  await page.getByRole("button", { name: "เพิ่มบิลยาง", exact: true }).click();
  const guard = page.getByRole("alertdialog", { name: "ยืนยันสาขาก่อนสร้างรายการ" });
  if (await guard.isVisible()) {
    const branch = await page.getByLabel(/^เลือกสาขา/).locator("span").first().innerText();
    await guard.getByRole("button", { name: `เลือกสาขา ${branch}`, exact: true }).click();
  }
  return page.getByRole("dialog", { name: "บิลเครื่องชั่งเล็ก", exact: true });
}

test("opens and accepts input before policy responds, blocks Enter, retries without losing input, and uses the latest price cap", async ({ page }) => {
  test.setTimeout(90_000);
  const policy = await openRubberPage(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let shouldFail = true;
  await page.route("**/rubber-bills/approval-settings?*", async (route) => {
    if (shouldFail) {
      await pending;
      await route.fulfill({ status: 403, json: { errorMessage: "ทดสอบโหลดไม่สำเร็จ" } });
    } else {
      await route.fulfill({ json: { ...policy, centralPrice: 10, priceAllowance: 0, effectivePriceCap: 10 } });
    }
  });
  let savedRequests = 0;
  await page.route("**/api/lanflow/rubber-bills", (route) => route.abort());
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/lanflow\/(sync|rubber-bills)/.test(request.url())) savedRequests += 1;
  });
  try {
    const modal = await openBill(page);
    await expect(modal).toBeVisible({ timeout: 2000 });
    await expect(modal.getByRole("status")).toContainText("กรอกข้อมูลต่อได้");
    const name = modal.getByLabel("ชื่อลูกค้า", { exact: false });
    await name.fill("ทดสอบฟอร์มไม่รอเครือข่าย");
    await modal.locator("table").first().locator('tbody input[type="number"]').nth(0).fill("10");
    const price = modal.locator("table").first().locator('tbody input[type="number"]').nth(3);
    await price.fill("20");
    await expect(modal.locator('button[type="submit"]')).toBeDisabled();
    await name.press("Enter");
    await modal.locator("form").evaluate((form: HTMLFormElement) => form.requestSubmit());
    expect(savedRequests).toBe(0);
    release();
    await expect(modal.getByRole("button", { name: "ลองใหม่", exact: true })).toBeVisible();
    await expect(modal.locator('button[type="submit"]')).toBeDisabled();
    shouldFail = false;
    await modal.getByRole("button", { name: "ลองใหม่", exact: true }).click();
    await expect(modal.getByRole("button", { name: "ส่งขออนุมัติ", exact: true })).toBeEnabled();
    await expect(name).toHaveValue("ทดสอบฟอร์มไม่รอเครือข่าย");
    await expect(price).toHaveValue(/^20(?:\.0+)?$/);
    await expect(modal.getByText(/ราคาสูงสุด 10.00/)).toBeVisible();
    expect(savedRequests).toBe(0);
  } finally {
    release();
  }
});

test("HTTP 200 with invalid policy keeps saving blocked until a valid retry", async ({ page }) => {
  test.setTimeout(90_000);
  const policy = await openRubberPage(page);
  let valid = false;
  await page.route("**/rubber-bills/approval-settings?*", (route) => route.fulfill({ json: valid ? policy : {} }));
  const modal = await openBill(page);
  await expect(modal).toBeVisible({ timeout: 2000 });
  await expect(modal.getByRole("button", { name: "ลองใหม่", exact: true })).toBeVisible();
  await expect(modal.locator('button[type="submit"]')).toBeDisabled();
  valid = true;
  await modal.getByRole("button", { name: "ลองใหม่", exact: true }).click();
  await expect(modal.locator('button[type="submit"]')).toBeEnabled();
});

test("closing and reopening cannot let an older refresh unlock the new form", async ({ page }) => {
  test.setTimeout(90_000);
  const policy = await openRubberPage(page);
  const releases: Array<() => void> = [];
  await page.route("**/rubber-bills/approval-settings?*", async (route) => {
    await new Promise<void>((resolve) => { releases.push(resolve); });
    await route.fulfill({ json: policy });
  });
  try {
    let modal = await openBill(page);
    await expect(modal).toBeVisible({ timeout: 2000 });
    await expect.poll(() => releases.length).toBe(1);
    await modal.getByRole("button", { name: "ปิด", exact: true }).click();
    await expect(modal).toBeHidden();
    modal = await openBill(page);
    await expect(modal).toBeVisible({ timeout: 2000 });
    // React Query may share the pending request. Either way the reopened form
    // must stay blocked until its own awaited refresh has completed.
    await expect(modal.locator('button[type="submit"]')).toBeDisabled();
    releases[0]();
    if (releases.length > 1) {
      await expect(modal.locator('button[type="submit"]')).toBeDisabled();
      releases[1]();
    }
    await expect(modal.locator('button[type="submit"]')).toBeEnabled();
  } finally {
    releases.forEach((release) => release());
  }
});
