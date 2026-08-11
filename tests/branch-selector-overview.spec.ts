import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const publishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "";

function normalizePhone(raw: string) {
  if (raw.startsWith("+")) return raw;
  if (raw.startsWith("0")) return `+66${raw.slice(1)}`;
  return `+${raw}`;
}

test.describe("branch selector overview", () => {
  test.use({ storageState: "playwright/.auth/super_admin.json" });

  test("shows the saved dashboard summary without enlarging the closed selector", async ({
    page,
  }) => {
    const bootstrapResponse = await page.request.get("/api/lanflow");
    expect(bootstrapResponse.ok(), await bootstrapResponse.text()).toBeTruthy();
    const bootstrap = await bootstrapResponse.json() as {
      locations: Array<{ id: string; active: boolean }>;
      profile: { locationIds: string[] };
    };
    const accessibleLocations = bootstrap.locations.filter(
      (location) =>
        location.active && bootstrap.profile.locationIds.includes(location.id),
    );
    expect(accessibleLocations.length).toBeGreaterThan(0);

    let summaryRequests = 0;
    await page.route("**/api/lanflow/dashboard/branch-summaries", async (route) => {
      summaryRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(accessibleLocations.map((location, index) => ({
          locationId: location.id,
          snapshotStatus: "ready",
          calculatedAt: "2026-08-01T00:00:00.000Z",
          cashStatus: index === 0 ? "low" : "normal",
          summary: {
            netCashFlow: 42_000,
            rubberInventoryWeight: 18_420,
            purchaseToday: {
              paidTotal: 289_239,
              billCount: 30,
              netWeight: 7_959,
              averagePrice: 36.34,
            },
          },
        }))),
      });
    });

    await page.goto("/");
    const selector = page.getByRole("button", { name: /^เลือกสาขา/ });
    await expect(selector).toBeVisible({ timeout: 15_000 });
    await expect(selector).toHaveCSS("height", "40px");
    await expect.poll(() => summaryRequests, { timeout: 3_000 }).toBeGreaterThan(0);

    await selector.click();
    await expect.poll(() => summaryRequests, { timeout: 3_000 }).toBeGreaterThan(1);
    const option = page.locator(
      `[role="option"][data-location-id="${accessibleLocations[0].id}"]`,
    );
    await expect(option).toContainText("รับ–จ่ายสุทธิ");
    await expect(option).toContainText("฿42,000");
    await expect(option).toContainText("ต่ำกว่าเกณฑ์");
    await expect(option).toHaveAttribute("data-cash-status", "low");
    await expect(option.locator(".text-danger").filter({ hasText: "รับ–จ่ายสุทธิ" }))
      .toBeVisible();
    await expect(option).toContainText("นน.ยางคงเหลือ 18,420 กก.");
    await expect(option).not.toContainText("ซื้อยางวันนี้");
    await expect(option).toContainText("วันนี้ 30 บิล · 7,959 กก. · เฉลี่ย ฿36.34/กก.");
  });

  test("returns only assigned branch summaries and derives cash status without exposing thresholds", async () => {
    test.skip(!serviceRoleKey || !publishableKey, "Supabase test keys are required");
    const service = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const user = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const anonymous = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const manager = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signIn = await user.auth.signInWithPassword({
      phone: "+66820000001",
      password: process.env.TEST_PASSWORD ?? "password123",
    });
    expect(signIn.error).toBeNull();
    const managerSignIn = await manager.auth.signInWithPassword({
      phone: normalizePhone(process.env.TEST_PHONE ?? "0800000000"),
      password: process.env.TEST_PASSWORD ?? "password123",
    });
    expect(managerSignIn.error).toBeNull();

    const assignedLocationId = crypto.randomUUID();
    const inaccessibleLocationId = crypto.randomUUID();
    const marker = assignedLocationId.replaceAll("-", "").slice(0, 5).toUpperCase();
    const calculatedAt = "2026-08-01T03:00:00.000Z";
    const summary = (netCashFlow: number) => ({
      purchaseToday: {
        billCount: 30,
        netWeight: 7_959,
        paidTotal: 289_239,
        averagePrice: 36.34,
      },
      purchase7Days: {
        paidTotal: 0,
        dailyAverage: 0,
        netWeight: 0,
        averageCostPerKg: null,
      },
      netCashFlow,
      operatingExpenseAccumulated: 0,
      payablePurchaseAccumulated: 0,
      operatingBurdenPercent: null,
      rubberInventoryWeight: 18_420,
      waterLoss7Days: { exportCount: 0, weight: 0, percent: null },
      stock: { inStockCount: 0, outOfStockCount: 0, items: [] },
    });

    try {
      expect((await service.from("locations").insert([
        {
          id: assignedLocationId,
          name: `Branch summary ${marker}`,
          code: `BS${marker}`,
          is_active: true,
        },
        {
          id: inaccessibleLocationId,
          name: `Hidden branch summary ${marker}`,
          code: `BH${marker}`,
          is_active: true,
        },
      ])).error).toBeNull();
      expect((await service.from("user_locations").insert({
        user_id: signIn.data.user!.id,
        location_id: assignedLocationId,
        is_primary: false,
      })).error).toBeNull();

      const managerRead = await manager.rpc("get_dashboard_branch_summaries");
      expect(managerRead.error).toBeNull();
      expect(managerRead.data.some(
        (item: { locationId: string }) => item.locationId === inaccessibleLocationId,
      )).toBeTruthy();
      expect((await service.from("dashboard_branch_snapshots").update({
        status: "ready",
        source_version: 7,
        snapshot_version: 7,
        summary: summary(99),
        calculated_at: calculatedAt,
      }).eq("location_id", assignedLocationId)).error).toBeNull();

      const readAssigned = async () => {
        const { data, error } = await user.rpc("get_dashboard_branch_summaries");
        expect(error).toBeNull();
        expect(JSON.stringify(data)).not.toContain("netCashMin");
        expect(data.some(
          (item: { locationId: string }) => item.locationId === inaccessibleLocationId,
        )).toBeFalsy();
        return data.find(
          (item: { locationId: string }) => item.locationId === assignedLocationId,
        );
      };

      const unconfigured = await readAssigned();
      expect(Date.parse(unconfigured.calculatedAt)).toBe(Date.parse(calculatedAt));
      expect(unconfigured).toMatchObject({
        locationId: assignedLocationId,
        snapshotStatus: "ready",
        cashStatus: "unconfigured",
        summary: {
          netCashFlow: 99,
          rubberInventoryWeight: 18_420,
          purchaseToday: {
            billCount: 30,
            netWeight: 7_959,
            paidTotal: 289_239,
            averagePrice: 36.34,
          },
        },
      });

      expect((await service.from("dashboard_alert_thresholds").update({
        is_configured: true,
        net_cash_min: 100,
      }).eq("location_id", assignedLocationId)).error).toBeNull();
      expect((await readAssigned()).cashStatus).toBe("low");

      expect((await service.from("dashboard_branch_snapshots").update({
        status: "failed",
        summary: summary(100),
      }).eq("location_id", assignedLocationId)).error).toBeNull();
      const beforeRead = await service
        .from("dashboard_branch_snapshots")
        .select("status, source_version, snapshot_version, calculated_at, manual_requested_at, updated_at")
        .eq("location_id", assignedLocationId)
        .single();
      expect(beforeRead.error).toBeNull();
      expect(await readAssigned()).toMatchObject({
        snapshotStatus: "failed",
        cashStatus: "normal",
        summary: { netCashFlow: 100 },
      });
      const afterRead = await service
        .from("dashboard_branch_snapshots")
        .select("status, source_version, snapshot_version, calculated_at, manual_requested_at, updated_at")
        .eq("location_id", assignedLocationId)
        .single();
      expect(afterRead.error).toBeNull();
      expect(afterRead.data).toEqual(beforeRead.data);

      expect((await service.from("dashboard_branch_snapshots").update({
        summary: summary(101),
      }).eq("location_id", assignedLocationId)).error).toBeNull();
      expect((await readAssigned()).cashStatus).toBe("normal");

      expect((await service.from("dashboard_branch_snapshots").update({
        status: "dirty",
        summary: null,
        calculated_at: null,
      }).eq("location_id", assignedLocationId)).error).toBeNull();
      expect(await readAssigned()).toMatchObject({
        cashStatus: "no_data",
        summary: null,
      });

      expect((await anonymous.rpc("get_dashboard_branch_summaries")).error)
        .not.toBeNull();

      expect((await service.from("profiles").update({
        is_active: false,
      }).eq("id", signIn.data.user!.id)).error).toBeNull();
      expect((await user.rpc("get_dashboard_branch_summaries")).error).not.toBeNull();
    } finally {
      await service.from("profiles").update({ is_active: true })
        .eq("id", signIn.data.user!.id);
      await service.from("user_locations").delete().eq("location_id", assignedLocationId);
      await service.from("locations").delete().in(
        "id",
        [assignedLocationId, inaccessibleLocationId],
      );
      await user.auth.signOut();
      await manager.auth.signOut();
    }
  });

  test("keeps the last saved summary visible when a refresh fails on a narrow viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const bootstrapResponse = await page.request.get("/api/lanflow");
    expect(bootstrapResponse.ok(), await bootstrapResponse.text()).toBeTruthy();
    const bootstrap = await bootstrapResponse.json() as {
      locations: Array<{ id: string; active: boolean }>;
      profile: { locationIds: string[] };
    };
    const location = bootstrap.locations.find(
      (item) => item.active && bootstrap.profile.locationIds.includes(item.id),
    );
    expect(location).toBeTruthy();

    let summaryRequests = 0;
    let failRefresh = false;
    await page.route("**/api/lanflow/dashboard/branch-summaries", async (route) => {
      summaryRequests += 1;
      if (failRefresh) {
        await route.fulfill({ status: 503, body: "unavailable" });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{
          locationId: location!.id,
          snapshotStatus: "ready",
          calculatedAt: "2026-08-01T00:00:00.000Z",
          cashStatus: "normal",
          summary: {
            netCashFlow: 42_000,
            rubberInventoryWeight: 18_420,
            purchaseToday: {
              paidTotal: 289_239,
              billCount: 30,
              netWeight: 7_959,
              averagePrice: 36.34,
            },
          },
        }]),
      });
    });

    await page.goto("/");
    const selector = page.getByRole("button", { name: /^เลือกสาขา/ });
    await expect(selector).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => summaryRequests).toBeGreaterThan(0);
    const requestsBeforeOpen = summaryRequests;
    failRefresh = true;
    await selector.click();
    await expect.poll(() => summaryRequests).toBeGreaterThan(requestsBeforeOpen);

    const option = page.locator(`[role="option"][data-location-id="${location!.id}"]`);
    await expect(option).toContainText("฿42,000");
    await expect(option.getByRole("img", { name: /^ข้อมูลไม่สด/ })).toBeVisible({
      timeout: 5_000,
    });
    const listbox = page.getByRole("listbox", { name: "สาขาที่เข้าถึงได้" });
    const box = await listbox.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  });

  test("keeps branch selection usable when the first summary request fails", async ({
    page,
  }) => {
    await page.route("**/api/lanflow/dashboard/branch-summaries", async (route) => {
      await route.fulfill({ status: 503, body: "unavailable" });
    });
    await page.goto("/");

    const selector = page.getByRole("button", { name: /^เลือกสาขา/ });
    await expect(selector).toBeVisible({ timeout: 15_000 });
    await selector.click();
    const option = page.getByRole("option").first();
    await expect(option).toContainText("โหลดข้อมูลไม่ได้", { timeout: 5_000 });
    await option.click();
    await expect(page.getByRole("listbox", { name: "สาขาที่เข้าถึงได้" }))
      .toHaveCount(0);
  });
});
