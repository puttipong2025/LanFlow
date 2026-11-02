import { expect, test, type Browser } from "@playwright/test";
import { selectAppLocation } from "./helpers/select-app-location";
import { installThresholdAlertHandler } from "./helpers/dismiss-threshold-alert";

async function openFixture(browser: Browser, status: "draft" | "verified", blocked?: "report" | "receipt" | "wex" | "sold", canVerify = true,
  options: { originalWeight?: number; failDetailAfterSave?: boolean; canonicalWeightAfterSave?: number } = {}) {
  const context = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
  const me = await (await context.request.get("/api/auth/me")).json() as { profile: { locationIds: string[] } };
  const locationId = me.profile.locationIds[0];
  const id = crypto.randomUUID();
  const originalWeight = options.originalWeight ?? 12355;
  let currentWeight = originalWeight, weightLossPercent = 0;
  const submissions: Record<string, unknown>[] = [];
  const summary = () => ({ id, exportNo: "REX-WEIGHT-UI", locationId, locationName: "สาขาทดสอบ", status,
    originalWeightTotal: originalWeight, currentWeight, weightLossPercent, rubberValueTotal: 498938, paidTotal: 498938,
    averagePrice: 40.38, workRate: 0.3, otherOperatingCost: 0, workTotal: 3706.5,
    expenseDestination: status === "verified" ? "external" : null, createdByName: "ผู้ทดสอบ", createdAt: "2026-11-02T01:00:00Z",
    verifiedAt: status === "verified" ? "2026-11-02T02:00:00Z" : null, itemCount: 0,
    reportLockNo: blocked === "report" ? "RPT-LOCKED" : null, hasWorkTransfer: true,
    hasWexReservation: blocked === "wex", soldOutAt: blocked === "sold" ? "2026-11-02T03:00:00Z" : null,
    receiptBillId: blocked === "receipt" ? crypto.randomUUID() : null, receiptBillNo: blocked === "receipt" ? "RB-RECEIVED" : null,
  });
  const page = await context.newPage();
  await installThresholdAlertHandler(page);
  await page.route("**/api/lanflow/threshold-alert", async route => {
    const response = await route.fetch(); const body = await response.json();
    await route.fulfill({ json: { ...body, candidates: [], unavailable: [], configuredCount: 0, checkedCount: 0 } });
  });
  await page.route("**/api/lanflow/rubber-exports?*", route => route.fulfill({ json: {
    exports: new URL(route.request().url()).searchParams.get("locationId") === locationId ? [summary()] : [],
    availableBills: [], permissions: { canVerify, canDelete: canVerify },
  } }));
  await page.route(`**/api/lanflow/rubber-exports/${id}`, async route => {
    if (route.request().method() === "PATCH") {
      const values = route.request().postDataJSON(); submissions.push(values); currentWeight = values.currentWeight;
      weightLossPercent = Math.round((originalWeight - currentWeight) / originalWeight * 10000) / 100;
      await route.fulfill({ json: { id } }); return;
    }
    if (options.failDetailAfterSave && submissions.length) { await route.fulfill({ status: 503, json: { error: "fixture refresh unavailable" } }); return; }
    if (submissions.length && options.canonicalWeightAfterSave !== undefined) {
      currentWeight = options.canonicalWeightAfterSave;
      weightLossPercent = Math.round((originalWeight - currentWeight) / originalWeight * 10000) / 100;
    }
    await route.fulfill({ json: { ...summary(), items: [], weightAdjustments: submissions.length ? [{ id: "audit-1", previousWeight: originalWeight,
      currentWeight, previousLossPercent: 0, lossPercent: weightLossPercent, actorName: "ผู้ทดสอบ", adjustedAt: "2026-11-02T04:00:00Z", note: "ชั่งจริง" }] : [] } });
  });
  await page.route(`**/api/lanflow/rubber-exports/${id}/weight`, async route => {
    const values = route.request().postDataJSON(); submissions.push(values); currentWeight = values.currentWeight;
    weightLossPercent = Math.round((originalWeight - currentWeight) / originalWeight * 10000) / 100;
    await route.fulfill({ json: { id } });
  });
  await page.goto("/"); await selectAppLocation(page, locationId);
  await page.getByRole("button", { name: /^ส่งออกยาง/ }).click();
  await page.getByRole("button", { name: "ดูรายละเอียด REX-WEIGHT-UI" }).click();
  const dialog = page.getByRole("dialog", { name: "REX-WEIGHT-UI" }); await expect(dialog).toBeVisible();
  return { context, page, dialog, submissions, id };
}

test("verified weight expands inside the existing modal, saves only weight and shows history", async ({ browser }) => {
  const h = await openFixture(browser, "verified");
  try {
    await expect(h.dialog.locator("#rubber-export-current-weight")).toHaveAttribute("readonly", "");
    await h.dialog.getByRole("button", { name: "ปรับ", exact: true }).click();
    await expect(h.page.getByRole("dialog")).toHaveCount(1);
    await expect(h.dialog.locator(".landscape-modal-body #rubber-export-weight-editor")).toBeVisible();
    const weight = h.dialog.locator("#rubber-export-current-weight"), percent = h.dialog.locator("#rubber-export-loss-percent");
    await expect(weight).not.toHaveAttribute("readonly", ""); await expect(percent).toHaveAttribute("readonly", "");
    await weight.fill("12000"); await expect(percent).toHaveValue("2.87");
    await h.dialog.getByRole("radio", { name: "น้ำหนักลดลง (%)" }).check();
    await expect(weight).toHaveValue("12000"); await expect(weight).toHaveAttribute("readonly", "");
    await percent.fill("5"); await expect(weight).toHaveValue("11737.25");
    await h.dialog.getByLabel("หมายเหตุการปรับ (ถ้ามี)").fill("ชั่งจริง");
    await h.dialog.getByRole("button", { name: "บันทึกน้ำหนัก", exact: true }).click();
    await expect(h.dialog.getByRole("button", { name: "ปรับ", exact: true })).toBeVisible();
    await expect(h.dialog.getByRole("button", { name: "ปรับ", exact: true })).toBeFocused();
    expect(h.submissions).toEqual([{ currentWeight: 11737.25, expectedCurrentWeight: 12355, note: "ชั่งจริง" }]);
    await h.dialog.getByText("ประวัติการปรับน้ำหนัก", { exact: true }).click();
    await expect(h.dialog.getByText(/12,355.00 → 11,737.25 กก./)).toBeVisible();
    await h.page.setViewportSize({ width: 844, height: 390 });
    await h.dialog.getByRole("button", { name: "ปรับ", exact: true }).click();
    await h.dialog.getByRole("button", { name: "ยกเลิก", exact: true }).click();
    await expect(h.dialog.getByRole("button", { name: "ปรับ", exact: true })).toBeFocused();
  } finally { await h.context.close(); }
});

test("weight entry shows exact rounded loss and keeps weight when switching modes", async ({ browser }) => {
  const h = await openFixture(browser, "draft", undefined, true, { originalWeight: 0.32 });
  try {
    const weight = h.dialog.locator("#rubber-export-current-weight"), percent = h.dialog.locator("#rubber-export-loss-percent");
    await weight.fill("0.27");
    await expect(percent).toHaveValue("15.63");
    await h.dialog.getByRole("radio", { name: "น้ำหนักลดลง (%)" }).check();
    await expect(weight).toHaveValue("0.27");
    await expect(percent).toHaveValue("15.63");
    await expect(h.dialog.getByRole("button", { name: "บันทึกร่าง" })).toBeEnabled();
  } finally { await h.context.close(); }
});

test("draft opens with exclusive input modes and keeps the original save workflow", async ({ browser }) => {
  const h = await openFixture(browser, "draft");
  try {
    await expect(h.dialog.getByRole("button", { name: "ปรับ", exact: true })).toHaveCount(0);
    await expect(h.dialog.getByRole("radio", { name: "น้ำหนักปัจจุบัน (กก.)" })).toBeChecked();
    await h.dialog.getByRole("radio", { name: "น้ำหนักลดลง (%)" }).check();
    const percent = h.dialog.locator("#rubber-export-loss-percent");
    await percent.fill("100"); await expect(h.dialog.getByRole("button", { name: "บันทึกร่าง" })).toBeDisabled();
    await percent.fill("5"); await h.dialog.getByRole("button", { name: "บันทึกร่าง" }).click();
    await expect.poll(() => h.submissions.length).toBe(1);
    expect(h.submissions[0]).toEqual({ currentWeight: 11737.25, workRate: 0.3, otherOperatingCost: 0 });
    await expect(h.page.getByRole("dialog")).toHaveCount(1);
    await expect(h.dialog.getByRole("button", { name: "ตรวจสอบแล้ว", exact: true })).toBeEnabled();
  } finally { await h.context.close(); }
});

for (const blocked of ["report", "receipt", "wex", "sold"] as const) {
  test(`verified adjustment is blocked by ${blocked}`, async ({ browser }) => {
    const h = await openFixture(browser, "verified", blocked);
    try { await expect(h.dialog.getByRole("button", { name: "ปรับ", exact: true })).toBeDisabled(); await expect(h.dialog.getByText(/^ปรับน้ำหนักไม่ได้:/)).toBeVisible(); }
    finally { await h.context.close(); }
  });
}
test("existing management permission controls access to the adjustment", async ({ browser }) => {
  const h = await openFixture(browser, "verified", undefined, false);
  try { await expect(h.dialog.getByRole("button", { name: "ปรับ", exact: true })).toHaveCount(0); }
  finally { await h.context.close(); }
});

test("percentage rounding to zero cannot silently save a draft with missing weight", async ({ browser }) => {
  const h = await openFixture(browser, "draft", undefined, true, { originalWeight: 0.01 });
  try {
    await h.dialog.getByRole("radio", { name: "น้ำหนักลดลง (%)" }).check();
    await h.dialog.locator("#rubber-export-loss-percent").fill("50");
    await expect(h.dialog.locator("#rubber-export-current-weight")).toHaveValue("0.01");
    await expect(h.dialog.getByRole("button", { name: "บันทึกร่าง" })).toBeEnabled();
    await h.dialog.locator("#rubber-export-loss-percent").fill("99.99");
    await expect(h.dialog.getByRole("button", { name: "บันทึกร่าง" })).toBeDisabled();
    await expect(h.dialog.locator("#rubber-export-weight-entry-error")).not.toBeEmpty();
    expect(h.submissions).toHaveLength(0);
  } finally { await h.context.close(); }
});

test("a successful weight write remains successful when the following detail read fails", async ({ browser }) => {
  const h = await openFixture(browser, "verified", undefined, true, { failDetailAfterSave: true });
  try {
    await h.dialog.getByRole("button", { name: "ปรับ", exact: true }).click();
    await h.dialog.locator("#rubber-export-current-weight").fill("12000");
    await h.dialog.getByRole("button", { name: "บันทึกน้ำหนัก", exact: true }).click();
    await expect.poll(() => h.submissions.length).toBe(1);
    await expect(h.dialog.getByRole("button", { name: "บันทึกน้ำหนัก", exact: true })).toHaveCount(0);
    await expect(h.dialog.locator("#rubber-export-current-weight")).toHaveValue("12000");
    await expect(h.page.getByText(/บันทึกน้ำหนักแล้ว.*โหลด/)).toBeVisible();
  } finally { await h.context.close(); }
});

test("a pending draft save blocks verification and changes to the weight source", async ({ browser }) => {
  const h = await openFixture(browser, "draft");
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let saving = false;
  try {
    await h.page.route(`**/api/lanflow/rubber-exports/${h.id}`, async route => {
      if (route.request().method() !== "PATCH") { await route.fallback(); return; }
      saving = true; await gate; await route.fulfill({ json: { id: h.id } });
    });
    await expect(h.dialog.getByRole("button", { name: "ตรวจสอบแล้ว", exact: true })).toBeEnabled();
    await h.dialog.getByRole("button", { name: "บันทึกร่าง", exact: true }).click();
    await expect.poll(() => saving).toBe(true);
    await expect(h.dialog.getByRole("button", { name: "ตรวจสอบแล้ว", exact: true })).toBeDisabled();
    await expect(h.dialog.locator("#rubber-export-current-weight")).toBeDisabled();
    await expect(h.dialog.getByRole("radio", { name: "น้ำหนักลดลง (%)" })).toBeDisabled();
  } finally { release(); await h.context.close(); }
});

test("canonical weight from a newer correction replaces both form values after save", async ({ browser }) => {
  const h = await openFixture(browser, "verified", undefined, true, { canonicalWeightAfterSave: 11900 });
  try {
    await h.dialog.getByRole("button", { name: "ปรับ", exact: true }).click();
    await h.dialog.locator("#rubber-export-current-weight").fill("12000");
    await h.dialog.getByRole("button", { name: "บันทึกน้ำหนัก", exact: true }).click();
    await expect(h.dialog.getByRole("button", { name: "ปรับ", exact: true })).toBeVisible();
    await expect(h.dialog.locator("#rubber-export-current-weight")).toHaveValue("11900");
    await h.dialog.getByRole("button", { name: "ปรับ", exact: true }).click();
    await expect(h.dialog.locator("#rubber-export-loss-percent")).toHaveValue("3.68");
    await expect(h.dialog.getByRole("button", { name: "บันทึกน้ำหนัก", exact: true })).toBeDisabled();
    expect(h.submissions).toHaveLength(1);
  } finally { await h.context.close(); }
});

test("changing branch by keyboard closes details from the previous branch", async ({ browser }) => {
  const h = await openFixture(browser, "verified");
  try {
    const selector = h.page.locator('button[data-location-id][aria-controls="location-selector-listbox"]');
    const previous = await selector.getAttribute("data-location-id");
    await selector.focus(); await h.page.keyboard.press("Enter");
    const next = h.page.locator(`[role="option"][data-location-id]:not([data-location-id="${previous}"]):not([disabled])`).first();
    await next.focus(); await h.page.keyboard.press("Enter");
    await expect(selector).not.toHaveAttribute("data-location-id", previous!);
    await expect(h.page.getByRole("dialog", { name: "REX-WEIGHT-UI" })).toHaveCount(0);
  } finally { await h.context.close(); }
});
