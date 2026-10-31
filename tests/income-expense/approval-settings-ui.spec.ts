import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { installThresholdAlertHandler } from "../helpers/dismiss-threshold-alert";

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const ids = ["75000000-0000-4000-8000-000000000001", "75000000-0000-4000-8000-000000000002", "75000000-0000-4000-8000-000000000003"];
let locationId: string;
async function mockRequests(page: Page) {
  const common = { request_status: "pending", created_at: "2026-10-31T02:00:00Z", requested_by_name: "ผู้ขอทดสอบ", location_id: locationId, location_name: "สาขาทดสอบ" };
  const rows = [
    { ...common, id: ids[0], requested_operation: "create", matched_reasons: ["keyword"], tx_type: "expense", title: "บิลขาย — รายการทดสอบข้อความยาวสำหรับมือถือ", cost: 300, requested_payload: { saleLines: [{ sequenceNo: 1, title: "สินค้าทดสอบ", quantity: 2, unitPrice: 150, lineTotal: 300 }] } },
    { ...common, id: ids[1], source_location_id: locationId, source_location_name: "ต้นทาง", target_location_name: "ปลายทาง", transfer_display_no: "CT-CARD-TEST", sent_total: 500, received_total: 490, difference_total: 10 },
    { ...common, id: ids[2], transfer_display_no: "BT-CARD-TEST", amount: 700 },
  ];
  for (const [index, table] of ["income_expense_approval_requests", "cash_transfer_delete_requests", "branch_transfer_delete_requests"].entries()) {
    await page.route(`**/rest/v1/${table}?*`, async route => {
      if (route.request().method() === "HEAD") { await route.fulfill({ status: 200, headers: { "content-range": "0-0/1" }, body: "" }); return; }
      const filter = new URL(route.request().url()).searchParams.get("request_status");
      await route.fulfill({ status: 200, json: filter?.startsWith("eq.") ? rows[index].request_status === "pending" ? [rows[index]] : [] : rows[index].request_status !== "pending" ? [rows[index]] : [] });
    });
  }
  return rows;
}
async function open(page: Page) {
  await installThresholdAlertHandler(page);
  await page.goto("/");
  await page.getByRole("button", { name: /^รับ-จ่าย(?: |$)/ }).click();
  await page.getByRole("button", { name: /^ตั้งค่าและอนุมัติรับ-จ่าย/ }).click();
  const dialog = page.getByRole("dialog", { name: "ตั้งค่าและอนุมัติรับ-จ่าย", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}
test.describe.serial("Income expense approval table and independent configuration", () => {
  test.use({ storageState: "playwright/.auth/super_admin.json" });
  test.beforeAll(async () => {
    const result = await db().from("locations").select("id").eq("is_active", true).order("created_at").limit(1).single();
    expect(result.error).toBeNull(); locationId = result.data!.id;
  });
  for (const width of [375, 1280]) test(`table and collapsed settings preserve drafts at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await mockRequests(page);
    const dialog = await open(page);
    await dialog.getByRole("combobox", { name: "สาขา", exact: true }).selectOption("all");
    await expect(dialog.locator('tr[id^="income-expense-approval-request-"]')).toHaveCount(3);
    await expect(dialog.locator("table")).toHaveCount(1);
    await expect(dialog.getByRole("columnheader", { name: "จำนวนเงิน", exact: true })).toBeInViewport({ ratio: 1 });
    for (const row of await dialog.locator('tr[id^="income-expense-approval-request-"]').all()) {
      const amount = row.getByRole("cell").nth(1);
      const bounds = await amount.boundingBox();
      const scroller = await dialog.getByRole("region", { name: "ตารางคำขออนุมัติ เลื่อนแนวนอนเพื่อดูข้อมูลเพิ่มเติม" }).boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(scroller!.x);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(scroller!.x + scroller!.width);
    }
    await expect(dialog.getByText("รับจริง ฿490.00 · ผลต่าง ฿10.00")).toBeVisible();
    const toggle = dialog.getByRole("button", { name: "ตั้งค่าระบบ", exact: true });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.press("Enter");
    const amount = dialog.getByLabel("ยอดขั้นต่ำ (บาท)", { exact: true });
    await amount.fill("4321.25");
    await dialog.getByRole("button", { name: "ซ่อนการตั้งค่าระบบ", exact: true }).press("Enter");
    await toggle.click(); await expect(amount).toHaveValue("4321.25");
    const layout = await dialog.evaluate(element => ({
      scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
      outside: Array.from(element.querySelectorAll("*")).filter(child => !child.closest('[role="region"]') && child.getBoundingClientRect().right > element.getBoundingClientRect().right + 1)
        .slice(0, 5).map(child => ({ tag: child.tagName, classes: child.className, right: child.getBoundingClientRect().right })),
    }));
    expect(layout.scrollWidth <= layout.clientWidth, JSON.stringify(layout)).toBe(true);
    await dialog.screenshot({ path: testInfo.outputPath(`approval-${width}.png`) });
    if (width === 375) {
      const original = await db().from("income_expense_approval_settings").select("*").eq("id", true).single();
      expect(original.error).toBeNull();
      try {
        await dialog.getByRole("checkbox", { name: "ขออนุมัติเมื่อวันที่รับ–จ่ายไม่ใช่วันปัจจุบัน" }).setChecked(!original.data!.non_current_date_requires_approval);
        await dialog.getByRole("button", { name: "บันทึกกฎวันที่", exact: true }).click();
        await expect(dialog.getByRole("button", { name: "บันทึกกฎวันที่", exact: true })).toBeDisabled();
        await expect(amount).toHaveValue("4321.25");
        const saved = await db().from("income_expense_approval_settings").select("*").eq("id", true).single();
        expect(saved.data!.non_current_date_requires_approval).toBe(!original.data!.non_current_date_requires_approval);
        expect(saved.data!.approval_min_amount).toBe(original.data!.approval_min_amount);
      } finally { expect((await db().from("income_expense_approval_settings").update(original.data!).eq("id", true)).error).toBeNull(); }
    }
  });

  test("settings failure does not hide ready requests and can recover", async ({ page }) => {
    await mockRequests(page);
    let fail = true;
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/rest/v1/income_expense_approval_settings?*", async route => {
      if (fail) { await held; await route.fulfill({ status: 400, json: { message: "unavailable" } }); } else await route.continue();
    });
    const dialog = await open(page);
    await dialog.getByRole("combobox", { name: "สาขา", exact: true }).selectOption("all");
    await expect(dialog.locator('tr[id^="income-expense-approval-request-"]')).toHaveCount(3);
    await dialog.getByRole("button", { name: "ตั้งค่าระบบ", exact: true }).click();
    await expect(dialog.getByLabel("ยอดขั้นต่ำ (บาท)", { exact: true })).toBeDisabled();
    release();
    await expect(dialog.getByRole("alert")).toContainText("โหลดการตั้งค่าบางส่วนไม่สำเร็จ");
    fail = false;
    await dialog.getByRole("button", { name: "ลองโหลดกติกาใหม่", exact: true }).click();
    await expect(dialog.getByLabel("ยอดขั้นต่ำ (บาท)", { exact: true })).toBeEnabled();
  });

  test("the same keyword can have independent income and expense rules while same-scope duplicates are blocked", async ({ page }) => {
    const keyword = `Scope-${crypto.randomUUID()}`;
    try {
      const seeded = await db().from("income_expense_approval_keywords").insert({ keyword, applies_to: "expense", match_mode: "contains", is_active: true });
      expect(seeded.error).toBeNull();
      const dialog = await open(page);
      await dialog.getByRole("button", { name: "ตั้งค่าระบบ", exact: true }).click();
      const section = dialog.locator("section").filter({ has: page.getByRole("heading", { name: "ข้อความที่ต้องขออนุมัติ", exact: true }) }).last();
      await section.getByLabel("ข้อความ", { exact: true }).fill(keyword);
      await section.getByRole("button", { name: "เพิ่มข้อความ", exact: true }).click();
      await expect(section.getByRole("alert")).toHaveText("มีข้อความนี้ในรายการตรวจสอบแล้ว");
      const before = await db().from("income_expense_approval_keywords").select("id").eq("keyword", keyword);
      expect(before.data).toHaveLength(1);
      await section.getByRole("combobox").first().selectOption("income");
      await section.getByLabel("ยอดขั้นต่ำเฉพาะข้อความ (บาท)").fill("1000");
      await section.getByRole("button", { name: "เพิ่มข้อความ", exact: true }).click();
      await expect(section.getByRole("article", { name: `ข้อความ ${keyword}`, exact: true })).toHaveCount(2);
      const saved = await db().from("income_expense_approval_keywords").select("applies_to,approval_min_amount").eq("keyword", keyword);
      expect(saved.error).toBeNull();
      expect(saved.data).toEqual(expect.arrayContaining([
        expect.objectContaining({ applies_to: "expense", approval_min_amount: null }),
        expect.objectContaining({ applies_to: "income", approval_min_amount: 1000 }),
      ]));
    } finally {
      expect((await db().from("income_expense_approval_keywords").delete().eq("keyword", keyword)).error).toBeNull();
    }
  });

  test("keyword creation and disable persist with a server audit timestamp", async ({ page }) => {
    const text = `UI ข้อความ ${crypto.randomUUID()}`;
    let createdId: string | undefined;
    try {
      const dialog = await open(page);
      await dialog.getByRole("button", { name: "ตั้งค่าระบบ", exact: true }).click();
      await dialog.getByLabel("ข้อความ", { exact: true }).fill(text);
      await dialog.getByRole("button", { name: "เพิ่มข้อความ", exact: true }).click();
      const card = dialog.getByRole("article", { name: `ข้อความ ${text}`, exact: true });
      await expect(card.getByRole("button", { name: "ปิดใช้งาน", exact: true })).toBeVisible();
      const row = await db().from("income_expense_approval_keywords").select("id").eq("keyword", text).single();
      expect(row.error).toBeNull(); createdId = row.data!.id;
      await card.getByRole("button", { name: "ปิดใช้งาน", exact: true }).click();
      await page.getByRole("alertdialog", { name: "ปิดใช้งานข้อความ", exact: true }).getByRole("button", { name: "ปิดใช้งาน", exact: true }).click();
      await expect(card.getByRole("button", { name: "ปิดใช้งาน", exact: true })).toHaveCount(0);
      const disabled = await db().from("income_expense_approval_keywords").select("is_active,deleted_at").eq("id", createdId).single();
      expect(disabled.data!.is_active).toBe(false); expect(disabled.data!.deleted_at).toBeTruthy();
    } finally {
      const result = await db().from("income_expense_approval_keywords").delete().eq("keyword", text);
      expect(result.error).toBeNull();
    }
  });

  test("storage quota failure does not turn an acknowledged date-rule save into failure", async ({ page }) => {
    const original = await db().from("income_expense_approval_settings").select("*").eq("id", true).single();
    expect(original.error).toBeNull();
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    try {
      const dialog = await open(page);
      await dialog.getByRole("button", { name: "ตั้งค่าระบบ", exact: true }).click();
      await page.evaluate(() => {
        const originalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key === "lanflow:income-expense-approval-settings:v1") throw new DOMException("Storage quota exceeded", "QuotaExceededError");
          originalSetItem.call(this, key, value);
        };
      });
      await dialog.getByRole("checkbox", { name: "ขออนุมัติเมื่อวันที่รับ–จ่ายไม่ใช่วันปัจจุบัน" }).setChecked(!original.data!.non_current_date_requires_approval);
      await dialog.getByRole("button", { name: "บันทึกกฎวันที่", exact: true }).click();
      await expect(page.getByText("บันทึกกติกาแล้ว", { exact: true })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "บันทึกกฎวันที่", exact: true })).toBeDisabled();
      const saved = await db().from("income_expense_approval_settings").select("*").eq("id", true).single();
      expect(saved.error).toBeNull();
      expect(saved.data!.non_current_date_requires_approval).toBe(!original.data!.non_current_date_requires_approval);
      expect(await page.evaluate(() => localStorage.getItem("lanflow:income-expense-approval-settings:v1"))).toBeNull();
      expect(pageErrors).toEqual([]);
    } finally {
      expect((await db().from("income_expense_approval_settings").update({ non_current_date_requires_approval: original.data!.non_current_date_requires_approval }).eq("id", true)).error).toBeNull();
    }
  });

  test("acknowledged save stays successful when the follow-up refresh fails", async ({ page }) => {
    const original = await db().from("income_expense_approval_settings").select("*").eq("id", true).single();
    let saved = false;
    try {
      const dialog = await open(page);
      await dialog.getByRole("button", { name: "ตั้งค่าระบบ", exact: true }).click();
      await page.route("**/rest/v1/income_expense_approval_settings?*", async route => {
        if (route.request().method() === "PATCH") { const response = await route.fetch(); saved = true; await route.fulfill({ response }); }
        else if (saved) await route.fulfill({ status: 400, json: { message: "refresh failed" } });
        else await route.continue();
      });
      await dialog.getByLabel("ยอดขั้นต่ำ (บาท)", { exact: true }).fill("5555.25");
      await dialog.getByRole("button", { name: "บันทึกเกณฑ์ยอดเงิน", exact: true }).click();
      await expect(page.getByText("บันทึกเกณฑ์ยอดเงินแล้ว", { exact: true })).toBeVisible();
      await expect(dialog.getByRole("alert")).toContainText("โหลดการตั้งค่าบางส่วนไม่สำเร็จ");
      expect((await db().from("income_expense_approval_settings").select("approval_min_amount").eq("id", true).single()).data!.approval_min_amount).toBe(5555.25);
    } finally { expect((await db().from("income_expense_approval_settings").update(original.data!).eq("id", true)).error).toBeNull(); }
  });

  test("going offline in the open dialog preserves the draft and sends no deferred write", async ({ page, context }) => {
    const dialog = await open(page);
    await dialog.getByRole("button", { name: "ตั้งค่าระบบ", exact: true }).click();
    const amount = dialog.getByLabel("ยอดขั้นต่ำ (บาท)", { exact: true });
    await amount.fill("1234");
    let writes = 0;
    page.on("request", request => { if (request.url().includes("/income_expense_approval_") && ["POST", "PATCH"].includes(request.method())) writes++; });
    await context.setOffline(true);
    await expect(dialog.getByRole("button", { name: "บันทึกเกณฑ์ยอดเงิน", exact: true })).toBeDisabled();
    await expect(amount).toHaveValue("1234");
    await context.setOffline(false);
    await expect(dialog.getByRole("button", { name: "บันทึกเกณฑ์ยอดเงิน", exact: true })).toBeEnabled();
    expect(writes).toBe(0);
  });

  test("same-section conflict preserves the draft and requires an explicit latest-value review", async ({ page }) => {
    const original = await db().from("income_expense_approval_settings").select("*").eq("id", true).single();
    try {
      const dialog = await open(page);
      await dialog.getByRole("button", { name: "ตั้งค่าระบบ", exact: true }).click();
      await dialog.getByLabel("ยอดขั้นต่ำ (บาท)", { exact: true }).fill("2222.25");
      expect((await db().from("income_expense_approval_settings").update({ approval_min_amount: 3333.25 }).eq("id", true)).error).toBeNull();
      await dialog.getByRole("button", { name: "บันทึกเกณฑ์ยอดเงิน", exact: true }).click();
      await expect(dialog.getByText("ค่าถูกเปลี่ยนหรือสิทธิ์เปลี่ยนไป", { exact: false })).toBeVisible();
      await expect(dialog.getByLabel("ยอดขั้นต่ำ (บาท)", { exact: true })).toHaveValue("2222.25");
      expect((await db().from("income_expense_approval_settings").select("approval_min_amount").eq("id", true).single()).data!.approval_min_amount).toBe(3333.25);
      await dialog.getByRole("button", { name: "โหลดค่าล่าสุดก่อนบันทึกอีกครั้ง" }).click();
      await dialog.getByRole("button", { name: "บันทึกเกณฑ์ยอดเงิน", exact: true }).click();
      await expect.poll(async () => (await db().from("income_expense_approval_settings").select("approval_min_amount").eq("id", true).single()).data!.approval_min_amount).toBe(2222.25);
    } finally { expect((await db().from("income_expense_approval_settings").update(original.data!).eq("id", true)).error).toBeNull(); }
  });

  test("a lost response after persistence is uncertain and never resends automatically", async ({ page }) => {
    const original = await db().from("income_expense_approval_settings").select("*").eq("id", true).single();
    let writes = 0;
    try {
      const dialog = await open(page);
      await dialog.getByRole("button", { name: "ตั้งค่าระบบ", exact: true }).click();
      await page.route("**/rest/v1/income_expense_approval_settings?*", async route => {
        if (route.request().method() !== "PATCH") { await route.continue(); return; }
        writes++; await route.fetch(); await route.abort("failed");
      });
      await dialog.getByLabel("ยอดขั้นต่ำ (บาท)", { exact: true }).fill("4444.25");
      await dialog.getByRole("button", { name: "บันทึกเกณฑ์ยอดเงิน", exact: true }).click();
      await expect(dialog.getByText("ยังยืนยันผลบันทึกไม่ได้", { exact: false })).toBeVisible();
      expect((await db().from("income_expense_approval_settings").select("approval_min_amount").eq("id", true).single()).data!.approval_min_amount).toBe(4444.25);
      expect(writes).toBe(1);
      await dialog.getByRole("button", { name: "โหลดค่าล่าสุดก่อนบันทึกอีกครั้ง" }).click();
      expect(writes).toBe(1);
    } finally { expect((await db().from("income_expense_approval_settings").update(original.data!).eq("id", true)).error).toBeNull(); }
  });

  test("system manager reads disabled keywords and retains request actions without settings editors", async ({ browser }) => {
    const client = db(); const managerId = "00000000-0000-4000-8000-000000000002";
    const previous = await client.from("profiles").select("can_access_super_admin_features").eq("id", managerId).single();
    const keywordId = crypto.randomUUID();
    const context = await browser.newContext({ storageState: "playwright/.auth/admin.json" });
    try {
      expect((await client.from("profiles").update({ can_access_super_admin_features: true }).eq("id", managerId)).error).toBeNull();
      expect((await client.from("income_expense_approval_keywords").insert({ id: keywordId, keyword: "ข้อความปิดสำหรับผู้จัดการ", is_active: false })).error).toBeNull();
      const page = await context.newPage(); await mockRequests(page);
      const dialog = await open(page);
      await dialog.getByRole("combobox", { name: "สาขา", exact: true }).selectOption("all");
      await expect(dialog.getByRole("button", { name: "อนุมัติ", exact: true }).first()).toBeEnabled();
      await dialog.getByRole("button", { name: "ตั้งค่าระบบ", exact: true }).click();
      await expect(dialog.getByRole("article", { name: "ข้อความ ข้อความปิดสำหรับผู้จัดการ" })).toContainText("ปิดใช้งาน");
      await expect(dialog.getByRole("button", { name: /^บันทึก/ })).toHaveCount(0);
      await expect(dialog.getByRole("button", { name: "เพิ่มข้อความ", exact: true })).toHaveCount(0);
    } finally {
      await client.from("income_expense_approval_keywords").delete().eq("id", keywordId);
      await client.from("profiles").update(previous.data!).eq("id", managerId);
      await context.close();
    }
  });

  test("two simultaneous authenticated clients isolate sections and reject stale same-section writes", async ({ page, context }) => {
    const original = await db().from("income_expense_approval_settings").select("*").eq("id", true).single();
    try {
      await db().from("income_expense_approval_settings").update({ approval_min_amount: 100, applies_to: "both", non_current_date_requires_approval: false }).eq("id", true);
      const initialRead = page.waitForRequest(request => request.url().includes("/rest/v1/income_expense_approval_settings?") && request.method() === "GET");
      await open(page);
      const headers = (await initialRead).headers();
      const write = (filter: string, data: object) => context.request.patch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/income_expense_approval_settings?id=eq.true&${filter}&select=*`, {
        headers: { apikey: headers.apikey, authorization: headers.authorization, prefer: "return=representation" }, data,
      });
      const same = await Promise.all([write("applies_to=eq.both&approval_min_amount=eq.100", { approval_min_amount: 101 }), write("applies_to=eq.both&approval_min_amount=eq.100", { approval_min_amount: 102 })]);
      expect(same.map(response => response.status())).toEqual([200, 200]);
      expect((await Promise.all(same.map(response => response.json()))).map(rows => rows.length).sort()).toEqual([0, 1]);
      await db().from("income_expense_approval_settings").update({ approval_min_amount: 100, non_current_date_requires_approval: false }).eq("id", true);
      const different = await Promise.all([write("applies_to=eq.both&approval_min_amount=eq.100", { approval_min_amount: 200 }), write("non_current_date_requires_approval=eq.false", { non_current_date_requires_approval: true })]);
      expect(different.map(response => response.status())).toEqual([200, 200]);
      expect((await Promise.all(different.map(response => response.json()))).map(rows => rows.length)).toEqual([1, 1]);
      const saved = await db().from("income_expense_approval_settings").select("approval_min_amount,non_current_date_requires_approval").eq("id", true).single();
      expect(saved.data).toEqual({ approval_min_amount: 200, non_current_date_requires_approval: true });
    } finally { expect((await db().from("income_expense_approval_settings").update(original.data!).eq("id", true)).error).toBeNull(); }
  });

  for (const decision of ["approved", "rejected"] as const) test(`each row routes ${decision} to the original decision endpoint`, async ({ page }) => {
    const rows = await mockRequests(page);
    const calls: string[] = [];
    await page.route("**/api/lanflow/**/decide", async route => {
      const id = route.request().url().split("/").at(-2)!;
      calls.push(route.request().url());
      expect(route.request().postDataJSON().decision).toBe(decision);
      rows[ids.indexOf(id)].request_status = decision;
      await route.fulfill({ status: 200, json: { requestId: id, status: decision, ...(id === ids[0] && decision === "approved" ? { incomeExpenseId: "75000000-0000-4000-8000-000000000004" } : {}) } });
    });
    const dialog = await open(page);
    await dialog.getByRole("combobox", { name: "สาขา", exact: true }).selectOption("all");
    for (const id of ids) {
      const card = dialog.locator(`#income-expense-approval-request-${id}`);
      await card.getByRole("button", { name: decision === "approved" ? "อนุมัติ" : "ปฏิเสธ", exact: true }).click();
      if (decision === "approved") await page.getByRole("alertdialog", { name: "ยืนยันดำเนินการ", exact: true }).getByRole("button", { name: "ยืนยัน", exact: true }).click();
      else {
        const comment = page.getByRole("dialog", { name: id === ids[0] ? "ปฏิเสธรายการ" : "ปฏิเสธคำขอลบ", exact: true });
        await comment.getByLabel("เหตุผลที่ปฏิเสธ (ไม่บังคับ)").fill("ตรวจสอบโดยผู้จัดการ");
        await comment.getByRole("button", { name: "ยืนยัน", exact: true }).click();
      }
      await expect(card.getByText(decision === "approved" ? "อนุมัติแล้ว" : "ปฏิเสธแล้ว", { exact: true })).toBeVisible();
    }
    expect(calls[0]).toContain("/income-expense/approval-requests/");
    expect(calls[1]).toContain("/cash-branch-transfers/delete-requests/");
    expect(calls[2]).toContain("/money-transfers/delete-requests/");
  });
});
