import { expect, request as playwrightRequest, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  || "";
const password = process.env.TEST_PASSWORD || "password123";
const superAdminId = "00000000-0000-4000-8000-000000000001";
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

async function signedInClient(phone: string) {
  expect(publishableKey).toBeTruthy();
  const client = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const normalizedPhone = phone.startsWith("+") ? phone : `+66${phone.slice(1)}`;
  const signIn = await client.auth.signInWithPassword({ phone: normalizedPhone, password });
  expect(signIn.error).toBeNull();
  expect(signIn.data.session?.access_token).toBeTruthy();
  return {
    client,
    accessToken: signIn.data.session!.access_token,
  };
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
  await service.from("time_tracking_resume_schedules").delete().eq("profile_id", id);
  await service.from("time_tracking_audit_logs").delete().eq("record_id", id);
  await service.from("time_tracking_audit_logs").delete().eq("admin_id", id);
  await service.from("admin_account_audit_logs").delete().eq("target_user_id", id);
  await service.from("admin_account_audit_logs").delete().eq("actor_user_id", id);
  await service.from("financial_transactions").delete().eq("profile_id", id);
  await service.from("payroll_slips").delete().eq("profile_id", id);
  await service.from("time_segments").delete().eq("profile_id", id);
  const profile = await service.from("profiles").delete().eq("id", id);
  expect(profile.error).toBeNull();
  const auth = await service.auth.admin.deleteUser(id);
  expect(auth.error).toBeNull();
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

  test("admin and employee routes reject malformed JSON without throwing", async () => {
    const contexts = await Promise.all([
      playwrightRequest.newContext({
        baseURL: "http://127.0.0.1:3000",
        storageState: "playwright/.auth/super_admin.json",
      }),
      playwrightRequest.newContext({
        baseURL: "http://127.0.0.1:3000",
        storageState: "playwright/.auth/user.json",
      }),
    ]);
    try {
      const [adminResponse, userResponse] = await Promise.all([
        contexts[0].post("/api/lanflow/time-tracking/admin", {
          data: "{",
          headers: { "Content-Type": "application/json" },
        }),
        contexts[1].post("/api/lanflow/time-tracking/user", {
          data: "{",
          headers: { "Content-Type": "application/json" },
        }),
      ]);

      for (const response of [adminResponse, userResponse]) {
        expect(response.status(), await response.text()).toBe(400);
      }
    } finally {
      await Promise.all(contexts.map((context) => context.dispose()));
    }
  });

  test("delegated manager without a branch keeps a self-service row", async ({ browser }) => {
    test.setTimeout(60_000);
    const service = serviceClient();
    const originalProfile = await service
      .from("profiles")
      .select("can_manage_time_payroll")
      .eq("id", userId)
      .single();
    const originalAssignments = await service
      .from("user_locations")
      .select("location_id, is_primary")
      .eq("user_id", userId);
    expect(originalProfile.error).toBeNull();
    expect(originalAssignments.error).toBeNull();

    const context = await browser.newContext({ storageState: "playwright/.auth/user.json" });
    try {
      expect((await service.from("profiles").update({ can_manage_time_payroll: true }).eq("id", userId)).error).toBeNull();
      expect((await service.from("user_locations").delete().eq("user_id", userId)).error).toBeNull();

      const response = await context.request.get("/api/lanflow/time-tracking/admin");
      expect(response.ok(), await response.text()).toBeTruthy();
      const users = (await response.json()).users as Array<{ id: string; primary_location_id: string | null }>;
      expect(users.find((profile) => profile.id === userId)?.primary_location_id).toBeNull();

      const bootstrapResponse = await context.request.get("/api/lanflow");
      expect(bootstrapResponse.ok(), await bootstrapResponse.text()).toBeTruthy();
      const bootstrap = await bootstrapResponse.json();
      expect(bootstrap.profile.canManageTimePayroll).toBe(true);
      expect(bootstrap.profile.locationIds).toEqual([]);

      const page = await context.newPage();
      await page.goto("/");
      await expect(page.getByText("ไม่มีสาขาหลัก · ใช้บริการตนเองเท่านั้น", { exact: true })).toBeVisible();

      const selfRow = page.locator('[data-time-payroll-self="true"]');
      await expect(selfRow).toBeVisible();
      await expect(selfRow.getByText("ของตนเอง", { exact: true })).toBeVisible();
      await expect(selfRow.getByRole("button", { name: /^แก้ไขค่าแรงรายวันของ / })).toHaveCount(0);
      await expect(selfRow.getByRole("button", { name: /^จัดการปฏิทินวันทำงานของ / })).toHaveCount(0);
      await expect(selfRow.getByRole("button", { name: /^จัดการสลิปเงินเดือนของ / })).toHaveCount(0);

      await selfRow.getByRole("button", { name: /^ดูข้อมูลเวลาและเงินเดือนของ / }).click();
      const dialog = page.getByRole("dialog", { name: "ข้อมูลของตนเอง" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: "ขอเบิกเงินตนเอง" })).toBeVisible();
      await expect(dialog.getByRole("button", { name: /เริ่มนับเวลา|หยุดงาน/ })).toHaveCount(0);
      await expect(dialog.getByRole("button", { name: "สร้างหนี้สินเพิ่ม" })).toHaveCount(0);
    } finally {
      await service.from("user_locations").delete().eq("user_id", userId);
      if ((originalAssignments.data?.length ?? 0) > 0) {
        await service.from("user_locations").insert(originalAssignments.data!.map((assignment) => ({
          user_id: userId,
          location_id: assignment.location_id,
          is_primary: assignment.is_primary,
        })));
      }
      await service.from("profiles").update({
        can_manage_time_payroll: originalProfile.data?.can_manage_time_payroll ?? false,
      }).eq("id", userId);
      await context.close().catch(() => undefined);
    }
  });

  test("manager has one highlighted self row and an immediate loading modal", async ({ browser }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
    const page = await context.newPage();
    let implicitSelfRequests = 0;
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/lanflow/time-tracking/user" && !url.searchParams.has("userId")) {
        implicitSelfRequests += 1;
      }
    });
    let releaseDashboard!: () => void;
    const dashboardGate = new Promise<void>((resolve) => {
      releaseDashboard = resolve;
    });

    await page.route(`**/api/lanflow/time-tracking/user?userId=${superAdminId}`, async (route) => {
      await dashboardGate;
      await route.continue();
    });

    try {
      await page.goto("/");
      await page.getByRole("button", { name: "เวลาและเงินเดือน" }).click();

      const firstRow = page.locator("tbody tr").first();
      await expect(firstRow).toBeVisible();
      expect(implicitSelfRequests).toBe(0);
      await expect(page.getByRole("heading", { name: "ระบบเวลาและเงินเดือน (ของตนเอง)" })).toHaveCount(0);
      await expect(firstRow).toHaveAttribute("data-time-payroll-self", "true");
      await expect(firstRow.getByText("ของตนเอง", { exact: true })).toBeVisible();
      await expect(firstRow.getByRole("button", { name: /^แก้ไขค่าแรงรายวันของ / })).toBeVisible();
      const attendanceButton = firstRow.getByRole("button", { name: /^จัดการปฏิทินวันทำงานของ / });
      await expect(attendanceButton).toBeVisible();
      await expect(firstRow.getByRole("button", { name: /^จัดการสลิปเงินเดือนของ / })).toBeVisible();

      await attendanceButton.click();
      const dialog = page.getByRole("dialog", { name: "ข้อมูลของตนเอง" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("status", { name: "กำลังโหลดข้อมูล..." })).toBeVisible();

      releaseDashboard();
      await expect(dialog.getByRole("button", { name: "ขอเบิกเงินตนเอง" })).toBeVisible();
      await expect(dialog.getByRole("button", { name: /เริ่มนับเวลา|หยุดงาน/ })).toHaveCount(0);
      await expect(dialog.getByRole("button", { name: "สร้างหนี้สินเพิ่ม" })).toBeVisible();
      await expect(dialog.getByText("ผู้จัดการหยุดงาน", { exact: true })).toHaveCount(0);
    } finally {
      releaseDashboard();
      await context.close();
    }
  });

  test("user and admin capability have equal primary-branch scope and revoke immediately", async () => {
    const service = serviceClient();
    const [insideLocationId, outsideLocationId] = await activeLocationIds(service);
    const activeLocations = await service.from("locations").select("id").eq("is_active", true);
    expect(activeLocations.error).toBeNull();
    const expectedPaymentLocationIds = (activeLocations.data || []).map((location) => location.id).sort();
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
          expect(
            (dashboardBody.paymentLocations as Array<{ id: string }>).map((location) => location.id).sort(),
          ).toEqual(expectedPaymentLocationIds);

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

  test("delegated manager cannot mutate approved sources but can withdraw an own pending payroll slip", async () => {
    test.setTimeout(60_000);
    const service = serviceClient();
    const [locationId] = await activeLocationIds(service);
    const delegatedId = await createTarget(service, "ผู้จัดการสาขาทดสอบสิทธิ์", "admin", locationId);
    const transactionTargetId = await createTarget(service, "พนักงานทดสอบรายการเงิน", "user", locationId);
    const slipTargetId = await createTarget(service, "พนักงานทดสอบสลิป", "user", locationId);
    const approvedSlipTargetId = await createTarget(service, "พนักงานทดสอบสลิปอนุมัติ", "user", locationId);
    let pendingTransactionId: string | null = null;
    let approvedTransactionId: string | null = null;
    let pendingSlipId: string | null = null;
    let approvedSlipId: string | null = null;
    let routePendingSlipId: string | null = null;

    const superProfile = await service.from("profiles").select("phone").eq("id", superAdminId).single();
    const delegatedProfile = await service.from("profiles").select("phone").eq("id", delegatedId).single();
    expect(superProfile.error).toBeNull();
    expect(delegatedProfile.error).toBeNull();
    const global = await signedInClient(superProfile.data!.phone);
    const delegated = await signedInClient(delegatedProfile.data!.phone);
    const delegatedRequest = await playwrightRequest.newContext({
      baseURL: "http://127.0.0.1:3000",
      extraHTTPHeaders: { Authorization: `Bearer ${delegated.accessToken}` },
    });

    try {
      expect((await service.from("profiles").update({
        can_manage_time_payroll: true,
      }).eq("id", delegatedId)).error).toBeNull();

      const pendingTransaction = await service.from("financial_transactions").insert({
        profile_id: transactionTargetId,
        type: "WITHDRAWAL",
        amount: 111,
        status: "PENDING",
        effective_date: "2026-08-01",
      }).select("id").single();
      expect(pendingTransaction.error).toBeNull();
      pendingTransactionId = pendingTransaction.data!.id;

      const approvedTransaction = await service.from("financial_transactions").insert({
        profile_id: transactionTargetId,
        type: "WITHDRAWAL",
        amount: 222,
        status: "APPROVED",
        effective_date: "2026-08-01",
        approved_by: superAdminId,
        approved_at: new Date().toISOString(),
      }).select("id").single();
      expect(approvedTransaction.error).toBeNull();
      approvedTransactionId = approvedTransaction.data!.id;

      const pendingSlip = await service.from("payroll_slips").insert({
        profile_id: slipTargetId,
        month: "2026-06",
        status: "PENDING",
        created_by: delegatedId,
      }).select("id").single();
      expect(pendingSlip.error).toBeNull();
      pendingSlipId = pendingSlip.data!.id;

      const routePendingSlip = await service.from("payroll_slips").insert({
        profile_id: slipTargetId,
        month: "2026-07",
        status: "PENDING",
        created_by: delegatedId,
      }).select("id").single();
      expect(routePendingSlip.error).toBeNull();
      routePendingSlipId = routePendingSlip.data!.id;

      const approvedSlip = await service.from("payroll_slips").insert({
        profile_id: approvedSlipTargetId,
        month: "2026-06",
        gross_pay: 500,
        net_pay: 500,
        total_days: 1,
        daily_wage: 500,
        status: "APPROVED",
        created_by: delegatedId,
        approved_by: superAdminId,
        approved_at: new Date().toISOString(),
      }).select("id").single();
      expect(approvedSlip.error).toBeNull();
      approvedSlipId = approvedSlip.data!.id;

      const delegatedPaymentChange = await delegated.client.rpc("change_time_tracking_expense_location", {
        p_source_type: "transaction",
        p_source_id: approvedTransactionId,
        p_expense_location_id: locationId,
        p_comment: null,
      });
      expect(delegatedPaymentChange.error?.message).toContain("Forbidden");

      for (const [sourceType, sourceId] of [
        ["transaction", pendingTransactionId],
        ["transaction", approvedTransactionId],
        ["payroll_slip", approvedSlipId],
      ] as const) {
        const deletion = await delegated.client.rpc("delete_time_tracking_source_permanently", {
          p_source_type: sourceType,
          p_source_id: sourceId,
        });
        expect(deletion.error?.message).toContain("Forbidden");
      }

      const routeCreatorDelete = await delegatedRequest.post("/api/lanflow/time-tracking/admin", { data: {
        action: "DELETE_PAYROLL_SLIP",
        payload: { slip_id: routePendingSlipId },
      } });
      expect(routeCreatorDelete.ok(), await routeCreatorDelete.text()).toBeTruthy();
      routePendingSlipId = null;

      const creatorPendingSlipDelete = await delegated.client.rpc("delete_time_tracking_source_permanently", {
        p_source_type: "payroll_slip",
        p_source_id: pendingSlipId,
      });
      expect(creatorPendingSlipDelete.error).toBeNull();
      pendingSlipId = null;

      for (const request of [
        {
          action: "CHANGE_EXPENSE_LOCATION",
          payload: {
            source_type: "transaction",
            source_id: approvedTransactionId,
            expense_location_id: locationId,
          },
        },
        { action: "DELETE_TRANSACTION", payload: { transaction_id: approvedTransactionId } },
        { action: "DELETE_PAYROLL_SLIP", payload: { slip_id: approvedSlipId } },
      ]) {
        const response = await delegatedRequest.post("/api/lanflow/time-tracking/admin", { data: request });
        expect(response.status(), await response.text()).toBe(403);
      }

      const globalPaymentChange = await global.client.rpc("change_time_tracking_expense_location", {
        p_source_type: "transaction",
        p_source_id: approvedTransactionId,
        p_expense_location_id: locationId,
        p_comment: null,
      });
      expect(globalPaymentChange.error).toBeNull();

      const globalApprovedTransactionDelete = await global.client.rpc("delete_time_tracking_source_permanently", {
        p_source_type: "transaction",
        p_source_id: approvedTransactionId,
      });
      expect(globalApprovedTransactionDelete.error).toBeNull();
      approvedTransactionId = null;

      const globalPendingTransactionDelete = await global.client.rpc("delete_time_tracking_source_permanently", {
        p_source_type: "transaction",
        p_source_id: pendingTransactionId,
      });
      expect(globalPendingTransactionDelete.error).toBeNull();
      pendingTransactionId = null;

      const globalApprovedSlipDelete = await global.client.rpc("delete_time_tracking_source_permanently", {
        p_source_type: "payroll_slip",
        p_source_id: approvedSlipId,
      });
      expect(globalApprovedSlipDelete.error).toBeNull();
      approvedSlipId = null;
    } finally {
      for (const [sourceType, sourceId] of [
        ["transaction", pendingTransactionId],
        ["transaction", approvedTransactionId],
        ["payroll_slip", pendingSlipId],
        ["payroll_slip", routePendingSlipId],
        ["payroll_slip", approvedSlipId],
      ] as const) {
        if (sourceId) {
          await global.client.rpc("delete_time_tracking_source_permanently", {
            p_source_type: sourceType,
            p_source_id: sourceId,
          });
        }
      }
      await delegatedRequest.dispose();
      await delegated.client.auth.signOut();
      await global.client.auth.signOut();
      await deleteTarget(service, delegatedId);
      await deleteTarget(service, transactionTargetId);
      await deleteTarget(service, slipTargetId);
      await deleteTarget(service, approvedSlipTargetId);
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
      await superPage.getByLabel("ค้นหาพนักงาน").fill("0810000001");
      const adminRow = superPage.getByRole("row", { name: /LanFlow admin.*0810000001/ });
      await expect(adminRow).toBeVisible();
      await adminRow.getByRole("button", { name: "จัดการ" }).click();
      const superAdminDialog = superPage.getByRole("dialog", { name: "จัดการพนักงาน" });
      await expect(superAdminDialog.getByRole("button", { name: "สิทธิ์เวลา/เงินเดือน" })).toBeVisible();

      const adminPage = await adminContext.newPage();
      await adminPage.goto("/");
      await adminPage.getByRole("button", { name: "Admin" }).click();
      await adminPage.getByLabel("ค้นหาพนักงาน").fill("0820000001");
      const userRow = adminPage.getByRole("row", { name: /LanFlow user.*0820000001/ });
      await expect(userRow).toBeVisible();
      await userRow.getByRole("button", { name: "จัดการ" }).click();
      const normalAdminDialog = adminPage.getByRole("dialog", { name: "จัดการพนักงาน" });
      await expect(normalAdminDialog.getByRole("button", { name: /ระงับบัญชี|กู้คืนบัญชี/ })).toHaveCount(0);
    } finally {
      await superContext.close();
      await adminContext.close();
    }
  });
});
