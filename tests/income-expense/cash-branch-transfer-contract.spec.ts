import { expect, test, type APIRequestContext, type Browser, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const zeroCounts = {
  coin1: 0,
  coin2: 0,
  coin5: 0,
  coin10: 0,
  banknote20: 0,
  banknote50: 0,
  banknote100: 0,
  banknote500: 0,
  banknote1000: 0,
};

async function authContext(browser: Browser, role: "user" | "admin" | "super_admin") {
  const context = await browser.newContext({ storageState: `playwright/.auth/${role}.json` });
  const me = await context.request.get("/api/auth/me");
  if (!me.ok()) {
    const phoneByRole = {
      user: "0820000001",
      admin: "0810000001",
      super_admin: process.env.TEST_PHONE || "0800000000",
    };
    const page = await context.newPage();
    await page.goto("/login");
    await page.fill('input[type="tel"]', phoneByRole[role]);
    await page.fill('input[type="password"]', process.env.TEST_PASSWORD || "password123");
    await page.click('button:has-text("เข้าสู่ระบบ")');
    await expect(page.locator('text=ออกจากระบบ')).toBeVisible({ timeout: 30000 });
    await page.close();
  }
  return context;
}

async function profile(request: APIRequestContext) {
  const response = await request.get("/api/auth/me");
  expect(response.ok()).toBeTruthy();
  return (await response.json() as { profile: { id: string; locationIds: string[] } }).profile;
}

function createPayload(sourceLocationId: string, targetLocationId: string, banknote20 = 1) {
  const id = crypto.randomUUID();
  return {
    sourceLocationId,
    targetLocationId,
    sent: { ...zeroCounts, banknote20 },
    clientTempId: id,
    idempotencyKey: `cash-contract:${id}`,
    createdByUserId: "00000000-0000-4000-8000-ffffffffffff",
    createdByName: "ห้ามเชื่อชื่อจาก client",
    sentAt: "2000-01-01T00:00:00.000Z",
  };
}

async function createTransfer(request: APIRequestContext, sourceLocationId: string, targetLocationId: string, banknote20 = 1) {
  const response = await request.post("/api/lanflow/cash-branch-transfers", {
    data: createPayload(sourceLocationId, targetLocationId, banknote20),
  });
  const body = await response.json() as { id?: string; error?: string };
  expect(response.ok(), body.error).toBeTruthy();
  return body.id!;
}

async function deleteTransfer(request: APIRequestContext, id: string) {
  const response = await request.delete(`/api/lanflow/cash-branch-transfers/${id}`);
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function cleanupTransfer(id: string) {
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await service.from("money_transfers").delete().eq("id", id);
  expect(error).toBeNull();
}

async function closeAll(contexts: BrowserContext[]) {
  await Promise.all(contexts.map((context) => context.close()));
}

function cashDetail(transfer: { money_transfer_cash_details: unknown }) {
  const relation = transfer.money_transfer_cash_details;
  return (Array.isArray(relation) ? relation[0] : relation) as Record<string, unknown>;
}

test.describe.serial("Cash branch transfer contract @cash-transfer-contract", () => {
  test("user, admin, and super_admin create with server identity; location and state guards hold", async ({ browser }) => {
    test.setTimeout(60000);
    expect(serviceRoleKey).toBeTruthy();
    const service = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const user = await authContext(browser, "user");
    const admin = await authContext(browser, "admin");
    const superAdmin = await authContext(browser, "super_admin");
    const contexts = [user, admin, superAdmin];
    try {
      const [userProfile, adminProfile, superProfile] = await Promise.all([
        profile(user.request),
        profile(admin.request),
        profile(superAdmin.request),
      ]);
      const sourceLocationId = userProfile.locationIds[0];
      const targetLocationId = superProfile.locationIds.find((id) => !userProfile.locationIds.includes(id));
      expect(sourceLocationId).toBeTruthy();
      expect(targetLocationId).toBeTruthy();
      expect(adminProfile.locationIds).toContain(sourceLocationId);

      const deniedCreate = await user.request.post("/api/lanflow/cash-branch-transfers", {
        data: createPayload(targetLocationId!, sourceLocationId),
      });
      expect(deniedCreate.status()).toBe(403);

      for (const [context, actor] of [[user, userProfile], [admin, adminProfile], [superAdmin, superProfile]] as const) {
        const transferId = await createTransfer(context.request, sourceLocationId, targetLocationId!);
        const detail = await superAdmin.request.get(`/api/lanflow/cash-branch-transfers/${transferId}`);
        expect(detail.ok()).toBeTruthy();
        const row = (await detail.json()).transfer;
        expect(row.created_by_user_id).toBe(actor.id);
        expect(row.created_by_name).not.toBe("ห้ามเชื่อชื่อจาก client");
        expect(cashDetail(row).sent_at).not.toContain("2000-01-01");
        await deleteTransfer(superAdmin.request, transferId);
      }

      const guardedId = await createTransfer(user.request, sourceLocationId, targetLocationId!);
      const deniedReceive = await user.request.post(`/api/lanflow/cash-branch-transfers/${guardedId}/receive`, {
        data: { received: { ...zeroCounts, banknote20: 1 } },
      });
      expect(deniedReceive.status()).toBe(403);

      const acceptedReceive = await superAdmin.request.post(`/api/lanflow/cash-branch-transfers/${guardedId}/receive`, {
        data: { received: { ...zeroCounts, banknote20: 1 }, receivedByName: "client spoof", receivedAt: "2000-01-01T00:00:00Z" },
      });
      expect(acceptedReceive.ok(), await acceptedReceive.text()).toBeTruthy();
      expect((await superAdmin.request.post(`/api/lanflow/cash-branch-transfers/${guardedId}/accept-difference`, {
        data: { reason: "removed" },
      })).status()).toBe(404);
      const removedRpc = await service.rpc("accept_cash_branch_difference", {
        p_transfer_id: guardedId,
        p_reason: "removed",
      });
      expect(removedRpc.error).not.toBeNull();

      const lockedEdit = await user.request.patch(`/api/lanflow/cash-branch-transfers/${guardedId}`, {
        data: { targetLocationId, sent: { ...zeroCounts, banknote20: 2 } },
      });
      expect(lockedEdit.status()).toBe(409);
      expect((await user.request.delete(`/api/lanflow/cash-branch-transfers/${guardedId}`)).status()).toBe(403);
      await cleanupTransfer(guardedId);

      const managerOnlySource = superProfile.locationIds.find((id) => !adminProfile.locationIds.includes(id));
      expect(managerOnlySource).toBeTruthy();
      const targetOwnedId = await createTransfer(
        superAdmin.request,
        managerOnlySource!,
        adminProfile.locationIds[0],
      );
      expect((await admin.request.post(`/api/lanflow/cash-branch-transfers/${targetOwnedId}/receive`, {
        data: { received: { ...zeroCounts, banknote20: 1 } },
      })).ok()).toBeTruthy();
      expect((await admin.request.delete(`/api/lanflow/cash-branch-transfers/${targetOwnedId}`)).status()).toBe(403);
      await cleanupTransfer(targetOwnedId);
    } finally {
      await closeAll(contexts);
    }
  });

  test("exact, shortage, overage, zero, and duplicate receipt all finish at received while preserving counts", async ({ browser }) => {
    const superAdmin = await authContext(browser, "super_admin");
    const admin = await authContext(browser, "admin");
    const service = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    try {
      const superProfile = await profile(superAdmin.request);
      const sourceLocationId = superProfile.locationIds[0];
      const targetLocationId = superProfile.locationIds[1];
      expect(targetLocationId).toBeTruthy();

      const cases = [
        { received20: 1, status: "received", difference: 0 },
        { received20: 0, status: "received", difference: -20 },
        { received20: 2, status: "received", difference: 20 },
      ] as const;

      for (const scenario of cases) {
        const transferId = await createTransfer(superAdmin.request, sourceLocationId, targetLocationId);
        const pendingBadges = await service.rpc("get_telegram_badge_counts");
        expect(pendingBadges.error).toBeNull();
        expect((pendingBadges.data as Array<{ badge_key: string }>).some(
          (badge) => badge.badge_key === "cash_transfer_pending_receipt",
        )).toBeTruthy();
        const receipt = { received: { ...zeroCounts, banknote20: scenario.received20 } };
        const responses = scenario.difference === 0
          ? await Promise.all([
            superAdmin.request.post(`/api/lanflow/cash-branch-transfers/${transferId}/receive`, { data: receipt }),
            superAdmin.request.post(`/api/lanflow/cash-branch-transfers/${transferId}/receive`, { data: receipt }),
          ])
          : [await superAdmin.request.post(`/api/lanflow/cash-branch-transfers/${transferId}/receive`, { data: receipt })];

        expect(responses.map((response) => response.status()).sort()).toEqual(
          scenario.difference === 0 ? [200, 409] : [200],
        );
        const detail = await superAdmin.request.get(`/api/lanflow/cash-branch-transfers/${transferId}`);
        const cash = cashDetail((await detail.json()).transfer);
        expect(cash.cash_status).toBe(scenario.status);
        expect(Number(cash.received_total)).toBe(scenario.received20 * 20);
        expect(Number(cash.difference_total)).toBe(scenario.difference);
        const receivedBadges = await service.rpc("get_telegram_badge_counts");
        expect(receivedBadges.error).toBeNull();
        expect((receivedBadges.data as Array<{ badge_key: string }>).some(
          (badge) => badge.badge_key === "cash_transfer_mismatched",
        )).toBeFalsy();

        expect(cash.received_banknote_20_count).toBe(scenario.received20);
        await cleanupTransfer(transferId);
      }
    } finally {
      await closeAll([superAdmin, admin]);
    }
  });

  test("feed shows terminal difference and post-receipt delete approval preserves history", async ({ browser }) => {
    const superAdmin = await authContext(browser, "super_admin");
    const admin = await authContext(browser, "admin");
    const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    try {
      const superProfile = await profile(superAdmin.request);
      const adminProfile = await profile(admin.request);
      const sourceLocationId = adminProfile.locationIds[0];
      const targetLocationId = superProfile.locationIds.find((id) => id !== sourceLocationId)!;
      expect(targetLocationId).toBeTruthy();
      expect((await service.from("income_expense_approval_settings").upsert({
        id: true,
        applies_to: "both",
        cash_transfer_delete_requires_approval: true,
      })).error).toBeNull();
      const { data: sourceLocation, error: sourceLocationError } = await service
        .from("locations")
        .select("name")
        .eq("id", sourceLocationId)
        .single();
      expect(sourceLocationError).toBeNull();
      const transferId = await createTransfer(superAdmin.request, sourceLocationId, targetLocationId, 2);
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);
      expect((await service.from("money_transfer_cash_details").update({ sent_at: `${yesterday}T05:00:00.000Z` }).eq("transfer_id", transferId)).error).toBeNull();

      const sourceFeed = await superAdmin.request.get(`/api/lanflow/income-expense/feed?locationId=${sourceLocationId}&from=${yesterday}&to=${yesterday}`);
      const sourceRows = (await sourceFeed.json()).rows as Array<{ id: string; cost: number; txDate: string }>;
      expect(sourceRows).toContainEqual(expect.objectContaining({ id: `cash-transfer-expense:${transferId}`, cost: 40, txDate: yesterday }));

      const targetBeforeReceipt = await superAdmin.request.get(`/api/lanflow/income-expense/feed?locationId=${targetLocationId}&from=${today}&to=${today}`);
      expect(((await targetBeforeReceipt.json()).rows as Array<{ id: string }>).some((row) => row.id === `cash-transfer-income:${transferId}`)).toBeFalsy();

      const receive = await superAdmin.request.post(`/api/lanflow/cash-branch-transfers/${transferId}/receive`, {
        data: { received: { ...zeroCounts, banknote20: 1 } },
      });
      expect(receive.ok(), await receive.text()).toBeTruthy();
      expect((await service.from("money_transfer_cash_details").update({ received_at: `${today}T06:00:00.000Z` }).eq("transfer_id", transferId)).error).toBeNull();

      const targetFeed = await superAdmin.request.get(`/api/lanflow/income-expense/feed?locationId=${targetLocationId}&from=${today}&to=${today}`);
      const targetRows = (await targetFeed.json()).rows as Array<{ id: string; cost: number; txDate: string; title: string; relationLabel: string }>;
      expect(targetRows).toContainEqual(expect.objectContaining({
        id: `cash-transfer-income:${transferId}`,
        cost: 20,
        txDate: today,
        title: `รับโอนเงินสดจาก ${sourceLocation!.name}`,
        relationLabel: "รับเงินแล้ว · ผลต่าง -฿20",
      }));

      const requested = await admin.request.delete(`/api/lanflow/cash-branch-transfers/${transferId}`);
      expect(requested.ok(), await requested.text()).toBeTruthy();
      const requestResult = await requested.json() as { status: string; requestId: string };
      expect(requestResult.status).toBe("pending_approval");
      const duplicate = await admin.request.delete(`/api/lanflow/cash-branch-transfers/${transferId}`);
      expect(await duplicate.json()).toMatchObject({
        status: "pending_approval",
        requestId: requestResult.requestId,
      });
      expect((await superAdmin.request.get(`/api/lanflow/cash-branch-transfers/${transferId}`)).ok()).toBeTruthy();

      expect((await service.from("income_expense_approval_settings").upsert({
        id: true,
        applies_to: "both",
        cash_transfer_delete_requires_approval: false,
      })).error).toBeNull();
      expect(await (await admin.request.delete(`/api/lanflow/cash-branch-transfers/${transferId}`)).json()).toMatchObject({
        status: "pending_approval",
        requestId: requestResult.requestId,
      });
      expect((await superAdmin.request.get(`/api/lanflow/cash-branch-transfers/${transferId}`)).ok()).toBeTruthy();

      expect((await service.from("income_expense_approval_settings").upsert({
        id: true,
        applies_to: "both",
        cash_transfer_delete_requires_approval: true,
      })).error).toBeNull();
      const rejected = await superAdmin.request.post(
        `/api/lanflow/cash-branch-transfers/delete-requests/${requestResult.requestId}/decide`,
        { data: { decision: "rejected", comment: "เก็บรายการไว้ก่อน" } },
      );
      expect(rejected.ok(), await rejected.text()).toBeTruthy();
      const resubmitted = await admin.request.delete(`/api/lanflow/cash-branch-transfers/${transferId}`);
      const resubmittedResult = await resubmitted.json() as { status: string; requestId: string };
      expect(resubmittedResult.status).toBe("pending_approval");
      expect(resubmittedResult.requestId).not.toBe(requestResult.requestId);

      const concurrentDecisions = await Promise.all([
        superAdmin.request.post(
          `/api/lanflow/cash-branch-transfers/delete-requests/${resubmittedResult.requestId}/decide`,
          { data: { decision: "approved" } },
        ),
        superAdmin.request.post(
          `/api/lanflow/cash-branch-transfers/delete-requests/${resubmittedResult.requestId}/decide`,
          { data: { decision: "approved" } },
        ),
      ]);
      expect(concurrentDecisions.map((response) => response.status()).sort()).toEqual([200, 409]);
      expect((await superAdmin.request.get(`/api/lanflow/cash-branch-transfers/${transferId}`)).status()).toBe(404);
      const { data: history, error: historyError } = await service
        .from("cash_transfer_delete_requests")
        .select("id, transfer_id, request_status, source_location_name, target_location_name")
        .in("id", [requestResult.requestId, resubmittedResult.requestId])
        .order("created_at", { ascending: true });
      expect(historyError).toBeNull();
      expect(history).toEqual([
        expect.objectContaining({
          id: requestResult.requestId,
          transfer_id: null,
          request_status: "rejected",
          source_location_name: sourceLocation!.name,
        }),
        expect.objectContaining({
          id: resubmittedResult.requestId,
          transfer_id: null,
          request_status: "approved",
          source_location_name: sourceLocation!.name,
        }),
      ]);
      const queue = await superAdmin.request.get(`/api/lanflow/cash-branch-transfers?locationId=${targetLocationId}`);
      expect(((await queue.json()).transfers as Array<{ id: string }>).some((row) => row.id === transferId)).toBeFalsy();
      const sourceAfterDelete = await superAdmin.request.get(`/api/lanflow/income-expense/feed?locationId=${sourceLocationId}&from=${yesterday}&to=${yesterday}`);
      expect(((await sourceAfterDelete.json()).rows as Array<{ id: string }>).some((row) => row.id === `cash-transfer-expense:${transferId}`)).toBeFalsy();

      expect((await service.from("income_expense_approval_settings").upsert({
        id: true,
        applies_to: "both",
        cash_transfer_delete_requires_approval: false,
      })).error).toBeNull();
      const immediateId = await createTransfer(superAdmin.request, sourceLocationId, targetLocationId);
      expect((await superAdmin.request.post(`/api/lanflow/cash-branch-transfers/${immediateId}/receive`, {
        data: { received: { ...zeroCounts, banknote20: 1 } },
      })).ok()).toBeTruthy();
      expect(await (await admin.request.delete(`/api/lanflow/cash-branch-transfers/${immediateId}`)).json()).toMatchObject({
        status: "deleted",
      });

      expect((await service.from("income_expense_approval_settings").upsert({
        id: true,
        applies_to: "both",
        cash_transfer_delete_requires_approval: true,
      })).error).toBeNull();
      const pendingId = await createTransfer(superAdmin.request, sourceLocationId, targetLocationId);
      expect(await (await admin.request.delete(`/api/lanflow/cash-branch-transfers/${pendingId}`)).json()).toMatchObject({
        status: "deleted",
      });
    } finally {
      await service.from("income_expense_approval_settings").upsert({
        id: true,
        applies_to: "both",
        cash_transfer_delete_requires_approval: true,
      });
      await closeAll([superAdmin, admin]);
    }
  });

  test("database rejects a partial received denomination set", async ({ browser }) => {
    const superAdmin = await authContext(browser, "super_admin");
    const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    try {
      const superProfile = await profile(superAdmin.request);
      const transferId = await createTransfer(superAdmin.request, superProfile.locationIds[0], superProfile.locationIds[1]);
      const { error } = await service
        .from("money_transfer_cash_details")
        .update({
          cash_status: "received",
          received_coin_1_count: 0,
          received_by_user_id: superProfile.id,
          received_at: new Date().toISOString(),
        })
        .eq("transfer_id", transferId);
      expect(error?.code).toBe("23514");
      await deleteTransfer(superAdmin.request, transferId);
    } finally {
      await closeAll([superAdmin]);
    }
  });
});
