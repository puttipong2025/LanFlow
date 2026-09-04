import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  || "";

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

      const malformedCreate = await manager.request.post("/api/lanflow/admin/users", { data: [] });
      expect(malformedCreate.status()).toBe(400);
      expect(await malformedCreate.json()).toEqual({ error: "invalid request body" });

      const invalidPhone = await manager.request.post("/api/lanflow/admin/users", {
        data: {
          phone: "not-a-phone",
          name: "invalid phone",
          password,
          role: "user",
          locationIds: [],
        },
      });
      expect(invalidPhone.status()).toBe(400);
      expect(await invalidPhone.json()).toEqual({ error: "กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง" });

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

  test("password reset is idempotent, stores only the display copy, and never returns it from mutation or audit", async ({ browser }) => {
    const manager = await authContext(browser, "super_admin");
    const ordinaryAdmin = await authContext(browser, "admin");
    const db = service();
    const managerProfile = await ownProfile(manager);
    const phone = `08${Date.now().toString().slice(-8)}`;
    const originalPassword = `Start-${crypto.randomUUID()}`;
    const newPassword = `Changed-${crypto.randomUUID()}`;
    const managerPassword = `Manager-${crypto.randomUUID()}`;
    const concurrentPasswordA = `Concurrent-A-${crypto.randomUUID()}`;
    const concurrentPasswordB = `Concurrent-B-${crypto.randomUUID()}`;
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

      const malformedReset = await manager.request.put(`/api/lanflow/admin/users/${targetId}/password`, {
        data: [],
      });
      expect(malformedReset.status()).toBe(400);
      expect(await malformedReset.json()).toEqual({ errorMessage: "ข้อมูลรีเซ็ตรหัสผ่านไม่ถูกต้อง" });

      const initialReveal = await manager.request.get(`/api/lanflow/admin/users/${targetId}/password`);
      expect(initialReveal.ok(), await initialReveal.text()).toBeTruthy();
      expect(await initialReveal.json()).toEqual({ available: true, password: originalPassword });

      expect((await db.from("profiles").update({ can_access_super_admin_features: true }).eq("id", "00000000-0000-4000-8000-000000000002")).error).toBeNull();
      const managerReveal = await ordinaryAdmin.request.get(`/api/lanflow/admin/users/${targetId}/password`);
      expect(managerReveal.status()).toBe(403);
      expect((await db.from("profiles").update({ can_access_super_admin_features: false }).eq("id", "00000000-0000-4000-8000-000000000002")).error).toBeNull();

      const targetDeviceOne = createClient(supabaseUrl, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const targetDeviceTwo = createClient(supabaseUrl, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const signedInOne = await targetDeviceOne.auth.signInWithPassword({
        phone: `+66${phone.slice(1)}`,
        password: originalPassword,
      });
      const signedInTwo = await targetDeviceTwo.auth.signInWithPassword({
        phone: `+66${phone.slice(1)}`,
        password: originalPassword,
      });
      expect(signedInOne.error).toBeNull();
      expect(signedInTwo.error).toBeNull();
      const refreshTokenOne = signedInOne.data.session!.refresh_token;
      const refreshTokenTwo = signedInTwo.data.session!.refresh_token;

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
      expect(JSON.parse(firstText)).toEqual({
        success: true,
        auditStatus: "succeeded",
        readablePasswordAvailable: true,
      });
      expect((await targetDeviceOne.auth.refreshSession({ refresh_token: refreshTokenOne })).error).not.toBeNull();
      expect((await targetDeviceTwo.auth.refreshSession({ refresh_token: refreshTokenTwo })).error).not.toBeNull();

      const retry = await manager.request.put(`/api/lanflow/admin/users/${targetId}/password`, { data: payload });
      expect(retry.ok(), await retry.text()).toBeTruthy();
      expect(await retry.json()).toEqual({
        success: true,
        auditStatus: "succeeded",
        readablePasswordAvailable: true,
      });

      const updatedReveal = await manager.request.get(`/api/lanflow/admin/users/${targetId}/password`);
      expect(updatedReveal.ok(), await updatedReveal.text()).toBeTruthy();
      expect(await updatedReveal.json()).toEqual({ available: true, password: newPassword });

      expect((await db.from("profiles").update({ can_access_super_admin_features: true }).eq("id", "00000000-0000-4000-8000-000000000002")).error).toBeNull();
      const managerReset = await ordinaryAdmin.request.put(`/api/lanflow/admin/users/${targetId}/password`, {
        data: {
          newPassword: managerPassword,
          confirmPassword: managerPassword,
          requestId: crypto.randomUUID(),
        },
      });
      expect(managerReset.ok(), await managerReset.text()).toBeTruthy();
      expect(await managerReset.json()).toMatchObject({
        success: true,
        readablePasswordAvailable: true,
      });
      const stillForbiddenReveal = await ordinaryAdmin.request.get(`/api/lanflow/admin/users/${targetId}/password`);
      expect(stillForbiddenReveal.status()).toBe(403);
      expect((await db.from("profiles").update({ can_access_super_admin_features: false }).eq("id", "00000000-0000-4000-8000-000000000002")).error).toBeNull();

      const managerUpdatedReveal = await manager.request.get(`/api/lanflow/admin/users/${targetId}/password`);
      expect(managerUpdatedReveal.ok(), await managerUpdatedReveal.text()).toBeTruthy();
      expect(await managerUpdatedReveal.json()).toEqual({ available: true, password: managerPassword });

      const [concurrentA, concurrentB] = await Promise.all([
        manager.request.put(`/api/lanflow/admin/users/${targetId}/password`, {
          data: {
            newPassword: concurrentPasswordA,
            confirmPassword: concurrentPasswordA,
            requestId: crypto.randomUUID(),
          },
        }),
        manager.request.put(`/api/lanflow/admin/users/${targetId}/password`, {
          data: {
            newPassword: concurrentPasswordB,
            confirmPassword: concurrentPasswordB,
            requestId: crypto.randomUUID(),
          },
        }),
      ]);
      expect(concurrentA.ok(), await concurrentA.text()).toBeTruthy();
      expect(concurrentB.ok(), await concurrentB.text()).toBeTruthy();

      const loginAfterConcurrentA = await createClient(supabaseUrl, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }).auth.signInWithPassword({ phone: `+66${phone.slice(1)}`, password: concurrentPasswordA });
      const loginAfterConcurrentB = await createClient(supabaseUrl, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }).auth.signInWithPassword({ phone: `+66${phone.slice(1)}`, password: concurrentPasswordB });
      const activeConcurrentPassword = loginAfterConcurrentA.error === null
        ? concurrentPasswordA
        : concurrentPasswordB;
      expect([loginAfterConcurrentA.error, loginAfterConcurrentB.error].filter((error) => error === null)).toHaveLength(1);

      const concurrentReveal = await manager.request.get(`/api/lanflow/admin/users/${targetId}/password`);
      expect(concurrentReveal.ok(), await concurrentReveal.text()).toBeTruthy();
      const concurrentRevealBody = await concurrentReveal.json() as { available: boolean; password?: string };
      if (concurrentRevealBody.available) {
        expect(concurrentRevealBody.password).toBe(activeConcurrentPassword);
      }

      const authenticated = createClient(supabaseUrl, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      expect((await authenticated.auth.signInWithPassword({ phone: "+66810000001", password: process.env.TEST_PASSWORD ?? "password123" })).error).toBeNull();
      const directSecretRead = await authenticated
        .from("profiles")
        .select("current_password_plaintext")
        .eq("id", targetId);
      expect(directSecretRead.error).not.toBeNull();

      const audits = await db.from("admin_account_audit_logs")
        .select("id,action,status,old_data,new_data,error_code")
        .eq("request_id", requestId);
      expect(audits.error).toBeNull();
      expect(audits.data).toHaveLength(1);
      expect(audits.data?.[0]).toMatchObject({ action: "password_reset", status: "succeeded" });
      expect(JSON.stringify(audits.data)).not.toContain(newPassword);

      const targetLogin = createClient(supabaseUrl, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const signedIn = await targetLogin.auth.signInWithPassword({ phone: `+66${phone.slice(1)}`, password: activeConcurrentPassword });
      expect(signedIn.error).toBeNull();

      expect((await service().from("profiles").update({ current_password_plaintext: null }).eq("id", targetId)).error).toBeNull();
      const unavailableReveal = await manager.request.get(`/api/lanflow/admin/users/${targetId}/password`);
      expect(unavailableReveal.ok(), await unavailableReveal.text()).toBeTruthy();
      expect(await unavailableReveal.json()).toEqual({ available: false });
    } finally {
      await db.from("profiles").update({ can_access_super_admin_features: false }).eq("id", "00000000-0000-4000-8000-000000000002");
      if (targetId) {
        await db.from("admin_account_audit_logs").delete().eq("target_user_id", targetId);
        await db.from("profiles").delete().eq("id", targetId);
        await db.auth.admin.deleteUser(targetId);
      }
      await Promise.all([manager.close(), ordinaryAdmin.close()]);
    }
  });
});
