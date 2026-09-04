import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  || "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

test("a revoked System Manager access JWT cannot reset another password", async ({ request }) => {
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const manager = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const managerId = crypto.randomUUID();
  const targetId = crypto.randomUUID();
  const managerPhoneLocal = `06${Date.now().toString().slice(-8)}`;
  const managerPhone = `+66${managerPhoneLocal.slice(1)}`;
  const managerPassword = `Manager-${crypto.randomUUID()}`;

  try {
    expect((await admin.auth.admin.createUser({
      id: managerId,
      phone: managerPhone,
      phone_confirm: true,
      password: managerPassword,
    })).error).toBeNull();
    expect((await admin.from("profiles").insert({
      id: managerId,
      phone: managerPhoneLocal,
      name: "Revoked manager",
      role: "admin",
      is_active: true,
      password_hash: null,
      can_access_super_admin_features: true,
    })).error).toBeNull();

    const signedIn = await manager.auth.signInWithPassword({
      phone: managerPhone,
      password: managerPassword,
    });
    expect(signedIn.error).toBeNull();
    const accessToken = signedIn.data.session!.access_token;

    expect((await admin.auth.admin.updateUserById(managerId, {
      password: `${managerPassword}-replacement`,
    })).error).toBeNull();

    const reset = await request.put(`/api/lanflow/admin/users/${targetId}/password`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {
        newPassword: "new-password-123",
        confirmPassword: "new-password-123",
        requestId: crypto.randomUUID(),
      },
    });
    expect(reset.status()).toBe(401);
    expect(await reset.json()).toEqual({ error: "session นี้ถูกยกเลิกแล้ว กรุณาเข้าสู่ระบบใหม่" });
  } finally {
    await admin.from("admin_account_audit_logs").delete().eq("actor_user_id", managerId);
    await admin.from("profiles").delete().eq("id", managerId);
    await admin.auth.admin.deleteUser(managerId);
  }
});
