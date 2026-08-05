import { expect, test, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { bangkokDateString } from "../src/lib/bangkok-date";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function adjacentDate(dayOffset: number) {
  const date = new Date(`${bangkokDateString()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return date.toISOString().slice(0, 10);
}

function incomePayload(locationId: string, txDate: string) {
  const clientTempId = crypto.randomUUID();
  const now = new Date().toISOString();
  return {
    operation: "create",
    expectedRevisionNo: 0,
    clientTempId,
    idempotencyKey: `date-approval:${clientTempId}`,
    locationId,
    recordStatus: "active",
    localBillNo: `DATE-${clientTempId.slice(0, 8)}`,
    txDate,
    type: "income",
    title: `DATE-APPROVAL-${clientTempId}`,
    cost: 100,
    billOption: "รายรับ",
    unit: null,
    price: null,
    clientRecordedAt: now,
    clientCreatedAt: now,
  };
}

async function profile(context: BrowserContext) {
  const response = await context.request.get("/api/auth/me");
  expect(response.ok()).toBeTruthy();
  return (await response.json() as { profile: { locationIds: string[] } }).profile;
}

test.describe.serial("non-current income/expense approval gate", () => {
  test("old direct-sync client cannot create a past row and approval preserves txDate", async ({ browser }) => {
    test.skip(!serviceRoleKey, "Supabase service role key is required");
    const manager = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
    const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const locationId = (await profile(manager)).locationIds[0];
    const txDate = adjacentDate(-1);
    const payload = incomePayload(locationId, txDate);
    const originalSettings = await db.from("income_expense_approval_settings").select("*").eq("id", true).single();
    expect(originalSettings.error).toBeNull();

    let requestId: string | null = null;
    const keywordId = crypto.randomUUID();
    try {
      expect((await db.from("income_expense_approval_keywords").insert({
        id: keywordId,
        keyword: payload.title,
        match_mode: "exact",
        applies_to: "both",
        is_active: true,
      })).error).toBeNull();
      expect((await db.from("income_expense_approval_settings").update({
        non_current_date_requires_approval: true,
        approval_min_amount: 50,
      }).eq("id", true)).error).toBeNull();

      const direct = await manager.request.post("/api/lanflow/income-expense", { data: payload });
      expect(direct.status()).toBe(202);
      const body = await direct.json() as { status: string; requestId: string; matchedReasons: string[] };
      expect(body.status).toBe("pending_approval");
      expect(body.matchedReasons).toEqual(["keyword", "amount_threshold", "non_current_date"]);
      requestId = body.requestId;

      const beforeDecision = await db.from("income_expense").select("id").eq("client_temp_id", payload.clientTempId);
      expect(beforeDecision.error).toBeNull();
      expect(beforeDecision.data).toHaveLength(0);

      expect((await db.from("income_expense_approval_settings").update({
        non_current_date_requires_approval: false,
      }).eq("id", true)).error).toBeNull();
      const stillPending = await db.from("income_expense_approval_requests").select("request_status,matched_reasons").eq("id", requestId).single();
      expect(stillPending.data?.request_status).toBe("pending");
      expect(stillPending.data?.matched_reasons).toContain("non_current_date");

      const decision = await manager.request.post(`/api/lanflow/income-expense/approval-requests/${requestId}/decide`, {
        data: { decision: "approved", comment: "boundary contract" },
      });
      expect(decision.ok()).toBeTruthy();

      const created = await db.from("income_expense").select("tx_date").eq("client_temp_id", payload.clientTempId).single();
      expect(created.error).toBeNull();
      expect(created.data?.tx_date).toBe(txDate);
      const request = await db.from("income_expense_approval_requests").select("request_status").eq("id", requestId).single();
      expect(request.data?.request_status).toBe("approved");
    } finally {
      if (requestId) await db.from("income_expense_approval_requests").delete().eq("id", requestId);
      await db.from("income_expense").delete().eq("client_temp_id", payload.clientTempId);
      await db.from("income_expense_approval_keywords").delete().eq("id", keywordId);
      if (originalSettings.data) {
        await db.from("income_expense_approval_settings").update({
          applies_to: originalSettings.data.applies_to,
          approval_min_amount: originalSettings.data.approval_min_amount,
          cash_transfer_delete_requires_approval: originalSettings.data.cash_transfer_delete_requires_approval,
          non_current_date_requires_approval: originalSettings.data.non_current_date_requires_approval,
        }).eq("id", true);
      }
      await manager.close();
    }
  });

  test("update uses the proposed date and delete uses the persisted date", async ({ browser }) => {
    test.skip(!serviceRoleKey, "Supabase service role key is required");
    const manager = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
    const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const locationId = (await profile(manager)).locationIds[0];
    const originalSettings = await db.from("income_expense_approval_settings").select("*").eq("id", true).single();
    expect(originalSettings.error).toBeNull();
    const basePayload = incomePayload(locationId, bangkokDateString());
    let updateRequestId: string | null = null;
    let deleteRequestId: string | null = null;

    try {
      expect((await db.from("income_expense_approval_settings").update({
        applies_to: "both",
        approval_min_amount: null,
        cash_transfer_delete_requires_approval: false,
        non_current_date_requires_approval: false,
      }).eq("id", true)).error).toBeNull();

      const createResponse = await manager.request.post("/api/lanflow/income-expense", { data: basePayload });
      expect(createResponse.ok()).toBeTruthy();
      const created = await createResponse.json() as { revisionNo: number };

      expect((await db.from("income_expense_approval_settings").update({
        non_current_date_requires_approval: true,
      }).eq("id", true)).error).toBeNull();

      const pastDate = adjacentDate(-1);
      const updatePayload = {
        ...basePayload,
        operation: "update",
        expectedRevisionNo: created.revisionNo,
        idempotencyKey: `date-update:${basePayload.clientTempId}:${created.revisionNo}`,
        txDate: pastDate,
      };
      const updateResponse = await manager.request.post("/api/lanflow/income-expense", { data: updatePayload });
      expect(updateResponse.status()).toBe(202);
      const pendingUpdate = await updateResponse.json() as { requestId: string; matchedReasons: string[] };
      expect(pendingUpdate.matchedReasons).toEqual(["non_current_date"]);
      updateRequestId = pendingUpdate.requestId;

      const unchanged = await db.from("income_expense").select("tx_date,revision_no").eq("client_temp_id", basePayload.clientTempId).single();
      expect(unchanged.data?.tx_date).toBe(bangkokDateString());
      expect(unchanged.data?.revision_no).toBe(created.revisionNo);

      const approveUpdate = await manager.request.post(`/api/lanflow/income-expense/approval-requests/${updateRequestId}/decide`, {
        data: { decision: "approved", comment: "proposed date contract" },
      });
      expect(approveUpdate.ok()).toBeTruthy();
      const updated = await db.from("income_expense").select("tx_date,revision_no").eq("client_temp_id", basePayload.clientTempId).single();
      expect(updated.data?.tx_date).toBe(pastDate);

      const deletePayload = {
        ...basePayload,
        operation: "delete",
        recordStatus: "deleted",
        expectedRevisionNo: updated.data!.revision_no,
        idempotencyKey: `date-delete:${basePayload.clientTempId}:${updated.data!.revision_no}`,
        txDate: bangkokDateString(),
      };
      const deleteResponse = await manager.request.post("/api/lanflow/income-expense", { data: deletePayload });
      expect(deleteResponse.status()).toBe(202);
      const pendingDelete = await deleteResponse.json() as { requestId: string; matchedReasons: string[] };
      expect(pendingDelete.matchedReasons).toEqual(["non_current_date"]);
      deleteRequestId = pendingDelete.requestId;

      const rejectDelete = await manager.request.post(`/api/lanflow/income-expense/approval-requests/${deleteRequestId}/decide`, {
        data: { decision: "rejected", comment: "persisted date contract" },
      });
      expect(rejectDelete.ok()).toBeTruthy();
      const retained = await db.from("income_expense").select("record_status,tx_date").eq("client_temp_id", basePayload.clientTempId).single();
      expect(retained.data).toMatchObject({ record_status: "active", tx_date: pastDate });
    } finally {
      if (updateRequestId || deleteRequestId) {
        await db.from("income_expense_approval_requests").delete().in(
          "id",
          [updateRequestId, deleteRequestId].filter((id): id is string => Boolean(id))
        );
      }
      await db.from("income_expense").delete().eq("client_temp_id", basePayload.clientTempId);
      if (originalSettings.data) {
        await db.from("income_expense_approval_settings").update({
          applies_to: originalSettings.data.applies_to,
          approval_min_amount: originalSettings.data.approval_min_amount,
          cash_transfer_delete_requires_approval: originalSettings.data.cash_transfer_delete_requires_approval,
          non_current_date_requires_approval: originalSettings.data.non_current_date_requires_approval,
        }).eq("id", true);
      }
      await manager.close();
    }
  });
});
