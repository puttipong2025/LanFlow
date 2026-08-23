import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

async function authContext(browser: Browser, role: "admin" | "super_admin") {
  return browser.newContext({ storageState: `playwright/.auth/${role}.json` });
}

async function ownProfile(context: BrowserContext) {
  const response = await context.request.get("/api/auth/me");
  expect(response.ok()).toBeTruthy();
  return (await response.json() as {
    profile: { id: string; locationIds: string[]; primaryLocationId: string | null };
  }).profile;
}

function service() {
  expect(serviceRoleKey).toBeTruthy();
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

test.describe.serial("Admin profile management API", () => {
  test("profile save is atomic, audited, and enforces field-level authorization", async ({ browser }) => {
    const manager = await authContext(browser, "super_admin");
    const admin = await authContext(browser, "admin");
    const db = service();
    const adminProfile = await ownProfile(admin);
    const locationId = adminProfile.locationIds[0];
    const phone = `09${Date.now().toString().slice(-8)}`;
    const password = `Start-${crypto.randomUUID()}`;
    const secondLocationId = crypto.randomUUID();
    let targetId: string | null = null;

    try {
      expect((await db.from("locations").insert({
        id: secondLocationId,
        name: `สาขาทดสอบสิทธิ์ Admin ${secondLocationId.slice(0, 6)}`,
        code: `AP${secondLocationId.replaceAll("-", "").slice(0, 6).toUpperCase()}`,
        is_active: true,
      })).error).toBeNull();
      expect((await db.from("user_locations").insert({
        user_id: adminProfile.id,
        location_id: secondLocationId,
        is_primary: false,
      })).error).toBeNull();

      const created = await manager.request.post("/api/lanflow/admin/users", {
        data: {
          phone,
          name: "พนักงานทดสอบข้อมูลทั่วไป",
          password,
          role: "user",
          locationIds: [locationId],
        },
      });
      expect(created.status(), await created.text()).toBe(201);
      targetId = (await created.json() as { user: { id: string } }).user.id;

      const saved = await manager.request.put(`/api/lanflow/admin/users/${targetId}/profile`, {
        data: {
          name: "  พนักงาน   ทดสอบใหม่  ",
          locationIds: [locationId],
          primaryLocationId: locationId,
        },
      });
      expect(saved.ok(), await saved.text()).toBeTruthy();
      const savedBody = await saved.json() as { auditId: string; user: { name: string } };
      expect(savedBody.user.name).toBe("พนักงาน ทดสอบใหม่");
      expect(savedBody.auditId).toBeTruthy();

      const audit = await db.from("admin_account_audit_logs")
        .select("action,status,old_data,new_data")
        .eq("id", savedBody.auditId)
        .single();
      expect(audit.error).toBeNull();
      expect(audit.data).toMatchObject({ action: "profile_update", status: "succeeded" });

      const branchOnly = await admin.request.put(`/api/lanflow/admin/users/${targetId}/profile`, {
        data: {
          name: "พนักงาน ทดสอบใหม่",
          locationIds: [locationId],
          primaryLocationId: locationId,
        },
      });
      expect(branchOnly.ok(), await branchOnly.text()).toBeTruthy();

      const expanded = await manager.request.put(`/api/lanflow/admin/users/${targetId}/profile`, {
        data: {
          name: "พนักงาน ทดสอบใหม่",
          locationIds: [locationId, secondLocationId],
          primaryLocationId: locationId,
        },
      });
      expect(expanded.ok(), await expanded.text()).toBeTruthy();

      const movedPrimary = await admin.request.put(`/api/lanflow/admin/users/${targetId}/profile`, {
        data: {
          name: "พนักงาน ทดสอบใหม่",
          locationIds: [locationId, secondLocationId],
          primaryLocationId: secondLocationId,
        },
      });
      expect(movedPrimary.status()).toBe(403);

      const tampered = await admin.request.put(`/api/lanflow/admin/users/${targetId}/profile`, {
        data: {
          name: "ชื่อที่ Admin ทั่วไปไม่มีสิทธิ์เปลี่ยน",
          locationIds: [locationId],
          primaryLocationId: locationId,
        },
      });
      expect(tampered.status()).toBe(403);

      const invalidPrimary = await manager.request.put(`/api/lanflow/admin/users/${targetId}/profile`, {
        data: {
          name: "พนักงาน ทดสอบใหม่",
          locationIds: [locationId],
          primaryLocationId: null,
        },
      });
      expect(invalidPrimary.status()).toBe(400);

      const selfEdit = await admin.request.put(`/api/lanflow/admin/users/${adminProfile.id}/profile`, {
        data: { name: "แก้ตนเอง", locationIds: [], primaryLocationId: null },
      });
      expect(selfEdit.status()).toBe(403);

      expect((await db.from("profiles").update({ is_active: false }).eq("id", targetId)).error).toBeNull();
      const inactive = await manager.request.put(`/api/lanflow/admin/users/${targetId}/profile`, {
        data: {
          name: "พนักงานหลังระงับ",
          locationIds: [locationId],
          primaryLocationId: locationId,
        },
      });
      expect(inactive.status()).toBe(403);
    } finally {
      if (targetId) {
        await db.from("profiles").update({ is_active: true }).eq("id", targetId);
        await db.from("admin_account_audit_logs").delete().eq("target_user_id", targetId);
        await db.from("profiles").delete().eq("id", targetId);
        await db.auth.admin.deleteUser(targetId);
      }
      await db.from("user_locations").delete()
        .eq("user_id", adminProfile.id)
        .eq("location_id", secondLocationId);
      await db.from("locations").delete().eq("id", secondLocationId);
      await Promise.all([manager.close(), admin.close()]);
    }
  });

  test("password reset is idempotent and never stores or returns the password", async ({ browser }) => {
    const manager = await authContext(browser, "super_admin");
    const ordinaryAdmin = await authContext(browser, "admin");
    const db = service();
    const managerProfile = await ownProfile(manager);
    const phone = `08${Date.now().toString().slice(-8)}`;
    const originalPassword = `Start-${crypto.randomUUID()}`;
    const newPassword = `Changed-${crypto.randomUUID()}`;
    const requestId = crypto.randomUUID();
    const stoppedRequestId = crypto.randomUUID();
    const failedRequestId = crypto.randomUUID();
    const unknownRequestId = crypto.randomUUID();
    let targetId: string | null = null;

    try {
      const created = await manager.request.post("/api/lanflow/admin/users", {
        data: {
          phone,
          name: "พนักงานทดสอบรหัสผ่าน",
          password: originalPassword,
          role: "user",
          locationIds: [managerProfile.locationIds[0]],
        },
      });
      expect(created.status(), await created.text()).toBe(201);
      targetId = (await created.json() as { user: { id: string } }).user.id;

      const completedAt = new Date().toISOString();
      expect((await db.from("admin_account_audit_logs").insert([
        {
          request_id: stoppedRequestId,
          actor_user_id: managerProfile.id,
          target_user_id: targetId,
          action: "password_reset",
          status: "pending",
        },
        {
          request_id: failedRequestId,
          actor_user_id: managerProfile.id,
          target_user_id: targetId,
          action: "password_reset",
          status: "failed",
          error_code: "auth_provider_rejected_internal_detail",
          completed_at: completedAt,
        },
        {
          request_id: unknownRequestId,
          actor_user_id: managerProfile.id,
          target_user_id: targetId,
          action: "password_reset",
          status: "unknown",
          error_code: "network_result_ambiguous_internal_detail",
          completed_at: completedAt,
        },
      ])).error).toBeNull();

      for (const replayRequestId of [stoppedRequestId, failedRequestId, unknownRequestId]) {
        const replay = await manager.request.put(`/api/lanflow/admin/users/${targetId}/password`, {
          data: { newPassword, confirmPassword: newPassword, requestId: replayRequestId },
        });
        expect(replay.status()).toBe(409);
        const replayText = await replay.text();
        expect(replayText).not.toContain(newPassword);
        expect(replayText).not.toContain("internal_detail");
        expect(JSON.parse(replayText)).toEqual({
          errorMessage: "คำขอนี้ยังไม่ยืนยันผลสำเร็จ กรุณาตรวจสอบและสร้างคำขอใหม่",
        });
      }

      const payload = { newPassword, confirmPassword: newPassword, requestId };
      const forbidden = await ordinaryAdmin.request.put(
        `/api/lanflow/admin/users/${targetId}/password`,
        { data: payload },
      );
      expect(forbidden.status()).toBe(403);
      const mismatch = await manager.request.put(`/api/lanflow/admin/users/${targetId}/password`, {
        data: { ...payload, confirmPassword: `${newPassword}-different` },
      });
      expect(mismatch.status()).toBe(400);
      const first = await manager.request.put(`/api/lanflow/admin/users/${targetId}/password`, { data: payload });
      expect(first.ok(), await first.text()).toBeTruthy();
      const firstText = await first.text();
      expect(firstText).not.toContain(newPassword);
      expect(JSON.parse(firstText)).toMatchObject({ success: true, auditStatus: "succeeded" });

      const retry = await manager.request.put(`/api/lanflow/admin/users/${targetId}/password`, { data: payload });
      expect(retry.ok(), await retry.text()).toBeTruthy();
      expect(await retry.json()).toEqual({ success: true, auditStatus: "succeeded" });

      const audits = await db.from("admin_account_audit_logs")
        .select("id,action,status,old_data,new_data,error_code")
        .eq("request_id", requestId);
      expect(audits.error).toBeNull();
      expect(audits.data).toHaveLength(1);
      expect(audits.data?.[0]).toMatchObject({ action: "password_reset", status: "succeeded" });
      expect(JSON.stringify(audits.data)).not.toContain(newPassword);

      const signedIn = await db.auth.signInWithPassword({ phone: `+66${phone.slice(1)}`, password: newPassword });
      expect(signedIn.error).toBeNull();
    } finally {
      if (targetId) {
        await db.from("admin_account_audit_logs").delete().eq("target_user_id", targetId);
        await db.from("profiles").delete().eq("id", targetId);
        await db.auth.admin.deleteUser(targetId);
      }
      await Promise.all([manager.close(), ordinaryAdmin.close()]);
    }
  });
});
