import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { bangkokDateString } from "../../src/lib/bangkok-date";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ?? "";

test("sale create bypasses approval while competing changes share one pending request", async () => {
  test.skip(!serviceRoleKey || !publishableKey, "Supabase test keys are required");
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const authenticated = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rawPhone = process.env.TEST_PHONE ?? "0800000000";
  const phone = rawPhone.startsWith("0") ? `+66${rawPhone.slice(1)}` : rawPhone;
  const signIn = await authenticated.auth.signInWithPassword({
    phone,
    password: process.env.TEST_PASSWORD ?? "password123",
  });
  expect(signIn.error).toBeNull();

  const userId = signIn.data.user!.id;
  const [profile, userLocation, saleItem, originalSettings] = await Promise.all([
    service.from("profiles").select("name,phone").eq("id", userId).single(),
    service.from("user_locations").select("location_id").eq("user_id", userId).limit(1).single(),
    service.from("income_sale_items").select("id,name,stock_product_id").eq("is_active", true)
      .not("stock_product_id", "is", null).limit(1).single(),
    service.from("income_expense_approval_settings").select("*").eq("id", true).maybeSingle(),
  ]);
  expect(profile.error).toBeNull();
  expect(userLocation.error).toBeNull();
  expect(saleItem.error).toBeNull();
  expect(originalSettings.error).toBeNull();

  const locationId = userLocation.data!.location_id as string;
  const clientTempId = crypto.randomUUID();
  const parentId = crypto.randomUUID();
  const lineId = crypto.randomUUID();
  const stockEntryId = crypto.randomUUID();
  const today = bangkokDateString();
  const now = new Date().toISOString();
  const basePayload = {
    operation: "update",
    expectedRevisionNo: 1,
    clientTempId,
    idempotencyKey: `update:${clientTempId}:1`,
    locationId,
    recordStatus: "active",
    localBillNo: `SALE-${clientTempId.slice(0, 8)}`,
    serverBillNo: `SERVER-${clientTempId.slice(0, 8)}`,
    txDate: today,
    type: "income",
    title: "client title is ignored",
    cost: 40,
    billOption: "บิลขาย",
    saleLines: [{
      incomeSaleItemId: saleItem.data!.id,
      quantity: 2,
      unitPrice: 20,
      sequenceNo: 1,
    }],
    clientRecordedAt: now,
    clientCreatedAt: now,
    createdByUserId: userId,
    createdByName: profile.data!.name,
    createdByPhone: profile.data!.phone,
  };

  try {
    expect((await service.from("income_expense_approval_settings").upsert({
      id: true,
      applies_to: "both",
      approval_min_amount: 1,
      non_current_date_requires_approval: false,
    }, { onConflict: "id" })).error).toBeNull();
    expect((await service.from("stock_entries").insert({
      id: stockEntryId,
      server_bill_no: `TEST-STOCK-${stockEntryId.slice(0, 8)}`,
      tx_date: today,
      product_id: saleItem.data!.stock_product_id,
      product_name: saleItem.data!.name,
      quantity_delta: 100,
      amount: 0,
      location_id: locationId,
      tx_type: "receive",
      record_status: "active",
      created_by_user_id: userId,
      created_by_name: profile.data!.name,
      created_by_phone: profile.data!.phone,
    })).error).toBeNull();
    expect((await service.from("income_expense").insert({
      id: parentId,
      client_temp_id: clientTempId,
      local_bill_no: basePayload.localBillNo,
      server_bill_no: basePayload.serverBillNo,
      idempotency_key: `create:${clientTempId}:0`,
      sync_status: "synced",
      record_status: "active",
      location_id: locationId,
      type: "income",
      number: basePayload.serverBillNo,
      tx_date: today,
      title: "บิลขาย — 1 รายการ",
      cost: 10,
      bill_option: "บิลขาย",
      client_recorded_at: now,
      client_created_at: now,
      server_received_at: now,
      revision_no: 1,
      created_by_user_id: userId,
      created_by_name: profile.data!.name,
      created_by_phone: profile.data!.phone,
    })).error).toBeNull();
    expect((await service.from("income_expense_sale_lines").insert({
      id: lineId,
      income_expense_id: parentId,
      income_sale_item_id: saleItem.data!.id,
      stock_product_id: saleItem.data!.stock_product_id,
      title: saleItem.data!.name,
      quantity: 1,
      unit_price: 10,
      line_total: 10,
      sequence_no: 1,
    })).error).toBeNull();

    const createCheck = await authenticated.rpc("create_income_expense_approval_request", {
      payload: {
        ...basePayload,
        operation: "create",
        expectedRevisionNo: 0,
        clientTempId: crypto.randomUUID(),
        idempotencyKey: `create:${crypto.randomUUID()}:0`,
      },
    });
    expect(createCheck.error).toBeNull();
    expect(createCheck.data, JSON.stringify(createCheck.data)).toMatchObject({ status: "no_approval" });

    const deletePayload = {
      ...basePayload,
      operation: "delete",
      recordStatus: "deleted",
      idempotencyKey: `delete:${clientTempId}:1`,
    };

    const concurrent = await Promise.all([
      authenticated.rpc("sync_income_expense", { payload: basePayload }),
      authenticated.rpc("sync_income_expense", { payload: deletePayload }),
    ]);
    expect(concurrent.every((result) => result.error === null)).toBe(true);
    expect(
      concurrent.map((result) => (result.data as any).status),
      JSON.stringify(concurrent.map((result) => result.data)),
    ).toEqual([
      "pending_approval",
      "pending_approval",
    ]);
    const requestIds = concurrent.map((result) => (result.data as any).requestId);
    expect(new Set(requestIds).size).toBe(1);

    const rejected = await authenticated.rpc("decide_income_expense_approval_request", {
      p_request_id: requestIds[0],
      p_decision: "rejected",
      p_comment: "contract rejection",
    });
    expect(rejected.error).toBeNull();
    expect(rejected.data).toMatchObject({ status: "rejected" });
    const unchanged = await service.from("income_expense").select("revision_no,cost").eq("id", parentId).single();
    expect(unchanged.data).toMatchObject({ revision_no: 1, cost: 10 });

    const retried = await authenticated.rpc("sync_income_expense", { payload: basePayload });
    expect(retried.error).toBeNull();
    expect(retried.data).toMatchObject({ status: "pending_approval" });
    expect((retried.data as any).requestId).not.toBe(requestIds[0]);
    const approved = await authenticated.rpc("decide_income_expense_approval_request", {
      p_request_id: (retried.data as any).requestId,
      p_decision: "approved",
      p_comment: null,
    });
    expect(approved.error).toBeNull();
    expect(approved.data).toMatchObject({ status: "approved", incomeExpenseId: parentId });
    const changed = await service.from("income_expense").select("revision_no,cost").eq("id", parentId).single();
    expect(changed.data).toMatchObject({ revision_no: 2, cost: 40 });
    const movements = await service.from("acid_stock_movements")
      .select("quantity_delta").eq("source_type", "income_sale").eq("source_id", parentId);
    expect(movements.error).toBeNull();
    expect(movements.data).toEqual([{ quantity_delta: -2 }]);

    const replay = await authenticated.rpc("sync_income_expense", { payload: basePayload });
    expect(replay.error).toBeNull();
    expect(replay.data).toMatchObject({ status: "synced", id: parentId });
  } finally {
    await service.from("income_expense_approval_requests").delete().eq("source_income_expense_id", parentId);
    await service.from("acid_stock_movements").delete().eq("source_id", parentId);
    await service.from("income_expense").delete().eq("id", parentId);
    await service.from("stock_entries").delete().eq("id", stockEntryId);
    if (originalSettings.data) {
      await service.from("income_expense_approval_settings").upsert(originalSettings.data, { onConflict: "id" });
    }
  }
});
