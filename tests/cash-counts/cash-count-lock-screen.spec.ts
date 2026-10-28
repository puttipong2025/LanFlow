import { expect, test } from "@playwright/test";
test.use({ storageState: "playwright/.auth/super_admin.json" });
test.setTimeout(90_000);

test("remote unlock polling, branch switch and loading failure cannot dismiss the gate", async ({ page }) => {
  const response = await page.request.get("/api/lanflow");
  const locations = (await response.json()).locations as Array<{ id: string; name: string }>;
  expect(locations.length).toBeGreaterThan(1);
  let unlocked = false; let reads = 0; let fail = true;
  await page.route("**/api/lanflow/threshold-alert", (route) => route.fulfill({ json: { config: { thresholdKg: 10000, intervalMinutes: 60 }, configuredCount: 0, checkedCount: 0, candidates: [], unavailable: [] } }));
  await page.route("**/api/lanflow/cash-counts/lock", (route) => {
    reads++;
    if (fail) return route.fulfill({ status: 503, json: { error: "ทดสอบโหลดล้มเหลว" } });
    return route.fulfill({ json: { serverNow: new Date().toISOString(), states: locations.map((location, index) => ({ locationId: location.id, locationName: location.name, groupId: location.id, enabled: true, locked: !unlocked && index === 0, canUnlock: false, dueDate: "2026-10-20", lockAt: "2026-10-21T00:00:00Z", unlockedUntil: null, unlockedAt: null, unlockedByName: null, contacts: [] })) } });
  });
  await page.goto("/");
  const loading = page.getByRole("alertdialog", { name: "กำลังตรวจสถานะสาขา", exact: true });
  await expect(loading).toBeVisible({ timeout: 30_000 });
  await expect(loading.getByRole("alert")).toBeVisible();
  await loading.getByRole("combobox").selectOption(locations[0].id);
  fail = false;
  await loading.getByRole("button", { name: "ตรวจสถานะอีกครั้ง", exact: true }).click();
  const screen = page.getByRole("alertdialog", { name: "สาขาถูกล็อก", exact: true });
  await expect(screen).toBeVisible();
  await expect(screen.getByText(/ตรวจสถานะอีกครั้งใน \d+ วินาที/)).toBeVisible();
  await screen.getByRole("combobox").selectOption(locations[1].id);
  await expect(screen).toBeHidden();
  await page.getByRole("button", { name: /^เลือกสาขา/ }).click();
  await page.getByRole("option").filter({ hasText: locations[0].name }).click();
  await expect(screen).toBeVisible();
  const before = reads; unlocked = true;
  await expect(screen).toBeHidden({ timeout: 15_000 });
  expect(reads).toBeGreaterThan(before);
});

test("cash lock preserves an open draft and its dialog through lock and unlock", async ({ page }) => {
  let locked = false;
  const response = await page.request.get("/api/lanflow");
  const locations = (await response.json()).locations as Array<{ id: string; name: string }>;
  await page.route("**/api/lanflow/threshold-alert", (route) => route.fulfill({ json: { config: { thresholdKg: 10000, intervalMinutes: 60 }, configuredCount: 0, checkedCount: 0, candidates: [], unavailable: [] } }));
  await page.route("**/api/lanflow/cash-counts/lock", (route) => {
    if (route.request().method() === "POST") locked = false;
    return route.fulfill({ json: { serverNow: new Date().toISOString(), states: locations.map((location) => ({ locationId: location.id, locationName: location.name, groupId: location.id, enabled: true, locked, canUnlock: true, dueDate: "2026-10-20", lockAt: "2026-10-21T00:00:00Z", unlockedUntil: null, unlockedAt: null, unlockedByName: null, contacts: [] })) } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "เปลี่ยนรหัสผ่าน", exact: true }).click({ timeout: 30_000 });
  const draft = page.getByLabel("รหัสผ่านปัจจุบัน", { exact: true });
  await draft.fill("unsaved-draft");
  locked = true;
  await page.evaluate(() => window.dispatchEvent(new Event("lanflow:cash-count-lock-changed")));
  const screen = page.getByRole("alertdialog", { name: "สาขาถูกล็อก", exact: true });
  await expect(screen).toBeVisible();
  await page.keyboard.press("Tab");
  expect(await screen.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await screen.getByRole("button", { name: "ปลดล็อกชั่วคราว", exact: true }).click();
  await expect(screen).toBeHidden();
  await expect(draft).toHaveValue("unsaved-draft");
});

test("temporary grant expiring offline blocks until the server confirms status", async ({ page, context }) => {
  const response = await page.request.get("/api/lanflow");
  const locations = (await response.json()).locations as Array<{ id: string; name: string }>;
  let expiry = 0;
  await page.route("**/api/lanflow/threshold-alert", (route) => route.fulfill({ json: { config: { thresholdKg: 10000, intervalMinutes: 60 }, configuredCount: 0, checkedCount: 0, candidates: [], unavailable: [] } }));
  await page.route("**/api/lanflow/cash-counts/lock", (route) => {
    expiry ||= Date.now() + 15_000;
    return route.fulfill({ json: { serverNow: new Date().toISOString(), states: locations.map((location) => ({ locationId: location.id, locationName: location.name, groupId: location.id, enabled: true, locked: Date.now() >= expiry, canUnlock: true, dueDate: "2026-10-20", lockAt: "2026-10-21T00:00:00Z", unlockedUntil: new Date(expiry).toISOString(), unlockedAt: new Date(expiry - 3600_000).toISOString(), unlockedByName: "ผู้ตรวจ", contacts: [] })) } });
  });
  await page.goto("/");
  await expect(page.getByLabel(/^สถานะล็อก /).first().getByText(/เหลือ .*นาที/)).toBeVisible({ timeout: 30_000 });
  // The dev server has no service worker: load the existing offline fallback chunk before disconnecting.
  await page.getByRole("button", { name: /^บิลยาง/ }).click();
  await expect(page.getByRole("button", { name: "เพิ่มบิลยาง", exact: true })).toBeVisible({ timeout: 30_000 });
  await context.setOffline(true);
  const checking = page.getByRole("alertdialog", { name: "กำลังตรวจสถานะสาขา", exact: true });
  await expect(checking).toBeVisible({ timeout: 20_000 });
  await expect(checking.getByText(/ไม่มีอินเทอร์เน็ต/)).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByRole("alertdialog", { name: "สาขาถูกล็อก", exact: true })).toBeVisible();
});

test("late branch reads cannot unlock a new branch and rejected unlock stays blocked", async ({ page }) => {
  const response = await page.request.get("/api/lanflow");
  const locations = (await response.json()).locations as Array<{ id: string; name: string }>;
  let hold = false; let release: (() => void) | undefined; let writes = 0;
  await page.route("**/api/lanflow/threshold-alert", (route) => route.fulfill({ json: { config: { thresholdKg: 10000, intervalMinutes: 60 }, configuredCount: 0, checkedCount: 0, candidates: [], unavailable: [] } }));
  await page.route("**/api/lanflow/cash-counts/lock", async (route) => {
    if (route.request().method() === "POST") { writes++; await route.fulfill({ status: 503, json: { error: "ทดสอบปลดล็อกไม่สำเร็จ" } }); return; }
    if (hold) {
      hold = false;
      await new Promise<void>((resolve) => { release = resolve; });
      await route.fulfill({ json: { serverNow: new Date().toISOString(), states: [] } }).catch(() => {});
      return;
    }
    await route.fulfill({ json: { serverNow: new Date().toISOString(), states: locations.map((location) => ({ locationId: location.id, locationName: location.name, groupId: location.id, enabled: true, locked: true, canUnlock: true, dueDate: "2026-10-20", lockAt: "2026-10-21T00:00:00Z", unlockedUntil: null, unlockedAt: null, unlockedByName: null, contacts: [] })) } });
  });
  await page.goto("/");
  const screen = page.getByRole("alertdialog", { name: "สาขาถูกล็อก", exact: true });
  await expect(screen).toBeVisible({ timeout: 30_000 });
  const previous = await screen.getByRole("combobox").inputValue();
  const other = locations.find((location) => location.id !== previous)!;
  hold = true;
  await screen.getByRole("button", { name: "ตรวจสถานะอีกครั้ง", exact: true }).click();
  await expect.poll(() => !!release).toBe(true);
  await screen.getByRole("combobox").selectOption(other.id);
  await expect(screen.getByRole("combobox")).toHaveValue(other.id);
  release!();
  await screen.getByRole("button", { name: "ปลดล็อกชั่วคราว", exact: true }).click();
  await expect(screen.getByRole("alert")).toContainText("ทดสอบปลดล็อกไม่สำเร็จ");
  await expect(screen).toBeVisible();
  expect(writes).toBe(1);
});
