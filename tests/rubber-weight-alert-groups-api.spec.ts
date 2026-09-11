import { expect, test, type Browser } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function service() {
  expect(serviceRoleKey).toBeTruthy();
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function managerContext(browser: Browser) {
  return browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
}

test.describe.serial("rubber weight alert groups", () => {
  test("manages groups, preserves inactive members, and serializes competing creates", async ({ browser }) => {
    const manager = await managerContext(browser);
    const db = service();
    const locationIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    const suffix = locationIds[0].replaceAll("-", "").slice(0, 6).toUpperCase();
    const names = [`สาขาแจ้งเตือน A ${suffix}`, `สาขาแจ้งเตือน B ${suffix}`, `สาขาปิด ${suffix}`];
    const groupIds = new Set<string>();
    try {
      expect((await db.from("locations").insert(locationIds.map((id, index) => ({
        id,
        name: names[index],
        code: `WA${index}${suffix}`,
        is_active: index !== 2,
      })))).error).toBeNull();

      const initialList = await manager.request.get("/api/lanflow/rubber-weight-alert/groups");
      expect(initialList.ok(), await initialList.text()).toBeTruthy();
      expect(await initialList.json()).toMatchObject({
        availableLocationIds: expect.arrayContaining(locationIds.slice(0, 2)),
      });

      const page = await manager.newPage();
      await page.route("**/api/lanflow/rubber-weight-alert", (route) => route.fulfill({
        json: { config: { thresholdKg: 10_000, intervalMinutes: 60 }, candidates: [] },
      }));
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/");
      await page.getByRole("button", { name: "Admin", exact: true }).click();
      await page.getByRole("button", { name: "แจ้งเตือนน้ำหนัก", exact: true }).click();
      const groupList = page.getByTestId("rubber-weight-alert-group-list");
      await expect(groupList.locator(":scope > *").first()).toContainText("ยังไม่จัดกลุ่ม");
      await expect(groupList.locator(":scope > *").first()).toContainText(names[0]);
      await page.getByRole("button", { name: "สร้างกลุ่ม", exact: true }).click();
      await page.getByLabel("เกณฑ์น้ำหนักสุทธิสะสม (กก.)").fill("20000");
      await page.getByLabel(names[0], { exact: true }).check();
      await page.getByRole("button", { name: "บันทึกกลุ่ม", exact: true }).click();
      await expect(page.getByText("สร้างกลุ่มแล้ว การตรวจรอบถัดไปจะเริ่มใช้กลุ่มนี้", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();

      const afterCreate = await manager.request.get("/api/lanflow/rubber-weight-alert/groups");
      const createdGroup = (await afterCreate.json() as {
        groups: Array<{ id: string; locationIds: string[]; thresholdKg: number }>;
      }).groups.find((group) => group.locationIds.includes(locationIds[0]));
      expect(createdGroup).toMatchObject({ locationIds: [locationIds[0]], thresholdKg: 20_000 });
      expect(createdGroup).not.toHaveProperty("updatedAt");
      groupIds.add(createdGroup!.id);

      expect((await db.from("locations").update({ is_active: false }).eq("id", locationIds[0])).error).toBeNull();
      const updated = await manager.request.put(`/api/lanflow/rubber-weight-alert/groups/${createdGroup!.id}`, {
        data: { locationIds: [locationIds[1]], thresholdKg: 25_000 },
      });
      expect(updated.ok(), await updated.text()).toBeTruthy();
      const updatedGroup = await updated.json();
      expect(updatedGroup.locationIds).toEqual(expect.arrayContaining(locationIds.slice(0, 2)));
      expect(updatedGroup).not.toHaveProperty("updatedAt");

      await page.reload();
      await page.getByRole("button", { name: "Admin", exact: true }).click();
      await page.getByRole("button", { name: "แจ้งเตือนน้ำหนัก", exact: true }).click();
      const inactiveGroup = page.locator("article").filter({ hasText: names[0] });
      await expect(inactiveGroup).toContainText("ปิดใช้งาน");
      await inactiveGroup.getByRole("button", { name: "แก้ไข", exact: true }).click();
      const inactiveCheckbox = page.getByRole("checkbox", { name: new RegExp(names[0]) });
      await expect(inactiveCheckbox).toBeChecked();
      await expect(inactiveCheckbox).toBeDisabled();
      await page.getByRole("button", { name: "ยกเลิก", exact: true }).click();

      expect((await db.from("locations").update({ is_active: true }).eq("id", locationIds[0])).error).toBeNull();
      const retained = await db.from("rubber_weight_alert_group_locations")
        .select("location_id")
        .eq("group_id", createdGroup!.id);
      expect(retained.error).toBeNull();
      expect(retained.data?.map((row) => row.location_id).sort()).toEqual(locationIds.slice(0, 2).sort());

      const inactiveCreate = await manager.request.post("/api/lanflow/rubber-weight-alert/groups", {
        data: { locationIds: [locationIds[2]], thresholdKg: 10_000 },
      });
      expect(inactiveCreate.status()).toBe(404);

      expect((await manager.request.delete(`/api/lanflow/rubber-weight-alert/groups/${createdGroup!.id}`)).ok()).toBeTruthy();
      groupIds.delete(createdGroup!.id);

      const competing = await Promise.all([30_000, 40_000].map((thresholdKg) => manager.request.post(
        "/api/lanflow/rubber-weight-alert/groups",
        { data: { locationIds: [locationIds[1]], thresholdKg } },
      )));
      expect(competing.map((response) => response.status()).sort()).toEqual([201, 409]);
      const winner = competing.find((response) => response.status() === 201)!;
      groupIds.add((await winner.json() as { id: string }).id);
    } finally {
      for (const groupId of groupIds) {
        await manager.request.delete(`/api/lanflow/rubber-weight-alert/groups/${groupId}`).catch(() => undefined);
      }
      await db.from("rubber_weight_alert_group_locations").delete().in("location_id", locationIds);
      await db.from("locations").delete().in("id", locationIds);
      await manager.close();
    }
  });
});
