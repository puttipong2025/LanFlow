import { expect, test } from "@playwright/test";

test.describe("admin employee state feedback", () => {
  test.use({ storageState: "playwright/.auth/super_admin.json" });

  test("adds the server-confirmed employee without refetching the employee list", async ({ page }) => {
    const createdUser = {
      id: "d4631215-980b-4823-aa20-a5988dce5720",
      name: "พนักงานที่สร้างทันที",
      phone: "0866666666",
      role: "user",
      isActive: true,
      locationIds: [],
      primaryLocationId: null,
      canAccessSystemManager: false,
      canAccessMoneyTransfer: false,
      canManageTimePayroll: false,
    };
    let employeeListReads = 0;

    await page.route(/\/api\/lanflow\/admin\/users(?:\?.*)?$/, async (route) => {
      if (route.request().method() === "GET") {
        employeeListReads += 1;
        await route.fulfill({ json: { users: [] } });
        return;
      }
      if (route.request().method() === "POST") {
        await route.fulfill({ status: 201, json: { user: createdUser } });
        return;
      }
      await route.continue();
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Admin" }).click();
    const readsBeforeCreate = employeeListReads;
    await page.getByRole("button", { name: "เพิ่มพนักงาน" }).click();
    const dialog = page.getByRole("dialog", { name: "เพิ่มพนักงาน" });
    await dialog.getByLabel("ชื่อ").fill(createdUser.name);
    await dialog.getByLabel("เบอร์โทร").fill(createdUser.phone);
    await dialog.getByLabel("รหัสผ่าน").fill("password123");
    await dialog.getByRole("button", { name: "สร้างพนักงาน" }).click();

    const employeeRow = page.getByRole("row").filter({ hasText: createdUser.phone });
    await expect(employeeRow).toContainText(createdUser.name);
    await expect(employeeRow).toContainText("User");
    expect(employeeListReads).toBe(readsBeforeCreate);
  });

  test("shows the confirmed account status immediately without refetching the employee list", async ({ page }) => {
    const targetUser = {
      id: "8a2dc75e-6ef7-46c5-9a60-465582fb7454",
      name: "พนักงานทดสอบสถานะทันที",
      phone: "0899999999",
      role: "user",
      isActive: true,
      locationIds: [],
      primaryLocationId: null,
      canAccessSystemManager: false,
      canAccessMoneyTransfer: false,
      canManageTimePayroll: false,
    };
    let employeeListReads = 0;
    let releaseStatusUpdate!: () => void;
    let markStatusRequested!: () => void;
    const statusUpdateReleased = new Promise<void>((resolve) => { releaseStatusUpdate = resolve; });
    const statusRequested = new Promise<void>((resolve) => { markStatusRequested = resolve; });

    await page.route(/\/api\/lanflow\/admin\/users(?:\?.*)?$/, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }

      employeeListReads += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ users: [targetUser] }),
      });
    });
    await page.route(
      `/api/lanflow/admin/users/${targetUser.id}/status`,
      async (route) => {
        markStatusRequested();
        await statusUpdateReleased;
        await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, isActive: false }),
        });
      },
    );

    await page.goto("/");
    await page.getByRole("button", { name: "Admin" }).click();
    await page.getByLabel("ค้นหาพนักงาน").fill(targetUser.phone);

    const employeeRow = page.getByRole("row").filter({ hasText: targetUser.phone });
    await expect(employeeRow).toBeVisible();
    await employeeRow.getByRole("button", { name: "จัดการ" }).click();

    const dialog = page.getByRole("dialog", { name: "จัดการพนักงาน" });
    const readsBeforeMutation = employeeListReads;
    await dialog.getByRole("button", { name: "ระงับบัญชี" }).click();
    await page.getByRole("button", { name: "ยืนยัน", exact: true }).click();

    await statusRequested;
    await expect(dialog.getByRole("button", { name: "ระงับบัญชี" })).toBeDisabled();
    releaseStatusUpdate();
    await expect(dialog.getByRole("button", { name: "กู้คืนบัญชี" })).toBeVisible();
    await expect(dialog.getByText("บัญชีถูกระงับ บทบาทและสิทธิ์ทั้งหมดจึงเป็นแบบอ่านอย่างเดียว")).toBeVisible();
    expect(employeeListReads).toBe(readsBeforeMutation);
  });

  test("applies every confirmed role and permission response to the open employee dialog", async ({ page }) => {
    const targetUser = {
      id: "53d2dcb4-5203-4b2a-a7ef-da783bda3b75",
      name: "พนักงานทดสอบสิทธิ์ทันที",
      phone: "0888888888",
      role: "admin",
      isActive: true,
      locationIds: [],
      primaryLocationId: null,
      canAccessSystemManager: false,
      canAccessMoneyTransfer: false,
      canManageTimePayroll: false,
    };
    let employeeListReads = 0;

    await page.route(/\/api\/lanflow\/admin\/users(?:\?.*)?$/, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      employeeListReads += 1;
      await route.fulfill({ json: { users: [targetUser] } });
    });
    await page.route(
      new RegExp(`/api/lanflow/admin/users/${targetUser.id}/(role|system-manager-access|money-transfer-access|time-payroll-access)$`),
      async (route) => {
        const path = new URL(route.request().url()).pathname.split("/").at(-1);
        const body = route.request().postDataJSON() as Record<string, boolean | string>;
        const responses: Record<string, Record<string, boolean | string>> = {
          "role": { success: true, role: String(body.role) },
          "system-manager-access": {
            success: true,
            canAccessSystemManager: body.canAccessSystemManager === true,
            canAccessMoneyTransfer: true,
            canManageTimePayroll: true,
          },
          "money-transfer-access": { success: true, canAccessMoneyTransfer: body.canAccessMoneyTransfer === true },
          "time-payroll-access": { success: true, canManageTimePayroll: body.canManageTimePayroll === true },
        };
        await route.fulfill({ json: responses[path ?? ""] });
      },
    );

    await page.goto("/");
    await page.getByRole("button", { name: "Admin" }).click();
    await page.getByLabel("ค้นหาพนักงาน").fill(targetUser.phone);
    const employeeRow = page.getByRole("row").filter({ hasText: targetUser.phone });
    await employeeRow.getByRole("button", { name: "จัดการ" }).click();
    const dialog = page.getByRole("dialog", { name: "จัดการพนักงาน" });
    const readsBeforeMutations = employeeListReads;

    for (const action of ["เปิดสิทธิ์โอนเงิน", "เปิดสิทธิ์เวลา/เงินเดือน", "เปิดผู้จัดการระบบ"] as const) {
      await dialog.getByRole("button", { name: action }).click();
      await page.getByRole("button", { name: "ยืนยัน", exact: true }).click();
      await expect(dialog.getByRole("button", { name: action.replace("เปิด", "ปิด") })).toBeVisible();
    }

    await dialog.getByRole("button", { name: "ปิดผู้จัดการระบบ" }).click();
    await page.getByRole("button", { name: "ยืนยัน", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "เปิดผู้จัดการระบบ" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "ปิดสิทธิ์โอนเงิน" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "ปิดสิทธิ์เวลา/เงินเดือน" })).toBeVisible();

    await dialog.getByRole("button", { name: "ลดเป็น User" }).click();
    await page.getByRole("button", { name: "ยืนยัน", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "ตั้งเป็น Admin" })).toBeVisible();
    await expect(dialog.getByText("ต้องตั้งเป็น Admin ก่อน", { exact: true })).toBeVisible();
    expect(employeeListReads).toBe(readsBeforeMutations);
  });

  test("keeps the confirmed employee profile instead of overwriting it with a stale list read", async ({ page }) => {
    const targetUser = {
      id: "e2af16dd-09e2-4b42-83e4-b576f5cc59f3",
      name: "ชื่อพนักงานเดิม",
      phone: "0877777777",
      role: "user",
      isActive: true,
      locationIds: [],
      primaryLocationId: null,
      canAccessSystemManager: false,
      canAccessMoneyTransfer: false,
      canManageTimePayroll: false,
    };
    const updatedUser = { ...targetUser, name: "ชื่อพนักงานใหม่" };
    let employeeListReads = 0;

    await page.route(/\/api\/lanflow\/admin\/users(?:\?.*)?$/, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      employeeListReads += 1;
      await route.fulfill({ json: { users: [targetUser] } });
    });
    await page.route(`/api/lanflow/admin/users/${targetUser.id}/profile`, (route) => route.fulfill({
      json: { user: updatedUser, auditId: "3cb013c0-f2a7-4253-91fd-5974db386652" },
    }));

    await page.goto("/");
    await page.getByRole("button", { name: "Admin" }).click();
    await page.getByLabel("ค้นหาพนักงาน").fill(targetUser.phone);
    const employeeRow = page.getByRole("row").filter({ hasText: targetUser.phone });
    await employeeRow.getByRole("button", { name: "จัดการ" }).click();
    const dialog = page.getByRole("dialog", { name: "จัดการพนักงาน" });
    const readsBeforeMutation = employeeListReads;

    await dialog.getByLabel("ชื่อ").fill(updatedUser.name);
    await dialog.getByRole("button", { name: "บันทึกข้อมูลและสาขา" }).click();

    await expect(dialog.getByText(`${updatedUser.name} · ${updatedUser.phone}`)).toBeVisible();
    expect(employeeListReads).toBe(readsBeforeMutation);
    await dialog.getByRole("button", { name: "ปิด", exact: true }).click();
    await expect(employeeRow).toContainText(updatedUser.name);
  });
});
