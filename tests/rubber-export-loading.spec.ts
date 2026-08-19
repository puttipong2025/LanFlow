import { expect, test } from "@playwright/test";
import { selectAppLocation } from "./helpers/select-app-location";

test.use({ storageState: "playwright/.auth/super_admin.json" });

test("Rubber Export keeps options and audit lazy on initial entry", async ({ page }) => {
  const meResponse = await page.request.get("/api/auth/me");
  expect(meResponse.ok()).toBeTruthy();
  const me = await meResponse.json() as { profile: { locationIds: string[] } };
  const locationId = me.profile.locationIds[0];
  let listRequests = 0;
  let optionRequests = 0;
  let auditRequests = 0;

  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/lanflow/rubber-exports/options") optionRequests += 1;
    if (url.pathname === "/api/lanflow/rubber-exports") {
      if (url.searchParams.get("view") === "deletions") auditRequests += 1;
      else listRequests += 1;
    }
  });

  await page.goto("/");
  await selectAppLocation(page, locationId);
  await page.getByRole("button", { name: /^ส่งออกยาง/ }).click();
  await expect.poll(() => listRequests).toBeGreaterThan(0);
  expect(optionRequests).toBe(0);
  expect(auditRequests).toBe(0);

  await page.getByRole("button", { name: "สร้างรายการ" }).click();
  await expect.poll(() => optionRequests).toBe(1);
  const createDialog = page.getByRole("dialog", { name: "สร้างรายการส่งออกยาง" });
  if (await createDialog.isVisible()) await createDialog.getByRole("button", { name: "ปิด" }).click();
  await page.getByRole("button", { name: "ประวัติการลบ" }).click();
  await expect.poll(() => auditRequests).toBe(1);
});
