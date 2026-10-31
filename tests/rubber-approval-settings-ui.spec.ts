import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { installThresholdAlertHandler } from "./helpers/dismiss-threshold-alert";

async function openApproval(page: Page) {
  await installThresholdAlertHandler(page);
  await page.goto("/");
  await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
  await page.getByRole("button", { name: /ตั้งค่าและอนุมัติบิลยาง/ }).click();
  const dialog = page.getByRole("dialog", { name: "ตั้งค่าและอนุมัติบิลยาง" });
  await expect(dialog.getByTestId("approval-group-list")).toBeVisible();
  return dialog;
}

test.describe.serial("Rubber approval settings layout and permissions", () => {
  test.setTimeout(90_000);
  for (const width of [375, 1280]) {
    test(`system settings are collapsed and preserve drafts at ${width}px`, async ({ browser }, testInfo) => {
      const context = await browser.newContext({ storageState: "playwright/.auth/super_admin.json", viewport: { width, height: 900 } });
      try {
        const page = await context.newPage();
        const dialog = await openApproval(page);
        const toggle = dialog.getByRole("button", { name: "ตั้งค่าระบบ", exact: true });
        await expect(toggle).toHaveAttribute("aria-expanded", "false");
        await expect(dialog.getByRole("heading", { name: "งานรออนุมัติบิลยาง" })).toBeVisible();
        await expect(dialog.getByRole("heading", { name: "กลุ่มราคาและเวลา" })).toBeVisible();
        await expect(dialog.getByLabel("ราคากลางใหม่")).toBeHidden();
        await expect(dialog.getByRole("checkbox", { name: "ขออนุมัติเมื่อวันที่บิลไม่ใช่วันปัจจุบัน" })).toBeHidden();
        await toggle.click();
        await expect(dialog.getByRole("button", { name: "ซ่อนการตั้งค่าระบบ", exact: true })).toHaveAttribute("aria-expanded", "true");
        const centralInput = dialog.getByLabel("ราคากลางใหม่");
        await expect(centralInput).toBeVisible();
        await centralInput.fill("43.25");
        const guardedCard = dialog.getByRole("heading", { name: "เพดานราคาและกฎวันที่บิล" }).locator("../..").locator("..");
        const centralCard = dialog.getByRole("heading", { name: "ราคากลางยางทั้งระบบ" }).locator("..");
        const centralBounds = await centralCard.boundingBox();
        const guardedBounds = await guardedCard.boundingBox();
        expect(centralBounds!.y + centralBounds!.height).toBeLessThanOrEqual(guardedBounds!.y);
        await expect(guardedCard.getByLabel("ราคายางที่กำหนดสูงสุด (บาท/กก.)", { exact: true })).toBeVisible();
        const dateRule = guardedCard.getByRole("checkbox", { name: "ขออนุมัติเมื่อวันที่บิลไม่ใช่วันปัจจุบัน" });
        await expect(dateRule).toBeEnabled();
        await dialog.getByRole("button", { name: "ซ่อนการตั้งค่าระบบ", exact: true }).press("Enter");
        await expect(centralInput).toBeHidden();
        await toggle.click();
        await expect(centralInput).toHaveValue("43.25");
        expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        await guardedCard.screenshot({ path: testInfo.outputPath(`settings-${width}.png`) });

        // Exercise the real save path once, restoring the global value afterwards.
        if (width === 375) {
          const original = await dateRule.isChecked();
          const locationId = await dialog.getByRole("combobox").inputValue();
          try {
            await dateRule.setChecked(!original);
            const saved = page.waitForResponse(response => response.request().method() === "PUT" && /approval-settings\?/.test(response.url()));
            await dialog.getByRole("button", { name: "บันทึกกฎวันที่", exact: true }).click();
            const response = await saved;
            expect(response.status()).toBe(200);
            const persisted = await context.request.get(`/api/lanflow/rubber-bills/approval-settings?locationId=${locationId}`);
            expect(persisted.status()).toBe(200);
            expect((await persisted.json()).nonCurrentDateRequiresApproval).toBe(!original);
            await expect(dialog.getByRole("button", { name: "บันทึกกฎวันที่", exact: true })).toBeDisabled();
          } finally {
            const restored = await context.request.put(`/api/lanflow/rubber-bills/approval-settings?locationId=${locationId}`, { data: { nonCurrentDateRequiresApproval: original } });
            expect(restored.status(), await restored.text()).toBe(200);
          }
        }
      } finally { await context.close(); }
    });
  }

  test("saving unrelated group defaults preserves the unsaved global date rule", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
    const before = await context.request.get("/api/lanflow/rubber-bills/approval-groups");
    expect(before.status()).toBe(200);
    const original = (await before.json()).ungroupedDefaults;
    try {
      const page = await context.newPage();
      const dialog = await openApproval(page);
      await dialog.getByRole("button", { name: "ตั้งค่าระบบ", exact: true }).click();
      const dateRule = dialog.getByRole("checkbox", { name: "ขออนุมัติเมื่อวันที่บิลไม่ใช่วันปัจจุบัน" });
      await expect(dateRule).toBeEnabled();
      const draft = !await dateRule.isChecked();
      await dateRule.setChecked(draft);
      const ungrouped = dialog.getByTestId("ungrouped-approval-settings");
      await ungrouped.getByRole("button", { name: "แก้ไข", exact: true }).click();
      await ungrouped.getByLabel("เวลาแก้ไขได้ (นาที)").fill(original.editWindowMinutes === 30 ? "31" : "30");
      const refreshed = page.waitForResponse(response => response.request().method() === "GET" && /approval-settings\?/.test(response.url()));
      await ungrouped.getByRole("button", { name: "บันทึกการตั้งค่า", exact: true }).click();
      await refreshed;
      await expect(ungrouped.getByRole("button", { name: "แก้ไข", exact: true })).toBeVisible();
      await expect(dateRule).toBeEnabled();
      if (draft) await expect(dateRule).toBeChecked();
      else await expect(dateRule).not.toBeChecked();
      await expect(dialog.getByRole("button", { name: "บันทึกกฎวันที่", exact: true })).toBeEnabled();
    } finally {
      const latest = await context.request.get("/api/lanflow/rubber-bills/approval-groups");
      const defaults = (await latest.json()).ungroupedDefaults;
      const restored = await context.request.put("/api/lanflow/rubber-bills/approval-settings/ungrouped", { data: { editWindowMinutes: original.editWindowMinutes, priceAllowance: original.priceAllowance, expectedRevision: defaults.revision } });
      expect(restored.status()).toBe(200);
      await context.close();
    }
  });

  test("disconnecting disables settings without discarding drafts or submitting them on reconnect", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
    try {
      const page = await context.newPage();
      let writes = 0;
      page.on("request", request => { if (["POST", "PUT", "DELETE"].includes(request.method()) && /rubber-bills\/approval-(settings|groups)/.test(request.url())) writes++; });
      const dialog = await openApproval(page);
      await dialog.getByRole("button", { name: "ตั้งค่าระบบ", exact: true }).click();
      const central = dialog.getByLabel("ราคากลางใหม่");
      await central.fill("43.25");
      const ungrouped = dialog.getByTestId("ungrouped-approval-settings");
      await ungrouped.getByRole("button", { name: "แก้ไข", exact: true }).click();
      const minutes = ungrouped.getByLabel("เวลาแก้ไขได้ (นาที)");
      await minutes.fill("45");
      await page.evaluate(() => {
        Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
        window.dispatchEvent(new Event("offline"));
      });
      await expect(central).toBeDisabled();
      await expect(minutes).toBeDisabled();
      await expect(dialog.getByRole("button", { name: "เปลี่ยนราคากลาง", exact: true })).toBeDisabled();
      await expect(ungrouped.getByRole("button", { name: "บันทึกการตั้งค่า", exact: true })).toBeDisabled();
      await dialog.getByRole("button", { name: "ซ่อนการตั้งค่าระบบ", exact: true }).click();
      await dialog.getByRole("button", { name: "ตั้งค่าระบบ", exact: true }).click();
      await page.evaluate(() => {
        Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
        window.dispatchEvent(new Event("online"));
      });
      await expect(central).toBeEnabled();
      await expect(minutes).toHaveValue("45");
      await expect(central).toHaveValue("43.25");
      expect(writes).toBe(0);
    } finally { await context.close(); }
  });

  test("malformed group reads show an error without crashing the dialog", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
    try {
      const page = await context.newPage();
      await installThresholdAlertHandler(page);
      const crashes: string[] = [];
      page.on("pageerror", error => crashes.push(error.message));
      await page.route("**/api/lanflow/rubber-bills/approval-groups", async route => {
        const response = await route.fetch();
        await route.fulfill({ response, json: { ...await response.json(), groups: {} } });
      });
      await page.goto("/");
      await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
      await page.getByRole("button", { name: /ตั้งค่าและอนุมัติบิลยาง/ }).click();
      const dialog = page.getByRole("dialog", { name: "ตั้งค่าและอนุมัติบิลยาง" });
      await expect(dialog.getByRole("alert").filter({ hasText: "ระบบไม่ตอบกลับข้อมูลการตั้งค่าตามรูปแบบที่กำหนด" })).toBeVisible();
      expect(crashes).toEqual([]);
    } finally { await context.close(); }
  });

  test("a malformed central-price acknowledgement retains the draft and shows an error", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
    try {
      const page = await context.newPage();
      await page.route("**/api/lanflow/rubber-bills/approval-settings/central", route => route.fulfill({ status: 200, json: {} }));
      const dialog = await openApproval(page);
      await dialog.getByRole("button", { name: "ตั้งค่าระบบ", exact: true }).click();
      const central = dialog.getByLabel("ราคากลางใหม่");
      const original = await central.getAttribute("placeholder");
      const draft = (Number(original) + 0.01).toFixed(2);
      await central.fill(draft);
      await dialog.getByRole("button", { name: "เปลี่ยนราคากลาง", exact: true }).click();
      await page.getByRole("alertdialog", { name: "ยืนยันเปลี่ยนราคากลาง?" }).getByRole("button", { name: "ยืนยันราคากลาง", exact: true }).click();
      await expect(page.getByText("ระบบไม่ตอบกลับข้อมูลการตั้งค่าตามรูปแบบที่กำหนด", { exact: true })).toBeVisible();
      await expect(central).toHaveValue(draft);
      await expect(central).toHaveAttribute("placeholder", original!);
    } finally { await context.close(); }
  });

  test("a same-frame double confirmation sends only one settings request and locks pending fields", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    try {
      const page = await context.newPage();
      let writes = 0;
      await page.route("**/api/lanflow/rubber-bills/approval-settings/central", async route => {
        writes++;
        await gate;
        await route.fulfill({ status: 503, json: { errorMessage: "ทดสอบบริการไม่พร้อมใช้งาน" } });
      });
      const dialog = await openApproval(page);
      await dialog.getByRole("button", { name: "ตั้งค่าระบบ", exact: true }).click();
      const central = dialog.getByLabel("ราคากลางใหม่");
      const draft = (Number(await central.getAttribute("placeholder")) + 0.01).toFixed(2);
      await central.fill(draft);
      await dialog.getByRole("button", { name: "เปลี่ยนราคากลาง", exact: true }).click();
      const confirmation = page.getByRole("alertdialog", { name: "ยืนยันเปลี่ยนราคากลาง?" });
      await confirmation.getByRole("button", { name: "ยืนยันราคากลาง", exact: true }).evaluate(button => {
        if (!(button instanceof HTMLButtonElement)) throw new Error("Expected confirmation button");
        button.click(); button.click();
      });
      await expect.poll(() => writes).toBe(1);
      await expect(central).toBeDisabled();
      await expect(dialog.getByTestId("ungrouped-approval-settings").getByRole("button", { name: "แก้ไข", exact: true })).toBeDisabled();
      release();
      await expect(confirmation).toBeHidden();
      await expect(page.getByText("ทดสอบบริการไม่พร้อมใช้งาน", { exact: true })).toBeVisible();
      await expect(central).toBeEnabled();
      await expect(central).toHaveValue(draft);
      expect(writes).toBe(1);
    } finally { release(); await context.close(); }
  });

  test("an offline confirmation reports failure promptly without waiting for reconnect", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
    try {
      const page = await context.newPage();
      let writes = 0;
      page.on("request", request => { if (request.method() === "PUT" && /rubber-bills\/approval-settings/.test(request.url())) writes++; });
      const dialog = await openApproval(page);
      await dialog.getByRole("button", { name: "ตั้งค่าระบบ", exact: true }).click();
      const central = dialog.getByLabel("ราคากลางใหม่");
      const draft = (Number(await central.getAttribute("placeholder")) + 0.01).toFixed(2);
      await central.fill(draft);
      await dialog.getByRole("button", { name: "เปลี่ยนราคากลาง", exact: true }).click();
      const confirmation = page.getByRole("alertdialog", { name: "ยืนยันเปลี่ยนราคากลาง?" });
      await page.evaluate(() => {
        Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
        window.dispatchEvent(new Event("offline"));
      });
      await confirmation.getByRole("button", { name: "ยืนยันราคากลาง", exact: true }).click();
      await expect(confirmation).toBeHidden({ timeout: 3_000 });
      await expect(page.getByText("การตั้งค่าบิลยางใช้ได้เมื่อออนไลน์เท่านั้น", { exact: true })).toBeVisible();
      await expect(central).toHaveValue(draft);
      expect(writes).toBe(0);
    } finally { await context.close(); }
  });

  test("system managers can read date rules but cannot edit through UI or API", async ({ browser, request }) => {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const managerId = "00000000-0000-4000-8000-000000000002";
    const previous = await db.from("profiles").select("can_access_super_admin_features").eq("id", managerId).single();
    expect(previous.error).toBeNull();
    const context = await browser.newContext({ storageState: "playwright/.auth/admin.json" });
    try {
      expect((await db.from("profiles").update({ can_access_super_admin_features: true }).eq("id", managerId)).error).toBeNull();
      const page = await context.newPage();
      const dialog = await openApproval(page);
      await dialog.getByRole("button", { name: "ตั้งค่าระบบ", exact: true }).click();
      const dateRule = dialog.getByRole("checkbox", { name: "ขออนุมัติเมื่อวันที่บิลไม่ใช่วันปัจจุบัน" });
      await expect(dateRule).toBeDisabled();
      await expect(dialog.getByRole("button", { name: "บันทึกกฎวันที่", exact: true })).toHaveCount(0);
      await expect(dialog.getByLabel("ราคายางที่กำหนดสูงสุด (บาท/กก.)", { exact: true })).toHaveCount(0);
      await expect(dialog.getByLabel("ราคากลางใหม่")).toBeEnabled();
      await expect(dialog.getByTestId("ungrouped-approval-settings").getByRole("button", { name: "แก้ไข", exact: true })).toBeEnabled();
      const locationId = await dialog.getByRole("combobox").inputValue();
      const url = `/api/lanflow/rubber-bills/approval-settings?locationId=${locationId}`;
      expect((await context.request.get(url)).status()).toBe(200);
      expect((await context.request.put(url, { data: { nonCurrentDateRequiresApproval: true } })).status()).toBe(403);
      expect((await request.put(url, { data: { nonCurrentDateRequiresApproval: true } })).status()).toBe(401);
    } finally {
      expect((await db.from("profiles").update({ can_access_super_admin_features: previous.data!.can_access_super_admin_features }).eq("id", managerId)).error).toBeNull();
      await context.close();
    }
  });
});
