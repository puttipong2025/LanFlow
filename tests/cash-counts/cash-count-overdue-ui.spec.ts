import { expect, test, type Page } from "@playwright/test";
test.use({ storageState: "playwright/.auth/super_admin.json" });
test.setTimeout(60_000); // Include cold bootstrap/Admin loading, not only business actions.

async function lockFixture(page: Page, canUnlock = true) {
  const bootstrap = await page.request.get("/api/lanflow");
  const locations = (await bootstrap.json()).locations as Array<{ id: string; name: string }>;
  let unlocked = false;
  let writes = 0;
  const states = () => locations.map((l) => ({ locationId: l.id, locationName: l.name, groupId: l.id,
    enabled: true, locked: !unlocked, canUnlock, dueDate: "2026-10-20", lockAt: "2026-10-21T01:00:00Z",
    unlockedUntil: unlocked ? new Date(Date.now() + 3600_000).toISOString() : null,
    unlockedAt: unlocked ? new Date().toISOString() : null, unlockedByName: unlocked ? "ผู้จัดการทดสอบ" : null,
    contacts: [{ id: l.id, name: "ผู้ดูแลปลดล็อก" }] }));
  await page.route("**/api/lanflow/cash-counts/lock", async (route) => {
    if (route.request().method() === "POST") { writes++; unlocked = true; }
    await route.fulfill({ json: { states: states(), serverNow: new Date().toISOString() } });
  });
  await page.route("**/api/lanflow/threshold-alert", (route) => route.fulfill({ json: {
    config: { thresholdKg: 10000, intervalMinutes: 60 }, configuredCount: 0, checkedCount: 0, candidates: [], unavailable: [],
  } }));
  return { writes: () => writes };
}
test("acknowledge never dismisses the branch lock; unlock is shared and cannot extend", async ({ page }) => {
  const fixture = await lockFixture(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "นับเงิน", exact: true })).toBeVisible({ timeout: 30_000 });
  const notice = page.getByLabel(/^สถานะล็อก /).first();
  await expect(notice.getByText(/ถูกล็อกงานการเงิน/)).toBeVisible();
  await notice.getByRole("button", { name: "เปิดแจ้งเตือนนับเงิน" }).click();
  const dialog = page.getByRole("alertdialog", { name: "แจ้งเตือน", exact: true });
  await expect(dialog.getByText(/ถูกล็อกงานการเงิน/).first()).toBeVisible();
  await dialog.getByRole("button", { name: "รับทราบ", exact: true }).click();
  await expect(dialog).toBeHidden(); await expect(notice.getByText(/ถูกล็อกงานการเงิน/)).toBeVisible();
  await notice.getByRole("button", { name: "ปลดล็อกชั่วคราว", exact: true }).click();
  await expect(notice.getByText(/เหลือ .*นาที/)).toBeVisible();
  await expect(notice.getByRole("button", { name: "ปลดล็อกชั่วคราว", exact: true })).toHaveCount(0);
  expect(fixture.writes()).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("cash-count-lock-mobile.png"), fullPage: true });
});
test("contact-only status still lets the user enter and start cash counting", async ({ page }) => {
  await lockFixture(page, false);
  await page.route("**/api/lanflow/cash-counts/session?*", (route) => route.fulfill({ json: { session: null } }));
  await page.route(/\/api\/lanflow\/cash-counts\?.*$/, (route) => route.fulfill({ json: { counts: [] } }));
  await page.goto("/");
  const notice = page.getByLabel(/^สถานะล็อก /).first();
  await expect(notice.getByText("กรุณาติดต่อ ผู้ดูแลปลดล็อก", { exact: true })).toBeVisible();
  await expect(notice.getByRole("button", { name: "ปลดล็อกชั่วคราว", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "นับเงิน", exact: true }).click();
  await expect(page.getByRole("button", { name: "เริ่มนับเงิน", exact: true })).toBeEnabled();
});
test("group form requires hours before enabling and sends both bounds", async ({ page }) => {
  const bootstrap = await page.request.get("/api/lanflow");
  const location = (await bootstrap.json()).locations[0];
  let saved: Record<string, unknown> | null = null;
  await page.route("**/api/lanflow/cash-count-alert/groups*", async (route) => {
    if (route.request().method() === "POST") saved = route.request().postDataJSON();
    await route.fulfill({ json: { groups: [], availableLocationIds: [location.id] } });
  });
  await page.goto("/");
  const alert = page.getByRole("alertdialog", { name: "แจ้งเตือน", exact: true });
  if (await alert.isVisible()) await alert.getByRole("button", { name: "รับทราบ" }).click();
  await page.getByRole("button", { name: "Admin", exact: true }).click();
  await page.getByRole("button", { name: "การแจ้งเตือน", exact: true }).click();
  await page.getByLabel("ประเภทการตั้งค่าแจ้งเตือน").getByRole("button", { name: "นับเงิน", exact: true }).click();
  await page.getByRole("button", { name: "สร้างกลุ่ม", exact: true }).click();
  const toggle = page.getByRole("checkbox", { name: "ล็อกเมื่อเกินกำหนดนับเงิน", exact: true });
  await expect(toggle).not.toBeChecked(); await toggle.check();
  await page.getByRole("checkbox", { name: location.name, exact: true }).check();
  await page.getByRole("button", { name: "บันทึกกลุ่ม", exact: true }).click();
  expect(saved).toBeNull();
  await page.getByLabel("ผ่อนผันก่อนล็อก (ชั่วโมง)", { exact: true }).fill("1");
  await page.getByLabel("ใช้งานหลังปลดล็อก (ชั่วโมง)", { exact: true }).fill("48");
  await page.getByRole("button", { name: "บันทึกกลุ่ม", exact: true }).click();
  await expect.poll(() => saved).toMatchObject({ lockEnabled: true, graceHours: 1, unlockHours: 48 });
});

test("turning lock off never submits hidden invalid hour drafts", async ({ page }) => {
  test.setTimeout(60_000); // This standalone case cold-loads the Admin chunk.
  const bootstrap = await page.request.get("/api/lanflow");
  const location = (await bootstrap.json()).locations[0];
  let saved: Record<string, unknown> | null = null;
  await page.route("**/api/lanflow/threshold-alert", (route) => route.fulfill({ json: { config: { thresholdKg: 10000, intervalMinutes: 60 }, configuredCount: 0, checkedCount: 0, candidates: [], unavailable: [] } }));
  await page.route("**/api/lanflow/cash-count-alert/groups*", async (route) => {
    if (route.request().method() === "POST") saved = route.request().postDataJSON();
    await route.fulfill({ json: { groups: [], availableLocationIds: [location.id] } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Admin", exact: true }).click();
  await page.getByRole("button", { name: "การแจ้งเตือน", exact: true }).click();
  await page.getByLabel("ประเภทการตั้งค่าแจ้งเตือน").getByRole("button", { name: "นับเงิน", exact: true }).click();
  await page.getByRole("button", { name: "สร้างกลุ่ม", exact: true }).click();
  const toggle = page.getByRole("checkbox", { name: "ล็อกเมื่อเกินกำหนดนับเงิน", exact: true });
  await toggle.check(); await page.getByLabel("ผ่อนผันก่อนล็อก (ชั่วโมง)", { exact: true }).fill("0"); await toggle.uncheck();
  await page.getByRole("checkbox", { name: location.name, exact: true }).check();
  await page.getByRole("button", { name: "บันทึกกลุ่ม", exact: true }).click();
  await expect.poll(() => saved).toMatchObject({ lockEnabled: false });
  expect(saved).not.toHaveProperty("graceHours");
});

test("temporary grant expiry refreshes the server status without the alert interval", async ({ page }) => {
  const bootstrap = await page.request.get("/api/lanflow");
  const locations = (await bootstrap.json()).locations as Array<{ id: string; name: string }>;
  let expiry = 0;
  let reads = 0;
  await page.route("**/api/lanflow/cash-counts/lock", async (route) => {
    reads++; expiry ||= Date.now() + 3000;
    await route.fulfill({ json: { serverNow: new Date().toISOString(), states: locations.map((l) => ({
      locationId: l.id, locationName: l.name, groupId: l.id, enabled: true, locked: Date.now() >= expiry,
      dueDate: "2026-10-20", lockAt: "2026-10-21T01:00:00Z", unlockedUntil: new Date(expiry).toISOString(),
      unlockedAt: new Date(expiry - 3600_000).toISOString(), unlockedByName: "ผู้จัดการ", canUnlock: true, contacts: [],
    })) } });
  });
  await page.route("**/api/lanflow/threshold-alert", (route) => route.fulfill({ json: { config: { thresholdKg: 10000, intervalMinutes: 60 }, configuredCount: 0, checkedCount: 0, candidates: [], unavailable: [] } }));
  await page.goto("/");
  const notice = page.getByLabel(/^สถานะล็อก /).first();
  await expect(notice.getByText(/เหลือ .*นาที/)).toBeVisible();
  await expect(notice.getByText(/ถูกล็อกงานการเงิน/)).toBeVisible({ timeout: 10_000 });
  expect(reads).toBeGreaterThanOrEqual(2);
});
