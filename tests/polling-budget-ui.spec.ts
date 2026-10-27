import { expect, test } from "@playwright/test";

test.use({ storageState: "playwright/.auth/super_admin.json" });
test.setTimeout(60_000);

test.beforeEach(async ({ page }) => {
  await page.clock.install();
  await page.addLocatorHandler(page.getByRole("alertdialog", { name: "แจ้งเตือน", exact: true }), async (dialog) => {
    await dialog.getByRole("button", { name: "รับทราบ", exact: true }).click();
  });
});

test("real queue routes preserve the local database response contracts", async ({ request }) => {
  const bootstrap = await request.get("/api/lanflow");
  expect(bootstrap.ok()).toBe(true);
  const { locations } = await bootstrap.json();
  expect(locations.length).toBeGreaterThan(0);
  const locationId = locations[0].id;
  for (const url of [
    "/api/lanflow/admin/browser-approvals",
    `/api/lanflow/cash-branch-transfers?locationId=${locationId}&view=pending`,
    `/api/lanflow/evidence/feed?locationId=${locationId}&view=history&limit=1`,
  ]) {
    const response = await request.get(url);
    expect(response.status(), url).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/json");
  }
});

test("cash empty queue uses one check per minute and recovers from errors", async ({ page }) => {
  let requests = 0;
  let fail = false;
  let hasWork = false;
  const transfers = Array.from({ length: 20 }, (_, index) => ({ id: `cash-${index}`, createdByName: "Polling fixture", sentTotal: 20 }));
  await page.route("**/api/lanflow/cash-branch-transfers?**", async (route) => {
    requests++;
    await route.fulfill({ status: fail ? 503 : 200, json: fail ? { error: "queue unavailable" } : { transfers: hasWork ? transfers : [], total: hasWork ? 21 : 0 } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "รับ-จ่าย", exact: true }).click();
  await expect.poll(() => requests).toBeGreaterThan(0);
  const before = requests;
  await page.clock.runFor(46_000);
  expect(requests - before).toBe(0);
  await page.clock.runFor(15_000);
  await expect.poll(() => requests).toBe(before + 1);
  fail = true;
  await page.clock.runFor(61_000);
  await expect.poll(() => requests).toBe(before + 2);
  fail = false;
  await page.clock.runFor(61_000);
  await expect.poll(() => requests).toBe(before + 3);
  hasWork = true;
  await page.clock.runFor(61_000);
  await expect.poll(() => requests).toBe(before + 4);
  await expect(page.getByText("แสดง 20 รายการที่เก่าที่สุดจาก 21 รายการค้าง")).toBeVisible();
  await page.clock.runFor(16_000);
  await expect.poll(() => requests).toBe(before + 5);
  hasWork = false;
  await page.clock.runFor(15_000);
  await expect.poll(() => requests).toBe(before + 6);
  await page.clock.runFor(46_000);
  expect(requests).toBe(before + 6);
});

test("browser approval has a single timer across admin observers", async ({ page }) => {
  let requests = 0;
  let pending = false;
  await page.route("**/api/lanflow/admin/browser-approvals", async (route) => {
    requests++;
    await route.fulfill({ json: { users: pending ? [{ userId: "fixture", required: true, primaryLocationId: null, lastApprovedBy: null, lastApprovedAt: null, pending: [{ id: "request", label: "Fixture browser", requestedAt: new Date().toISOString() }] }] : [] } });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Admin", exact: true })).toBeVisible();
  await expect.poll(() => requests).toBeGreaterThan(0);
  let before = requests;
  await page.clock.runFor(46_000);
  expect(requests).toBe(before);
  await page.clock.runFor(15_000);
  await expect.poll(() => requests).toBe(before + 1);
  await page.getByRole("button", { name: "Admin", exact: true }).click();
  await expect(page.getByRole("button", { name: "พนักงาน", exact: true })).toBeVisible();
  before = requests;
  await page.clock.runFor(16_000);
  await expect.poll(() => requests).toBe(before + 1);
  before = requests;
  await page.clock.runFor(30_000);
  await expect.poll(() => requests).toBe(before + 2);
  await page.getByRole("button", { name: "สาขา", exact: true }).click();
  before = requests;
  await page.clock.runFor(46_000);
  expect(requests).toBe(before);
  pending = true;
  await page.clock.runFor(15_000);
  await expect.poll(() => requests).toBe(before + 1);
  await page.clock.runFor(16_000);
  await expect.poll(() => requests).toBe(before + 2);
  pending = false;
  await page.clock.runFor(15_000);
  await expect.poll(() => requests).toBe(before + 3);
  await page.clock.runFor(46_000);
  expect(requests).toBe(before + 3);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    window.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(61_000);
  expect(requests).toBe(before + 3);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    window.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => requests).toBe(before + 4);
});

test("evidence history stops its feed timer and offers keyboard refresh", async ({ page }, testInfo) => {
  let historyRequests = 0;
  let pendingRequests = 0;
  await page.route("**/api/lanflow/evidence/feed?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("view") === "history") historyRequests++;
    else pendingRequests++;
    await route.fulfill({ json: { rows: [], nextCursor: null, hasMore: false } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /^ตรวจหลักฐาน/ }).click();
  await expect.poll(() => pendingRequests).toBeGreaterThan(0);
  await page.getByRole("button", { name: "ประวัติการตรวจ", exact: true }).click();
  await expect.poll(() => historyRequests).toBeGreaterThan(0);
  const before = historyRequests;
  await page.clock.runFor(121_000);
  expect(historyRequests).toBe(before);
  const refresh = page.getByRole("button", { name: "รีเฟรชหลักฐาน", exact: true });
  await refresh.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => historyRequests).toBe(before + 1);
  await expect(refresh).toBeEnabled();
  await page.getByRole("button", { name: "รอตรวจ", exact: true }).click();
  const pendingBefore = pendingRequests;
  await page.clock.runFor(61_000);
  await expect.poll(() => pendingRequests).toBeGreaterThan(pendingBefore);
  const historyBefore = historyRequests;
  await page.getByRole("button", { name: "ประวัติการตรวจ", exact: true }).click();
  await expect.poll(() => historyRequests).toBe(historyBefore + 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await refresh.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("evidence-refresh-mobile.png") });
});

test("policy refreshes fresh cache on visibility and remount without replacing drafts", async ({ page }) => {
  const response = await page.request.get("/api/lanflow/rubber-bills/approval-groups");
  expect(response.ok()).toBe(true);
  const settings = await response.json();
  let requests = 0;
  await page.route("**/api/lanflow/rubber-bills/approval-groups", async (route) => {
    expect(route.request().method()).toBe("GET");
    requests++;
    await route.fulfill({ json: settings });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
  await page.getByRole("button", { name: /ตั้งค่าและอนุมัติบิลยาง/ }).click();
  const dialog = page.getByRole("dialog", { name: "ตั้งค่าและอนุมัติบิลยาง", exact: true });
  const input = dialog.getByRole("textbox", { name: "ราคากลางใหม่", exact: true });
  await expect(input).toBeVisible();
  await input.fill("123.45");
  const before = requests;
  await page.clock.runFor(121_000);
  expect(requests).toBe(before);
  settings.centralPrice.value = 43.21;
  settings.centralPrice.revision++;
  settings.ungroupedDefaults.priceAllowance = 0;
  settings.ungroupedDefaults.revision++;
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    window.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    window.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => requests).toBe(before + 1);
  await expect(input).toHaveAttribute("placeholder", "43.21");
  await expect(input).toHaveValue("123.45");
  await dialog.getByRole("button", { name: "ปิด", exact: true }).click();
  await page.getByRole("button", { name: /ตั้งค่าและอนุมัติบิลยาง/ }).click();
  await expect.poll(() => requests).toBe(before + 2);
  await expect(input).toHaveAttribute("placeholder", "43.21");
});

test("history refresh preserves two loaded pages without periodic refetches", async ({ page }) => {
  const ids = Array.from({ length: 6 }, () => crypto.randomUUID());
  const rows = ids.map((id, index) => ({ id, revision_no: 1, bill_no: `POLL-${index}`, bill_date: "2026-10-27", bill_type: "weighing", customer_name: "Polling fixture", created_at: new Date().toISOString(), client_created_at: new Date().toISOString(), items: [], evidence_state: {} }));
  let historyRequests = 0;
  await page.route("**/api/lanflow/evidence/feed?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("view") !== "history") return route.fulfill({ json: { rows: [], hasMore: false, nextCursor: null } });
    historyRequests++;
    const more = !params.has("cursor");
    await route.fulfill({ json: { rows: more ? rows.slice(0, 5) : rows.slice(5), hasMore: more, nextCursor: more ? "next-page" : null } });
  });
  await page.route("**/api/lanflow/evidence/bills/*/revisions/*/detail", async (route) => {
    const id = route.request().url().match(/bills\/([^/]+)/)![1];
    await route.fulfill({ json: { bill: { id, revisionNo: 1, billNo: "POLL", customerName: "Fixture", clientCreatedAt: new Date().toISOString(), manualCorrectionCount: 0 }, rows: [] } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /^ตรวจหลักฐาน/ }).click();
  await page.getByRole("button", { name: "ประวัติการตรวจ", exact: true }).click();
  await expect(page.locator("[data-testid^='evidence-card-']")).toHaveCount(5);
  await page.getByRole("button", { name: "หน้าถัดไป", exact: true }).click();
  await expect(page.getByTestId(`evidence-card-${ids[5]}`)).toBeVisible();
  expect(historyRequests).toBe(2);
  await page.clock.runFor(121_000);
  expect(historyRequests).toBe(2);
  await page.getByRole("button", { name: "รีเฟรชหลักฐาน", exact: true }).click();
  await expect.poll(() => historyRequests).toBe(4);
  await expect(page.locator("[data-testid^='evidence-card-']")).toHaveCount(1);
  await expect(page.getByTestId(`evidence-card-${ids[5]}`)).toBeVisible();
});
