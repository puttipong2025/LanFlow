import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

test.use({ storageState: "playwright/.auth/super_admin.json" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ?? "";

test("creates, replays, updates, and deletes one sale parent atomically", async () => {
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
  const profile = await service.from("profiles").select("name,phone").eq("id", userId).single();
  const userLocation = await service.from("user_locations").select("location_id").eq("user_id", userId).limit(1).single();
  expect(profile.error).toBeNull();
  expect(userLocation.error).toBeNull();

  const saleItems = await service
    .from("income_sale_items")
    .select("id,name,stock_product_id")
    .eq("is_active", true)
    .not("stock_product_id", "is", null)
    .limit(2);
  expect(saleItems.error).toBeNull();
  expect(saleItems.data?.length).toBeGreaterThan(0);

  const first = saleItems.data![0];
  const second = first;
  const locationId = userLocation.data!.location_id as string;
  const clientTempId = crypto.randomUUID();
  const rejectedClientId = crypto.randomUUID();
  const tooManyClientId = crypto.randomUUID();
  const noStockClientId = crypto.randomUUID();
  const stockEntryIds = [...new Set([first.stock_product_id, second.stock_product_id])]
    .map(() => crypto.randomUUID());
  const approvalKeywordId = crypto.randomUUID();
  let approvalRequestId: string | null = null;
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const saleLines = [
    { incomeSaleItemId: first.id, quantity: 2, unitPrice: 10.125, sequenceNo: 99 },
    { incomeSaleItemId: second.id, quantity: 3, unitPrice: 5.25, sequenceNo: 99 },
  ];
  const payload = {
    operation: "create",
    expectedRevisionNo: 0,
    clientTempId,
    idempotencyKey: `create:${clientTempId}:0`,
    locationId,
    recordStatus: "active",
    localBillNo: `SALE-${clientTempId.slice(0, 8)}`,
    txDate: today,
    type: "income",
    title: "client title is ignored",
    cost: 1,
    billOption: "บิลขาย",
    saleLines,
    clientRecordedAt: now,
    clientCreatedAt: now,
    createdByUserId: userId,
    createdByName: profile.data!.name,
    createdByPhone: profile.data!.phone,
  };

  try {
    const products = [...new Set([first.stock_product_id, second.stock_product_id])];
    const stockSeed = await service.from("stock_entries").insert(products.map((productId, index) => ({
      id: stockEntryIds[index],
      server_bill_no: `TEST-STOCK-${stockEntryIds[index].slice(0, 8)}`,
      tx_date: today,
      product_id: productId,
      product_name: `สินค้าทดสอบ ${index + 1}`,
      quantity_delta: 100,
      amount: 0,
      location_id: locationId,
      tx_type: "receive",
      record_status: "active",
      created_by_user_id: userId,
      created_by_name: profile.data!.name,
      created_by_phone: profile.data!.phone,
    })));
    expect(stockSeed.error).toBeNull();

    const invalidDecimals = await authenticated.rpc("sync_income_expense", {
      payload: { ...payload, clientTempId: rejectedClientId, idempotencyKey: `create:${rejectedClientId}:0` },
    });
    expect(invalidDecimals.error).toBeNull();
    expect(invalidDecimals.data).toMatchObject({ status: "failed" });

    const validLines = saleLines.map((line, index) => ({
      ...line,
      unitPrice: index === 0 ? 10.13 : 5.25,
    }));
    const tooManyLines = await authenticated.rpc("sync_income_expense", {
      payload: {
        ...payload,
        clientTempId: tooManyClientId,
        idempotencyKey: `create:${tooManyClientId}:0`,
        saleLines: Array.from({ length: 51 }, (_, index) => ({
          incomeSaleItemId: first.id,
          quantity: 1,
          unitPrice: 1,
          sequenceNo: index + 1,
        })),
      },
    });
    expect(tooManyLines.error).toBeNull();
    expect(tooManyLines.data).toMatchObject({ status: "failed" });

    const insufficientStock = await authenticated.rpc("sync_income_expense", {
      payload: {
        ...payload,
        clientTempId: noStockClientId,
        idempotencyKey: `create:${noStockClientId}:0`,
        saleLines: [{
          incomeSaleItemId: first.id,
          quantity: 101,
          unitPrice: 1,
          sequenceNo: 1,
        }],
      },
    });
    expect(insufficientStock.error).toBeNull();
    expect(insufficientStock.data).toMatchObject({
      status: "failed",
      errorMessage: "สต็อกสินค้าไม่พอสำหรับบิลขาย",
    });

    const validPayload = { ...payload, saleLines: validLines };
    const created = await authenticated.rpc("sync_income_expense", { payload: validPayload });
    expect(created.error).toBeNull();
    expect(created.data).toMatchObject({
      status: "synced",
      title: "บิลขาย — 2 รายการ",
      cost: 36.01,
      saleLineCount: 2,
    });
    expect((created.data as any).saleLines.map((line: any) => line.sequenceNo)).toEqual([1, 2]);
    expect((created.data as any).saleLines.map((line: any) => Number(line.lineTotal))).toEqual([20.26, 15.75]);

    const replay = await authenticated.rpc("sync_income_expense", { payload: validPayload });
    expect(replay.error).toBeNull();
    expect(replay.data).toMatchObject({ status: "synced", saleLineCount: 2 });
    const parentCount = await service.from("income_expense").select("id", { count: "exact", head: true }).eq("client_temp_id", clientTempId);
    expect(parentCount.count).toBe(1);

    const parent = await service.from("income_expense").select("id,revision_no").eq("client_temp_id", clientTempId).single();
    expect(parent.error).toBeNull();
    const children = await service
      .from("income_expense_sale_lines")
      .select("sequence_no,quantity,unit_price,line_total")
      .eq("income_expense_id", parent.data!.id)
      .order("sequence_no");
    expect(children.data).toHaveLength(2);
    const movements = await service
      .from("acid_stock_movements")
      .select("source_id,source_line_id,quantity_delta")
      .eq("source_type", "income_sale")
      .eq("source_id", parent.data!.id);
    expect(movements.error).toBeNull();
    expect(movements.data).toHaveLength(2);
    expect(
      movements.data!
        .map((movement) => Number(movement.quantity_delta))
        .sort((left, right) => left - right)
    ).toEqual([-3, -2]);

    const updatedPayload = {
      ...validPayload,
      operation: "update",
      expectedRevisionNo: parent.data!.revision_no,
      idempotencyKey: `update:${clientTempId}:${parent.data!.revision_no}`,
      saleLines: [{ incomeSaleItemId: first.id, quantity: 4, unitPrice: 10.13, sequenceNo: 1 }],
    };
    const updated = await authenticated.rpc("sync_income_expense", { payload: updatedPayload });
    expect(updated.error).toBeNull();
    expect(updated.data).toMatchObject({ status: "synced", cost: 40.52, saleLineCount: 1 });

    const keyword = await service.from("income_expense_approval_keywords").insert({
      id: approvalKeywordId,
      keyword: first.name,
      match_mode: "exact",
      applies_to: "income",
      is_active: true,
      created_by_user_id: userId,
      created_by_name: profile.data!.name,
      created_by_phone: profile.data!.phone,
    });
    expect(keyword.error).toBeNull();
    const deletePayload = {
      ...updatedPayload,
      operation: "delete",
      expectedRevisionNo: (updated.data as any).revisionNo,
      idempotencyKey: `delete:${clientTempId}:${(updated.data as any).revisionNo}`,
      recordStatus: "deleted",
      deletedByName: profile.data!.name,
      deletedByPhone: profile.data!.phone,
    };

    const blockedDelete = await authenticated.rpc("sync_income_expense", {
      payload: deletePayload,
    });
    expect(blockedDelete.error).toBeNull();
    expect(blockedDelete.data).toMatchObject({ status: "conflict" });

    const requestedDelete = await authenticated.rpc("create_income_expense_approval_request", {
      payload: deletePayload,
    });
    expect(requestedDelete.error).toBeNull();
    expect(requestedDelete.data).toMatchObject({ status: "pending" });
    approvalRequestId = (requestedDelete.data as any).requestId;
    const storedRequest = await service
      .from("income_expense_approval_requests")
      .select("requested_payload")
      .eq("id", approvalRequestId)
      .single();
    expect(storedRequest.error).toBeNull();
    expect((storedRequest.data!.requested_payload as any).saleLines).toHaveLength(1);
    expect((storedRequest.data!.requested_payload as any).saleLines[0]).toMatchObject({
      title: first.name,
      quantity: 4,
      unitPrice: 10.13,
      lineTotal: 40.52,
    });
    const stillActive = await service.from("income_expense").select("record_status").eq("client_temp_id", clientTempId).single();
    expect(stillActive.data?.record_status).toBe("active");

    const approvedDelete = await authenticated.rpc("decide_income_expense_approval_request", {
      p_request_id: approvalRequestId,
      p_decision: "approved",
      p_comment: null,
    });
    expect(approvedDelete.error).toBeNull();
    expect(approvedDelete.data).toMatchObject({ status: "approved" });
    const deletedParent = await service.from("income_expense").select("record_status").eq("client_temp_id", clientTempId).single();
    expect(deletedParent.data?.record_status).toBe("deleted");
  } finally {
    await service.from("income_expense").delete().in("client_temp_id", [
      clientTempId,
      rejectedClientId,
      tooManyClientId,
      noStockClientId,
    ]);
    if (approvalRequestId) {
      await service.from("income_expense_approval_requests").delete().eq("id", approvalRequestId);
    }
    await service.from("income_expense_approval_keywords").delete().eq("id", approvalKeywordId);
    await service.from("stock_entries").delete().in("id", stockEntryIds);
  }
});
