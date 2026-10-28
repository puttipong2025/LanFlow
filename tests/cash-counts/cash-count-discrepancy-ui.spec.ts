import { expect, test, type Page } from "@playwright/test";
test.use({ storageState: "playwright/.auth/super_admin.json" });
test.setTimeout(60_000);
const config = { thresholdKg: 10000, intervalMinutes: 60 };
async function fixture(page: Page, locked = false) {
  await page.addInitScript(() => { localStorage.setItem("lanflow:rubber-weight-alert:last-checked:v1:00000000-0000-4000-8000-000000000001", String(Date.now())); });
  const bootstrap = await page.request.get("/api/lanflow");
  const location = (await bootstrap.json()).locations[0] as { id: string; name: string };
  let amount = -500; let reads = 0; let finished = 0; let hold = false; let release: (() => void) | null = null;
  await page.route("**/api/lanflow/cash-counts/lock", (r) => r.fulfill({ json: { serverNow: new Date().toISOString(), states: locked ? [{ locationId: location.id, locationName: location.name, groupId: location.id, enabled: true, locked: true, canUnlock: true, dueDate: "2026-10-20", lockAt: "2026-10-21T00:00:00Z", unlockedUntil: null, unlockedAt: null, unlockedByName: null, contacts: [] }] : [] } }));
  await page.route("**/api/lanflow/threshold-alert", async (r) => { reads++; const snapshot = amount;
    if (hold) { hold = false; await new Promise<void>((resolve) => { release = resolve; }); }
    await r.fulfill({ json: { config, configuredCount: 1, checkedCount: 1, unavailable: [], candidates: [{ kind: "count", locationId: location.id, locationName: location.name, groupId: location.id, groupOrder: 1, threshold: 2, value: 2, calculatedAt: new Date().toISOString(), discrepancyThreshold: 100, discrepancy: { countId: location.id, amount: snapshot, countedAt: "2026-10-26T02:00:00Z" } }] } }); finished++; });
  return { location, reads: () => reads, finished: () => finished, change: (next: number) => { amount = next; }, hold: () => { hold = true; }, held: () => release !== null, release: () => { release?.(); release = null; } };
}
test("one row preserves both alerts and unlock action; threshold remains in group header on mobile", async ({ page }) => {
  const state = await fixture(page, true); await page.goto("/");
  const bootstrap = await page.request.get("/api/lanflow");
  const other = (await bootstrap.json()).locations.find((location: { id: string }) => location.id !== state.location.id);
  const gate = page.getByRole("alertdialog", { name: "สาขาถูกล็อก", exact: true });
  await expect(page.getByRole("button", { name: "ตรวจแจ้งเตือน", exact: true })).toBeVisible({ timeout: 30_000 });
  if (await gate.isVisible()) await gate.getByRole("combobox").selectOption(other.id);
  await expect(gate).toBeHidden();
  await page.getByRole("button", { name: "ตรวจแจ้งเตือน", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "แจ้งเตือน", exact: true });
  const row = dialog.getByTestId("count-alert-row");
  await expect(row).toHaveCount(1);
  await expect(row.getByText("เกินกำหนด 2 วัน", { exact: true })).toBeVisible();
  await expect(row.getByText("ขาด 500 บาท", { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "ปลดล็อกชั่วคราว", exact: true })).toBeVisible();
  await expect(row.getByText(/ขาด–เกิน >/)).toHaveCount(0);
  await expect(dialog.getByRole("heading", { name: "กลุ่ม 1 · ทุก 2 วัน · ขาด–เกิน > 100 บาท", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("discrepancy-mobile.png"), fullPage: true });
});
test("mutation refreshes an open alert but never reopens an acknowledged one", async ({ page }) => {
  const state = await fixture(page); await page.goto("/");
  await page.getByRole("button", { name: "ตรวจแจ้งเตือน", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "แจ้งเตือน", exact: true });
  await expect(dialog.getByText("ขาด 500 บาท", { exact: true })).toBeVisible();
  state.change(200);
  await page.evaluate(() => window.dispatchEvent(new Event("lanflow:cash-count-lock-changed")));
  await expect(dialog.getByText("เกิน 200 บาท", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "รับทราบ", exact: true }).click();
  const before = state.reads(); state.change(-300);
  await page.evaluate(() => window.dispatchEvent(new Event("lanflow:cash-count-lock-changed")));
  await expect.poll(state.reads).toBeGreaterThan(before);
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "ตรวจแจ้งเตือน", exact: true }).click();
  await expect(dialog.getByText("ขาด 300 บาท", { exact: true })).toBeVisible();
});
test("form writes zero and explicitly clears threshold without changing hour settings", async ({ page }) => {
  const { location } = await fixture(page); let saved: Record<string, unknown> | null = null; let failNext = true;
  await page.route("**/api/lanflow/cash-count-alert/groups*", async (r) => {
    if (r.request().method() === "POST") {
      if (failNext) { failNext = false; return r.fulfill({ status: 503, json: { error: "ลองบันทึกใหม่" } }); }
      saved = r.request().postDataJSON();
    }
    return r.fulfill({ json: { groups: [{ id: location.id, locationIds: [location.id], dueDays: 2, discrepancyThreshold: saved ? saved.discrepancyThreshold : 100 }], availableLocationIds: [] } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Admin", exact: true }).click();
  await page.getByRole("button", { name: "การแจ้งเตือน", exact: true }).click();
  await page.getByLabel("ประเภทการตั้งค่าแจ้งเตือน").getByRole("button", { name: "นับเงิน", exact: true }).click();
  await page.getByRole("button", { name: "แก้ไข", exact: true }).last().click();
  const input = page.getByRole("spinbutton", { name: /แจ้งเตือนเมื่อขาดหรือเกินมากกว่า/ });
  await expect(input).toHaveValue("100"); await input.fill("0");
  await page.getByRole("button", { name: "บันทึกกลุ่ม", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "ลองบันทึกใหม่" })).toBeVisible();
  await expect(input).toHaveValue("0");
  await page.getByRole("button", { name: "บันทึกกลุ่ม", exact: true }).click();
  await expect.poll(() => saved).toMatchObject({ discrepancyThreshold: 0 });
  await page.getByRole("button", { name: "แก้ไข", exact: true }).last().click(); await input.fill("");
  await page.getByRole("button", { name: "บันทึกกลุ่ม", exact: true }).click();
  await expect.poll(() => saved).toMatchObject({ discrepancyThreshold: null });
  await page.getByRole("button", { name: "แก้ไข", exact: true }).last().click(); await expect(input).toHaveValue("");
});
test("a mutation during an in-flight read discards the stale response and reads the new count", async ({ page }) => {
  const state = await fixture(page); await page.goto("/");
  await page.getByRole("button", { name: "ตรวจแจ้งเตือน", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "แจ้งเตือน", exact: true });
  await expect(dialog.getByText("ขาด 500 บาท", { exact: true })).toBeVisible();
  state.hold(); state.change(-200);
  await page.evaluate(() => window.dispatchEvent(new Event("lanflow:cash-count-lock-changed")));
  await expect.poll(state.held).toBe(true);
  state.change(300);
  await page.evaluate(() => window.dispatchEvent(new Event("lanflow:cash-count-lock-changed")));
  state.release();
  await expect(dialog.getByText("เกิน 300 บาท", { exact: true })).toBeVisible();
  await expect(dialog.getByText("ขาด 200 บาท", { exact: true })).toHaveCount(0);
});
test("cross-tab invalidation refreshes visible results", async ({ page }) => {
  const state = await fixture(page); await page.goto("/");
  await page.getByRole("button", { name: "ตรวจแจ้งเตือน", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "แจ้งเตือน", exact: true });
  await expect(dialog.getByText("ขาด 500 บาท", { exact: true })).toBeVisible(); state.change(600);
  await page.evaluate(() => window.dispatchEvent(new StorageEvent("storage", { key: "lanflow:cash-count-lock-changed", newValue: String(Date.now()) })));
  await expect(dialog.getByText("เกิน 600 บาท", { exact: true })).toBeVisible();
});
test("changing selected branch never restores a dismissed global alert after a held read", async ({ page }) => {
  const state = await fixture(page);
  const bootstrap = await page.request.get("/api/lanflow");
  const other = (await bootstrap.json()).locations.find((l: { id: string }) => l.id !== state.location.id);
  expect(other).toBeTruthy(); await page.goto("/");
  await page.getByRole("button", { name: "ตรวจแจ้งเตือน", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "แจ้งเตือน", exact: true });
  await expect(dialog.getByText("ขาด 500 บาท", { exact: true })).toBeVisible(); state.hold();
  await page.evaluate(() => window.dispatchEvent(new Event("lanflow:cash-count-lock-changed")));
  await expect.poll(state.held).toBe(true);
  await dialog.getByRole("button", { name: "รับทราบ", exact: true }).click();
  await page.getByRole("button", { name: /^เลือกสาขา/ }).click();
  await page.getByRole("option").filter({ hasText: other.name }).first().click();
  const done = state.finished(); state.release();
  await expect.poll(state.finished).toBeGreaterThan(done);
  await expect(dialog).toBeHidden();
});
