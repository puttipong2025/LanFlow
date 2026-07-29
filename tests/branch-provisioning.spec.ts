import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { selectedAppLocationId } from "./helpers/select-app-location";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const adminId = "00000000-0000-4000-8000-000000000002";

function service() {
  expect(serviceRoleKey).toBeTruthy();
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function removeLocation(locationId: string) {
  const db = service();
  expect(
    (await db.from("user_locations").delete().eq("location_id", locationId))
      .error,
  ).toBeNull();
  expect(
    (await db.from("locations").delete().eq("id", locationId)).error,
  ).toBeNull();
}

test.describe.serial("safe branch provisioning", () => {
  test.use({ storageState: "playwright/.auth/super_admin.json" });

  test("enforces manager access, atomic replay, immutable code, and alert readiness", async ({
    browser,
  }) => {
    const db = service();
    const marker = crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
    const name = `สาขาทดสอบ ${marker}`;
    const code = marker.slice(0, 8);
    const requestId = crypto.randomUUID();
    const duplicateRequestId = crypto.randomUUID();
    let locationId = "";

    const previousAccess = await db
      .from("profiles")
      .select("can_access_super_admin_features")
      .eq("id", adminId)
      .single();
    expect(previousAccess.error).toBeNull();
    expect(
      (
        await db
          .from("profiles")
          .update({ can_access_super_admin_features: true })
          .eq("id", adminId)
      ).error,
    ).toBeNull();

    const user = await browser.newContext({
      storageState: "playwright/.auth/user.json",
    });
    const manager = await browser.newContext({
      storageState: "playwright/.auth/admin.json",
    });

    try {
      const forbidden = await user.request.post(
        "/api/lanflow/admin/locations",
        { data: { name, code, requestId } },
      );
      expect(forbidden.status()).toBe(403);

      const created = await manager.request.post(
        "/api/lanflow/admin/locations",
        { data: { name, code, requestId } },
      );
      expect(created.ok(), await created.text()).toBeTruthy();
      const createdBody = await created.json() as {
        location: { id: string; name: string; code: string; active: boolean };
        replayed: boolean;
      };
      locationId = createdBody.location.id;
      expect(createdBody).toMatchObject({
        location: { name, code, active: true },
        replayed: false,
      });

      const location = await db
        .from("locations")
        .select("created_by, provision_request_id")
        .eq("id", locationId)
        .single();
      expect(location.error).toBeNull();
      expect(location.data).toEqual({
        created_by: adminId,
        provision_request_id: requestId,
      });

      const assignments = await db
        .from("user_locations")
        .select("user_id")
        .eq("location_id", locationId);
      expect(assignments.error).toBeNull();
      expect(assignments.data).toEqual([{ user_id: adminId }]);

      const thresholdBefore = await db
        .from("dashboard_alert_thresholds")
        .select("is_configured")
        .eq("location_id", locationId)
        .single();
      expect(thresholdBefore.error).toBeNull();
      expect(thresholdBefore.data?.is_configured).toBe(false);
      expect(
        (
          await db
            .from("dashboard_branch_snapshots")
            .select("location_id")
            .eq("location_id", locationId)
            .single()
        ).error,
      ).toBeNull();

      const replay = await manager.request.post(
        "/api/lanflow/admin/locations",
        { data: { name, code, requestId } },
      );
      expect(replay.ok(), await replay.text()).toBeTruthy();
      expect(await replay.json()).toMatchObject({
        location: { id: locationId },
        replayed: true,
      });
      expect(
        (
          await db
            .from("user_locations")
            .select("*", { count: "exact", head: true })
            .eq("location_id", locationId)
        ).count,
      ).toBe(1);

      const mismatch = await manager.request.post(
        "/api/lanflow/admin/locations",
        { data: { name: `${name} แก้ไข`, code, requestId } },
      );
      expect(mismatch.status()).toBe(409);

      const duplicate = await manager.request.post(
        "/api/lanflow/admin/locations",
        { data: { name: `${name} ซ้ำ`, code, requestId: duplicateRequestId } },
      );
      expect(duplicate.status()).toBe(409);
      const partial = await db
        .from("locations")
        .select("id")
        .eq("provision_request_id", duplicateRequestId);
      expect(partial.error).toBeNull();
      expect(partial.data).toEqual([]);

      const immutable = await db
        .from("locations")
        .update({ code: `${code.slice(0, 7)}Z` })
        .eq("id", locationId);
      expect(immutable.error?.message).toContain("BRANCH_CODE_IMMUTABLE");

      expect(
        (
          await db
            .from("dashboard_branch_snapshots")
            .update({
              status: "ready",
              summary: {
                purchase7Days: { dailyAverage: 0 },
                netCashFlow: 0,
                stock: { items: [] },
              },
              calculated_at: new Date().toISOString(),
            })
            .eq("location_id", locationId)
        ).error,
      ).toBeNull();
      const alertsBefore = await db.rpc("get_dashboard_alerts_for_telegram");
      expect(alertsBefore.error).toBeNull();
      expect(
        (alertsBefore.data ?? []).filter(
          (alert: { location_id: string }) => alert.location_id === locationId,
        ),
      ).toEqual([]);

      const config = await manager.request.get(
        `/api/lanflow/dashboard/config?locationId=${locationId}`,
      );
      expect(config.ok(), await config.text()).toBeTruthy();
      const configBody = await config.json() as {
        intervalMinutes: number;
        thresholds: {
          stockItems: Array<{
            productId: string;
            minimumBalance: number | null;
          }>;
        };
      };
      const saved = await manager.request.put(
        `/api/lanflow/dashboard/config?locationId=${locationId}`,
        {
          data: {
            locationId,
            intervalMinutes: configBody.intervalMinutes,
            purchaseAverageMin: 30_000,
            netCashMin: 30_000,
            stockItems: configBody.thresholds.stockItems,
          },
        },
      );
      expect(saved.ok(), await saved.text()).toBeTruthy();

      const thresholdAfter = await db
        .from("dashboard_alert_thresholds")
        .select("is_configured")
        .eq("location_id", locationId)
        .single();
      expect(thresholdAfter.error).toBeNull();
      expect(thresholdAfter.data?.is_configured).toBe(true);
      const alertsAfter = await db.rpc("get_dashboard_alerts_for_telegram");
      expect(alertsAfter.error).toBeNull();
      expect(
        (alertsAfter.data ?? []).some(
          (alert: { location_id: string }) => alert.location_id === locationId,
        ),
      ).toBe(true);
    } finally {
      await user.close();
      await manager.close();
      if (locationId) await removeLocation(locationId);
      expect(
        (
          await db
            .from("profiles")
            .update({
              can_access_super_admin_features:
                previousAccess.data?.can_access_super_admin_features ?? false,
            })
            .eq("id", adminId)
        ).error,
      ).toBeNull();
    }
  });

  test("uses the existing form and selects the new branch without opening Telegram", async ({
    page,
  }) => {
    const marker = crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
    const name = `สาขาหน้าจอ ${marker}`;
    const code = marker.slice(0, 8);
    let locationId = "";

    try {
      await page.goto("/");
      await page.getByRole("button", { name: "Admin", exact: true }).click();
      await page.getByPlaceholder("ชื่อสาขาใหม่").fill(name);
      await page.getByLabel("รหัสสาขาใหม่").fill(code.toLowerCase());
      await page.getByRole("button", { name: "เพิ่มสาขา", exact: true }).click();

      await expect(
        page.getByRole("heading", { name: "ยืนยันเพิ่มสาขา?" }),
      ).toBeVisible();
      const responsePromise = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/lanflow/admin/locations") &&
          response.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "ยืนยันเพิ่มสาขา", exact: true })
        .click();
      const response = await responsePromise;
      expect(response.ok(), await response.text()).toBeTruthy();
      const body = await response.json() as {
        location: { id: string };
      };
      locationId = body.location.id;

      await expect.poll(() => selectedAppLocationId(page)).toBe(locationId);
      await expect(
        page.getByText(
          "เพิ่มสาขาแล้ว · ตั้งค่าเกณฑ์ผ่านปุ่ม Telegram เพื่อเริ่ม Dashboard alert",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "ตั้งค่าการแจ้งเตือน Telegram" }),
      ).toHaveCount(0);
      await expect(page.getByPlaceholder("ชื่อสาขาใหม่")).toHaveValue("");
      await expect(page.getByLabel("รหัสสาขาใหม่")).toHaveValue("");
    } finally {
      if (locationId) await removeLocation(locationId);
    }
  });
});
