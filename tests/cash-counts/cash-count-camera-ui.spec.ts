import { expect, test } from "@playwright/test";
import { dismissRubberWeightAlertIfVisible } from "../helpers/dismiss-threshold-alert";

test.use({ storageState: "playwright/.auth/super_admin.json", permissions: ["camera"],
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });

test("ambiguous camera OCR blocks saving; every retake requires fresh confirmation", async ({ page }) => {
  let reads = 0;
  await page.route("**/api/lanflow/cash-counts/session?*", (route) => route.fulfill({ json: { session: {
    id: "camera-session", isOwner: true, cutoffAt: new Date().toISOString(), expiresAt: "2099-10-24T10:30:00Z", systemBalance: 1000,
  } } }));
  await page.route(/\/api\/lanflow\/cash-counts\?.*$/, (route) => route.fulfill({ json: { counts: [] } }));
  await page.route("**/api/lanflow/cash-counts/ocr", (route) => {
    reads++;
    return route.fulfill(reads === 1 ? { status: 422, json: { error: "ยอดไม่แน่ชัด กรุณาถ่ายใหม่" } }
      : { json: { evidenceId: `evidence-${reads}`, amount: 123.45 } });
  });
  await page.goto("/"); await dismissRubberWeightAlertIfVisible(page);
  await page.getByRole("button", { name: "นับเงิน", exact: true }).click();
  const save = page.getByRole("button", { name: "ยืนยันและส่งผล", exact: true });
  async function shoot(label: string) {
    await page.getByRole("button", { name: label, exact: true }).click();
    const modal = page.getByRole("dialog", { name: "ถ่ายยอดบัญชี", exact: true });
    await expect.poll(() => modal.locator("video").evaluate((el) => (el as HTMLVideoElement).videoWidth)).toBeGreaterThan(0);
    await modal.getByRole("button", { name: "ถ่ายรูป", exact: true }).click();
  }
  await page.getByRole("button", { name: "เพิ่มบัญชี", exact: true }).click();
  await expect(page.getByRole("button", { name: "ลบบัญชี1", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "ลบบัญชี1", exact: true })).toHaveClass(/bg-clay/);
  await expect(page.getByRole("button", { name: "ถ่ายยอดบัญชี", exact: true })).toHaveClass(/bg-river/);
  await shoot("ถ่ายยอดบัญชี");
  await expect(page.getByRole("alert").filter({ hasText: "ยอดไม่แน่ชัด" })).toBeVisible();
  await expect(save).toBeDisabled();
  await shoot("ถ่ายใหม่");
  const confirmation = page.getByRole("checkbox", { name: "ยอดตรงกับรูป", exact: true });
  await expect(confirmation).not.toBeChecked(); await expect(save).toBeDisabled();
  await confirmation.check(); await expect(save).toBeEnabled();
  await shoot("ถ่ายใหม่");
  await expect(confirmation).not.toBeChecked(); await expect(save).toBeDisabled();
  await page.getByRole("button", { name: "ลบบัญชี1", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "ยกเลิก", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^บัญชี1 =/ })).toBeVisible();
  await page.getByRole("button", { name: "ลบบัญชี1", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "ลบ", exact: true }).click();
  await expect(save).toBeEnabled(); await expect(confirmation).toHaveCount(0);
  expect(reads).toBe(3);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(page.getByLabel("เหตุผล", { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: test.info().outputPath("cash-count-camera-mobile.png"), fullPage: true });
});

test("count alerts share the existing dialog and acknowledge closes all pages", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("lanflow:rubber-weight-alert:last-checked:v1:00000000-0000-4000-8000-000000000001", String(Date.now())));
  const candidate = (kind: string, value: number) => ({ kind, locationId: kind, locationName: `สาขา ${kind}`,
    groupId: kind, groupOrder: 1, threshold: kind === "count" ? 2 : 10000, value, calculatedAt: "2026-10-24T00:00:00Z" });
  await page.route("**/api/lanflow/threshold-alert", (route) => route.fulfill({ json: {
    config: { thresholdKg: 10000, intervalMinutes: 60 }, configuredCount: 3, checkedCount: 3, unavailable: [],
    candidates: [candidate("cash", 100), candidate("weight", 12000), candidate("count", 3)],
  } }));
  await page.goto("/");
  const dialog = page.getByRole("alertdialog", { name: "แจ้งเตือน", exact: true });
  await page.getByRole("button", { name: "ตรวจแจ้งเตือน", exact: true }).click();
  await dialog.getByRole("button", { name: "นับเงิน · 1", exact: true }).click();
  await expect(dialog.getByText("เกินกำหนด 3 วัน", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "รับทราบ", exact: true }).click();
  await expect(dialog).toBeHidden();
});

test("four account slots allow duplicates, block unreadable slots, remove and renumber", async ({ page }) => {
  await page.route("**/api/lanflow/cash-counts/session?*", (route) => route.fulfill({ json: { session: {
    id: "four-session", isOwner: true, cutoffAt: new Date().toISOString(), expiresAt: "2099-10-24T10:30:00Z", systemBalance: 500,
  } } }));
  await page.route(/\/api\/lanflow\/cash-counts\?.*$/, (route) => route.fulfill({ json: { counts: [] } }));
  let reads = 0;
  await page.route("**/api/lanflow/cash-counts/ocr", (route) => {
    reads++;
    return route.fulfill(reads === 4 ? { status: 422, json: { error: "ช่องสี่อ่านไม่ชัด" } }
      : { json: { evidenceId: `slot-evidence-${reads}`, amount: 100.25 } });
  });
  await page.goto("/"); await dismissRubberWeightAlertIfVisible(page);
  await page.getByRole("button", { name: "นับเงิน", exact: true }).click();
  const save = page.getByRole("button", { name: "ยืนยันและส่งผล", exact: true });
  for (let index = 1; index <= 4; index++) {
    await page.getByRole("button", { name: "เพิ่มบัญชี", exact: true }).click();
    const slot = page.locator("section").filter({ has: page.getByRole("heading", { name: new RegExp(`^บัญชี${index} =`) }) }).last();
    await expect(save).toBeDisabled();
    await slot.getByRole("button", { name: "ถ่ายยอดบัญชี", exact: true }).click();
    const camera = page.getByRole("dialog", { name: "ถ่ายยอดบัญชี", exact: true });
    await expect.poll(() => camera.locator("video").evaluate((el) => (el as HTMLVideoElement).videoWidth)).toBeGreaterThan(0);
    await camera.getByRole("button", { name: "ถ่ายรูป", exact: true }).click();
    if (index < 4) { await slot.getByRole("checkbox", { name: "ยอดตรงกับรูป", exact: true }).check(); await expect(save).toBeEnabled(); }
  }
  await expect(page.getByRole("button", { name: "เพิ่มบัญชี", exact: true })).toHaveCount(0);
  await expect(page.getByText("ช่องสี่อ่านไม่ชัด", { exact: true })).toBeVisible(); await expect(save).toBeDisabled();
  await page.getByRole("button", { name: "ลบบัญชี4", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "ลบ", exact: true }).click();
  await expect(save).toBeEnabled();
  await expect(page.getByText(/ส่วนต่าง -199.25 บาท/)).toBeVisible();
  await page.getByRole("button", { name: "ลบบัญชี2", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "ลบ", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^บัญชี2 =/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^บัญชี3 =/ })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: test.info().outputPath("four-accounts-mobile.png"), fullPage: true });
});

test("Admin count groups can be created, edited and removed with confirmation", async ({ page }) => {
  const bootstrap = await page.request.get("/api/lanflow");
  const locations = (await bootstrap.json()).locations as Array<{ id: string; name: string }>;
  expect(locations.length).toBeGreaterThan(0);
  let groups: Array<{ id: string; dueDays: number; locationIds: string[] }> = [];
  await page.route("**/api/lanflow/cash-count-alert/groups*", async (route) => {
    const method = route.request().method();
    if (method === "POST") { const body = route.request().postDataJSON(); groups = [{ ...body, id: "test-count-group" }]; }
    if (method === "DELETE") groups = [];
    await route.fulfill({ json: method === "GET" ? { groups, availableLocationIds: groups.length ? [] : [locations[0].id] } : { id: "test-count-group" } });
  });
  await page.goto("/"); await dismissRubberWeightAlertIfVisible(page);
  await page.getByRole("button", { name: "Admin", exact: true }).click();
  await page.getByRole("button", { name: "การแจ้งเตือน", exact: true }).click();
  await page.getByLabel("ประเภทการตั้งค่าแจ้งเตือน").getByRole("button", { name: "นับเงิน", exact: true }).click();
  await page.getByRole("button", { name: "สร้างกลุ่ม", exact: true }).click();
  await expect(page.getByRole("button", { name: "บันทึกกลุ่ม", exact: true })).toBeDisabled();
  await page.getByLabel("กำหนดนับเงิน (วัน)", { exact: true }).fill("3");
  await page.getByRole("checkbox", { name: locations[0].name, exact: true }).check();
  await page.getByRole("button", { name: "บันทึกกลุ่ม", exact: true }).click();
  await expect(page.getByRole("heading", { name: "กลุ่ม 1 · ทุก 3 วัน", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "แก้ไข", exact: true }).click();
  await page.getByLabel("กำหนดนับเงิน (วัน)", { exact: true }).fill("5");
  await page.getByRole("button", { name: "บันทึกกลุ่ม", exact: true }).click();
  await expect(page.getByRole("heading", { name: "กลุ่ม 1 · ทุก 5 วัน", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "ลบกลุ่ม", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "ลบกลุ่ม", exact: true }).click();
  await expect(page.getByText("ยังไม่มีกลุ่ม กดสร้างกลุ่มเพื่อเลือกสาขา", { exact: true })).toBeVisible();
});
