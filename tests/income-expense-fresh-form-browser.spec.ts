import { test, expect, type Page } from "@playwright/test";
import { bangkokDateString } from "../src/lib/bangkok-date";
import { confirmCurrentBranchIfRequired, selectedAppLocationId } from "./helpers/select-app-location";
import { waitForBillIssuer } from "./helpers/wait-bill-issuer";
import { installThresholdAlertHandler } from "./helpers/dismiss-threshold-alert";
import { assertSafeIntegrationTarget } from "./support/integration-target";

async function openIncomeExpense(page: Page) {
  page.setDefaultTimeout(15000); await installThresholdAlertHandler(page);
  await page.goto("/");
  await expect(page.locator('button[data-location-id][aria-controls="location-selector-listbox"]')).toHaveAttribute("data-location-id", /^[0-9a-f-]{36}$/i);
  const branch = await selectedAppLocationId(page); if (!branch) throw new Error("Missing branch");
  await page.getByRole("button", { name: /^รับ-จ่าย/ }).click(); await waitForBillIssuer(page, branch);
  await expect(page.getByRole("status").filter({ hasText: /^พร้อมใช้งานออฟไลน์ 100%$/ })).toBeVisible({ timeout: 60000 });
  return branch;
}
async function queueRows(page: Page) {
  return page.evaluate(() => new Promise<Array<{ id: string; payload: { title: string; localBillNo: string } }>>((resolve, reject) => {
    const request = indexedDB.open("lanflow_sync_db"); request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction("sync_queue"), read = tx.objectStore("sync_queue").getAll();
      tx.oncomplete = () => { db.close(); resolve(read.result); };
    };
  }));
}
test.use({ storageState: "playwright/.auth/super_admin.json" });
test.beforeEach(() => assertSafeIntegrationTarget(process.env.NEXT_PUBLIC_SUPABASE_URL!));

for (const type of ["income", "expense"] as const) test(`new ${type} forms ignore old drafts and reset after close and reload`, async ({ page, context }) => {
  test.setTimeout(90000);
  const me = await (await context.request.get("/api/auth/me")).json(), branch = await openIncomeExpense(page);
  const marker = `FRESH-${crypto.randomUUID().slice(0,8)}`, addName = type === "income" ? "เพิ่มรายรับ" : "เพิ่มรายจ่าย";
  await page.evaluate(({ owner, branch, type, marker }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("lanflow_form_drafts_db");
    request.onupgradeneeded = () => request.result.createObjectStore("form_drafts", { keyPath: "key" });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction("form_drafts", "readwrite");
      tx.objectStore("form_drafts").put({ key: JSON.stringify([owner, branch, type]), ownerUserId: owner, locationId: branch, formType: type,
        data: { txDate: "2026-10-01", billOption: type === "income" ? "รายรับ" : "ค่าใช้จ่าย", lines: [{ id: "legacy", title: marker, cost: 99, unit: 0, price: 0 }] } });
      tx.oncomplete = () => { db.close(); resolve(); };
    };
  }), { owner: me.profile.id, branch, type, marker });
  await context.setOffline(true);
  const modal = page.getByRole("dialog", { name: "เพิ่ม/แก้ไข บิลเงินสด" });
  const open = async () => { await page.getByRole("button", { name: addName, exact: true }).click(); await confirmCurrentBranchIfRequired(page); };
  const blank = async () => {
    await expect(modal.locator("tbody tr")).toHaveCount(1);
    await expect(modal.locator("tbody input").first()).toHaveValue("");
    await expect(modal.locator('input[type="number"]')).toHaveValue("0");
    await expect(modal.getByLabel("วันที่", { exact: true })).toHaveValue(bangkokDateString());
  };
  await open(); await blank();
  await modal.locator("tbody input").first().fill(marker);
  await modal.locator('input[type="number"]').fill("12.34");
  await modal.getByRole("button", { name: "เพิ่มรายการ", exact: true }).click();
  const dialogs: string[] = []; page.on("dialog", async dialog => { dialogs.push(dialog.type()); await dialog.accept(); });
  await modal.getByRole("button", { name: "ยกเลิก", exact: true }).click(); await expect(modal).toBeHidden();
  expect(dialogs).toEqual([]);
  await open(); await blank();
  await modal.locator("tbody input").first().fill(`${marker}-reload`);
  await modal.locator('input[type="number"]').fill("25");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /^รับ-จ่าย/ }).click(); await open(); await blank();
  expect((await queueRows(page)).filter(row => row.payload.title?.startsWith(marker))).toEqual([]);
});

for (const failIndex of [0, 1]) test(`failed create closes the form and preserves ${failIndex} accepted rows`, async ({ page, context }, info) => {
  test.setTimeout(90000); await openIncomeExpense(page); await context.setOffline(true);
  const marker = `FAIL-${crypto.randomUUID().slice(0,8)}`;
  await page.getByRole("button", { name: "เพิ่มรายจ่าย", exact: true }).click(); await confirmCurrentBranchIfRequired(page);
  const modal = page.getByRole("dialog", { name: "เพิ่ม/แก้ไข บิลเงินสด" });
  await modal.getByRole("button", { name: "เพิ่มรายการ", exact: true }).click();
  for (let index = 0; index < 2; index++) {
    const row = modal.locator("tbody tr").nth(index);
    await row.locator("input").first().fill(`${marker}-${index}`); await row.locator('input[type="number"]').fill("10");
  }
  await page.evaluate(title => {
    const add = IDBObjectStore.prototype.add; let failed = false;
    IDBObjectStore.prototype.add = function (...args: Parameters<typeof add>) {
      if (!failed && this.name === "sync_queue" && args[0]?.payload?.title === title) {
        failed = true; throw new DOMException("fixture quota failure", "QuotaExceededError");
      }
      return add.apply(this, args);
    };
  }, `${marker}-${failIndex}`);
  await modal.getByRole("button", { name: "บันทึกบิล", exact: true }).click(); await expect(modal).toBeHidden();
  await expect(page.getByText("พื้นที่บันทึกในเครื่องไม่พอ กรุณาเพิ่มพื้นที่ว่างแล้วลองใหม่", { exact: true })).toBeVisible();
  if (failIndex) await expect(page.getByText("รับไว้แล้ว 1 รายการ รายการที่เหลือไม่ได้บันทึก", { exact: true })).toBeVisible();
  const accepted = (await queueRows(page)).filter(row => row.payload.title?.startsWith(marker)); expect(accepted).toHaveLength(failIndex);
  await page.getByRole("button", { name: "เพิ่มรายจ่าย", exact: true }).click(); await confirmCurrentBranchIfRequired(page);
  await expect(modal.locator("tbody tr")).toHaveCount(1); await expect(modal.locator("tbody input").first()).toHaveValue("");
  await page.setViewportSize({ width: 375, height: 812 }); await modal.screenshot({ path: info.outputPath("fresh-form-after-failure.png") });
  await modal.locator("tbody input").first().fill(`${marker}-new`); await modal.locator('input[type="number"]').fill("20");
  await modal.getByRole("button", { name: "บันทึกบิล", exact: true }).click(); await expect(modal).toBeHidden();
  const after = (await queueRows(page)).filter(row => row.payload.title?.startsWith(marker));
  expect(after).toHaveLength(failIndex + 1);
  if (failIndex) expect(after.find(row => row.id === accepted[0].id)).toEqual(accepted[0]);
});

for (const type of ["income", "expense"] as const) test(`editing ${type} changes only the original record`, async ({ page }) => {
  test.setTimeout(90000); await openIncomeExpense(page);
  const marker = `EDIT-ONE-${crypto.randomUUID().slice(0,8)}`;
  await page.getByRole("button", { name: type === "income" ? "เพิ่มรายรับ" : "เพิ่มรายจ่าย", exact: true }).click(); await confirmCurrentBranchIfRequired(page);
  const modal = page.getByRole("dialog", { name: "เพิ่ม/แก้ไข บิลเงินสด" });
  await modal.locator("tbody input").first().fill(marker); await modal.locator('input[type="number"]').fill("10");
  await modal.getByRole("button", { name: "บันทึกบิล", exact: true }).click(); await expect(modal).toBeHidden();
  const row = page.getByRole("row").filter({ hasText: marker });
  await expect(row).toContainText("ซิงก์แล้ว", { timeout: 30000 });
  const originalNumber = await row.locator("td").nth(2).innerText();
  await row.getByRole("button", { name: "แก้ไข", exact: true }).click();
  await expect(modal.locator("tbody tr")).toHaveCount(1);
  await expect(modal.locator("tbody input").first()).toHaveValue(marker);
  await expect(modal.getByRole("button", { name: "เพิ่มรายการ", exact: true })).toHaveCount(0);
  await modal.locator("tbody input").first().fill(`${marker}-edited`); await modal.locator('input[type="number"]').fill("20");
  await modal.getByRole("button", { name: "บันทึกบิล", exact: true }).click(); await expect(modal).toBeHidden();
  await expect(row).toContainText(`${marker}-edited`, { timeout: 30000 });
  await expect(row).toContainText("ซิงก์แล้ว", { timeout: 30000 });
  await expect(row.locator("td").nth(2)).toHaveText(originalNumber);
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: "ลบ", exact: true }).click();
  await page.getByRole("alertdialog", { name: "ยืนยันลบรายการ" }).getByRole("button", { name: "ส่งคำขอลบ", exact: true }).click();
  await expect(row).toBeHidden({ timeout: 30000 });
});

for (const type of ["income", "expense"] as const) for (const invalidCost of [0, -1]) {
  test(`${type} submission cannot drop a touched line with cost ${invalidCost}`, async ({ page, context }) => {
    test.setTimeout(90000); await openIncomeExpense(page); await context.setOffline(true);
    const marker = `INVALID-LINE-${crypto.randomUUID().slice(0,8)}`;
    await page.getByRole("button", { name: type === "income" ? "เพิ่มรายรับ" : "เพิ่มรายจ่าย", exact: true }).click(); await confirmCurrentBranchIfRequired(page);
    const modal = page.getByRole("dialog", { name: "เพิ่ม/แก้ไข บิลเงินสด" });
    await modal.getByRole("button", { name: "เพิ่มรายการ", exact: true }).click();
    for (const [index, cost] of [10, invalidCost].entries()) {
      const row = modal.locator("tbody tr").nth(index);
      await row.locator("input").first().fill(`${marker}-${index}`); await row.locator('input[type="number"]').fill(String(cost));
    }
    await modal.getByRole("button", { name: "บันทึกบิล", exact: true }).click();
    await expect.soft(modal).toBeVisible();
    expect((await queueRows(page)).filter(row => row.payload.title?.startsWith(marker))).toEqual([]);
    await expect(page.getByText("กรุณากรอกรายการและจำนวนเงินมากกว่า 0 ให้ครบทุกแถวที่ใช้งาน", { exact: true })).toBeVisible();
    await modal.locator("tbody tr").nth(1).locator('input[type="number"]').fill("20");
    await modal.getByRole("button", { name: "บันทึกบิล", exact: true }).click(); await expect(modal).toBeHidden();
    expect((await queueRows(page)).filter(row => row.payload.title?.startsWith(marker)).map(row => row.payload.title)).toEqual([`${marker}-0`, `${marker}-1`]);
  });
}
