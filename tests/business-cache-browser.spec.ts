import { test, expect, type Page } from "@playwright/test";
import { rubberBillFromSyncEvent } from "../src/lib/rubber-bills/local-feed";
import { buildRubberBillReceiptModel } from "../src/components/rubber-bills/bill-display";
import { installThresholdAlertHandler } from "./helpers/dismiss-threshold-alert";
import { confirmCurrentBranchIfRequired, selectedAppLocationId } from "./helpers/select-app-location";

test("superadmin shared interval uses zero focus behavior and schedules metadata only while online", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
  const endpoint = "/api/lanflow/business-cache/settings";
  const originalResponse = await context.request.get(endpoint);
  expect(originalResponse.status()).toBe(200);
  const original = await originalResponse.json();
  expect((await context.request.put(endpoint, { data: { intervalMinutes: 10, expectedRevision: 2_147_483_648 } })).status()).toBe(400);
  try {
    const page = await context.newPage();
    page.on("pageerror", error => console.log("Cache settings browser error:", error.message));
    await installThresholdAlertHandler(page);
    await page.clock.install();
    let reads = 0;
    await context.route("**/api/lanflow/business-cache?*", async route => { reads++; await route.continue(); });
    await page.goto("/");
    await expect(page.locator('button[data-location-id][aria-controls="location-selector-listbox"]')).toBeVisible({ timeout: 30_000 });
    const readiness = page.locator("details").filter({ hasText: "ตรวจความพร้อมอีกครั้ง" });
    await expect.poll(() => reads, { timeout: 30_000 }).toBeGreaterThan(0);
    // Load the lazy module online before testing connectivity in dev mode.
    await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
    await expect(page.getByRole("button", { name: "เพิ่มบิลยาง", exact: true })).toBeVisible();
    await readiness.locator("summary").click();
    await readiness.getByRole("button", { name: "ตั้งรอบตรวจแคช", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "ตั้งรอบตรวจเวอร์ชันแคช", exact: true });
    const enabled = modal.getByRole("checkbox", { name: "เปิดตรวจตามรอบ" });
    await expect(enabled).toBeEnabled(); await enabled.check();
    const minutes = modal.getByRole("spinbutton", { name: "รอบตรวจ (นาที)" });
    await minutes.fill(""); await minutes.press("Enter");
    await expect(modal.getByRole("alert")).toContainText("10–120");
    await minutes.fill("0"); await minutes.blur(); await minutes.focus(); await expect(minutes).toHaveValue("");
    await minutes.blur(); await expect(minutes).toHaveValue("0");
    await minutes.fill("9"); await modal.getByRole("button", { name: "บันทึกค่ากลาง" }).click();
    await expect(modal.getByRole("alert")).toContainText("10–120");
    await minutes.fill("10"); await modal.getByRole("button", { name: "บันทึกค่ากลาง" }).click();
    await expect(modal).not.toBeVisible(); await expect(readiness).toContainText("ทุก 10 นาที");
    await expect(readiness.getByRole("region", { name: "แคชบิลยาง" })).toContainText("รุ่นแคชปัจจุบัน");
    const before = reads; await page.clock.fastForward(600_000);
    await expect.poll(() => reads).toBe(before + 1);
    await expect(readiness.getByRole("region", { name: "แคชบิลยาง" })).toContainText("รุ่นแคชปัจจุบัน");
    await context.setOffline(true);
    await expect(readiness).toContainText("ออฟไลน์ · ใช้แคชข้อมูลเดิม");
    const offlineReads = reads;
    await page.clock.fastForward(600_000); expect(reads).toBe(offlineReads);
    await context.setOffline(false);
    await expect.poll(() => reads, { timeout: 20_000 }).toBeGreaterThan(offlineReads);
    await page.setViewportSize({ width: 360, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await readiness.getByRole("button", { name: "ตั้งรอบตรวจแคช", exact: true }).click();
    await expect(modal.getByRole("checkbox", { name: "เปิดตรวจตามรอบ" })).toBeEnabled();
    await expect(modal.getByRole("spinbutton", { name: "รอบตรวจ (นาที)" })).toHaveValue("10");
    await modal.screenshot({ path: "output/cache-settings-mobile.png", timeout: 10_000 });
  } finally {
    await context.setOffline(false);
    const latest = await (await context.request.get(endpoint)).json();
    const restored = await context.request.put(endpoint, { data: { intervalMinutes: original.intervalMinutes, expectedRevision: latest.revision } });
    expect(restored.status()).toBe(200); await context.close();
  }
  const admin = await browser.newContext({ storageState: "playwright/.auth/admin.json" });
  try {
    expect((await admin.request.get(endpoint)).status()).toBe(200);
    expect((await admin.request.put(endpoint, { data: { intervalMinutes: 10, expectedRevision: 1 } })).status()).toBe(403);
    const page = await admin.newPage(); await page.goto("/");
    await expect(page.locator('button[data-location-id][aria-controls="location-selector-listbox"]')).toBeVisible({ timeout: 30_000 });
    const readiness = page.locator("details").filter({ hasText: "ตรวจความพร้อมอีกครั้ง" });
    await readiness.locator("summary").click();
    await expect(readiness.getByRole("button", { name: "ตั้งรอบตรวจแคช", exact: true })).toHaveCount(0);
  } finally { await admin.close(); }
});

test("cache API reads real scoped records and denies a branch outside the authenticated scope", async ({ browser }) => {
  const context = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
  try {
    const me = await (await context.request.get("/api/auth/me")).json();
    const branch = me.profile.locationIds[0];
    const metadata = await context.request.get(`/api/lanflow/business-cache?locationId=${branch}`);
    expect(metadata.status()).toBe(200); expect(metadata.headers()["cache-control"]).toContain("no-store");
    const feed = await (await context.request.get(`/api/lanflow/rubber-bills/feed?locationId=${branch}&mode=latest&documentStatus=any&search=&limit=5`)).json();
    const ids = feed.rows.filter((row: { row_kind: string }) => row.row_kind === "bill").map((row: { id: string }) => row.id);
    const batch = await context.request.post("/api/lanflow/business-cache", { data: { locationId: branch, ids } });
    expect(batch.status()).toBe(200);
    const checks = (await batch.json()).checks;
    expect(checks).toHaveLength(ids.length);
    for (const row of checks) { expect(row.state).toBe("active"); expect(row.snapshot.bill.locationId).toBe(branch); }
    const denied = await context.request.get("/api/lanflow/business-cache?locationId=00000000-0000-4000-8000-00000000ca02");
    expect(denied.status()).toBe(403);
  } finally { await context.close(); }
});

async function seedLegacyReceipt(page: Page, branch: string) {
  const id = "00000000-0000-4000-8000-00000000ca01";
  const bill = rubberBillFromSyncEvent({ id, entity: "rubber_bills", operation: "create", ownerUserId: "fixture", locationId: branch,
    timestamp: 0, status: "pending", payload: { customerName: "Cache legacy fixture", billDate: "2026-10-30", weight: 1,
      clientCreatedAt: "2026-10-30T00:00:00Z", clientRecordedAt: "2026-10-30T00:00:00Z" } }, "fixture")!;
  Object.assign(bill, { id, locationId: branch, serverBillNo: "CACHE-FIXTURE", localBillNo: "CACHE-FIXTURE", billNo: "CACHE-FIXTURE", syncStatus: "synced", revisionNo: 1 });
  const snapshot = { billId: id, locationId: branch, serverBillNo: bill.serverBillNo, serverReceivedAt: "2026-10-30T00:00:00Z",
    revisionNo: 1, bill, receipt: buildRubberBillReceiptModel(bill) };
  await page.evaluate(async ({ snapshot, branch }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("lanflow_sync_db", 8); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["rubber_bill_receipts", "business_cache_meta"], "readwrite");
      tx.objectStore("rubber_bill_receipts").put(snapshot); tx.objectStore("business_cache_meta").delete(`rubber:${branch}`);
      tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error);
    }); db.close();
  }, { snapshot, branch });
  return id;
}

test("cache repair survives offline projection; reconnect preserves a real open Rubber form", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
  const page = await context.newPage();
  page.on("dialog", dialog => { void dialog.accept(); });
  await installThresholdAlertHandler(page);
  let metadataReads = 0;
  await context.route("**/api/lanflow/business-cache**", async route => {
    if (route.request().method() === "GET") { metadataReads++; await route.fulfill({ json: { protocol: 1, versions: { rubber: 1, income: 1 } } }); return; }
    const { ids, locationId } = route.request().postDataJSON();
    const snapshots = await page.evaluate(async (branch: string) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("lanflow_sync_db", 8); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const data = await new Promise<Array<{ billId: string }>>(resolve => {
        const request = db.transaction("rubber_bill_receipts").objectStore("rubber_bill_receipts").index("locationId").getAll(branch);
        request.onsuccess = () => resolve(request.result);
      }); db.close(); return data;
    }, locationId);
    await route.fulfill({ json: { checks: ids.map((id: string) => id.endsWith("ca01") ? { billId: id, state: "deleted", revisionNo: 2 }
      : { billId: id, state: "active", snapshot: snapshots.find(row => row.billId === id) }) } });
  });
  try {
    await page.goto("/");
    await expect(page.locator('button[data-location-id][aria-controls="location-selector-listbox"]')).toBeVisible({ timeout: 30_000 });
    const branch = (await selectedAppLocationId(page))!;
    const readiness = page.locator("details").filter({ hasText: "ตรวจความพร้อมอีกครั้ง" });
    await expect.poll(() => metadataReads).toBeGreaterThan(0);
    await readiness.locator("summary").click();
    await expect(readiness.getByRole("region", { name: "แคชบิลยาง" })).toBeVisible();
    await expect(readiness.getByRole("region", { name: "แคชบิลยาง" })).toContainText("รุ่นแคชปัจจุบัน", { timeout: 20_000 });
    await seedLegacyReceipt(page, branch);
    await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
    await page.getByRole("button", { name: "เพิ่มบิลยาง", exact: true }).click();
    await confirmCurrentBranchIfRequired(page);
    const modal = page.getByRole("dialog", { name: "บิลเครื่องชั่งเล็ก", exact: true });
    await expect(modal).toBeVisible();
    const name = modal.locator('input[placeholder*="ค้นหาชื่อ หรือ รหัสสมาชิก"]');
    await name.fill("Keep this unfinished form");
    let navigations = 0; page.on("framenavigated", frame => { if (frame === page.mainFrame()) navigations++; });
    await context.setOffline(true); await context.setOffline(false);
    await expect.poll(() => metadataReads).toBeGreaterThan(1);
    await expect(readiness).toContainText("รอปิดฟอร์ม");
    await expect(name).toHaveValue("Keep this unfinished form"); expect(navigations).toBe(0);
    await modal.getByRole("button", { name: "ปิด", exact: true }).click();
    await expect(readiness.getByRole("region", { name: "แคชบิลยาง" })).toContainText("รุ่นแคชปัจจุบัน");
    await context.setOffline(true);
    await page.getByLabel("ค้นหา:").fill("Cache legacy fixture");
    await expect(page.getByRole("row").filter({ hasText: "Cache legacy fixture" })).toHaveCount(0);
    await context.setOffline(false);
    await page.reload();
    await expect.poll(() => metadataReads).toBeGreaterThan(2);
    await page.setViewportSize({ width: 360, height: 800 });
    if (await readiness.getAttribute("open") === null) await readiness.locator("summary").click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    expect(overflow).toBe(false);
    await readiness.screenshot({ path: "output/cache-status-mobile.png", timeout: 10_000, animations: "disabled" });
    if (process.env.PW_PROJECT === "pwa") {
      await expect(readiness.locator("summary")).toContainText("พร้อมใช้งานออฟไลน์ 100%", { timeout: 60_000 });
      const readsBeforeOfflineReload = metadataReads;
      await context.setOffline(true);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "LanFlow", exact: true })).toBeVisible({ timeout: 20_000 });
      if (await readiness.getAttribute("open") === null) await readiness.locator("summary").click();
      await expect(readiness).toContainText("ออฟไลน์ · ใช้แคชข้อมูลเดิม");
      expect(metadataReads).toBe(readsBeforeOfflineReload);
      await readiness.screenshot({ path: "output/cache-status-pwa-offline.png", timeout: 10_000, animations: "disabled" });
    }
  } finally { await context.close().catch(() => {}); }
});
