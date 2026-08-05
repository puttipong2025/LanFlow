import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { bangkokDateString } from "../src/lib/bangkok-date";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  || "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const password = process.env.TEST_PASSWORD || "password123";

const actors = [
  { id: "00000000-0000-4000-8000-000000000002", phone: "+66810000001", role: "admin" },
  { id: "00000000-0000-4000-8000-000000000003", phone: "+66820000001", role: "user" },
] as const;

function serviceClient() {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signedInClient(phone: string) {
  const client = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ phone, password });
  expect(error).toBeNull();
  return client;
}

async function authContext(browser: Browser, role: "user" | "admin" | "super_admin") {
  return browser.newContext({ storageState: `playwright/.auth/${role}.json` });
}

async function closeAll(contexts: BrowserContext[]) {
  await Promise.all(contexts.map((context) => context.close()));
}

function transferRow(id: string, locationId: string, actor: typeof actors[number]) {
  return {
    id,
    client_temp_id: id,
    idempotency_key: `money-transfer-access:${id}`,
    location_id: locationId,
    customer_name: `ทดสอบสิทธิ์ ${actor.role}`,
    net_amount_to_pay: 100,
    transfer_status: "pending",
    transfer_type: "customer",
    transfer_method: "bank",
    sync_status: "synced",
    record_status: "active",
    created_by_user_id: actor.id,
    created_by_name: `LanFlow ${actor.role}`,
    created_by_phone: actor.phone,
  };
}

async function assignedLocation(service: SupabaseClient, userId: string) {
  const { data, error } = await service
    .from("user_locations")
    .select("location_id, locations!inner(is_active)")
    .eq("user_id", userId)
    .eq("locations.is_active", true)
    .limit(1)
    .single();
  expect(error).toBeNull();
  return data!.location_id as string;
}

test.describe.serial("Money Transfer account access @money-transfer-access", () => {
  test("system managers retain automatic Money Transfer access", async () => {
    test.skip(!serviceRoleKey || !publishableKey, "Supabase test keys are required");
    const service = serviceClient();
    const actor = actors[0];
    const transferId = crypto.randomUUID();

    try {
      const locationId = await assignedLocation(service, actor.id);
      const enabled = await service
        .from("profiles")
        .update({
          can_access_super_admin_features: true,
          can_access_money_transfer: false,
        })
        .eq("id", actor.id);
      expect(enabled.error).toBeNull();

      const client = await signedInClient(actor.phone);
      const inserted = await client.from("money_transfers").insert(
        transferRow(transferId, locationId, actor),
      );
      expect(inserted.error).toBeNull();
    } finally {
      await service.from("money_transfers").delete().eq("id", transferId);
      await service
        .from("profiles")
        .update({
          can_access_super_admin_features: false,
          can_access_money_transfer: false,
        })
        .eq("id", actor.id);
    }
  });

  test("the standalone capability grants the same branch-scoped write access to user and admin", async () => {
    test.skip(!serviceRoleKey || !publishableKey, "Supabase test keys are required");
    const service = serviceClient();
    const transferIds: string[] = [];

    try {
      for (const actor of actors) {
        const locationId = await assignedLocation(service, actor.id);
        const enabled = await service
          .from("profiles")
          .update({
            can_access_super_admin_features: false,
            can_access_money_transfer: true,
          })
          .eq("id", actor.id);
        expect(enabled.error).toBeNull();

        const client = await signedInClient(actor.phone);
        const transferId = crypto.randomUUID();
        transferIds.push(transferId);
        const granted = await client.from("money_transfers").insert(
          transferRow(transferId, locationId, actor),
        );
        expect(granted.error).toBeNull();

        const updated = await client
          .from("money_transfers")
          .update({ customer_name: `แก้ไขโดย ${actor.role}` })
          .eq("id", transferId)
          .select("id")
          .single();
        expect(updated.error).toBeNull();

        const slipId = crypto.randomUUID();
        const slipInserted = await client.from("money_transfer_slips").insert({
          id: slipId,
          transfer_id: transferId,
          amount: 100,
          reference_number: `REF-${actor.role}`,
        });
        expect(slipInserted.error).toBeNull();

        const receiptDetails = await client.rpc(
          "get_money_transfer_receipt_source_details",
          { p_transfer_id: transferId },
        );
        expect(receiptDetails.error).toBeNull();
        expect(receiptDetails.data).toMatchObject({ items: [] });

        const deletedId = crypto.randomUUID();
        transferIds.push(deletedId);
        expect((await client.from("money_transfers").insert(
          transferRow(deletedId, locationId, actor),
        )).error).toBeNull();
        const deleted = await client
          .from("money_transfers")
          .delete()
          .eq("id", deletedId)
          .select("id")
          .single();
        expect(deleted.error).toBeNull();

        const { data: foreignLocation } = await service
          .from("locations")
          .select("id")
          .neq("id", locationId)
          .limit(1)
          .single();
        expect(foreignLocation).toBeTruthy();
        const foreignId = crypto.randomUUID();
        transferIds.push(foreignId);
        const foreignDenied = await client.from("money_transfers").insert(
          transferRow(foreignId, foreignLocation!.id, actor),
        );
        expect(foreignDenied.error).not.toBeNull();

        const disabled = await service
          .from("profiles")
          .update({ can_access_money_transfer: false })
          .eq("id", actor.id);
        expect(disabled.error).toBeNull();

        const updateDenied = await client
          .from("money_transfers")
          .update({ customer_name: "ต้องไม่ถูกบันทึก" })
          .eq("id", transferId)
          .select("id")
          .single();
        expect(updateDenied.error).not.toBeNull();

        const receiptDenied = await client.rpc(
          "get_money_transfer_receipt_source_details",
          { p_transfer_id: transferId },
        );
        expect(receiptDenied.error).not.toBeNull();

        const deniedId = crypto.randomUUID();
        transferIds.push(deniedId);
        const denied = await client.from("money_transfers").insert(
          transferRow(deniedId, locationId, actor),
        );
        expect(denied.error).not.toBeNull();
      }
    } finally {
      await service.from("money_transfers").delete().in("id", transferIds);
      await service
        .from("profiles")
        .update({
          can_access_super_admin_features: false,
          can_access_money_transfer: false,
        })
        .in("id", actors.map((actor) => actor.id));
    }
  });

  test("super_admin and system managers control the capability without coupling it to manager access", async ({ browser }) => {
    test.skip(!serviceRoleKey || !publishableKey, "Supabase test keys are required");
    const service = serviceClient();
    const superAdmin = await authContext(browser, "super_admin");
    const admin = await authContext(browser, "admin");
    const adminActor = actors[0];
    const userActor = actors[1];

    try {
      expect((await service.from("profiles").update({
        can_access_super_admin_features: false,
        can_access_money_transfer: false,
      }).in("id", [adminActor.id, userActor.id])).error).toBeNull();

      const denied = await admin.request.patch(
        `/api/lanflow/admin/users/${userActor.id}/money-transfer-access`,
        { data: { canAccessMoneyTransfer: true } },
      );
      expect(denied.status()).toBe(403);

      const grantedAdmin = await superAdmin.request.patch(
        `/api/lanflow/admin/users/${adminActor.id}/money-transfer-access`,
        { data: { canAccessMoneyTransfer: true } },
      );
      expect(grantedAdmin.ok(), await grantedAdmin.text()).toBeTruthy();

      const managerEnabled = await superAdmin.request.patch(
        `/api/lanflow/admin/users/${adminActor.id}/system-manager-access`,
        { data: { canAccessSystemManager: true } },
      );
      expect(managerEnabled.ok(), await managerEnabled.text()).toBeTruthy();

      const managerCannotToggleAutomaticAccess = await superAdmin.request.patch(
        `/api/lanflow/admin/users/${adminActor.id}/money-transfer-access`,
        { data: { canAccessMoneyTransfer: false } },
      );
      expect(managerCannotToggleAutomaticAccess.status()).toBe(403);

      const managerGrantedUser = await admin.request.patch(
        `/api/lanflow/admin/users/${userActor.id}/money-transfer-access`,
        { data: { canAccessMoneyTransfer: true } },
      );
      expect(managerGrantedUser.ok(), await managerGrantedUser.text()).toBeTruthy();

      const managerDisabled = await superAdmin.request.patch(
        `/api/lanflow/admin/users/${adminActor.id}/system-manager-access`,
        { data: { canAccessSystemManager: false } },
      );
      expect(managerDisabled.ok(), await managerDisabled.text()).toBeTruthy();

      const { data: profiles, error } = await service
        .from("profiles")
        .select("id, can_access_super_admin_features, can_access_money_transfer")
        .in("id", [adminActor.id, userActor.id]);
      expect(error).toBeNull();
      expect(profiles).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: adminActor.id,
          can_access_super_admin_features: false,
          can_access_money_transfer: true,
        }),
        expect.objectContaining({
          id: userActor.id,
          can_access_super_admin_features: false,
          can_access_money_transfer: true,
        }),
      ]));

      const deniedAfterManagerRemoval = await admin.request.patch(
        `/api/lanflow/admin/users/${userActor.id}/money-transfer-access`,
        { data: { canAccessMoneyTransfer: false } },
      );
      expect(deniedAfterManagerRemoval.status()).toBe(403);
    } finally {
      await service.from("profiles").update({
        can_access_super_admin_features: false,
        can_access_money_transfer: false,
      }).in("id", [adminActor.id, userActor.id]);
      await closeAll([superAdmin, admin]);
    }
  });

  test("the Admin module exposes the per-account toggle without granting manager access", async ({ browser }) => {
    test.skip(!serviceRoleKey || !publishableKey, "Supabase test keys are required");
    const service = serviceClient();
    const superAdmin = await authContext(browser, "super_admin");
    const page = await superAdmin.newPage();
    const userActor = actors[1];

    try {
      expect((await service.from("profiles").update({
        can_access_super_admin_features: false,
        can_access_money_transfer: false,
      }).eq("id", userActor.id)).error).toBeNull();

      await page.goto("/");
      await page.getByRole("button", { name: "Admin" }).click();
      const userCard = page.locator(`[data-user-id="${userActor.id}"]`);
      await expect(userCard).toBeVisible();
      await userCard.getByRole("button", { name: "เปิดสิทธิ์โอนเงิน" }).click();
      const updateResponse = page.waitForResponse((response) =>
        response.url().endsWith(`/api/lanflow/admin/users/${userActor.id}/money-transfer-access`)
        && response.request().method() === "PATCH"
      );
      await page.getByRole("button", { name: "ยืนยัน", exact: true }).click();
      const response = await updateResponse;
      expect(response.ok()).toBeTruthy();

      await expect.poll(async () => {
        const { data, error } = await service
          .from("profiles")
          .select("can_access_super_admin_features, can_access_money_transfer")
          .eq("id", userActor.id)
          .single();
        expect(error).toBeNull();
        return data;
      }).toEqual({
        can_access_super_admin_features: false,
        can_access_money_transfer: true,
      });
      await expect(userCard.getByRole("button", { name: "ปิดสิทธิ์โอนเงิน" })).toBeVisible();
    } finally {
      await service.from("profiles").update({
        can_access_super_admin_features: false,
        can_access_money_transfer: false,
      }).eq("id", userActor.id);
      await superAdmin.close();
    }
  });

  test("user and admin navigation follows the same per-account capability", async ({ browser }) => {
    test.skip(!serviceRoleKey || !publishableKey, "Supabase test keys are required");
    const service = serviceClient();
    const contexts: BrowserContext[] = [];

    try {
      for (const actor of actors) {
        expect((await service.from("profiles").update({
          can_access_super_admin_features: false,
          can_access_money_transfer: false,
        }).eq("id", actor.id)).error).toBeNull();

        const context = await authContext(browser, actor.role);
        contexts.push(context);
        const page = await context.newPage();
        await page.goto("/");
        await expect(page.getByRole("button", { name: "โอนเงิน", exact: true })).toHaveCount(0);

        expect((await service.from("profiles").update({
          can_access_money_transfer: true,
        }).eq("id", actor.id)).error).toBeNull();
        await page.reload();
        await page.getByRole("button", { name: "โอนเงิน", exact: true }).click();
        await expect(page.getByRole("heading", { name: "ระบบโอนเงิน" })).toBeVisible();
      }
    } finally {
      await service.from("profiles").update({
        can_access_super_admin_features: false,
        can_access_money_transfer: false,
      }).in("id", actors.map((actor) => actor.id));
      await closeAll(contexts);
    }
  });

  test("revoked module access keeps the assigned-branch Income/Expense derived row read-only", async ({ browser }) => {
    test.skip(!serviceRoleKey || !publishableKey, "Supabase test keys are required");
    const service = serviceClient();
    const actor = actors[1];
    const user = await authContext(browser, "user");
    const transferId = crypto.randomUUID();

    try {
      const locationId = await assignedLocation(service, actor.id);
      const { data: targetLocation, error: locationError } = await service
        .from("locations")
        .select("id, name")
        .neq("id", locationId)
        .limit(1)
        .single();
      expect(locationError).toBeNull();
      expect((await service.from("profiles").update({
        can_access_super_admin_features: false,
        can_access_money_transfer: false,
      }).eq("id", actor.id)).error).toBeNull();
      expect((await service.from("money_transfers").insert({
        ...transferRow(transferId, locationId, actor),
        target_location_id: targetLocation!.id,
        target_location_name: targetLocation!.name,
        transfer_type: "branch",
        transfer_status: "paid",
      })).error).toBeNull();

      const date = bangkokDateString();
      const response = await user.request.get(
        `/api/lanflow/income-expense/feed?locationId=${locationId}&from=${date}&to=${date}&pageSize=100`,
      );
      expect(response.ok()).toBeTruthy();
      const body = await response.json() as { rows: Array<{ id: string; relationSourceId?: string }> };
      expect(body.rows).toContainEqual(expect.objectContaining({
        id: `money-transfer-branch-expense:${transferId}`,
        relationSourceId: transferId,
      }));

      const client = await signedInClient(actor.phone);
      const sourceDenied = await client.rpc(
        "get_money_transfer_receipt_source_details",
        { p_transfer_id: transferId },
      );
      expect(sourceDenied.error).not.toBeNull();
    } finally {
      await service.from("money_transfers").delete().eq("id", transferId);
      await service.from("profiles").update({
        can_access_super_admin_features: false,
        can_access_money_transfer: false,
      }).eq("id", actor.id);
      await user.close();
    }
  });

  test("an inactive account stays blocked even when the capability flag is preserved", async () => {
    test.skip(!serviceRoleKey || !publishableKey, "Supabase test keys are required");
    const service = serviceClient();
    const actor = actors[1];
    const transferId = crypto.randomUUID();

    try {
      const locationId = await assignedLocation(service, actor.id);
      const client = await signedInClient(actor.phone);
      expect((await service.from("profiles").update({
        is_active: false,
        can_access_super_admin_features: false,
        can_access_money_transfer: true,
      }).eq("id", actor.id)).error).toBeNull();

      const denied = await client.from("money_transfers").insert(
        transferRow(transferId, locationId, actor),
      );
      expect(denied.error).not.toBeNull();

      const { data: profile, error } = await service
        .from("profiles")
        .select("is_active, can_access_money_transfer")
        .eq("id", actor.id)
        .single();
      expect(error).toBeNull();
      expect(profile).toEqual({
        is_active: false,
        can_access_money_transfer: true,
      });
    } finally {
      await service.from("money_transfers").delete().eq("id", transferId);
      await service.from("profiles").update({
        is_active: true,
        can_access_super_admin_features: false,
        can_access_money_transfer: false,
      }).eq("id", actor.id);
    }
  });
});
