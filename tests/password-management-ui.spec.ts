import { expect, test, type Browser } from "@playwright/test";

async function rolePage(browser: Browser, role: "user" | "admin" | "super_admin") {
  const context = await browser.newContext({ storageState: `playwright/.auth/${role}.json` });
  return { context, page: await context.newPage() };
}

for (const role of ["user", "admin", "super_admin"] as const) {
  test(`${role} can open the self password form from the header`, async ({ browser }) => {
    const { context, page } = await rolePage(browser, role);
    try {
      await page.goto("/");
      const action = page.getByRole("button", { name: "เปลี่ยนรหัสผ่าน", exact: true }).first();
      await expect(action).toBeVisible();
      await action.click();
      const dialog = page.getByRole("dialog", { name: "เปลี่ยนรหัสผ่านของฉัน" });
      await expect(dialog.getByLabel("รหัสผ่านปัจจุบัน", { exact: true })).toBeVisible();
      await expect(dialog.getByLabel("รหัสผ่านใหม่", { exact: true })).toBeVisible();
      await expect(dialog.getByLabel("ยืนยันรหัสผ่านใหม่", { exact: true })).toBeVisible();
    } finally {
      await context.close();
    }
  });
}

test("self password form reports validation and success beside the action", async ({ browser }) => {
  const { context, page } = await rolePage(browser, "super_admin");
  let requestBody: Record<string, string> | null = null;
  try {
    await page.route("/api/auth/password", async (route) => {
      requestBody = route.request().postDataJSON() as Record<string, string>;
      await route.fulfill({ json: { success: true, readablePasswordAvailable: true } });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "เปลี่ยนรหัสผ่าน", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "เปลี่ยนรหัสผ่านของฉัน" });
    await dialog.getByLabel("รหัสผ่านปัจจุบัน", { exact: true }).fill("current-password");
    await dialog.getByLabel("รหัสผ่านใหม่", { exact: true }).fill("new-password");
    await dialog.getByLabel("ยืนยันรหัสผ่านใหม่", { exact: true }).fill("different-password");
    await dialog.getByRole("button", { name: "ยืนยันเปลี่ยนรหัสผ่าน" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน");

    await dialog.getByLabel("ยืนยันรหัสผ่านใหม่", { exact: true }).fill("new-password");
    await dialog.getByRole("button", { name: "ยืนยันเปลี่ยนรหัสผ่าน" }).click();
    await expect(dialog.getByRole("status")).toHaveText("เปลี่ยนรหัสผ่านแล้ว อุปกรณ์นี้ยังใช้งานต่อได้");
    expect(requestBody).toEqual({
      currentPassword: "current-password",
      newPassword: "new-password",
      confirmPassword: "new-password",
    });
  } finally {
    await context.close();
  }
});

test("only Super Admin gets the fetch-on-reveal password control", async ({ browser }) => {
  const target = {
    id: "bbd8f4f8-dda7-451f-8c42-1beddd24d27d",
    name: "พนักงานทดสอบเปิดดูรหัสผ่าน",
    phone: "0854444444",
    role: "user",
    isActive: true,
    locationIds: [],
    primaryLocationId: null,
    canAccessSystemManager: false,
    canAccessMoneyTransfer: false,
    canManageTimePayroll: false,
  };

  for (const role of ["super_admin", "admin"] as const) {
    const { context, page } = await rolePage(browser, role);
    let revealAvailable = true;
    try {
      await page.route(/\/api\/lanflow\/admin\/users(?:\?.*)?$/, (route) => route.fulfill({ json: { users: [target] } }));
      await page.route(`/api/lanflow/admin/users/${target.id}/password`, (route) => route.fulfill({
        json: revealAvailable
          ? { available: true, password: "visible-password" }
          : { available: false },
      }));
      await page.goto("/");
      await page.getByRole("button", { name: "Admin" }).click();
      await page.getByLabel("ค้นหาพนักงาน").fill(target.phone);
      await page.getByRole("row").filter({ hasText: target.phone }).getByRole("button", { name: "จัดการ" }).click();
      const dialog = page.getByRole("dialog", { name: "จัดการพนักงาน" });

      if (role === "super_admin") {
        await expect(dialog.getByText("••••••••", { exact: true })).toBeVisible();
        await dialog.getByRole("button", { name: "แสดง", exact: true }).click();
        await expect(dialog.getByText("visible-password", { exact: true })).toBeVisible();
        await dialog.getByRole("button", { name: "ซ่อน", exact: true }).click();
        await expect(dialog.getByText("••••••••", { exact: true })).toBeVisible();
        revealAvailable = false;
        await dialog.getByRole("button", { name: "แสดง", exact: true }).click();
        await expect(dialog.getByText("ยังไม่มีข้อมูล", { exact: true })).toBeVisible();
      } else {
        await expect(dialog.getByRole("heading", { name: "รหัสผ่านปัจจุบัน" })).toHaveCount(0);
        await expect(dialog.getByRole("button", { name: "แสดง", exact: true })).toHaveCount(0);
      }
    } finally {
      await context.close();
    }
  }
});
