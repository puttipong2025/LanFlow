import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createBrowserClient } from "@supabase/ssr";
import { resetTestEnvironment, resetTestSql, restoreResetSeedActor } from "./support/bill-device-reset-target";
import { installThresholdAlertHandler } from "./helpers/dismiss-threshold-alert";
import { waitForBillIssuer } from "./helpers/wait-bill-issuer";
import { confirmCurrentBranchIfRequired, selectAppLocation } from "./helpers/select-app-location";

const target = resetTestEnvironment(), endpoint = "/api/lanflow/admin/rubber-bill-issuers/reset";
const branch = crypto.randomUUID(), otherBranch = crypto.randomUUID();
const password = "Reset-fixture-2026!", actors: { id: string; phone: string; role: string }[] = [];
const admin = createClient(target.url, target.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

test.beforeAll(async () => {
  resetTestSql(`update public.profiles set role='admin' where role='super_admin';
    insert into public.locations(id,name,code,is_active) values
      ('${branch}','Reset browser ${branch}','RB${branch.slice(0,6)}',true),
      ('${otherBranch}','Reset browser other ${otherBranch}','RB${otherBranch.slice(0,6)}',true);`);
  for (const role of ["super_admin", "admin"]) {
    const id = crypto.randomUUID(), phone = `+6686${String(Math.floor(Math.random() * 10000000)).padStart(7, "0")}`;
    const version = crypto.randomUUID();
    const result = await admin.auth.admin.createUser({ id, phone, password, phone_confirm: true,
      user_metadata: { name: `Reset ${role}`, lanflow_password_copy_version: version }, app_metadata: { lanflow_role: role } });
    if (result.error) throw result.error;
    const write = await admin.from("profiles").upsert({ id, phone, name: `Reset ${role}`, role, is_active: true,
      can_access_super_admin_features: role === "admin", current_password_plaintext: password, current_password_auth_version: version });
    if (write.error) throw write.error;
    const assigned = await admin.from("user_locations").insert({ user_id: id, location_id: branch, is_primary: true });
    if (assigned.error) throw assigned.error;
    expect(resetTestSql(`select count(*) from public.profiles where id='${id}'`)).toBe("1");
    actors.push({ id, phone, role });
  }
});
test.afterAll(async () => {
  const ids = actors.map(actor => `'${actor.id}'`).join(",");
  if (!ids) return;
  resetTestSql(`begin;set local app.history_retention_cleanup='on';
    delete from public.income_expense where location_id in ('${branch}','${otherBranch}');
    delete from private.income_expense_create_receipts where location_id in ('${branch}','${otherBranch}');
    delete from private.income_expense_number_bindings where location_id in ('${branch}','${otherBranch}');
    delete from private.income_expense_suffix_counters where location_id in ('${branch}','${otherBranch}');
    delete from private.bill_device_reset_receipts where actor_user_id in (${ids});
    create temp table reset_fixture_devices as select distinct device_id from private.rubber_bill_issuers
      where location_id in ('${branch}','${otherBranch}') or last_user_id in (${ids});
    delete from private.rubber_bill_issuer_heads h using private.rubber_bill_issuers i
      where h.issuer_id=i.id and i.device_id in(select device_id from reset_fixture_devices);
    delete from private.rubber_bill_issuers where device_id in(select device_id from reset_fixture_devices);
    delete from private.bill_issuer_device_heads where device_id in(select device_id from reset_fixture_devices);
    delete from private.bill_issuer_devices where id in(select device_id from reset_fixture_devices);
    delete from private.rubber_bill_issuer_counters where location_id in ('${branch}','${otherBranch}');
    commit;`);
  for (const actor of actors) { const result = await admin.auth.admin.deleteUser(actor.id); if (result.error) throw result.error; }
  restoreResetSeedActor();
});
async function contextFor(browser: Browser, role = "super_admin"): Promise<BrowserContext> {
  const actor = actors.find(value => value.role === role)!;
  const cookies = new Map<string, string>();
  const auth = createBrowserClient(target.url, target.anonKey, { isSingleton: false, cookies: {
    getAll: () => [], setAll: (values: { name: string; value: string }[]) => { for (const cookie of values) cookies.set(cookie.name, cookie.value); },
  } });
  const result = await auth.auth.signInWithPassword({ phone: actor.phone, password });
  if (result.error) throw result.error;
  return browser.newContext({ storageState: { cookies: [...cookies].map(([name, value]) => ({ name, value,
    domain: "127.0.0.1", path: "/", expires: Math.floor(Date.now() / 1000) + 3600,
    httpOnly: false, secure: false, sameSite: "Lax" as const })), origins: [] } });
}
async function openDevices(page: Page) {
  await installThresholdAlertHandler(page); await page.goto("/");
  await page.getByRole("button", { name: "Admin", exact: true }).click();
  await page.getByRole("button", { name: "เครื่องออกบิล", exact: true }).click();
  await waitForBillIssuer(page);
}
const dialog = (page: Page) => page.getByRole("alertdialog", { name: "รีเซ็ตรหัสเครื่องทั้งหมด?", exact: true });
const input = (page: Page) => dialog(page).getByLabel("พิมพ์ “รีเซ็ตทั้งหมด” เพื่อยืนยัน");
async function register(context: BrowserContext, location = otherBranch) {
  const response = await context.request.post("/api/lanflow/rubber-bills/issuers", { headers: { origin: "http://127.0.0.1:3002" },
    data: { locationId: location, installationId: crypto.randomUUID(), generationId: crypto.randomUUID() } });
  expect(response.status(), await response.text()).toBe(200); return response.json();
}
test("only Super Admin sees reset; manager keeps list and individual retirement", async ({ browser }) => {
  const context = await contextFor(browser, "admin");
  try {
    const page = await context.newPage(); await openDevices(page);
    await expect(page.getByRole("button", { name: "รีเซ็ตทั้งหมด", exact: true })).toHaveCount(0);
    expect((await context.request.get(endpoint)).status()).toBe(403);
    expect((await context.request.post(endpoint, { headers: { origin: "http://127.0.0.1:3002" }, data: {} })).status()).toBe(403);
    expect((await context.request.get("/api/lanflow/admin/rubber-bill-issuers")).status()).toBe(200);
  } finally { await context.close(); }
});
test("typed confirmation, all-branch preview, desktop/mobile layout and focus", async ({ browser }, info) => {
  const context = await contextFor(browser);
  try {
    const page = await context.newPage(); await openDevices(page); await register(context);
    await page.getByLabel("กรองสาขาเครื่องออกบิล").selectOption(branch);
    const button = page.getByRole("button", { name: "รีเซ็ตทั้งหมด", exact: true });
    await button.click();
    const preview = await (await context.request.get(endpoint)).json();
    await expect(dialog(page)).toContainText(`${preview.count.toLocaleString("th-TH")} เครื่อง`);
    const confirm = dialog(page).getByRole("button", { name: "ยืนยันรีเซ็ตทั้งหมด", exact: true });
    await expect(confirm).toBeDisabled(); await input(page).fill("wrong"); await expect(confirm).toBeDisabled();
    await input(page).fill("รีเซ็ตทั้งหมด"); await expect(confirm).toBeEnabled();
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 850 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(confirm).toBeInViewport(); await dialog(page).screenshot({ path: info.outputPath(`reset-${width}.png`) });
    }
    await page.keyboard.press("Escape"); await expect(dialog(page)).toBeHidden(); await expect(button).toBeFocused();
  } finally { await context.close(); }
});
test("real changed registry returns conflict and clears typed confirmation before retry", async ({ browser }) => {
  const context = await contextFor(browser);
  try {
    const page = await context.newPage(); await openDevices(page);
    await page.getByRole("button", { name: "รีเซ็ตทั้งหมด", exact: true }).click(); await input(page).fill("รีเซ็ตทั้งหมด");
    await register(context);
    const response = page.waitForResponse(value => value.url().endsWith(endpoint) && value.request().method() === "POST");
    await dialog(page).getByRole("button", { name: "ยืนยันรีเซ็ตทั้งหมด", exact: true }).click();
    expect((await response).status()).toBe(409);
    await expect(dialog(page).getByRole("alert")).toContainText("รายชื่อเครื่องเปลี่ยน");
    await expect(input(page)).toHaveValue("");
    await expect(dialog(page).getByRole("button", { name: "ยืนยันรีเซ็ตทั้งหมด", exact: true })).toBeDisabled();
    await input(page).fill("รีเซ็ตทั้งหมด");
    await dialog(page).getByRole("button", { name: "ยืนยันรีเซ็ตทั้งหมด", exact: true }).click();
    await expect(dialog(page)).toBeHidden(); await expect(page.getByRole("status").filter({ hasText: "เลิกใช้รหัสเดิม" })).toBeVisible();
  } finally { await context.close(); }
});
test("response lost after real commit retries exact request and preserves replacement", async ({ browser }) => {
  const context = await contextFor(browser);
  try {
    const page = await context.newPage(); await openDevices(page);
    const requests: unknown[] = [];
    await page.route(`**${endpoint}`, async route => {
      if (route.request().method() !== "POST") return route.continue();
      requests.push(route.request().postDataJSON());
      if (requests.length === 1) { const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort("failed"); }
      else await route.continue();
    });
    await page.getByRole("button", { name: "รีเซ็ตทั้งหมด", exact: true }).click(); await input(page).fill("รีเซ็ตทั้งหมด");
    await dialog(page).getByRole("button", { name: "ยืนยันรีเซ็ตทั้งหมด", exact: true }).click();
    await expect(dialog(page).getByRole("button", { name: "ตรวจผลคำสั่งเดิม" })).toBeVisible();
    await dialog(page).getByRole("button", { name: "ยกเลิก", exact: true }).click();
    await page.getByRole("button", { name: "รีเซ็ตทั้งหมด", exact: true }).click();
    await expect(dialog(page).getByRole("button", { name: "ตรวจผลคำสั่งเดิม" })).toBeVisible();
    const replacement = await register(context);
    await dialog(page).getByRole("button", { name: "ตรวจผลคำสั่งเดิม" }).click();
    await expect(dialog(page)).toBeHidden(); expect(requests).toHaveLength(2); expect(requests[0]).toEqual(requests[1]);
    expect(resetTestSql(`select retired_at is null from private.bill_issuer_devices where id='${replacement.deviceId}'`)).toBe("t");
  } finally { await context.close(); }
});

test("a second confirm click during submission never creates another reset request", async ({ browser }) => {
  const context = await contextFor(browser);
  try {
    const page = await context.newPage(); await openDevices(page); let calls = 0;
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route(`**${endpoint}`, async route => {
      if (route.request().method() !== "POST") return route.continue();
      calls++; await held; await route.continue();
    });
    await page.getByRole("button", { name: "รีเซ็ตทั้งหมด", exact: true }).click(); await input(page).fill("รีเซ็ตทั้งหมด");
    const confirm = dialog(page).getByRole("button", { name: "ยืนยันรีเซ็ตทั้งหมด", exact: true });
    await confirm.click(); await expect(confirm).toBeDisabled();
    await confirm.dispatchEvent("click"); expect(calls).toBe(1); release();
    await expect(dialog(page)).toBeHidden(); expect(calls).toBe(1);
  } finally { await context.close(); }
});

test("unrecognized 409 after commit preserves original command instead of authorizing another reset", async ({ browser }) => {
  const context = await contextFor(browser);
  try {
    const page = await context.newPage(); await openDevices(page); const requests: unknown[] = [];
    await page.route(`**${endpoint}`, async route => {
      if (route.request().method() !== "POST") return route.continue();
      requests.push(route.request().postDataJSON());
      if (requests.length === 1) {
        const response = await route.fetch(); expect(response.status()).toBe(200);
        await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ errorCode: "OTHER_CONFLICT" }) });
      } else await route.continue();
    });
    await page.getByRole("button", { name: "รีเซ็ตทั้งหมด", exact: true }).click(); await input(page).fill("รีเซ็ตทั้งหมด");
    await dialog(page).getByRole("button", { name: "ยืนยันรีเซ็ตทั้งหมด", exact: true }).click();
    await expect(dialog(page).getByRole("button", { name: "ตรวจผลคำสั่งเดิม", exact: true })).toBeVisible();
    const replacement = await register(context);
    await dialog(page).getByRole("button", { name: "ตรวจผลคำสั่งเดิม", exact: true }).click();
    await expect(dialog(page)).toBeHidden(); expect(requests).toHaveLength(2); expect(requests[0]).toEqual(requests[1]);
    expect(resetTestSql(`select retired_at is null from private.bill_issuer_devices where id='${replacement.deviceId}'`)).toBe("t");
  } finally { await context.close(); }
});
test("preview outage can retry and empty preview cannot reset", async ({ browser }) => {
  const context = await contextFor(browser);
  try {
    const page = await context.newPage(); await openDevices(page); let calls = 0;
    await page.route(`**${endpoint}`, route => {
      calls++; return route.fulfill({ status: calls === 1 ? 503 : 200, contentType: "application/json",
        body: JSON.stringify(calls === 1 ? { error: "unavailable" } : { count: 0, snapshot: "a".repeat(64) }) });
    });
    await page.getByRole("button", { name: "รีเซ็ตทั้งหมด", exact: true }).click();
    await expect(dialog(page).getByRole("alert")).toContainText("โหลดจำนวนเครื่องไม่สำเร็จ");
    await dialog(page).getByRole("button", { name: "โหลดจำนวนอีกครั้ง" }).click();
    await expect(dialog(page)).toContainText("ไม่มีรหัสที่ต้องรีเซ็ต");
    await expect(dialog(page).getByRole("button", { name: "ยืนยันรีเซ็ตทั้งหมด", exact: true })).toBeDisabled();
    expect(calls).toBe(2);
  } finally { await context.close(); }
});

test("offline income keeps its old number through reset, syncs once, and new work shares replacement across branches", async ({ browser }) => {
  test.setTimeout(150000);
  const context = await contextFor(browser), controller = await contextFor(browser), marker = `Reset offline ${crypto.randomUUID()}`;
  resetTestSql("update public.income_expense_approval_settings set approval_min_amount=null,non_current_date_requires_approval=false;update public.income_expense_approval_keywords set is_active=false;");
  const issuer = (page: Page, location: string) => page.evaluate(id => new Promise<{ code: string }>(resolve => {
    const request = indexedDB.open("lanflow_sync_db"); request.onsuccess = () => {
      const db = request.result, tx = db.transaction("rubber_bill_numbers"), read = tx.objectStore("rubber_bill_numbers").get(id);
      tx.oncomplete = () => { db.close(); resolve(read.result.issuer); };
    };
  }), location);
  const queue = (page: Page) => page.evaluate(() => new Promise<Array<{ id: string; payload: Record<string, unknown> }>>(resolve => {
    const request = indexedDB.open("lanflow_sync_db"); request.onsuccess = () => {
      const db = request.result, tx = db.transaction("sync_queue"), read = tx.objectStore("sync_queue").getAll();
      tx.oncomplete = () => { db.close(); resolve(read.result); };
    };
  }));
  try {
    const page = await context.newPage(); await openDevices(page); const original = await issuer(page, branch);
    if (process.env.BILL_RESET_PRODUCTION === "1") {
      await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 30000 }).toBe(true);
      await page.reload(); await waitForBillIssuer(page, branch);
      await expect(page.getByRole("status").filter({ hasText: /^พร้อมใช้งานออฟไลน์ 100%$/ })).toBeVisible({ timeout: 60000 });
    }
    await page.getByRole("button", { name: "รับ-จ่าย", exact: true }).click();
    await page.getByRole("button", { name: "เพิ่มรายรับ", exact: true }).click(); await confirmCurrentBranchIfRequired(page);
    const modal = page.getByRole("dialog", { name: "เพิ่ม/แก้ไข บิลเงินสด", exact: true });
    const row = modal.locator("table tbody tr").first(); await row.locator("input").first().fill(marker);
    await row.locator('input[type="number"]').first().fill("17");
    await context.setOffline(true); await modal.getByRole("button", { name: "บันทึกบิล", exact: true }).click();
    await expect(modal).toBeHidden();
    const event = (await queue(page)).find(value => value.payload.title === marker)!; expect(event).toBeTruthy();
    const base = String(event.payload.localBillNo); expect(base).toContain(original.code);
    if (process.env.BILL_RESET_PRODUCTION === "1") {
      await page.reload();
      expect((await queue(page)).find(value => value.id === event.id)).toEqual(event);
    }
    const before = await (await controller.request.get(endpoint)).json();
    const reset = await controller.request.post(endpoint, { headers: { origin: "http://127.0.0.1:3002" },
      data: { requestId: crypto.randomUUID(), snapshot: before.snapshot, confirmation: "รีเซ็ตทั้งหมด" } });
    expect(reset.status(), await reset.text()).toBe(200);
    expect((await queue(page)).find(value => value.id === event.id)).toEqual(event);
    await context.setOffline(false);
    await expect.poll(() => resetTestSql(`select server_bill_no from public.income_expense where client_temp_id='${event.id}'`), { timeout: 60000 }).toBe(`${base}-1`);
    await page.locator("summary").filter({ hasText: /ออฟไลน์/ }).click();
    await page.getByRole("button", { name: "ตรวจความพร้อมอีกครั้ง" }).click();
    await expect.poll(async () => (await issuer(page, branch)).code, { timeout: 20000 }).not.toBe(original.code);
    const replacement = await issuer(page, branch);
    const replay = await context.request.post("/api/lanflow/income-expense", { headers: { origin: "http://127.0.0.1:3002" }, data: event.payload });
    expect(replay.status(), await replay.text()).toBe(200);
    expect(resetTestSql(`select count(*) from public.income_expense where client_temp_id='${event.id}'`)).toBe("1");
    expect(resetTestSql(`select server_bill_no from public.income_expense where client_temp_id='${event.id}'`)).toBe(`${base}-1`);
    await selectAppLocation(page, otherBranch); await waitForBillIssuer(page, otherBranch);
    expect((await issuer(page, otherBranch)).code).toBe(replacement.code);
  } finally { await context.setOffline(false); await context.close(); await controller.close(); }
});
