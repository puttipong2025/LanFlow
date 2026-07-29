import { expect, test } from "@playwright/test";
import {
  selectAppLocation,
  selectedAppLocationId,
} from "./helpers/select-app-location";

test.describe("last location preference", () => {
  test.use({ storageState: "playwright/.auth/super_admin.json" });

  test("restores the latest location after reload and logout/login", async ({ page }) => {
    const response = await page.request.get("/api/lanflow");
    expect(response.ok(), await response.text()).toBeTruthy();
    const data = await response.json() as {
      locations: Array<{ id: string }>;
      profile: { id: string; locationIds: string[] };
    };
    const accessibleLocations = data.locations.filter((location) =>
      data.profile.locationIds.includes(location.id)
    );
    expect(accessibleLocations.length).toBeGreaterThan(0);

    if (accessibleLocations.length === 1) {
      const onlyLocationId = accessibleLocations[0].id;

      await page.goto("/");
      await expect(page.getByLabel(/^เลือกสาขา/)).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => selectedAppLocationId(page)).toBe(onlyLocationId);

      await page.evaluate(
        ({ userId }) => localStorage.setItem(
          `lanflow:last-location:${userId}`,
          "retired-location",
        ),
        { userId: data.profile.id },
      );
      await page.reload();

      await expect.poll(() => selectedAppLocationId(page)).toBe(onlyLocationId);
      return;
    }

    const targetLocationId = accessibleLocations[accessibleLocations.length - 1].id;

    await page.goto("/");
    await expect(page.getByLabel(/^เลือกสาขา/)).toBeVisible({ timeout: 15_000 });
    await selectAppLocation(page, targetLocationId);
    await expect.poll(() => selectedAppLocationId(page)).toBe(targetLocationId);

    await page.reload();
    await expect.poll(() => selectedAppLocationId(page)).toBe(targetLocationId);

    await page.getByRole("button", { name: "ออกจากระบบ", exact: true }).click();
    await page.getByRole("button", { name: "ออกจากระบบ", exact: true }).last().click();
    await expect(page.getByRole("button", { name: "เข้าสู่ระบบ" })).toBeVisible({
      timeout: 10_000,
    });
    await expect.poll(() =>
      page.evaluate(
        ({ userId }) => localStorage.getItem(`lanflow:last-location:${userId}`),
        { userId: data.profile.id },
      )
    ).toBe(targetLocationId);

    await page.locator("#phone").fill(process.env.TEST_PHONE ?? "0800000000");
    await page.locator("#password").fill(process.env.TEST_PASSWORD ?? "password123");
    await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();

    await expect(page.getByLabel(/^เลือกสาขา/)).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => selectedAppLocationId(page)).toBe(targetLocationId);
  });
});
