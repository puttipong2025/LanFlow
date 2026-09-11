import { expect, test, type Browser, type Page } from "@playwright/test";

async function contextFor(role: "super_admin" | "admin" | "user", browser: Browser) {
  return browser.newContext({ storageState: `playwright/.auth/${role}.json` });
}

const emptyCheck = {
  config: { thresholdKg: 10_000, intervalMinutes: 60 },
  candidates: [],
};

function qualifyingCheck() {
  return {
    config: { thresholdKg: 10_000, intervalMinutes: 30 },
    candidates: [
      {
        locationId: "branch-heavy",
        locationName: "สาขาชื่อยาวมากสำหรับตรวจการตัดบรรทัดบนหน้าจอขนาดเล็ก",
        netWeight: 25_500.5,
        groupId: "group-heavy",
        groupOrder: 2,
        thresholdKg: 20_000,
      },
      {
        locationId: "branch-light",
        locationName: "สาขารอง",
        netWeight: 12_000,
        groupId: "group-light",
        groupOrder: 4,
        thresholdKg: 10_000,
      },
    ],
  };
}

async function clearAlertTimestamp(page: Page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("rubber-weight-alert-test-initialized") === "true") return;
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith("lanflow:rubber-weight-alert:last-checked:")) {
        localStorage.removeItem(key);
      }
    }
    sessionStorage.setItem("rubber-weight-alert-test-initialized", "true");
  });
}

test("alert API enforces role, bounds, atomic save, and no-store responses", async ({ browser }) => {
  const manager = await contextFor("super_admin", browser);
  const admin = await contextFor("admin", browser);
  const user = await contextFor("user", browser);
  const anonymous = await browser.newContext();
  try {
    const bootstrap = await manager.request.get("/api/lanflow");
    expect(bootstrap.ok(), await bootstrap.text()).toBeTruthy();
    expect((await bootstrap.json()).rubberWeightAlertConfig).toEqual({
      thresholdKg: 10_000,
      intervalMinutes: 60,
    });

    const deniedCheck = await user.request.get("/api/lanflow/rubber-weight-alert");
    expect(deniedCheck.status()).toBe(403);
    expect(deniedCheck.headers()["cache-control"]).toContain("no-store");
    const anonymousCheck = await anonymous.request.get("/api/lanflow/rubber-weight-alert");
    expect(anonymousCheck.status()).toBe(401);
    expect(anonymousCheck.headers()["cache-control"]).toContain("no-store");
    expect((await (await user.request.get("/api/lanflow")).json()).rubberWeightAlertConfig)
      .toBeNull();
    const deniedSave = await admin.request.put("/api/lanflow/admin/rubber-weight-alert", {
      data: { intervalMinutes: 30 },
    });
    expect(deniedSave.status()).toBe(403);
    expect(deniedSave.headers()["cache-control"]).toContain("no-store");

    const staleClientSave = await manager.request.put("/api/lanflow/admin/rubber-weight-alert", {
      data: { thresholdKg: 20_000, intervalMinutes: 30 },
    });
    expect(staleClientSave.status()).toBe(409);

    for (const value of [{ intervalMinutes: 0 }, { intervalMinutes: 1_441 }, { intervalMinutes: "60" }]) {
      const response = await manager.request.put("/api/lanflow/admin/rubber-weight-alert", {
        data: value,
      });
      expect(response.status()).toBe(400);
    }

    const saved = await manager.request.put("/api/lanflow/admin/rubber-weight-alert", {
      data: { intervalMinutes: 30 },
    });
    expect(saved.ok(), await saved.text()).toBeTruthy();
    expect(saved.headers()["cache-control"]).toContain("no-store");
    expect(await saved.json()).toEqual({ thresholdKg: 10_000, intervalMinutes: 30 });

    const listedGroups = await manager.request.get("/api/lanflow/rubber-weight-alert/groups");
    expect(listedGroups.ok(), await listedGroups.text()).toBeTruthy();
    expect(listedGroups.headers()["cache-control"]).toContain("no-store");
    expect(await listedGroups.json()).toMatchObject({ groups: expect.any(Array), availableLocationIds: expect.any(Array) });
    const deniedGroups = await admin.request.get("/api/lanflow/rubber-weight-alert/groups");
    expect(deniedGroups.status()).toBe(403);
    expect(deniedGroups.headers()["cache-control"]).toContain("no-store");
    const anonymousGroups = await anonymous.request.get("/api/lanflow/rubber-weight-alert/groups");
    expect(anonymousGroups.status()).toBe(401);
    expect(anonymousGroups.headers()["cache-control"]).toContain("no-store");

    const check = await admin.request.get("/api/lanflow/rubber-weight-alert");
    expect(check.ok(), await check.text()).toBeTruthy();
    expect(check.headers()["cache-control"]).toContain("no-store");
    expect((await check.json()).config).toEqual({ thresholdKg: 10_000, intervalMinutes: 30 });
    expect((await (await admin.request.get("/api/lanflow")).json()).rubberWeightAlertConfig)
      .toEqual({ thresholdKg: 10_000, intervalMinutes: 30 });
  } finally {
    await manager.request.put("/api/lanflow/admin/rubber-weight-alert", {
      data: { intervalMinutes: 60 },
    }).catch(() => undefined);
    await Promise.all([manager.close(), admin.close(), user.close(), anonymous.close()]);
  }
});

test.describe("rubber weight alert UI", () => {
  test.use({ storageState: "playwright/.auth/super_admin.json" });

  test("saves the central interval with inline accessible validation on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await clearAlertTimestamp(page);
    await page.route("**/api/lanflow/rubber-weight-alert", (route) => route.fulfill({ json: emptyCheck }));
    await page.route("**/api/lanflow/rubber-weight-alert/groups", (route) => route.fulfill({
      json: { groups: [], availableLocationIds: [] },
    }));
    let writes = 0;
    await page.route("**/api/lanflow/admin/rubber-weight-alert", async (route) => {
      writes += 1;
      expect(route.request().postDataJSON()).toEqual({ intervalMinutes: 30 });
      if (writes === 1) {
        await route.fulfill({ status: 500, json: { error: "บันทึกไม่สำเร็จ กรุณาลองใหม่" } });
        return;
      }
      await route.fulfill({ json: { thresholdKg: 10_000, intervalMinutes: 30 } });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Admin", exact: true }).click();
    await page.getByRole("button", { name: "แจ้งเตือนน้ำหนัก", exact: true }).click();
    const interval = page.getByLabel("รอบตรวจ (นาที)");
    await expect(interval).toHaveValue("60");

    await interval.fill("0");
    await page.getByRole("button", { name: "บันทึกรอบตรวจ", exact: true }).click();
    await expect(page.getByText("รอบตรวจต้องอยู่ระหว่าง 1–1,440 นาที", { exact: true })).toBeVisible();
    await expect(interval).toHaveAttribute("aria-invalid", "true");

    await interval.fill("30");
    await page.getByRole("button", { name: "บันทึกรอบตรวจ", exact: true }).click();
    await expect(page.getByText("บันทึกไม่สำเร็จ กรุณาลองใหม่", { exact: true })).toBeVisible();
    await expect(interval).toHaveValue("30");
    await page.getByRole("button", { name: "บันทึกรอบตรวจ", exact: true }).click();
    await expect(page.getByText("บันทึกรอบตรวจแล้ว", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });

  test("shows one sorted mobile dialog and refresh does not check again", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await clearAlertTimestamp(page);
    let checks = 0;
    await page.route("**/api/lanflow/rubber-weight-alert", async (route) => {
      checks += 1;
      await route.fulfill({ json: qualifyingCheck() });
    });

    await page.goto("/");
    const dialog = page.getByRole("alertdialog", { name: "น้ำหนักยางสุทธิสะสมเกินเกณฑ์" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("listitem")).toHaveCount(2);
    await expect(dialog.getByRole("listitem").nth(0)).toContainText("25,500.5");
    await expect(dialog.getByRole("heading", { name: "กลุ่ม 2" })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "กลุ่ม 4" })).toBeVisible();
    await expect(dialog.getByText("20,000 กก.", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "รับทราบ", exact: true })).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await dialog.getByRole("button", { name: "รับทราบ", exact: true }).click();
    await expect(dialog).toBeHidden();

    await page.reload();
    await page.waitForTimeout(500);
    expect(checks).toBe(1);
  });

  test("alert uses the top layer and restores focus to the existing Admin dialog", async ({ page }) => {
    await clearAlertTimestamp(page);
    let releaseCheck: (() => void) | undefined;
    const holdCheck = new Promise<void>((resolve) => { releaseCheck = resolve; });
    await page.route("**/api/lanflow/rubber-weight-alert", async (route) => {
      await holdCheck;
      await route.fulfill({ json: qualifyingCheck() });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Admin", exact: true }).click();
    await page.getByRole("button", { name: "จัดการ", exact: true }).first().click();
    const adminDialog = page.getByRole("dialog", { name: "จัดการพนักงาน" });
    await expect(adminDialog).toBeVisible();
    const focusTarget = adminDialog.getByRole("button", { name: "ปิด", exact: true });
    await focusTarget.focus();
    releaseCheck?.();

    const alertDialog = page.getByRole("alertdialog", { name: "น้ำหนักยางสุทธิสะสมเกินเกณฑ์" });
    await expect(alertDialog).toBeVisible();
    expect(await alertDialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        ?.closest("dialog") === element;
    })).toBeTruthy();
    await page.keyboard.press("Escape");
    await expect(alertDialog).toBeHidden();
    await expect(focusTarget).toBeFocused();
    await expect(adminDialog).toBeVisible();
  });

  test("retries once, shows one failure message, and stops until the next interval", async ({ page }) => {
    await clearAlertTimestamp(page);
    let checks = 0;
    await page.route("**/api/lanflow/rubber-weight-alert", async (route) => {
      checks += 1;
      await route.fulfill({ status: 500, json: { error: "temporary failure" } });
    });

    await page.goto("/");
    await expect(page.getByText(
      "ตรวจการแจ้งเตือนน้ำหนักไม่สำเร็จ ระบบจะลองใหม่ในรอบถัดไป",
      { exact: true },
    )).toBeVisible();
    expect(checks).toBe(2);
    await page.waitForTimeout(500);
    expect(checks).toBe(2);
  });

  test("does not poll continuously when alert localStorage is unavailable", async ({ page }) => {
    await page.addInitScript(() => {
      const originalGetItem = Storage.prototype.getItem;
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.getItem = function getItem(key) {
        if (key.startsWith("lanflow:rubber-weight-alert:last-checked:")) {
          throw new DOMException("Storage unavailable", "SecurityError");
        }
        return originalGetItem.call(this, key);
      };
      Storage.prototype.setItem = function setItem(key, value) {
        if (key.startsWith("lanflow:rubber-weight-alert:last-checked:")) {
          throw new DOMException("Storage unavailable", "SecurityError");
        }
        return originalSetItem.call(this, key, value);
      };
    });
    let checks = 0;
    await page.route("**/api/lanflow/rubber-weight-alert", async (route) => {
      checks += 1;
      await route.fulfill({ json: emptyCheck });
    });

    await page.goto("/");
    await expect.poll(() => checks).toBeGreaterThan(0);
    await page.waitForTimeout(500);
    expect(checks).toBe(1);
  });

  test("ignores a stale check response after LanFlow unmounts", async ({ page }) => {
    await clearAlertTimestamp(page);
    let requestStarted: (() => void) | undefined;
    let releaseCheck: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { requestStarted = resolve; });
    const held = new Promise<void>((resolve) => { releaseCheck = resolve; });
    await page.route("**/api/lanflow/rubber-weight-alert", async (route) => {
      requestStarted?.();
      await held;
      await route.fulfill({ json: qualifyingCheck() });
    });

    await page.goto("/");
    await started;
    await page.evaluate(() => { window.location.href = "/login"; });
    releaseCheck?.();
    await page.waitForURL("**/login");
    await expect(page.getByRole("alertdialog", { name: "น้ำหนักยางสุทธิสะสมเกินเกณฑ์" }))
      .toHaveCount(0);
  });
});

test("regular Admin cannot see the global alert settings tab", async ({ browser }) => {
  const context = await contextFor("admin", browser);
  const page = await context.newPage();
  await page.route("**/api/lanflow/rubber-weight-alert", (route) => route.fulfill({ json: emptyCheck }));
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Admin", exact: true }).click();
    await expect(page.getByRole("button", { name: "แจ้งเตือนน้ำหนัก", exact: true })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("User shell never calls the rubber weight alert endpoint", async ({ browser }) => {
  const context = await contextFor("user", browser);
  const page = await context.newPage();
  let checks = 0;
  await page.route("**/api/lanflow/rubber-weight-alert", async (route) => {
    checks += 1;
    await route.fulfill({ json: qualifyingCheck() });
  });
  try {
    await page.goto("/");
    await page.waitForTimeout(500);
    expect(checks).toBe(0);
    await expect(page.getByRole("alertdialog", { name: "น้ำหนักยางสุทธิสะสมเกินเกณฑ์" }))
      .toHaveCount(0);
  } finally {
    await context.close();
  }
});
