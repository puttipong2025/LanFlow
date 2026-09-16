import { expect, test, type Page } from "@playwright/test";

const counts = { "1": 0, "2": 0, "5": 0, "10": 0, "20": 0, "50": 0, "100": 0, "500": 0, "1000": 1 };
const receipt = {
  id: "confirmed-count", reportId: "confirmed-report", reportNo: "COUNT-CONFIRMED",
  cutoffAt: "2026-09-02T03:00:00.000Z", submittedAt: "2026-09-02T03:10:00.000Z",
  countedByName: "ผู้ตรวจทดสอบ", actualCounts: counts, actualTotal: 1000,
};
const summary = {
  id: receipt.id, reportNo: receipt.reportNo, createdAt: receipt.submittedAt,
  createdByName: receipt.countedByName, actualTotal: 1000, expectedTotal: 1000,
  differenceTotal: 0, analysisStatus: "normal", formulaVersion: "cash-v1",
  isLatestActive: true, rubberExportLockNo: null,
};
const detail = {
  ...summary,
  reportId: receipt.reportId,
  locationId: "detail-location",
  cutoffAt: receipt.cutoffAt,
  status: "active",
  deletedAt: null,
  locationName: "สาขาทดสอบ",
  actualCounts: counts,
  expectedCounts: counts,
  differenceCounts: { "1": 0, "2": 0, "5": 0, "10": 0, "20": 0, "50": 0, "100": 0, "500": 0, "1000": 0 },
  evidence: { highlights: ["ยอดตรงกัน"], limitations: [], references: [] },
};

async function dismissRubberWeightAlertIfVisible(page: Page) {
  const alert = page.getByRole("alertdialog", { name: "น้ำหนักยางสุทธิสะสมเกินเกณฑ์" });
  const appeared = await alert.waitFor({ state: "visible", timeout: 2_000 }).then(() => true).catch(() => false);
  if (!appeared) return;
  await alert.getByRole("button", { name: "รับทราบ", exact: true }).click();
  await alert.waitFor({ state: "hidden" });
}

test.describe("cash count confirmed command / refresh failure", () => {
  test.use({ storageState: "playwright/.auth/super_admin.json" });

  test("loads the next history page without losing or duplicating existing rows", async ({ page }) => {
    const requests: string[] = [];
    await page.route("**/api/lanflow/cash-counts/session?*", (route) => route.fulfill({ json: { session: null } }));
    await page.route(/\/api\/lanflow\/cash-counts\?.*$/, async (route) => {
      const cursor = new URL(route.request().url()).searchParams.get("cursor");
      requests.push(cursor ?? "first");
      await route.fulfill({ json: cursor ? {
        counts: [summary, { ...summary, id: "next-count", reportNo: "COUNT-NEXT" }], hasMore: false, nextCursor: null,
      } : { counts: [summary], hasMore: true, nextCursor: "page-two" } });
    });
    await page.goto("/");
    await dismissRubberWeightAlertIfVisible(page);
    await page.getByRole("button", { name: "นับเงิน", exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: receipt.reportNo })).toBeVisible();
    await page.getByRole("button", { name: "โหลดผลตรวจนับเพิ่ม", exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: "COUNT-NEXT" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: receipt.reportNo })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "โหลดผลตรวจนับเพิ่ม", exact: true })).toHaveCount(0);
    expect(requests).toContain("page-two");
  });

  test("opens cash-count details in a responsive modal with loading, retry, and focus restoration", async ({ page }) => {
    let detailAttempts = 0;
    let releaseFirstAttempt!: () => void;
    const firstAttemptReleased = new Promise<void>((resolve) => { releaseFirstAttempt = resolve; });
    await page.route("**/api/lanflow/cash-counts/session?*", (route) => route.fulfill({ json: { session: null } }));
    await page.route(/\/api\/lanflow\/cash-counts\?.*$/, (route) => route.fulfill({ json: { counts: [summary] } }));
    await page.route("**/api/lanflow/cash-counts/confirmed-count?*", async (route) => {
      detailAttempts += 1;
      if (detailAttempts === 1) {
        await firstAttemptReleased;
        await route.fulfill({ status: 503, json: { error: "DETAIL_UNAVAILABLE" } });
        return;
      }
      await route.fulfill({ json: detail });
    });
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/");
    await dismissRubberWeightAlertIfVisible(page);
    await page.getByRole("button", { name: "นับเงิน", exact: true }).click();
    const trigger = page.getByRole("row").filter({ hasText: receipt.reportNo }).getByRole("button", { name: "ดูรายละเอียด" });
    await trigger.focus();
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: `รายละเอียด ${receipt.reportNo}` });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("status")).toContainText("กำลังโหลดรายละเอียด");
    const panel = dialog.locator(":scope > div > div");
    const mobileBox = await panel.boundingBox();
    expect(mobileBox).not.toBeNull();
    expect(mobileBox!.width).toBe(360);
    expect(mobileBox!.height).toBe(800);

    releaseFirstAttempt();
    await expect(dialog.getByRole("alert")).toContainText("DETAIL_UNAVAILABLE");
    await dialog.getByRole("button", { name: "ลองใหม่สำหรับรายละเอียดผลตรวจนับ" }).click();
    await expect(dialog.getByRole("listitem").filter({ hasText: "ยอดตรงกัน" })).toBeVisible();
    expect(detailAttempts).toBe(2);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await page.setViewportSize({ width: 1280, height: 800 });
    await trigger.click();
    await expect(dialog).toBeVisible();
    const desktopBox = await panel.boundingBox();
    expect(desktopBox).not.toBeNull();
    expect(desktopBox!.width).toBeLessThan(1280);
    expect(desktopBox!.width).toBeGreaterThan(800);
    await page.mouse.click(4, 4);
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "ปิด", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(detailAttempts).toBe(3);
  });

  test("retains a confirmed receipt and retries only history reads at 360px", async ({ page }, testInfo) => {
    let submitted = false;
    let failHistory = true;
    let writes = 0;
    let releaseSubmit!: () => void;
    const submitReleased = new Promise<void>((resolve) => { releaseSubmit = resolve; });
    await page.route("**/api/lanflow/cash-counts/session?*", (route) => route.fulfill({ json: {
      session: { id: "count-session", isOwner: true, cutoffAt: receipt.cutoffAt, expiresAt: "2099-09-02T03:30:00.000Z" },
    } }));
    await page.route(/\/api\/lanflow\/cash-counts(?:\?.*)?$/, async (route) => {
      if (route.request().method() === "POST") {
        writes += 1;
        await submitReleased;
        submitted = true;
        await route.fulfill({ status: 201, json: receipt });
      } else if (submitted && failHistory) {
        await route.fulfill({ status: 503, json: { error: "HISTORY_UNAVAILABLE" } });
      } else {
        await route.fulfill({ json: { counts: submitted ? [summary] : [] } });
      }
    });
    await page.goto("/");
    await dismissRubberWeightAlertIfVisible(page);
    await page.getByRole("button", { name: "นับเงิน", exact: true }).click();
    await page.setViewportSize({ width: 360, height: 800 });
    await page.getByRole("spinbutton", { name: "จำนวนเงินชนิด 1000 บาท" }).fill("1");
    await page.getByRole("button", { name: "ยืนยันและส่งผล" }).click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByRole("button", { name: "ส่งผลตรวจนับ", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "ส่งผลตรวจนับ", exact: true })).toBeDisabled();
    releaseSubmit();
    await expect(page.getByRole("heading", { name: "ส่งผลตรวจนับสำเร็จ" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "ส่งผลสำเร็จ แต่โหลดประวัติใหม่ไม่สำเร็จ" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("confirmed-receipt-warning-360px.png"), fullPage: true });
    await expect(page.getByRole("alert").filter({ hasText: "ส่งผลตรวจนับไม่สำเร็จ" })).toHaveCount(0);
    failHistory = false;
    const retry = page.getByRole("button", { name: "โหลดประวัติใหม่", exact: true });
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("row").filter({ hasText: receipt.reportNo })).toBeVisible();
    await expect(page.getByRole("heading", { name: "ส่งผลตรวจนับสำเร็จ" })).toBeVisible();
    await expect(retry).toHaveCount(0);
    expect(writes).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("keeps the editable form and reports a real command failure", async ({ page }) => {
    await page.route("**/api/lanflow/cash-counts/session?*", (route) => route.fulfill({ json: {
      session: { id: "count-session", isOwner: true, cutoffAt: receipt.cutoffAt, expiresAt: "2099-09-02T03:30:00.000Z" },
    } }));
    await page.route(/\/api\/lanflow\/cash-counts(?:\?.*)?$/, (route) => route.request().method() === "POST"
      ? route.fulfill({ status: 503, json: { error: "ยังไม่ได้บันทึก กรุณาลองใหม่" } })
      : route.fulfill({ json: { counts: [] } }));
    await page.goto("/");
    await dismissRubberWeightAlertIfVisible(page);
    await page.getByRole("button", { name: "นับเงิน", exact: true }).click();
    const input = page.getByRole("spinbutton", { name: "จำนวนเงินชนิด 1000 บาท" });
    await input.fill("1");
    await page.getByRole("button", { name: "ยืนยันและส่งผล" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "ส่งผลตรวจนับ", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "ยังไม่ได้บันทึก กรุณาลองใหม่" })).toBeVisible();
    await expect(input).toHaveValue("1");
    await expect(page.getByRole("heading", { name: "ส่งผลตรวจนับสำเร็จ" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "ยืนยันและส่งผล" })).toBeEnabled();
  });

  for (const failedView of ["current", "deletions"] as const) {
    test(`removes a confirmed deletion even when ${failedView} reconciliation fails`, async ({ page }) => {
      let deleted = false;
      let failHistory = true;
      let writes = 0;
      await page.route("**/api/lanflow/cash-counts/session?*", (route) => route.fulfill({ json: { session: null } }));
      await page.route(/\/api\/lanflow\/cash-counts\?.*$/, async (route) => {
        const view = new URL(route.request().url()).searchParams.get("view") === "deletions" ? "deletions" : "current";
        if (deleted && failHistory && view === failedView) {
          await route.fulfill({ status: 503, json: { error: "HISTORY_UNAVAILABLE" } });
        } else {
          await route.fulfill({ json: view === "deletions"
            ? { deletions: [], hasMore: false, nextCursor: null }
            : { counts: deleted ? [] : [summary] } });
        }
      });
      await page.route("**/api/lanflow/cash-counts/confirmed-count?*", async (route) => {
        expect(route.request().method()).toBe("DELETE");
        writes += 1;
        deleted = true;
        await route.fulfill({ json: { status: "deleted" } });
      });
      await page.goto("/");
      await dismissRubberWeightAlertIfVisible(page);
      await page.getByRole("button", { name: "นับเงิน", exact: true }).click();
      await page.getByRole("row").filter({ hasText: receipt.reportNo }).getByRole("button", { name: "ลบชุดล่าสุด" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "ลบทั้งชุด" }).click();
      await expect(page.getByRole("row").filter({ hasText: receipt.reportNo })).toHaveCount(0);
      await expect(page.getByRole("status").filter({ hasText: "ลบสำเร็จ แต่โหลดประวัติใหม่ไม่สำเร็จ" })).toBeVisible();
      failHistory = false;
      await page.getByRole("button", { name: "โหลดประวัติใหม่", exact: true }).click();
      await expect(page.getByRole("button", { name: "โหลดประวัติใหม่", exact: true })).toHaveCount(0);
      expect(writes).toBe(1);
    });
  }
});
