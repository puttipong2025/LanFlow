import { expect, request as playwrightRequest, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const password = process.env.TEST_PASSWORD || "password123";
const adminId = "00000000-0000-4000-8000-000000000002";
const userId = "00000000-0000-4000-8000-000000000003";
let temporaryLocationId: string | null = null;
let phoneSequence = 0;

function serviceClient() {
  expect(serviceRoleKey).toBeTruthy();
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function createTarget(service: SupabaseClient, label: string, role: "user" | "admin", locationId: string) {
  const id = crypto.randomUUID();
  phoneSequence += 1;
  const phone = `+669${String(Date.now() + phoneSequence).slice(-8)}`;
  const auth = await service.auth.admin.createUser({
    id,
    phone,
    password,
    phone_confirm: true,
    user_metadata: { name: label },
  });
  expect(auth.error).toBeNull();
  expect((await service.from("profiles").upsert({
    id,
    phone,
    name: label,
    role,
    is_active: true,
    daily_wage: 500,
    can_access_super_admin_features: false,
    can_manage_time_payroll: false,
  })).error).toBeNull();
  expect((await service.from("user_locations").insert({
    user_id: id,
    location_id: locationId,
    is_primary: true,
  })).error).toBeNull();
  return id;
}

async function deleteTarget(service: SupabaseClient, id: string) {
  await service.from("time_tracking_audit_logs").delete().eq("record_id", id);
  await service.from("financial_transactions").delete().eq("profile_id", id);
  await service.from("payroll_slips").delete().eq("profile_id", id);
  await service.from("time_segments").delete().eq("profile_id", id);
  await service.auth.admin.deleteUser(id);
}

async function activeLocationIds(service: SupabaseClient) {
  const result = await service.from("locations").select("id").eq("is_active", true).order("id");
  expect(result.error).toBeNull();
  expect(result.data?.length).toBeGreaterThanOrEqual(2);
  return result.data!.map((location) => location.id);
}

test.describe.serial("Time and Payroll delegated access @time-payroll-access", () => {
  test.beforeAll(async () => {
    const service = serviceClient();
    const existing = await service.from("locations").select("id").eq("is_active", true);
    expect(existing.error).toBeNull();
    if ((existing.data?.length ?? 0) < 2) {
      const id = crypto.randomUUID();
      const inserted = await service.from("locations").insert({
        id,
        name: `สาขาทดสอบเวลา ${id.slice(0, 6)}`,
        code: `TP${id.replaceAll("-", "").slice(0, 6).toUpperCase()}`,
        is_active: true,
      });
      expect(inserted.error).toBeNull();
      temporaryLocationId = id;
    }
  });

  test.afterAll(async () => {
    if (temporaryLocationId) {
      await serviceClient().from("locations").delete().eq("id", temporaryLocationId);
    }
  });

  test("user and admin capability have equal primary-branch scope and revoke immediately", async () => {
    const service = serviceClient();
    const [insideLocationId, outsideLocationId] = await activeLocationIds(service);
    const insideTarget = await createTarget(service, "เป้าหมายสาขาเดียวกัน", "user", insideLocationId);
    const outsideTarget = await createTarget(service, "เป้าหมายต่างสาขา", "admin", outsideLocationId);
    const originalAssignments = new Map<string, Array<{ location_id: string; is_primary: boolean }>>();

    try {
      for (const actor of [
        { id: adminId, role: "admin" },
        { id: userId, role: "user" },
      ] as const) {
        const existing = await service
          .from("user_locations")
          .select("location_id, is_primary")
          .eq("user_id", actor.id);
        expect(existing.error).toBeNull();
        originalAssignments.set(actor.id, existing.data || []);
        await service.from("user_locations").delete().eq("user_id", actor.id);
        expect((await service.from("user_locations").insert({
          user_id: actor.id,
          location_id: insideLocationId,
          is_primary: true,
        })).error).toBeNull();
        expect((await service.from("profiles").update({
          can_access_super_admin_features: false,
          can_manage_time_payroll: true,
        }).eq("id", actor.id)).error).toBeNull();

        const request = await playwrightRequest.newContext({
          baseURL: "http://127.0.0.1:3000",
          storageState: `playwright/.auth/${actor.role}.json`,
        });
        try {
          const dashboard = await request.get("/api/lanflow/time-tracking/admin");
          const dashboardText = await dashboard.text();
          expect(dashboard.ok(), dashboardText).toBeTruthy();
          const dashboardBody = JSON.parse(dashboardText);
          const users = dashboardBody.users as Array<{ id: string }>;
          expect(users.some((profile) => profile.id === insideTarget)).toBeTruthy();
          expect(users.some((profile) => profile.id === outsideTarget)).toBeFalsy();
          expect(dashboardBody.paymentLocations).toHaveLength(2);

          const allowed = await request.post("/api/lanflow/time-tracking/admin", { data: {
            action: "ADMIN_REQUEST_WITHDRAWAL",
            payload: { user_id: insideTarget, amount: 10, effective_date: "2026-08-01" },
          } });
          expect(allowed.ok(), await allowed.text()).toBeTruthy();

          const denied = await request.post("/api/lanflow/time-tracking/admin", { data: {
            action: "ADMIN_REQUEST_WITHDRAWAL",
            payload: { user_id: outsideTarget, amount: 10, effective_date: "2026-08-01" },
          } });
          expect(denied.status()).toBe(403);

          expect((await service.from("profiles")
            .update({ can_access_super_admin_features: true })
            .eq("id", insideTarget)).error).toBeNull();
          const globalTargetDashboard = await request.get("/api/lanflow/time-tracking/admin");
          const globalTargetUsers = ((await globalTargetDashboard.json()).users || []) as Array<{ id: string }>;
          expect(globalTargetUsers.some((profile) => profile.id === insideTarget)).toBeFalsy();
          expect((await request.post("/api/lanflow/time-tracking/admin", { data: {
            action: "ADMIN_REQUEST_WITHDRAWAL",
            payload: { user_id: insideTarget, amount: 10, effective_date: "2026-08-01" },
          } })).status()).toBe(403);
          expect((await service.from("profiles")
            .update({ can_access_super_admin_features: false })
            .eq("id", insideTarget)).error).toBeNull();

          expect((await service.from("user_locations").delete().eq("user_id", insideTarget)).error).toBeNull();
          const noBranchDashboard = await request.get("/api/lanflow/time-tracking/admin");
          const noBranchUsers = ((await noBranchDashboard.json()).users || []) as Array<{ id: string }>;
          expect(noBranchUsers.some((profile) => profile.id === insideTarget)).toBeFalsy();
          expect((await request.post("/api/lanflow/time-tracking/admin", { data: {
            action: "ADMIN_REQUEST_WITHDRAWAL",
            payload: { user_id: insideTarget, amount: 10, effective_date: "2026-08-01" },
          } })).status()).toBe(403);
          expect((await service.from("user_locations").insert({
            user_id: insideTarget,
            location_id: insideLocationId,
            is_primary: true,
          })).error).toBeNull();

          expect((await service.from("profiles")
            .update({ can_manage_time_payroll: false })
            .eq("id", actor.id)).error).toBeNull();
          expect((await request.get("/api/lanflow/time-tracking/admin")).status()).toBe(403);
        } finally {
          await request.dispose();
        }
      }
    } finally {
      for (const actorId of [adminId, userId]) {
        await service.from("profiles").update({
          can_access_super_admin_features: false,
          can_manage_time_payroll: false,
        }).eq("id", actorId);
        await service.from("user_locations").delete().eq("user_id", actorId);
        const assignments = originalAssignments.get(actorId) || [];
        if (assignments.length > 0) {
          await service.from("user_locations").insert(assignments.map((assignment) => ({
            user_id: actorId,
            location_id: assignment.location_id,
            is_primary: assignment.is_primary,
          })));
        }
      }
      await deleteTarget(service, insideTarget);
      await deleteTarget(service, outsideTarget);
    }
  });

  test("primary location changes and deletion replacement are explicit and atomic", async () => {
    const service = serviceClient();
    const [firstLocationId, secondLocationId] = await activeLocationIds(service);
    const targetId = await createTarget(service, "ทดสอบสาขาหลัก", "user", firstLocationId);
    const superRequest = await playwrightRequest.newContext({
      baseURL: "http://127.0.0.1:3000",
      storageState: "playwright/.auth/super_admin.json",
    });
    try {
      expect((await service.from("profiles").update({ can_manage_time_payroll: true }).eq("id", targetId)).error).toBeNull();
      expect((await superRequest.post("/api/lanflow/admin/user-locations", { data: {
        userId: targetId,
        locationId: secondLocationId,
      } })).ok()).toBeTruthy();

      const beforeChange = await service.from("user_locations").select("location_id, is_primary").eq("user_id", targetId);
      expect(beforeChange.data?.filter((item) => item.is_primary)).toHaveLength(1);
      expect(beforeChange.data?.find((item) => item.is_primary)?.location_id).toBe(firstLocationId);

      expect((await superRequest.patch("/api/lanflow/admin/user-locations", { data: {
        userId: targetId,
        locationId: secondLocationId,
      } })).ok()).toBeTruthy();

      const missingReplacement = await superRequest.delete(
        `/api/lanflow/admin/user-locations?userId=${targetId}&locationId=${secondLocationId}`,
      );
      expect(missingReplacement.status()).toBe(409);

      const removed = await superRequest.delete(
        `/api/lanflow/admin/user-locations?userId=${targetId}&locationId=${secondLocationId}&replacementLocationId=${firstLocationId}`,
      );
      expect(removed.ok(), await removed.text()).toBeTruthy();
      const afterReplacement = await service.from("user_locations").select("location_id, is_primary").eq("user_id", targetId);
      expect(afterReplacement.data).toEqual([{ location_id: firstLocationId, is_primary: true }]);

      expect((await superRequest.delete(
        `/api/lanflow/admin/user-locations?userId=${targetId}&locationId=${firstLocationId}`,
      )).ok()).toBeTruthy();
      expect((await service.from("user_locations").select("id").eq("user_id", targetId)).data).toEqual([]);
      expect((await service.from("profiles").select("can_manage_time_payroll").eq("id", targetId).single()).data)
        .toEqual({ can_manage_time_payroll: true });
    } finally {
      await superRequest.dispose();
      await deleteTarget(service, targetId);
    }
  });

  test("only superadmin or system manager can toggle access and suspend accounts", async () => {
    const service = serviceClient();
    const [locationId] = await activeLocationIds(service);
    const targetId = await createTarget(service, "ทดสอบผู้ควบคุมสิทธิ์", "user", locationId);
    const superRequest = await playwrightRequest.newContext({ baseURL: "http://127.0.0.1:3000", storageState: "playwright/.auth/super_admin.json" });
    const adminRequest = await playwrightRequest.newContext({ baseURL: "http://127.0.0.1:3000", storageState: "playwright/.auth/admin.json" });
    try {
      expect((await adminRequest.patch(`/api/lanflow/admin/users/${targetId}/time-payroll-access`, { data: { canManageTimePayroll: true } })).status()).toBe(403);
      expect((await adminRequest.patch(`/api/lanflow/admin/users/${targetId}/status`, { data: { isActive: false } })).status()).toBe(403);

      expect((await superRequest.patch(`/api/lanflow/admin/users/${targetId}/time-payroll-access`, { data: { canManageTimePayroll: true } })).ok()).toBeTruthy();
      expect((await service.from("profiles").update({ can_access_super_admin_features: true }).eq("id", adminId)).error).toBeNull();
      expect((await adminRequest.patch(`/api/lanflow/admin/users/${targetId}/time-payroll-access`, { data: { canManageTimePayroll: false } })).ok()).toBeTruthy();
      expect((await adminRequest.patch(`/api/lanflow/admin/users/${targetId}/status`, { data: { isActive: false } })).ok()).toBeTruthy();
    } finally {
      await service.from("profiles").update({ can_access_super_admin_features: false }).eq("id", adminId);
      await superRequest.dispose();
      await adminRequest.dispose();
      await deleteTarget(service, targetId);
    }
  });

  test("Admin UI shows the Time and Payroll toggle and hides suspension from a normal admin", async ({ browser }) => {
    const service = serviceClient();
    await service.from("profiles").update({
      can_access_super_admin_features: false,
      can_manage_time_payroll: false,
    }).eq("id", adminId);

    const superContext = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
    const adminContext = await browser.newContext({ storageState: "playwright/.auth/admin.json" });
    try {
      const superPage = await superContext.newPage();
      await superPage.goto("/");
      await superPage.getByRole("button", { name: "Admin" }).click();
      const adminRow = superPage.locator(`[data-user-id="${adminId}"]`);
      await expect(adminRow.getByRole("button", { name: "เปิดสิทธิ์เวลาและเงินเดือน" })).toBeVisible();

      const adminPage = await adminContext.newPage();
      await adminPage.goto("/");
      await adminPage.getByRole("button", { name: "Admin" }).click();
      const userRow = adminPage.locator(`[data-user-id="${userId}"]`);
      await expect(userRow).toBeVisible();
      await expect(userRow.getByRole("button", { name: /ระงับการใช้งาน|กู้คืนการใช้งาน/ })).toHaveCount(0);
    } finally {
      await superContext.close();
      await adminContext.close();
    }
  });
});
