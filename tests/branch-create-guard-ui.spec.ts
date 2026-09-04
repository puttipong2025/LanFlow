import { expect, test, type Page } from "@playwright/test";
import { selectAppLocation } from "./helpers/select-app-location";

type Bootstrap = {
  locations: Array<{ id: string; name: string; active: boolean }>;
  profile: {
    id: string;
    locationIds: string[];
    primaryLocationId: string | null;
  };
};

async function loadBranches(page: Page) {
  const response = await page.request.get("/api/lanflow");
  expect(response.ok(), await response.text()).toBeTruthy();
  const bootstrap = await response.json() as Bootstrap;
  const accessible = bootstrap.locations.filter((location) =>
    location.active && bootstrap.profile.locationIds.includes(location.id)
  );
  const primary = accessible.find((location) => location.id === bootstrap.profile.primaryLocationId)
    ?? accessible[0];
  const secondary = accessible.filter((location) => location.id !== primary?.id);
  expect(primary).toBeTruthy();
  expect(secondary.length).toBeGreaterThanOrEqual(2);
  return { bootstrap, primary: primary!, secondary };
}

async function mockBranchContext(
  page: Page,
  bootstrap: Bootstrap,
  primaryLocationId: string | null,
  locationIds = bootstrap.profile.locationIds,
) {
  await page.route(/\/api\/lanflow(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...bootstrap,
        profile: { ...bootstrap.profile, primaryLocationId, locationIds },
      }),
    });
  });
}

function branchGuard(page: Page) {
  return page.getByRole("alertdialog", { name: "ยืนยันสาขาก่อนสร้างรายการ" });
}

async function chooseBranch(page: Page, branchName: string) {
  await branchGuard(page).getByRole("button", {
    name: `เลือกสาขา ${branchName}`,
    exact: true,
  }).click();
}

async function closeDialog(page: Page, name: string) {
  const dialog = page.getByRole("dialog", { name });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "ปิด", exact: true }).click();
}

test.describe("branch create guard quiz", () => {
  test.use({ storageState: "playwright/.auth/super_admin.json" });

  test("tests primary and secondary branches and shares one acknowledgement across the three target tabs", async ({ page }) => {
    test.setTimeout(90_000);
    const { bootstrap, primary, secondary } = await loadBranches(page);
    const [branchA, branchB] = secondary;
    await mockBranchContext(page, bootstrap, primary.id);
    await page.addInitScript(({ userId, primaryLocationId }) => {
      if (sessionStorage.getItem("branch-create-guard-test-ready")) return;
      sessionStorage.setItem("branch-create-guard-test-ready", "true");
      localStorage.removeItem(`lanflow:branch-create-guard:v2:${userId}`);
      localStorage.setItem(`lanflow:last-location:${userId}`, primaryLocationId);
    }, { userId: bootstrap.profile.id, primaryLocationId: primary.id });
    await page.route("**/api/lanflow/rubber-exports/options?**", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        availableBills: [{
          reportItemId: "00000000-0000-4000-8000-000000000901",
          billId: "00000000-0000-4000-8000-000000000902",
          billDate: "2026-09-04",
          billNo: "RB-TEST",
          customerName: "ลูกค้าทดสอบ",
          eligibilityAt: "2026-09-04T00:00:00.000Z",
          netWeight: 100,
          paidAmount: 1000,
          rubberValueAmount: 1000,
        }],
      }),
    }));

    await page.goto("/");
    const locationButton = page.getByLabel(/^เลือกสาขา/);
    await expect(locationButton).toBeVisible({ timeout: 15_000 });
    await expect(locationButton).not.toHaveAccessibleName(/สาขารอง|ไม่มีสาขาหลัก/);

    await page.getByRole("button", { name: /^รับ-จ่าย/ }).click();
    await page.getByRole("button", { name: "เพิ่มรายรับ", exact: true }).click();
    let guard = branchGuard(page);
    await expect(guard).toBeVisible();
    const optionNames = await guard.locator("fieldset button").allTextContents();
    expect(optionNames).toHaveLength(3);
    expect(optionNames).toContain(primary.name);
    const wrongName = optionNames.find((name) => name !== primary.name);
    expect(wrongName).toBeTruthy();
    await guard.evaluate((dialog, names) => {
      const buttons = [...dialog.querySelectorAll<HTMLButtonElement>("fieldset button")];
      buttons.find((button) => button.textContent?.trim() === names.wrong)?.click();
      buttons.find((button) => button.textContent?.trim() === names.correct)?.click();
    }, { wrong: wrongName!, correct: primary.name });
    await expect(guard).toBeHidden();
    await expect(page.getByRole("dialog", { name: "เพิ่ม/แก้ไข บิลเงินสด" })).toHaveCount(0);
    await expect(page.getByText(
      "เลือกสาขาไม่ตรงกับสาขาปัจจุบัน กรุณาตรวจสอบใหม่",
      { exact: true },
    )).toBeVisible();

    await page.getByRole("button", { name: "เพิ่มรายรับ", exact: true }).click();
    guard = branchGuard(page);
    await expect(guard).toBeVisible();
    await expect(page.getByText(
      "เลือกสาขาไม่ตรงกับสาขาปัจจุบัน กรุณาตรวจสอบใหม่",
      { exact: true },
    )).toHaveCount(0);
    const correctPrimaryChoice = guard.getByRole("button", {
      name: `เลือกสาขา ${primary.name}`,
      exact: true,
    });
    await correctPrimaryChoice.focus();
    await expect(correctPrimaryChoice).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(guard).toBeHidden();
    await closeDialog(page, "เพิ่ม/แก้ไข บิลเงินสด");

    await selectAppLocation(page, branchA.id);
    await expect(locationButton).toHaveAccessibleName(/สาขารอง/);
    await expect(locationButton.getByText("สาขารอง", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "เพิ่มรายรับ", exact: true }).click();
    guard = branchGuard(page);
    await expect(guard).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(guard).toBeHidden();
    await expect(page.getByRole("dialog", { name: "เพิ่ม/แก้ไข บิลเงินสด" })).toHaveCount(0);

    await page.getByRole("button", { name: "เพิ่มรายรับ", exact: true }).click();
    guard = branchGuard(page);
    await chooseBranch(page, branchA.name);
    await expect(guard).toBeHidden();
    await closeDialog(page, "เพิ่ม/แก้ไข บิลเงินสด");

    await page.getByRole("button", { name: /^บิลยาง/ }).click();
    await page.getByRole("button", { name: "เพิ่มบิลยาง", exact: true }).click();
    await expect(branchGuard(page)).toHaveCount(0);
    await closeDialog(page, "บิลเครื่องชั่งเล็ก");

    await page.getByRole("button", { name: /^ส่งออกยาง/ }).click();
    await page.getByRole("button", { name: "สร้างรายการ", exact: true }).click();
    await expect(branchGuard(page)).toHaveCount(0);
    await closeDialog(page, "สร้างรายการส่งออกยาง");

    await page.reload();
    await expect(locationButton).toHaveAccessibleName(/สาขารอง/);
    await page.getByRole("button", { name: /^รับ-จ่าย/ }).click();
    await page.getByRole("button", { name: "เพิ่มรายรับ", exact: true }).click();
    await expect(branchGuard(page)).toHaveCount(0);
    await closeDialog(page, "เพิ่ม/แก้ไข บิลเงินสด");

    await selectAppLocation(page, branchB.id);
    await page.getByRole("button", { name: "เพิ่มรายรับ", exact: true }).click();
    await expect(branchGuard(page)).toBeVisible();
    await page.keyboard.press("Escape");

    await selectAppLocation(page, branchA.id);
    await page.getByRole("button", { name: "เพิ่มรายรับ", exact: true }).click();
    await expect(branchGuard(page)).toBeVisible();
  });

  test("tests the active branch when the account has no primary branch", async ({ page }) => {
    const { bootstrap, primary } = await loadBranches(page);
    await mockBranchContext(page, bootstrap, null);
    await page.addInitScript(({ userId, locationId }) => {
      localStorage.removeItem(`lanflow:branch-create-guard:v2:${userId}`);
      localStorage.setItem(`lanflow:last-location:${userId}`, locationId);
    }, { userId: bootstrap.profile.id, locationId: primary.id });

    await page.goto("/");
    const locationButton = page.getByLabel(/^เลือกสาขา/);
    await expect(locationButton).toBeVisible({ timeout: 15_000 });
    await expect(locationButton).toHaveAccessibleName(/ไม่มีสาขาหลัก/);
    await expect(locationButton.getByText("ไม่มีสาขาหลัก", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: /^รับ-จ่าย/ }).click();
    await page.getByRole("button", { name: "เพิ่มรายรับ", exact: true }).click();
    const guard = branchGuard(page);
    await expect(guard).toBeVisible();
    await expect(guard.getByRole("button", {
      name: `เลือกสาขา ${primary.name}`,
      exact: true,
    })).toBeVisible();
  });

  test("bypasses the quiz for an account that manages one branch", async ({ page }) => {
    const { bootstrap, primary } = await loadBranches(page);
    await mockBranchContext(page, bootstrap, primary.id, [primary.id]);
    await page.addInitScript(({ userId, locationId }) => {
      localStorage.removeItem(`lanflow:branch-create-guard:v2:${userId}`);
      localStorage.setItem(`lanflow:last-location:${userId}`, locationId);
    }, { userId: bootstrap.profile.id, locationId: primary.id });

    await page.goto("/");
    const locationButton = page.getByLabel(/^เลือกสาขา/);
    await expect(locationButton).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /^รับ-จ่าย/ }).click();
    await page.getByRole("button", { name: "เพิ่มรายรับ", exact: true }).click();
    await expect(branchGuard(page)).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "เพิ่ม/แก้ไข บิลเงินสด" })).toBeVisible();
  });

  test("allows only the first action to continue when guarded requests overlap", async ({ page }) => {
    const { bootstrap, primary, secondary } = await loadBranches(page);
    const branch = secondary[0];
    await mockBranchContext(page, bootstrap, primary.id);
    await page.addInitScript(({ userId }) => {
      localStorage.removeItem(`lanflow:branch-create-guard:v2:${userId}`);
    }, { userId: bootstrap.profile.id });

    await page.goto("/");
    await expect(page.getByLabel(/^เลือกสาขา/)).toBeVisible({ timeout: 15_000 });
    await selectAppLocation(page, branch.id);
    await page.getByRole("button", { name: /^รับ-จ่าย/ }).click();
    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("button")];
      buttons.find((button) => button.textContent?.trim() === "เพิ่มรายรับ")?.click();
      buttons.find((button) => button.textContent?.trim() === "เพิ่มรายจ่าย")?.click();
    });

    const guard = branchGuard(page);
    await expect(guard).toBeVisible();
    await chooseBranch(page, branch.name);

    const modal = page.getByRole("dialog", { name: "เพิ่ม/แก้ไข บิลเงินสด" });
    await expect(modal).toBeVisible();
    await expect(modal.getByRole("button", { name: /รายรับทั่วไป/ })).toHaveAttribute("aria-pressed", "true");
    await expect(modal.getByRole("button", { name: "ค่าใช้จ่าย", exact: true })).toHaveCount(0);
  });

  test("keeps excluded actions unguarded and closes confirmation before a native target dialog", async ({ page, context }) => {
    test.setTimeout(60_000);
    const { bootstrap, primary, secondary } = await loadBranches(page);
    const branch = secondary[0];
    await mockBranchContext(page, bootstrap, primary.id);
    await page.addInitScript(({ userId }) => {
      if (sessionStorage.getItem("branch-create-guard-native-test-ready")) return;
      sessionStorage.setItem("branch-create-guard-native-test-ready", "true");
      localStorage.removeItem(`lanflow:branch-create-guard:v2:${userId}`);
    }, { userId: bootstrap.profile.id });

    await page.goto("/");
    await expect(page.getByLabel(/^เลือกสาขา/)).toBeVisible({ timeout: 15_000 });
    await selectAppLocation(page, branch.id);
    await page.getByRole("button", { name: /^บิลยาง/ }).click();

    await page.getByRole("button", { name: "บัตรคิว", exact: true }).click();
    await expect(branchGuard(page)).toHaveCount(0);
    await closeDialog(page, "บัตรคิว");

    await page.getByRole("tab", { name: "บิลรถส่งออก (WEX)" }).click();
    const createWex = page.getByRole("button", { name: "สร้างบิลรถส่งออก", exact: true });
    await expect(createWex).toBeEnabled({ timeout: 15_000 });
    await createWex.click();
    let guard = branchGuard(page);
    await expect(guard).toBeVisible();

    await context.setOffline(true);
    await expect(guard).toBeHidden();
    await expect.poll(() => page.evaluate(({ userId }) => {
      const raw = localStorage.getItem(`lanflow:branch-create-guard:v2:${userId}`);
      return raw ? JSON.parse(raw).acknowledged : null;
    }, { userId: bootstrap.profile.id })).toBe(false);

    await context.setOffline(false);
    await expect(createWex).toBeEnabled();
    await createWex.click();
    guard = branchGuard(page);
    await chooseBranch(page, branch.name);

    const wexDialog = page.getByRole("dialog", { name: "สร้างบิลรถส่งออก" });
    await expect(guard).toBeHidden();
    await expect(wexDialog).toBeVisible();
    await expect(page.locator("dialog[open]")).toHaveCount(1);
    await expect(wexDialog.getByRole("button", { name: "ปิด", exact: true })).toBeFocused();
  });

  test("runs the Rubber Export availability precondition before asking for branch confirmation", async ({ page }) => {
    test.setTimeout(60_000);
    const { bootstrap, primary, secondary } = await loadBranches(page);
    const branch = secondary[0];
    await mockBranchContext(page, bootstrap, primary.id);
    await page.addInitScript(({ userId }) => {
      localStorage.removeItem(`lanflow:branch-create-guard:v2:${userId}`);
    }, { userId: bootstrap.profile.id });

    let releaseOptions!: () => void;
    const optionsBlocked = new Promise<void>((resolve) => { releaseOptions = resolve; });
    let optionsRequested = false;
    await page.route("**/api/lanflow/rubber-exports/options?**", async (route) => {
      optionsRequested = true;
      await optionsBlocked;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          availableBills: [{
            reportItemId: "00000000-0000-4000-8000-000000000911",
            billId: "00000000-0000-4000-8000-000000000912",
            billDate: "2026-09-04",
            billNo: "RB-PRECONDITION",
            customerName: "ลูกค้าทดสอบ",
            eligibilityAt: "2026-09-04T00:00:00.000Z",
            netWeight: 100,
            paidAmount: 1000,
            rubberValueAmount: 1000,
          }],
        }),
      });
    });

    try {
      await page.goto("/");
      await expect(page.getByLabel(/^เลือกสาขา/)).toBeVisible({ timeout: 15_000 });
      await selectAppLocation(page, branch.id);
      await page.getByRole("button", { name: /^ส่งออกยาง/ }).click();
      await page.getByRole("button", { name: "สร้างรายการ", exact: true }).click();

      await expect.poll(() => optionsRequested).toBe(true);
      await expect(branchGuard(page)).toHaveCount(0);
      releaseOptions();
      await expect(branchGuard(page)).toBeVisible();
    } finally {
      releaseOptions();
    }
  });
});
