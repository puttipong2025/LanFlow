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
  return browser.newContext({ storageState: `playwright/.auth/${role}.json` });
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

async function closeAll(contexts: BrowserContext[]) {
  await Promise.all(contexts.map((context) => context.close()));
}

function cashDetail(transfer: { money_transfer_cash_details: unknown }) {
  const relation = transfer.money_transfer_cash_details;
  return (Array.isArray(relation) ? relation[0] : relation) as Record<string, unknown>;
}

test.describe.serial("Cash branch transfer contract @cash-transfer-contract", () => {
  test("user, admin, and super_admin create with server identity; location and state guards hold", async ({ browser }) => {
    expect(serviceRoleKey).toBeTruthy();
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

      const lockedEdit = await user.request.patch(`/api/lanflow/cash-branch-transfers/${guardedId}`, {
        data: { targetLocationId, sent: { ...zeroCounts, banknote20: 2 } },
      });
      expect(lockedEdit.status()).toBe(409);
      expect((await user.request.delete(`/api/lanflow/cash-branch-transfers/${guardedId}`)).status()).toBe(403);
      await deleteTransfer(superAdmin.request, guardedId);
    } finally {
      await closeAll(contexts);
    }
  });

  test("exact, shortage, overage, zero, duplicate receipt, and difference acceptance preserve counts", async ({ browser }) => {
    const superAdmin = await authContext(browser, "super_admin");
    const admin = await authContext(browser, "admin");
    try {
      const superProfile = await profile(superAdmin.request);
      const sourceLocationId = superProfile.locationIds[0];
      const targetLocationId = superProfile.locationIds[1];
      expect(targetLocationId).toBeTruthy();

      const cases = [
        { received20: 1, status: "received", difference: 0 },
        { received20: 0, status: "mismatched", difference: -20 },
        { received20: 2, status: "mismatched", difference: 20 },
      ] as const;

      for (const scenario of cases) {
        const transferId = await createTransfer(superAdmin.request, sourceLocationId, targetLocationId);
        const receipt = { received: { ...zeroCounts, banknote20: scenario.received20 } };
        const responses = scenario.status === "received"
          ? await Promise.all([
            superAdmin.request.post(`/api/lanflow/cash-branch-transfers/${transferId}/receive`, { data: receipt }),
            superAdmin.request.post(`/api/lanflow/cash-branch-transfers/${transferId}/receive`, { data: receipt }),
          ])
          : [await superAdmin.request.post(`/api/lanflow/cash-branch-transfers/${transferId}/receive`, { data: receipt })];

        expect(responses.map((response) => response.status()).sort()).toEqual(
          scenario.status === "received" ? [200, 409] : [200],
        );
        const detail = await superAdmin.request.get(`/api/lanflow/cash-branch-transfers/${transferId}`);
        const cash = cashDetail((await detail.json()).transfer);
        expect(cash.cash_status).toBe(scenario.status);
        expect(Number(cash.received_total)).toBe(scenario.received20 * 20);
        expect(Number(cash.difference_total)).toBe(scenario.difference);

        if (scenario.status === "mismatched") {
          expect((await admin.request.post(`/api/lanflow/cash-branch-transfers/${transferId}/accept-difference`, { data: { reason: "admin must fail" } })).status()).toBe(403);
          expect((await superAdmin.request.post(`/api/lanflow/cash-branch-transfers/${transferId}/accept-difference`, { data: { reason: "" } })).status()).toBe(400);
          const accepted = await superAdmin.request.post(`/api/lanflow/cash-branch-transfers/${transferId}/accept-difference`, { data: { reason: "ตรวจสอบและยอมรับผลต่าง" } });
          expect(accepted.ok(), await accepted.text()).toBeTruthy();
          const acceptedDetail = await superAdmin.request.get(`/api/lanflow/cash-branch-transfers/${transferId}`);
          const acceptedCash = cashDetail((await acceptedDetail.json()).transfer);
          expect(acceptedCash.cash_status).toBe("difference_accepted");
          expect(acceptedCash.received_banknote_20_count).toBe(scenario.received20);
        }

        await deleteTransfer(superAdmin.request, transferId);
      }
    } finally {
      await closeAll([superAdmin, admin]);
    }
  });

  test("feed uses sent and received dates/amounts and hard delete removes feed, queue, and details", async ({ browser }) => {
    const superAdmin = await authContext(browser, "super_admin");
    const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    try {
      const superProfile = await profile(superAdmin.request);
      const sourceLocationId = superProfile.locationIds[0];
      const targetLocationId = superProfile.locationIds[1];
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
      const targetRows = (await targetFeed.json()).rows as Array<{ id: string; cost: number; txDate: string; relationLabel: string }>;
      expect(targetRows).toContainEqual(expect.objectContaining({
        id: `cash-transfer-income:${transferId}`,
        cost: 20,
        txDate: today,
        relationLabel: "ยอดไม่ตรง -฿20",
      }));

      await deleteTransfer(superAdmin.request, transferId);
      expect((await superAdmin.request.get(`/api/lanflow/cash-branch-transfers/${transferId}`)).status()).toBe(404);
      const queue = await superAdmin.request.get(`/api/lanflow/cash-branch-transfers?locationId=${targetLocationId}`);
      expect(((await queue.json()).transfers as Array<{ id: string }>).some((row) => row.id === transferId)).toBeFalsy();
      const sourceAfterDelete = await superAdmin.request.get(`/api/lanflow/income-expense/feed?locationId=${sourceLocationId}&from=${yesterday}&to=${yesterday}`);
      expect(((await sourceAfterDelete.json()).rows as Array<{ id: string }>).some((row) => row.id === `cash-transfer-expense:${transferId}`)).toBeFalsy();
    } finally {
      await closeAll([superAdmin]);
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
