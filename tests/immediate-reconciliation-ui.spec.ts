import { expect, test } from "@playwright/test";

test.use({ storageState: "playwright/.auth/super_admin.json" });

for (const failedView of ["active", "deletions"]) {
  test(`Export confirmed deletion keeps GET-only retry after ${failedView} failure at 360px`, async ({ page }, testInfo) => {
    let deleted = false; let fail = true; let writes = 0;
    const row = {
      id: "confirmed-export", exportNo: "REX-CONFIRMED", status: "draft", itemCount: 1,
      originalWeightTotal: 100, paidTotal: 1000, rubberValueTotal: 1000, averagePrice: 10,
      otherOperatingCost: 0, createdByName: "ทดสอบ", createdAt: "2026-09-03T01:00:00Z",
      ageCalculatedAt: null, averageAgeHours: null, oldestAgeHours: null, estimatedAgeItemCount: 0,
    };
    await page.route(/\/api\/lanflow\/rubber-exports\?.*$/, (route) => {
      const view = new URL(route.request().url()).searchParams.get("view");
      if (deleted && fail && view === failedView) return route.fulfill({ status: 503, json: { error: "HISTORY_UNAVAILABLE" } });
      return route.fulfill({ json: view === "deletions" ? { deletions: [], hasMore: false, nextCursor: null } : {
        exports: deleted ? [] : [row], permissions: { canDelete: true, canVerify: true }, hasMore: false, nextCursor: null,
      } });
    });
    await page.route("**/api/lanflow/rubber-exports/confirmed-export", (route) => {
      expect(route.request().method()).toBe("DELETE"); writes++; deleted = true;
      return route.fulfill({ json: { status: "deleted" } });
    });
    await page.goto("/");
    await page.getByRole("button", { name: /^ส่งออกยาง/ }).click();
    await page.getByRole("row").filter({ hasText: row.exportNo }).getByRole("button", { name: "ลบรายการส่งออกยาง" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "ยืนยันลบ", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "ลบสำเร็จ แต่โหลดข้อมูลใหม่ไม่สำเร็จ" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: row.exportNo })).toHaveCount(0);
    await page.setViewportSize({ width: 360, height: 800 });
    await page.screenshot({ path: testInfo.outputPath(`export-${failedView}-360px.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    fail = false;
    const retry = page.getByRole("button", { name: "โหลดข้อมูลใหม่", exact: true });
    await retry.focus(); await page.keyboard.press("Enter");
    await expect(retry).toHaveCount(0);
    await expect(page.getByRole("row").filter({ hasText: row.exportNo })).toHaveCount(0);
    expect(writes).toBe(1);
  });
}

for (const status of [403, 409, 500]) {
  test(`Branch Receipt shows POST ${status} error after candidates reload at 393px`, async ({ page }, testInfo) => {
    let writes = 0; let readsAfterWrite = 0;
    await page.route(/\/api\/lanflow\/rubber-bills\/branch-receipts(?:\?.*)?$/, (route) => {
      if (route.request().method() === "POST") {
        writes++;
        return route.fulfill({ status, json: { error: "รับยางไม่ได้ กรุณาตรวจสอบรายการต้นทาง" } });
      }
      if (writes) readsAfterWrite++;
      return route.fulfill({ json: { candidates: [{
        sourceRubberExportId: "receipt-source", sourceExportNo: "REX-RECEIPT", sourceLocationName: "สาขาทดสอบ",
        verifiedAt: "2026-09-03T01:00:00Z", currentWeight: 100, rubberValue: 1000, receivedAgeHours: 1,
      }], hasMore: false, nextCursor: null } });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
    await page.getByRole("button", { name: "รับยางจากสาขา", exact: true }).click();
    await page.setViewportSize({ width: 393, height: 850 });
    const dialog = page.getByRole("dialog", { name: "รับยางจากสาขา", exact: true });
    await dialog.getByRole("radio", { name: /เลือก REX-RECEIPT/ }).check();
    const submit = dialog.getByRole("button", { name: "ยืนยันรับเข้าสาขา" });
    await submit.focus(); await page.keyboard.press("Enter");
    await expect.poll(() => readsAfterWrite).toBeGreaterThan(0);
    await expect(submit).toBeEnabled();
    await expect(dialog.getByRole("alert")).toHaveText("รับยางไม่ได้ กรุณาตรวจสอบรายการต้นทาง");
    await page.screenshot({ path: testInfo.outputPath(`receipt-${status}-393px.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(writes).toBe(1);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "รับยางจากสาขา", exact: true })).toBeFocused();
  });
}

test("Branch Receipt keeps confirmed success when its real parent feed refresh fails", async ({ page }) => {
  let writes = 0;
  await page.route("**/api/lanflow/rubber-bills/feed?*", (route) => route.fulfill(writes
    ? { status: 503, json: { error: "FEED_UNAVAILABLE" } }
    : { json: { rows: [], evidenceStates: [], hasMore: false, nextCursor: null } }));
  await page.route(/\/api\/lanflow\/rubber-bills\/branch-receipts(?:\?.*)?$/, (route) => {
    if (route.request().method() === "POST") {
      writes++;
      return route.fulfill({ json: { billNo: "BILL-CONFIRMED" } });
    }
    return route.fulfill({ json: { candidates: writes ? [] : [{
      sourceRubberExportId: "confirmed-receipt", sourceExportNo: "REX-CONFIRMED", sourceLocationName: "สาขาทดสอบ",
      verifiedAt: "2026-09-03T01:00:00Z", currentWeight: 100, rubberValue: 1000, receivedAgeHours: 1,
    }], hasMore: false, nextCursor: null } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
  await page.getByRole("button", { name: "รับยางจากสาขา", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "รับยางจากสาขา", exact: true });
  await dialog.getByRole("radio").check();
  await dialog.getByRole("button", { name: "ยืนยันรับเข้าสาขา" }).click();
  await expect(dialog.getByRole("status")).toContainText("รับยางสำเร็จแล้ว · บิล BILL-CONFIRMED", { timeout: 20000 });
  await expect(dialog.getByRole("radio")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "ยืนยันรับเข้าสาขา" })).toBeDisabled();
  expect(writes).toBe(1);
});

test("Stock sync waits for reads and offers read-only recovery at 360px", async ({ page }, testInfo) => {
  await page.clock.install();
  let writes = 0; let failReads = true; let refetchStarted = false;
  let releaseRead!: () => void;
  const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
  await page.route("**/rest/v1/stock_movements?*", async (route) => {
    if (writes) { refetchStarted = true; await readGate; }
    await route.fulfill(writes && failReads
      ? { status: 503, json: { message: "STOCK_READ_UNAVAILABLE" } }
      : { json: [] });
  });
  await page.route("**/api/lanflow/rubber-bills", (route) => {
    expect(route.request().method()).toBe("POST"); writes++;
    return route.fulfill({ json: { status: "synced" } });
  });
  const me = await (await page.request.get("/api/auth/me")).json() as { profile: { id: string } };
  await page.goto("/");
  await page.getByRole("button", { name: /^สต็อกสินค้า/ }).click();
  // Finish the coordinator's bounded startup retries (750 / 2500 ms) before
  // isolating the manual retry. Otherwise they can cancel its refetch.
  await page.clock.runFor(3000);
  await page.clock.resume();
  await page.waitForLoadState("networkidle");
  const locationId = await page.getByLabel(/^เลือกสาขา/).getAttribute("data-location-id");
  expect(locationId).toBeTruthy();
  await page.evaluate(async ({ ownerUserId, locationId }) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("lanflow_sync_db", 4);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("sync_queue", "readwrite");
        tx.objectStore("sync_queue").add({
          id: "stock-retry-ui", entity: "rubber_bills", ownerUserId, locationId,
          operation: "create", timestamp: Date.now(), status: "failed",
          payload: { items: [{ itemType: "stock_deduction", stockProductId: "mock-product", quantity: 1 }] },
        });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
  }, { ownerUserId: me.profile.id, locationId: locationId! });
  const sync = page.getByRole("button", { name: "ซิงก์รายการ", exact: true });
  await sync.click();
  await expect.poll(() => refetchStarted).toBe(true);
  try { await expect(sync).toBeDisabled(); } finally { releaseRead(); }
  const warning = page.getByRole("status").filter({ hasText: "โหลดข้อมูลหลังซิงก์ไม่สำเร็จ" });
  await expect(warning).toBeVisible({ timeout: 20000 });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.screenshot({ path: testInfo.outputPath("stock-warning-360px.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  failReads = false;
  const retry = warning.getByRole("button", { name: "โหลดข้อมูลใหม่" });
  await retry.focus(); await page.keyboard.press("Enter");
  await expect(warning).toHaveCount(0);
  expect(writes).toBe(1);
  await expect(sync).toBeEnabled();
});
