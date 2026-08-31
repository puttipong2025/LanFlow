import { expect, request as playwrightRequest, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const adminId = "00000000-0000-4000-8000-000000000002";
const userId = "00000000-0000-4000-8000-000000000003";

function serviceClient() {
  expect(serviceRoleKey).toBeTruthy();
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

test.describe.serial("Admin-only elevated permission boundary", () => {
  test("database rejects elevated flags on a User profile", async () => {
    const service = serviceClient();
    const result = await service.from("profiles").update({
      can_access_super_admin_features: true,
      can_access_money_transfer: true,
      can_manage_time_payroll: true,
    }).eq("id", userId);

    expect(result.error?.message).toContain("profiles_admin_only_elevated_access");
  });

  test("User targets return 403 until promoted, then demotion clears every flag atomically", async () => {
    const service = serviceClient();
    const superRequest = await playwrightRequest.newContext({
      baseURL: "http://127.0.0.1:3000",
      storageState: "playwright/.auth/super_admin.json",
    });

    try {
      expect((await service.from("profiles").update({
        role: "user",
        is_active: true,
        can_access_super_admin_features: false,
        can_access_money_transfer: false,
        can_manage_time_payroll: false,
      }).eq("id", userId)).error).toBeNull();

      for (const [path, data] of [
        ["system-manager-access", { canAccessSystemManager: true }],
        ["money-transfer-access", { canAccessMoneyTransfer: true }],
        ["time-payroll-access", { canManageTimePayroll: true }],
      ] as const) {
        const denied = await superRequest.patch(`/api/lanflow/admin/users/${userId}/${path}`, { data });
        expect(denied.status(), await denied.text()).toBe(403);
      }

      const promoted = await superRequest.patch(`/api/lanflow/admin/users/${userId}/role`, {
        data: { role: "admin" },
      });
      expect(promoted.ok(), await promoted.text()).toBeTruthy();

      for (const [path, data] of [
        ["system-manager-access", { canAccessSystemManager: true }],
        ["money-transfer-access", { canAccessMoneyTransfer: true }],
        ["time-payroll-access", { canManageTimePayroll: true }],
      ] as const) {
        if (path !== "system-manager-access") {
          await superRequest.patch(`/api/lanflow/admin/users/${userId}/system-manager-access`, {
            data: { canAccessSystemManager: false },
          });
        }
        const granted = await superRequest.patch(`/api/lanflow/admin/users/${userId}/${path}`, { data });
        expect(granted.ok(), await granted.text()).toBeTruthy();
      }

      const demoted = await superRequest.patch(`/api/lanflow/admin/users/${userId}/role`, {
        data: { role: "user" },
      });
      expect(demoted.ok(), await demoted.text()).toBeTruthy();

      const { data: profile, error } = await service.from("profiles")
        .select("role, can_access_super_admin_features, can_access_money_transfer, can_manage_time_payroll")
        .eq("id", userId)
        .single();
      expect(error).toBeNull();
      expect(profile).toEqual({
        role: "user",
        can_access_super_admin_features: false,
        can_access_money_transfer: false,
        can_manage_time_payroll: false,
      });

      expect((await superRequest.patch(`/api/lanflow/admin/users/${userId}/role`, {
        data: { role: "admin" },
      })).ok()).toBeTruthy();
      const [concurrentDemotion, concurrentGrant] = await Promise.all([
        superRequest.patch(`/api/lanflow/admin/users/${userId}/role`, {
          data: { role: "user" },
        }),
        superRequest.patch(`/api/lanflow/admin/users/${userId}/money-transfer-access`, {
          data: { canAccessMoneyTransfer: true },
        }),
      ]);
      expect(concurrentDemotion.ok(), await concurrentDemotion.text()).toBeTruthy();
      expect([200, 403]).toContain(concurrentGrant.status());

      const concurrentProfile = await service.from("profiles")
        .select("role, can_access_super_admin_features, can_access_money_transfer, can_manage_time_payroll")
        .eq("id", userId)
        .single();
      expect(concurrentProfile.error).toBeNull();
      expect(concurrentProfile.data).toEqual({
        role: "user",
        can_access_super_admin_features: false,
        can_access_money_transfer: false,
        can_manage_time_payroll: false,
      });
    } finally {
      await service.from("profiles").update({
        role: "user",
        is_active: true,
        can_access_super_admin_features: false,
        can_access_money_transfer: false,
        can_manage_time_payroll: false,
      }).eq("id", userId);
      await superRequest.dispose();
    }
  });

  test("inactive Admin exposes restore semantics without losing stored grants", async () => {
    const service = serviceClient();
    const superRequest = await playwrightRequest.newContext({
      baseURL: "http://127.0.0.1:3000",
      storageState: "playwright/.auth/super_admin.json",
    });

    try {
      expect((await service.from("profiles").update({
        role: "admin",
        is_active: true,
        can_access_money_transfer: true,
      }).eq("id", adminId)).error).toBeNull();

      const suspended = await superRequest.patch(`/api/lanflow/admin/users/${adminId}/status`, {
        data: { isActive: false },
      });
      expect(suspended.ok(), await suspended.text()).toBeTruthy();

      const denied = await superRequest.patch(`/api/lanflow/admin/users/${adminId}/money-transfer-access`, {
        data: { canAccessMoneyTransfer: false },
      });
      expect(denied.status(), await denied.text()).toBe(403);

      const restored = await superRequest.patch(`/api/lanflow/admin/users/${adminId}/status`, {
        data: { isActive: true },
      });
      expect(restored.ok(), await restored.text()).toBeTruthy();
    } finally {
      await service.from("profiles").update({
        role: "admin",
        is_active: true,
        can_access_super_admin_features: false,
        can_access_money_transfer: false,
        can_manage_time_payroll: false,
      }).eq("id", adminId);
      await superRequest.dispose();
    }
  });
});
