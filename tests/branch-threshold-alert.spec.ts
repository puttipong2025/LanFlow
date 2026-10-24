import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { assertSafeIntegrationTarget } from "./support/integration-target";
import { dismissRubberWeightAlertIfVisible } from "./helpers/dismiss-threshold-alert";

const config = { thresholdKg: 10000, intervalMinutes: 60 };
const blank = { config, candidates: [], unavailable: [], configuredCount: 0, checkedCount: 0 };
const item = (kind: "cash" | "weight") => ({ kind, locationId: kind, locationName: `สาขา ${kind}`, groupId: kind, groupOrder: 1,
  value: kind === "cash" ? -100 : 15000, threshold: 10000, calculatedAt: "2026-10-18T00:00:00Z" });
async function suppressAutomatic(page: Page) {
  await page.addInitScript(() => {
    // Preserve an existing timestamp across reload; seed only the first visit.
    if (!sessionStorage.getItem("threshold-test-seeded")) {
      for (const id of ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"])
        localStorage.setItem(`lanflow:rubber-weight-alert:last-checked:v1:${id}`, String(Date.now()));
      sessionStorage.setItem("threshold-test-seeded", "yes");
    }
  });
}
test.use({ storageState: "playwright/.auth/super_admin.json" });

test("manual check defaults to cash, restores focus, reopens and preserves timer", async ({ page }) => {
  await suppressAutomatic(page);
  await page.goto("/");
  await expect(page.locator(".landscape-compact-actions")).toBeVisible();
  await expect(page.getByRole("button", { name: "ตรวจแจ้งเตือน", exact: true })).toBeVisible();
  let checks = 0;
  let payload = { ...blank, candidates: [item("cash"), item("weight")], configuredCount: 2, checkedCount: 2 };
  await page.route("**/api/lanflow/threshold-alert", async route => { checks++; await route.fulfill({ json: payload }); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const button = page.getByRole("button", { name: "ตรวจแจ้งเตือน", exact: true });
  const timestamp = () => page.evaluate(() => localStorage.getItem("lanflow:rubber-weight-alert:last-checked:v1:00000000-0000-4000-8000-000000000001"));
  await expect(button).toBeVisible(); const before = await timestamp();
  await button.click();
  const dialog = page.getByRole("alertdialog", { name: "แจ้งเตือน", exact: true });
  await expect(dialog.getByRole("heading", { name: "รับ–จ่ายสุทธิสะสมต่ำกว่าเกณฑ์" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "ยอดเงิน · 1" })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: test.info().outputPath("cash-first-mobile.png") });
  await dialog.getByRole("button", { name: "น้ำหนัก · 1" }).click();
  await expect(dialog.getByText("สาขา weight", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "รับทราบ", exact: true }).click();
  await expect(button).toBeFocused();
  await button.click();
  await expect(dialog.getByRole("button", { name: "ยอดเงิน · 1" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  expect(await timestamp()).toBe(before);
  await page.reload(); await expect(button).toBeVisible(); expect(checks).toBe(2);
  payload = { ...blank, candidates: [item("cash")], configuredCount: 1, checkedCount: 1 };
  await button.click();
  await expect(dialog.getByRole("button", { name: /ยอดเงิน ·|น้ำหนัก ·/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 844, height: 390 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("cash-only-landscape.png") });
});

test("manual check distinguishes unconfigured, unavailable, empty, errors and offline", async ({ page }) => {
  await suppressAutomatic(page);
  let payload: unknown = blank; let fail = false;
  await page.route("**/api/lanflow/threshold-alert", route => route.fulfill(fail ? { status: 500, json: {} } : { json: payload }));
  await page.goto("/"); const button = page.getByRole("button", { name: "ตรวจแจ้งเตือน", exact: true });
  const dialog = page.getByRole("alertdialog", { name: "แจ้งเตือน", exact: true });
  await button.click(); await expect(dialog.getByText("ยังไม่มีสาขาที่ตั้งค่ากลุ่มแจ้งเตือน", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  payload = { ...blank, configuredCount: 1, checkedCount: 1 };
  await button.click(); await expect(dialog.getByText("ไม่มีรายการเข้าเงื่อนไขแจ้งเตือน", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  payload = { ...blank, configuredCount: 1, unavailable: [{ kind: "cash", locationId: "a", locationName: "สาขาที่รอ", reason: "missing_snapshot" }] };
  await button.click(); await expect(dialog.getByText(/สาขาที่รอ/)).toBeVisible();
  await expect(dialog.getByText("ไม่มีรายการเข้าเงื่อนไขแจ้งเตือน", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape"); fail = true;
  await button.click(); await expect(page.getByRole("alert").filter({ hasText: "ตรวจการแจ้งเตือนไม่สำเร็จ" })).toBeVisible();
  await expect(dialog).toBeHidden();
  await page.context().setOffline(true); await expect(button).toBeDisabled();
});

test("cash group UI to real RPC and snapshot; API authorization and equality", async ({ browser }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!; assertSafeIntegrationTarget(url);
  const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const manager = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
  const admin = await browser.newContext({ storageState: "playwright/.auth/admin.json" });
  const user = await browser.newContext({ storageState: "playwright/.auth/user.json" });
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const id = crypto.randomUUID(); const conflictId = crypto.randomUUID(); let conflictGroupId: string | undefined; const name = `เงินทดสอบ ${id.slice(0, 6)}`; let groupId: string | undefined;
  try {
    expect((await db.from("locations").insert([{ id, name, code: `CA${id.slice(0,8)}`, is_active: true }, { id: conflictId, name: `แข่ง ${name}`, code: `CB${conflictId.slice(0,8)}`, is_active: true }])).error).toBeNull();
    const page = await manager.newPage(); await suppressAutomatic(page); await page.goto("/");
    await page.getByRole("button", { name: "Admin", exact: true }).click();
    await page.getByRole("button", { name: "การแจ้งเตือน", exact: true }).click();
    await page.getByRole("button", { name: "เงินต่ำกว่าเกณฑ์", exact: true }).click();
    await page.getByRole("button", { name: "สร้างกลุ่ม", exact: true }).click();
    await page.getByLabel("เกณฑ์รับ–จ่ายสุทธิสะสมขั้นต่ำ (บาท)").fill("10000");
    await page.getByLabel(name, { exact: true }).check();
    await page.getByRole("button", { name: "บันทึกกลุ่ม", exact: true }).click();
    await expect(page.getByText("สร้างกลุ่มแล้ว การตรวจรอบถัดไปจะเริ่มใช้กลุ่มนี้", { exact: true })).toBeVisible();
    const list = await manager.request.get("/api/lanflow/cash-alert/groups");
    groupId = (await list.json()).groups.find((g: { locationIds: string[] }) => g.locationIds.includes(id)).id;
    for (const amount of [9999.99, 1000000.01, 10000.001, "10000", null]) expect((await manager.request.put(`/api/lanflow/cash-alert/groups/${groupId}`, { data: { locationIds: [id], thresholdAmount: amount } })).status()).toBe(400);
    expect((await admin.request.get("/api/lanflow/cash-alert/groups")).status()).toBe(403);
    expect((await user.request.get("/api/lanflow/threshold-alert")).status()).toBe(403);
    expect((await anon.request.get("/api/lanflow/threshold-alert")).status()).toBe(401);
    const competing = await Promise.all([0, 1].map(() => manager.request.post("/api/lanflow/cash-alert/groups", { data: { locationIds: [conflictId], thresholdAmount: 10000 } })));
    expect(competing.map(response => response.status()).sort()).toEqual([201, 409]);
    conflictGroupId = (await competing.find(response => response.status() === 201)!.json()).id;
    const snapshot = { location_id: id, status: "ready", source_version: 1, snapshot_version: 1, calculated_at: new Date().toISOString(), summary: { netCashFlow: 9999.99 } };
    expect((await db.from("dashboard_branch_snapshots").upsert(snapshot)).error).toBeNull();
    const response = await manager.request.get("/api/lanflow/threshold-alert");
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect((await response.json()).candidates).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "cash", locationId: id, value: 9999.99, threshold: 10000 })]));
    expect((await (await admin.request.get("/api/lanflow/threshold-alert")).json()).candidates.some((c: { locationId: string }) => c.locationId === id)).toBe(false);
    await page.getByRole("button", { name: "ตรวจแจ้งเตือน", exact: true }).click();
    const dialog = page.getByRole("alertdialog", { name: "แจ้งเตือน", exact: true });
    await expect(dialog.getByText(name, { exact: true })).toBeVisible();
    await expect(dialog.locator("section").filter({ hasText: name }).getByText("10,000 บาท", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "รับ–จ่ายสุทธิสะสมต่ำกว่าเกณฑ์" })).toBeVisible();
    await page.keyboard.press("Escape");
    expect((await db.from("dashboard_branch_snapshots").update({ summary: { netCashFlow: 10000 } }).eq("location_id", id)).error).toBeNull();
    expect((await (await manager.request.get("/api/lanflow/threshold-alert")).json()).candidates.some((c: { locationId: string }) => c.locationId === id)).toBe(false);
    await dismissRubberWeightAlertIfVisible(page);
  } finally {
    if (conflictGroupId) await manager.request.delete(`/api/lanflow/cash-alert/groups/${conflictGroupId}`);
    if (groupId) await manager.request.delete(`/api/lanflow/cash-alert/groups/${groupId}`);
    await db.from("dashboard_branch_snapshots").delete().in("location_id", [id, conflictId]);
    await db.from("dashboard_refresh_jobs").delete().in("location_id", [id, conflictId]);
    await db.from("locations").delete().in("id", [id, conflictId]);
    await Promise.all([manager.close(), admin.close(), user.close(), anon.close()]);
  }
});

test("manual and scheduled checks share in-flight work without moving the next automatic round", async ({ page }) => {
  const clockStart = new Date();
  await page.clock.install({ time: clockStart });
  await page.clock.pauseAt(new Date(clockStart.getTime() + 5_000));
  await suppressAutomatic(page);
  await page.route("**/api/lanflow", async route => {
    const response = await route.fetch(); const payload = await response.json();
    await route.fulfill({ response, json: { ...payload, rubberWeightAlertConfig: { ...config, intervalMinutes: 1 } } });
  });
  let checks = 0; let release: (() => void) | undefined;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/lanflow/threshold-alert", async route => {
    checks++; if (checks === 1) await held;
    await route.fulfill({ json: { ...blank, config: { ...config, intervalMinutes: 1 }, configuredCount: 1, checkedCount: 1, candidates: [item("cash")] } });
  });
  await page.goto("/"); const button = page.getByRole("button", { name: "ตรวจแจ้งเตือน", exact: true });
  await expect(button).toBeVisible();
  await page.clock.fastForward(59_000);
  await button.click(); await expect.poll(() => checks).toBe(1);
  await expect(page.getByRole("button", { name: "กำลังตรวจ...", exact: true })).toHaveAttribute("aria-disabled", "true");
  await page.clock.fastForward(1_000); expect(checks).toBe(1);
  release?.();
  const dialog = page.getByRole("alertdialog", { name: "แจ้งเตือน", exact: true }); await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "รับทราบ", exact: true }).click();
  await page.clock.fastForward(59_000); expect(checks).toBe(1);
  await page.clock.fastForward(1_000); await expect.poll(() => checks).toBe(2);
  await expect(dialog).toBeVisible();
});

test("cash renders shared group frames and one threshold per group like weight", async ({ page }) => {
  await suppressAutomatic(page);
  const candidates = Array.from({ length: 13 }, (_, index) => ({ ...item("cash"),
    locationId: `cash-${index}`, locationName: `สาขาเงิน ${index + 1}`, value: 1000 + index,
    groupId: index < 8 ? "cash-group-1" : "cash-group-2", groupOrder: index < 8 ? 1 : 2,
    threshold: index < 8 ? 8000 : 30000,
  }));
  await page.route("**/api/lanflow/threshold-alert", route => route.fulfill({ json: { ...blank, candidates, configuredCount: 13, checkedCount: 13 } }));
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/");
  await page.getByRole("button", { name: "ตรวจแจ้งเตือน", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "แจ้งเตือน", exact: true });
  await expect(dialog.getByText("พบ 13 สาขา จาก 2 กลุ่มที่ต้องตรวจสอบ", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("region")).toHaveCount(2);
  await expect(dialog.getByRole("region", { name: "กลุ่ม 1", exact: true }).getByRole("listitem")).toHaveCount(8);
  await expect(dialog.getByRole("region", { name: "กลุ่ม 2", exact: true }).getByRole("listitem")).toHaveCount(5);
  await expect(dialog.getByText("8,000 บาท", { exact: true })).toHaveCount(1);
  await expect(dialog.getByText("30,000 บาท", { exact: true })).toHaveCount(1);
  await expect(dialog.getByRole("button", { name: /ยอดเงิน ·|น้ำหนัก ·/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("cash-grouped-mobile.png") });
});

test("changing interval during a pending manual check releases the loading state", async ({ page }) => {
  await suppressAutomatic(page);
  await page.route("**/api/lanflow", async route => {
    const response = await route.fetch(); const data = await response.json();
    await route.fulfill({ response, json: { ...data, rubberWeightAlertConfig: config } });
  });
  let checks = 0; let release: (() => void) | undefined;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/lanflow/threshold-alert", async route => {
    checks++; if (checks > 1) await held;
    await route.fulfill({ json: blank }).catch(() => {});
  });
  await page.route("**/api/lanflow/rubber-weight-alert/groups", route => route.fulfill({ json: { groups: [], availableLocationIds: [] } }));
  await page.route("**/api/lanflow/admin/rubber-weight-alert", route => route.fulfill({ json: { ...config, intervalMinutes: 30 } }));
  try {
    await page.goto("/"); const check = page.getByRole("button", { name: "ตรวจแจ้งเตือน", exact: true });
    await check.click();
    const dialog = page.getByRole("alertdialog", { name: "แจ้งเตือน", exact: true }); await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape"); await expect(check).toHaveAttribute("aria-disabled", "false");
    await check.click(); await expect.poll(() => checks).toBe(2);
    await page.getByRole("button", { name: "Admin", exact: true }).click();
    await page.getByRole("button", { name: "การแจ้งเตือน", exact: true }).click();
    await page.getByLabel("รอบตรวจ (นาที)").fill("30");
    await page.getByRole("button", { name: "บันทึกรอบตรวจ", exact: true }).click();
    await expect(page.getByText("บันทึกรอบตรวจแล้ว", { exact: true })).toBeVisible();
    await expect(check).toHaveAttribute("aria-disabled", "false");
  } finally { release?.(); }
});
