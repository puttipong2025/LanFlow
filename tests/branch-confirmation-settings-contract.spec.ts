import { expect, test, type Browser } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

async function contextFor(role: "super_admin" | "admin" | "user", browser: Browser) {
  return browser.newContext({ storageState: `playwright/.auth/${role}.json` });
}

test("bootstrap exposes the setting to active accounts and only managers can save it", async ({ browser }) => {
  const manager = await contextFor("super_admin", browser);
  const admin = await contextFor("admin", browser);
  const user = await contextFor("user", browser);
  try {
    for (const context of [manager, admin, user]) {
      const response = await context.request.get("/api/lanflow");
      expect(response.ok(), await response.text()).toBeTruthy();
      expect((await response.json()).confirmationMinutes).toBe(15);
    }

    expect((await admin.request.put("/api/lanflow/admin/branch-confirmation", {
      data: { confirmationMinutes: 30 },
    })).status()).toBe(403);

    for (const confirmationMinutes of [true, "15", null, 0, 121, 1.5]) {
      const response = await manager.request.put("/api/lanflow/admin/branch-confirmation", {
        data: { confirmationMinutes },
      });
      expect(response.status()).toBe(400);
    }

    const saved = await manager.request.put("/api/lanflow/admin/branch-confirmation", {
      data: { confirmationMinutes: 30 },
    });
    expect(saved.ok(), await saved.text()).toBeTruthy();
    expect(saved.headers()["cache-control"]).toContain("no-store");
    expect(await saved.json()).toEqual({ confirmationMinutes: 30 });
    expect((await (await admin.request.get("/api/lanflow")).json()).confirmationMinutes).toBe(30);
  } finally {
    await manager.request.put("/api/lanflow/admin/branch-confirmation", {
      data: { confirmationMinutes: 15 },
    }).catch(() => undefined);
    await Promise.all([manager.close(), admin.close(), user.close()]);
  }
});

test("setting read failure stays isolated from locations and profile bootstrap", () => {
  const source = readFileSync(resolve(process.cwd(), "src/app/api/lanflow/route.ts"), "utf8");
  expect(source).toContain('console.error("Branch confirmation setting load failed"');
  expect(source).toContain("const confirmationMinutes = confirmationResult.error");
  expect(source).not.toContain("if (confirmationResult.error) throw");
});

test.describe("branch confirmation settings UI", () => {
  test.use({ storageState: "playwright/.auth/super_admin.json" });

  test("saves one integer without a confirmation dialog and handles permission loss", async ({ page }) => {
    let writes = 0;
    await page.route("**/api/lanflow/admin/branch-confirmation", async (route) => {
      writes += 1;
      await route.fulfill({ status: 403, json: { error: "ไม่มีสิทธิ์จัดการการตั้งค่านี้" } });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Admin", exact: true }).click();
    await page.getByRole("button", { name: "ยืนยันสาขา", exact: true }).click();
    const input = page.getByLabel("ระยะยืนยันสาขา (นาที)");
    await expect(input).toHaveValue("15");
    await input.fill("30");
    await page.getByRole("button", { name: "บันทึกระยะยืนยัน", exact: true }).click();
    expect(writes).toBe(1);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "พนักงาน", exact: true })).toHaveAttribute("aria-pressed", "true");
  });

  test("shows validation and saved feedback beside the action on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await page.route("**/api/lanflow/admin/branch-confirmation", async (route) => {
      expect(route.request().postDataJSON()).toEqual({ confirmationMinutes: 30 });
      await route.fulfill({ json: { confirmationMinutes: 30 } });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Admin", exact: true }).click();
    await page.getByRole("button", { name: "ยืนยันสาขา", exact: true }).click();
    const input = page.getByLabel("ระยะยืนยันสาขา (นาที)");
    await input.fill("121");
    await page.getByRole("button", { name: "บันทึกระยะยืนยัน", exact: true }).click();
    await expect(page.getByText(
      "ระยะยืนยันสาขาต้องอยู่ระหว่าง 1 ถึง 120 นาที",
      { exact: true },
    )).toBeVisible();
    await input.fill("30");
    await page.getByRole("button", { name: "บันทึกระยะยืนยัน", exact: true }).click();
    await expect(page.getByText(
      "บันทึกแล้ว หน้าอื่นจะใช้ค่านี้เมื่อรีเฟรช",
      { exact: true },
    )).toBeVisible();
    await page.getByRole("button", { name: "พนักงาน", exact: true }).click();
    await page.getByRole("button", { name: "ยืนยันสาขา", exact: true }).click();
    await expect(page.getByLabel("ระยะยืนยันสาขา (นาที)")).toHaveValue("30");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    expect(consoleErrors).toEqual([]);
  });
});
