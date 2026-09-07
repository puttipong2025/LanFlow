import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

test("the branch requester and system manager see a pending sale update in latest and search feeds", async ({ browser }) => {
  test.skip(!serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY is required");
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const requester = await browser.newContext({ storageState: "playwright/.auth/admin.json" });
  const coworker = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
  const requesterMe = await requester.request.get("/api/auth/me");
  const coworkerMe = await coworker.request.get("/api/auth/me");
  expect(requesterMe.ok()).toBeTruthy();
  expect(coworkerMe.ok()).toBeTruthy();
  const requesterProfile = (await requesterMe.json() as { profile: { id: string; name: string; phone: string } }).profile;
  const coworkerProfile = (await coworkerMe.json() as { profile: { id: string } }).profile;
  const locationId = crypto.randomUUID();
  const parentId = crypto.randomUUID();
  const clientTempId = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  const referenceNo = `PENDING-${clientTempId.slice(0, 8)}`;
  const now = new Date().toISOString();

  try {
    expect((await service.from("locations").insert({
      id: locationId,
      name: `Pending feed ${locationId.slice(0, 8)}`,
      code: `PF${locationId.slice(0, 6)}`,
      is_active: true,
    })).error).toBeNull();
    expect((await service.from("user_locations").insert([
      { user_id: requesterProfile.id, location_id: locationId, is_primary: false },
      { user_id: coworkerProfile.id, location_id: locationId, is_primary: false },
    ])).error).toBeNull();
    expect((await service.from("income_expense").insert({
      id: parentId,
      client_temp_id: clientTempId,
      local_bill_no: `LOCAL-${clientTempId.slice(0, 8)}`,
      server_bill_no: referenceNo,
      idempotency_key: `create:${clientTempId}:0`,
      sync_status: "synced",
      record_status: "active",
      location_id: locationId,
      type: "income",
      number: referenceNo,
      tx_date: "2026-09-07",
      title: "บิลขาย — 1 รายการ",
      cost: 25,
      bill_option: "บิลขาย",
      client_recorded_at: now,
      client_created_at: now,
      server_received_at: now,
      revision_no: 1,
      created_by_user_id: requesterProfile.id,
      created_by_name: requesterProfile.name,
      created_by_phone: requesterProfile.phone,
    })).error).toBeNull();
    expect((await service.from("income_expense_approval_requests").insert({
      id: requestId,
      request_status: "pending",
      requested_operation: "update",
      request_idempotency_key: `update:${clientTempId}:1`,
      requested_payload: {
        operation: "update",
        expectedRevisionNo: 1,
        clientTempId,
        idempotencyKey: `update:${clientTempId}:1`,
        locationId,
        billOption: "บิลขาย",
      },
      source_income_expense_id: parentId,
      matched_reasons: ["amount_threshold"],
      location_id: locationId,
      tx_type: "income",
      title: "บิลขาย — 1 รายการ",
      cost: 50,
      requested_by_user_id: requesterProfile.id,
      requested_by_name: requesterProfile.name,
      requested_by_phone: requesterProfile.phone,
    })).error).toBeNull();

    for (const context of [requester, coworker]) {
      for (const search of ["", referenceNo]) {
        const params = new URLSearchParams({ locationId, mode: "latest", search });
        const response = await context.request.get(`/api/lanflow/income-expense/feed?${params}`);
        const responseText = await response.text();
        expect(response.ok(), responseText).toBeTruthy();
        const body = JSON.parse(responseText) as { rows: Array<Record<string, unknown>> };
        const row = body.rows.find((candidate) => candidate.id === parentId);
        expect(row).toMatchObject({
          approvalPending: true,
          approvalRequestId: requestId,
          approvalOperation: "update",
          approvalReasons: ["amount_threshold"],
        });
      }
    }

    expect((await service.from("income_expense_approval_requests").update({
      request_status: "rejected",
      decided_at: new Date().toISOString(),
    }).eq("id", requestId)).error).toBeNull();
    const cleared = await coworker.request.get(
      `/api/lanflow/income-expense/feed?${new URLSearchParams({ locationId, mode: "latest", search: referenceNo })}`,
    );
    expect(cleared.ok()).toBeTruthy();
    const clearedBody = await cleared.json() as { rows: Array<Record<string, unknown>> };
    expect(clearedBody.rows.find((candidate) => candidate.id === parentId)).not.toHaveProperty("approvalPending", true);
  } finally {
    await service.from("income_expense_approval_requests").delete().eq("id", requestId);
    await service.from("income_expense").delete().eq("id", parentId);
    await service.from("user_locations").delete().eq("location_id", locationId);
    await service.from("locations").delete().eq("id", locationId);
    await requester.close();
    await coworker.close();
  }
});
