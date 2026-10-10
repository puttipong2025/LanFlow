import { expect, test } from "@playwright/test";

const landscapeViewports = [
  { name: "small-iphone", width: 568, height: 320 },
  { name: "small-android", width: 640, height: 360 },
  { name: "large-android", width: 740, height: 360 },
  { name: "iphone", width: 852, height: 393 },
] as const;

test("PWA manifest permits both portrait and landscape orientations", async ({ request }) => {
  const response = await request.get("/manifest.json");
  expect(response.ok()).toBeTruthy();

  const manifest = await response.json() as { orientation?: string };
  expect(manifest.orientation).toBe("any");
});

for (const viewport of landscapeViewports) {
  test(`keeps the app shell usable at ${viewport.name} landscape`, async ({ browser }) => {
    const context = await browser.newContext({
      storageState: "playwright/.auth/super_admin.json",
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: true,
      isMobile: true,
    });

    try {
      const page = await context.newPage();
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "LanFlow" })).toBeVisible({
        timeout: 15_000,
      });

      const shell = page.getByRole("heading", { name: "LanFlow" })
        .locator("xpath=ancestor::section[1]");
      await expect(shell).toBeVisible();
      const shellBox = await shell.boundingBox();
      expect(shellBox).not.toBeNull();
      expect(shellBox!.height).toBeLessThanOrEqual(Math.floor(viewport.height / 2));

      await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
        "content",
        /viewport-fit=cover/,
      );

      const viewportMetrics = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(viewportMetrics.scrollWidth).toBeLessThanOrEqual(viewportMetrics.clientWidth);

      const navigation = page.getByRole("navigation");
      expect(await navigation.evaluate((element) => getComputedStyle(element).flexWrap))
        .toBe("nowrap");

      const branchButton = page.getByRole("button", { name: /^เลือกสาขา/ });
      await expect(branchButton).toBeVisible();
      expect((await branchButton.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await branchButton.click();

      const listbox = page.getByRole("listbox", { name: "สาขาที่เข้าถึงได้" });
      await expect(listbox).toBeVisible();
      const listboxBox = await listbox.boundingBox();
      expect(listboxBox).not.toBeNull();
      expect(listboxBox!.x).toBeGreaterThanOrEqual(0);
      expect(listboxBox!.x + listboxBox!.width).toBeLessThanOrEqual(viewport.width);
      await page.keyboard.press("Escape");

      const passwordButton = page.getByRole("button", { name: "เปลี่ยนรหัสผ่าน" });
      await passwordButton.click();
      const dialog = page.getByRole("dialog", { name: "เปลี่ยนรหัสผ่านของฉัน" });
      await expect(dialog).toBeVisible();
      const dialogBox = await dialog.boundingBox();
      expect(dialogBox).not.toBeNull();
      expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
      expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
      expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(viewport.width);
      expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(viewport.height);
      await expect(dialog.getByRole("button", { name: "ปิด" })).toBeVisible();

    } finally {
      await context.close();
    }
  });
}

test("keeps custom modal controls touchable in small landscape", async ({ browser }) => {
  const safeArea = { top: 0, right: 59, bottom: 21, left: 59 };
  const context = await browser.newContext({
    storageState: "playwright/.auth/super_admin.json",
    viewport: { width: 852, height: 393 },
    hasTouch: true,
    isMobile: true,
  });

  try {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: safeArea });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "LanFlow" })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("navigation").getByRole("button", { name: /ลูกค้า/ }).click();
    const addCustomerButton = page.getByRole("button", { name: "เพิ่มลูกค้าใหม่" });
    await expect(addCustomerButton).toBeVisible({ timeout: 15_000 });
    await addCustomerButton.click();

    const dialog = page.getByRole("dialog", { name: "เพิ่มข้อมูลลูกค้า / สมาชิกใหม่" });
    await expect(dialog).toBeVisible();
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox).not.toBeNull();
    expect(dialogBox!.x).toBeGreaterThanOrEqual(safeArea.left);
    expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(852 - safeArea.right);

    const closeButton = dialog.getByRole("button", { name: "ปิด" });
    await expect(closeButton).toBeVisible();
    const closeButtonBox = await closeButton.boundingBox();
    expect(closeButtonBox).not.toBeNull();
    expect(closeButtonBox!.width).toBeGreaterThanOrEqual(44);
    expect(closeButtonBox!.height).toBeGreaterThanOrEqual(44);
  } finally {
    await context.close();
  }
});

test("keeps every accessible module inside a small landscape viewport", async ({ browser }) => {
  const viewport = { width: 640, height: 360 };
  const context = await browser.newContext({
    storageState: "playwright/.auth/super_admin.json",
    viewport,
    hasTouch: true,
    isMobile: true,
  });

  try {
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "LanFlow" })).toBeVisible({
      timeout: 15_000,
    });

    const navigation = page.getByRole("navigation");
    const tabs = navigation.getByRole("button");
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThan(0);

    for (let index = 0; index < tabCount; index += 1) {
      const tab = tabs.nth(index);
      await tab.scrollIntoViewIfNeeded();
      if (await tab.isDisabled()) continue;

      await tab.click();
      await expect(tab).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByText("กำลังโหลดโมดูล...", { exact: true })).toHaveCount(0, {
        timeout: 15_000,
      });
      await expect.poll(() => page.evaluate(() => (
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      ))).toBe(true);
    }
  } finally {
    await context.close();
  }
});
