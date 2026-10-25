import { test, expect } from "@playwright/test";

const target = { id: "bbd8f4f8-dda7-451f-8c42-1beddd24d27d", name: "SMS UI fixture", phone: "0854444444", role: "admin", isActive: true, locationIds: [], primaryLocationId: null, smsRequired: false };

test("Super Admin sees SMS under permissions and phone change beside the phone", async ({ browser }) => {
  const context = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
  const page = await context.newPage();
  const updates: Array<{ path: string; body: Record<string, unknown> }> = [];
  try {
    await page.route(/\/api\/lanflow\/admin\/users$/, route => route.fulfill({ json: { users: [target] } }));
    await page.route(`/api/lanflow/admin/users/${target.id}/sms`, async route => {
      updates.push({ path: "sms", body: route.request().postDataJSON() });
      await route.fulfill({ json: { success: true, smsRequired: true } });
    });
    await page.route(`/api/lanflow/admin/users/${target.id}/phone`, async route => {
      updates.push({ path: "phone", body: route.request().postDataJSON() });
      await route.fulfill({ json: { success: true, phone: "0854444445" } });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Admin", exact: true }).click();
    await page.getByRole("row").filter({ hasText: target.phone }).getByRole("button", { name: "จัดการ", exact: true }).click();
    const parent = page.getByRole("dialog", { name: "จัดการพนักงาน", exact: true });
    await expect(parent.getByText("สิทธิ์และสถานะ", { exact: true })).toBeVisible();
    await parent.getByLabel("ยืนยัน SMS เพิ่มอีกขั้น").click();
    const confirmation = page.getByRole("alertdialog", { name: "เปิดการยืนยัน SMS?", exact: true });
    await expect(confirmation).toBeVisible();
    expect(updates).toHaveLength(0);
    await confirmation.getByRole("button", { name: "ยืนยัน", exact: true }).click();
    await expect(parent.getByLabel("ยืนยัน SMS เพิ่มอีกขั้น")).toBeChecked();
    expect(updates[0]).toEqual({ path: "sms", body: { required: true } });
    await parent.getByRole("button", { name: "เปลี่ยนเบอร์โทร", exact: true }).click();
    const phone = page.getByRole("alertdialog", { name: "เปลี่ยนเบอร์โทร", exact: true });
    await expect(phone.getByLabel("รหัสผ่านปัจจุบัน")).toHaveCount(0);
    await phone.getByLabel("เบอร์โทรใหม่").fill("0854444445");
    await phone.getByRole("button", { name: "ยืนยันเปลี่ยนเบอร์", exact: true }).click();
    await expect(phone).toHaveCount(0);
    expect(updates[1]).toEqual({ path: "phone", body: { phone: "0854444445", currentPassword: "" } });
    await expect(parent.getByText("0854444445", { exact: true })).toBeVisible();
  } finally { await context.close(); }
});

test("ordinary Admin cannot change phone or toggle SMS", async ({ browser }) => {
  const context = await browser.newContext({ storageState: "playwright/.auth/admin.json" });
  const page = await context.newPage();
  try {
    await page.route(/\/api\/lanflow\/admin\/users$/, route => route.fulfill({ json: { users: [target] } }));
    await page.goto("/");
    await page.getByRole("button", { name: "Admin", exact: true }).click();
    await page.getByRole("row").filter({ hasText: target.phone }).getByRole("button", { name: "จัดการ", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "จัดการพนักงาน", exact: true });
    await expect(dialog.getByRole("button", { name: "เปลี่ยนเบอร์โทร", exact: true })).toHaveCount(0);
    await expect(dialog.getByLabel("ยืนยัน SMS เพิ่มอีกขั้น")).toHaveCount(0);
  } finally { await context.close(); }
});
