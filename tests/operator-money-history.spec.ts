import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { assertSafeIntegrationTarget } from "./support/integration-target";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:55421";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const locationA = "a1910000-0000-4000-8000-000000000001";
const locationB = "a1910000-0000-4000-8000-000000000002";
const actor = "00000000-0000-4000-8000-000000000003";
const adminId = "00000000-0000-4000-8000-000000000002";
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
const fixtures = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

test.describe("Operator money history @operator-history", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ storageState: "playwright/.auth/admin.json" });

  test.beforeAll(async () => {
    assertSafeIntegrationTarget(url);
    if (!key) throw new Error("Local service key required for operator fixtures");
    const client = fixtures();
    const branches = await client.from("locations").upsert([
      { id: locationA, name: "Operator fixture A", code: "O19A", is_active: true },
      { id: locationB, name: "Operator fixture B", code: "O19B", is_active: true },
    ]);
    if (branches.error) throw branches.error;
    const assignment = await client.from("user_locations").upsert({ user_id: adminId, location_id: locationA, is_primary: false }, { onConflict: "user_id,location_id" });
    if (assignment.error) throw assignment.error;
    const events = await client.from("dashboard_money_events").upsert(Array.from({ length: 14 }, (_, i) => ({
      id: `c1910000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      location_id: i < 12 ? locationA : locationB,
      source_type: i < 11 ? "income_expense" : i === 11 ? "rubber_bill" : "money_transfer",
      source_id: "d1910000-0000-4000-8000-000000000001",
      event_key: `operator-ui-${i}`, action: i === 11 ? "update" : "create", kind: "expense",
      number: `OP19-${i + 1}`, title: "Operator fixture money event", direction: "expense", amount: 123.45,
      actor_user_id: actor, actor_name: "Operator fixture", event_date: today(), occurred_at: `${today()}T01:00:00+07:00`,
    })));
    if (events.error) throw events.error;
    const previousDay = new Date(`${today()}T00:00:00Z`);
    previousDay.setUTCDate(previousDay.getUTCDate() - 1);
    const otherDate = previousDay.toISOString().slice(0, 10);
    const other = await client.from("dashboard_money_events").upsert({
      id: "c1910000-0000-4000-8000-000000000099", location_id: locationA,
      source_type: "withdrawal_adjustment", source_id: "d1910000-0000-4000-8000-000000000099",
      event_key: "operator-ui-other", action: "create", kind: "expense", number: "OTHER-OP19",
      title: "Other operator fixture", direction: "expense", amount: 2,
      actor_user_id: adminId, actor_name: "Other operator fixture", event_date: otherDate, occurred_at: `${otherDate}T01:00:00+07:00`,
    });
    if (other.error) throw other.error;
  });

  test.afterAll(async () => {
    const client = fixtures();
    await client.from("dashboard_money_events").delete().in("location_id", [locationA, locationB]);
    await client.from("user_locations").delete().eq("user_id", adminId).eq("location_id", locationA);
    await client.from("locations").delete().in("id", [locationA, locationB]);
  });

  test("real API scopes options, counts and cursor while rejecting inaccessible branches", async ({ request }) => {
    const endpoint = `/api/lanflow/dashboard/operator-history?actor=${actor}`;
    const response = await request.get(endpoint);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.counts).toEqual({ all: 12, create: 11, update: 1, delete: 0 });
    expect(body.locations.map((item: { key: string }) => item.key)).toEqual([locationA]);
    expect(body.rows).toHaveLength(10);
    const second = await (await request.get(`${endpoint}&cursor=${encodeURIComponent(body.nextCursor)}`)).json();
    expect(second.rows).toHaveLength(2);
    expect(second.rows.every((row: { id: string }) => !body.rows.some((first: { id: string }) => first.id === row.id))).toBe(true);
    expect((await request.get(`${endpoint}&locationId=${locationB}`)).status()).toBe(403);
  });

  test("superadmin sees both transfer sides while self-service is rejected", async ({ playwright }) => {
    const manager = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3000", storageState: "playwright/.auth/super_admin.json" });
    const user = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3000", storageState: "playwright/.auth/user.json" });
    try {
      const body = await (await manager.get(`/api/lanflow/dashboard/operator-history?actor=${actor}`)).json();
      expect(body.counts.all).toBe(14);
      expect(body.locations).toHaveLength(2);
      expect((await user.get("/api/lanflow/dashboard/operator-history")).status()).toBe(403);
    } finally { await manager.dispose(); await user.dispose(); }
  });

  test("dialog filters with full counts, resets pagination and restores keyboard focus", async ({ page }) => {
    await page.goto("/");
    const open = page.getByRole("button", { name: "ตรวจประวัติผู้ดำเนินการ", exact: true });
    await open.click();
    const dialog = page.getByRole("dialog", { name: "ตรวจประวัติผู้ดำเนินการ" });
    const actorSelect = dialog.getByLabel("บัญชีผู้ดำเนินการ");
    await expect(actorSelect).toBeEnabled();
    await actorSelect.selectOption(actor);
    await expect(dialog.getByRole("button", { name: /^แสดงทั้งหมด 12$/ })).toBeVisible();
    await page.screenshot({ path: "output/operator-history-desktop.png", fullPage: true });
    expect(await dialog.locator("tbody tr").count()).toBe(10);
    const activeBadge = dialog.getByRole("button", { name: /^แสดงทั้งหมด 12$/ }).locator("span");
    for (const token of ["min-w-6", "rounded-full", "px-1.5", "py-0.5", "text-center", "text-xs", "bg-white/20", "text-white"]) {
      await expect(activeBadge).toHaveClass(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    await dialog.getByRole("button", { name: "รายการย้อนหลัง", exact: true }).click();
    await expect(dialog.locator("tbody tr")).toHaveCount(2);
    await expect(dialog.getByText(/^หน้า 2/)).toBeVisible();
    await dialog.getByRole("button", { name: /^แก้ไข 1$/ }).click();
    await expect(dialog.locator("tbody tr")).toHaveCount(1);
    await expect(dialog.getByText(/^หน้า 1/)).toBeVisible();
    await expect(dialog.getByRole("button", { name: /^แสดงทั้งหมด 12$/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(open).toBeFocused();
    await open.click();
    await expect(page.getByLabel("บัญชีผู้ดำเนินการ")).toHaveValue("");
  });

  test("mobile layout stays within viewport and dialog traps focus", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/");
    await page.getByRole("button", { name: "ตรวจประวัติผู้ดำเนินการ", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "ตรวจประวัติผู้ดำเนินการ" });
    await expect(dialog.getByLabel("บัญชีผู้ดำเนินการ")).toBeEnabled();
    await dialog.getByLabel("บัญชีผู้ดำเนินการ").selectOption(actor);
    await expect(dialog.getByRole("button", { name: /^แสดงทั้งหมด 12$/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    }
    await page.screenshot({ path: "output/operator-history-mobile.png", fullPage: true });
  });

  test("late response from a closed dialog cannot replace a new actor selection", async ({ page }) => {
    let release = () => {};
    let started = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const pending = new Promise<void>((resolve) => { started = resolve; });
    let hold = true;
    await page.route("**/api/lanflow/dashboard/operator-history?*", async (route) => {
      if (hold && new URL(route.request().url()).searchParams.get("actor") === actor) {
        hold = false;
        const response = await route.fetch();
        started();
        await gate;
        // Closing the dialog cancels the original request; it may already be gone.
        await route.fulfill({ response }).catch(() => {});
      } else await route.continue();
    });
    try {
      await page.goto("/");
      const open = page.getByRole("button", { name: "ตรวจประวัติผู้ดำเนินการ", exact: true });
      await open.click();
      await expect(page.getByLabel("บัญชีผู้ดำเนินการ")).toBeEnabled();
      await page.getByLabel("บัญชีผู้ดำเนินการ").selectOption(actor);
      await pending;
      await page.keyboard.press("Escape");
      await open.click();
      await expect(page.getByLabel("บัญชีผู้ดำเนินการ")).toBeEnabled();
      await page.getByLabel("บัญชีผู้ดำเนินการ").selectOption(adminId);
      const dialog = page.getByRole("dialog", { name: "ตรวจประวัติผู้ดำเนินการ" });
      await expect(dialog.getByRole("cell", { name: "OTHER-OP19", exact: true })).toBeVisible();
      release();
      await expect(dialog.getByLabel("บัญชีผู้ดำเนินการ")).toHaveValue(adminId);
      await expect(dialog.locator("tbody tr")).toHaveCount(1);
      await expect(dialog.getByRole("button", { name: /^แสดงทั้งหมด 1$/ })).toBeVisible();
      await expect(dialog.getByRole("button", { name: /^เวลาและเงินเดือน 1$/ })).toBeVisible();
    } finally { release(); }
  });

  test("revoked branch access hides old rows and counts after real API denial", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "ตรวจประวัติผู้ดำเนินการ", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "ตรวจประวัติผู้ดำเนินการ" });
    await expect(dialog.getByLabel("บัญชีผู้ดำเนินการ")).toBeEnabled();
    await dialog.getByLabel("บัญชีผู้ดำเนินการ").selectOption(actor);
    await expect(dialog.getByRole("button", { name: /^Operator fixture A 12$/ })).toBeVisible();
    await dialog.getByRole("button", { name: /^Operator fixture A 12$/ }).click();
    await expect(dialog.locator("tbody tr")).toHaveCount(10);
    const client = fixtures();
    try {
      const removal = await client.from("user_locations").delete().eq("user_id", adminId).eq("location_id", locationA);
      if (removal.error) throw removal.error;
      await dialog.getByRole("button", { name: /^แก้ไข 1$/ }).click();
      await expect(dialog.getByRole("alert")).toContainText("ไม่มีสิทธิ์");
      await expect(dialog.locator("tbody tr")).toHaveCount(0);
      await expect(dialog.getByRole("group")).toHaveCount(0);
    } finally {
      await client.from("user_locations").upsert({ user_id: adminId, location_id: locationA, is_primary: false }, { onConflict: "user_id,location_id" });
    }
  });
});
