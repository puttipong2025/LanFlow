import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

test.use({ storageState: "playwright/.auth/super_admin.json" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ?? "";

test("persists sale grouping atomically and shrinks the group after deletion", async () => {
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
  const profileResult = await service
    .from("profiles")
    .select("name,phone")
    .eq("id", userId)
    .single();
  expect(profileResult.error).toBeNull();
  const locationResult = await service
    .from("user_locations")
    .select("location_id")
    .eq("user_id", userId)
    .limit(1)
    .single();
  expect(locationResult.error).toBeNull();
  const me = {
    profile: {
      id: userId,
      name: profileResult.data!.name as string,
      phone: profileResult.data!.phone as string,
    },
  };
  const locationId = locationResult.data!.location_id as string;
  const otherLocationResult = await service
    .from("locations")
    .select("id")
    .neq("id", locationId)
    .limit(1)
    .maybeSingle();
  expect(otherLocationResult.error).toBeNull();
  const saleItemResult = await service
    .from("income_sale_items")
    .select("id,stock_product_id")
    .eq("is_active", true)
    .not("stock_product_id", "is", null)
    .limit(1)
    .single();
  expect(saleItemResult.error).toBeNull();

  const groupId = crypto.randomUUID();
  const stockEntryId = crypto.randomUUID();
  const clientIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const rejectedClientIds = [crypto.randomUUID(), crypto.randomUUID()];
  const approvalKeywordId = crypto.randomUUID();
  let approvalRequestId: string | null = null;
  const productId = saleItemResult.data!.stock_product_id as string;
  const today = new Date().toISOString().slice(0, 10);

  const basePayload = (index: number) => ({
    operation: "create",
    expectedRevisionNo: 0,
    clientTempId: clientIds[index],
    idempotencyKey: `create:${clientIds[index]}:0`,
    locationId,
    recordStatus: "active",
    localBillNo: `SALE-GROUP-${clientIds[index].slice(0, 8)}`,
    txDate: today,
    type: "income",
    title: `สินค้าทดสอบกลุ่ม ${index + 1}`,
    cost: 10,
    billOption: "บิลขาย",
    unit: "1",
    price: 10,
    incomeSaleItemId: saleItemResult.data!.id,
    stockProductId: productId,
    stockQuantity: 1,
    saleGroupId: groupId,
    saleLineOrder: index + 1,
    saleExpectedLines: 2,
    clientRecordedAt: new Date().toISOString(),
    clientCreatedAt: new Date().toISOString(),
    createdByUserId: me.profile.id,
    createdByName: me.profile.name,
    createdByPhone: me.profile.phone,
  });

  try {
    const stockSeed = await service.from("stock_entries").insert({
      id: stockEntryId,
      server_bill_no: `TEST-STOCK-${stockEntryId.slice(0, 8)}`,
      tx_date: today,
      product_id: productId,
      product_name: "สินค้าทดสอบ",
      quantity_delta: 10,
      amount: 0,
      location_id: locationId,
      tx_type: "receive",
      record_status: "active",
      created_by_user_id: me.profile.id,
      created_by_name: me.profile.name,
      created_by_phone: me.profile.phone,
    });
    expect(stockSeed.error).toBeNull();

    const invalidMetadata = await authenticated.rpc("sync_income_expense", {
      payload: {
        ...basePayload(0),
        clientTempId: rejectedClientIds[0],
        idempotencyKey: `create:${rejectedClientIds[0]}:0`,
        localBillNo: `INVALID-${rejectedClientIds[0].slice(0, 8)}`,
        saleGroupId: null,
      },
    });
    expect(invalidMetadata.error).toBeNull();
    expect(invalidMetadata.data).toMatchObject({ status: "failed" });

    const insufficientStock = await authenticated.rpc("sync_income_expense", {
      payload: {
        ...basePayload(0),
        clientTempId: rejectedClientIds[1],
        idempotencyKey: `create:${rejectedClientIds[1]}:0`,
        localBillNo: `NO-STOCK-${rejectedClientIds[1].slice(0, 8)}`,
        saleGroupId: crypto.randomUUID(),
        saleLineOrder: 1,
        saleExpectedLines: 1,
        unit: "100",
        stockQuantity: 100,
        cost: 1_000,
      },
    });
    expect(insufficientStock.error).toBeNull();
    expect(insufficientStock.data).toMatchObject({
      status: "failed",
      errorMessage: "สต็อกสินค้าไม่พอสำหรับบิลขาย",
    });

    for (let index = 0; index < 2; index += 1) {
      const response = await authenticated.rpc("sync_income_expense", {
        payload: basePayload(index),
      });
      expect(response.error).toBeNull();
      expect((response.data as { status: string }).status).toBe("synced");
    }
    const replay = await authenticated.rpc("sync_income_expense", {
      payload: basePayload(0),
    });
    expect(replay.error).toBeNull();
    expect(replay.data).toMatchObject({ status: "synced" });
    const replayCount = await service
      .from("income_expense")
      .select("id", { count: "exact", head: true })
      .eq("client_temp_id", clientIds[0]);
    expect(replayCount.error).toBeNull();
    expect(replayCount.count).toBe(1);

    const stored = await service
      .from("income_expense")
      .select("client_temp_id,sale_group_id,sale_line_order,sale_expected_lines,revision_no")
      .in("client_temp_id", clientIds)
      .order("sale_line_order");
    expect(stored.error).toBeNull();
    expect(stored.data).toMatchObject([
      { client_temp_id: clientIds[0], sale_group_id: groupId, sale_line_order: 1, sale_expected_lines: 2 },
      { client_temp_id: clientIds[1], sale_group_id: groupId, sale_line_order: 2, sale_expected_lines: 2 },
    ]);

    if (otherLocationResult.data?.id) {
      const crossLocationUpdate = await authenticated.rpc("sync_income_expense", {
        payload: {
          ...basePayload(0),
          operation: "update",
          expectedRevisionNo: stored.data![0].revision_no,
          idempotencyKey: `update:${clientIds[0]}:cross-location`,
          locationId: otherLocationResult.data.id,
        },
      });
      expect(crossLocationUpdate.error).toBeNull();
      expect(crossLocationUpdate.data).toMatchObject({
        status: "failed",
        errorMessage: "ไม่สามารถย้ายรายการรับ-จ่ายข้ามสาขาได้",
      });
    }

    const staleChange = await authenticated.rpc("sync_income_expense", {
      payload: {
        ...basePayload(0),
        operation: "update",
        expectedRevisionNo: 999,
        idempotencyKey: `update:${clientIds[0]}:999`,
        billOption: "รายรับ",
        incomeSaleItemId: null,
        stockProductId: null,
        stockQuantity: null,
        saleGroupId: null,
        saleLineOrder: null,
        saleExpectedLines: null,
      },
    });
    expect(staleChange.error).toBeNull();
    expect(staleChange.data).toMatchObject({ status: "conflict" });
    const restoredAfterConflict = await service
      .from("income_expense")
      .select("sale_group_id,sale_line_order,sale_expected_lines")
      .eq("client_temp_id", clientIds[0])
      .single();
    expect(restoredAfterConflict.error).toBeNull();
    expect(restoredAfterConflict.data).toEqual({
      sale_group_id: groupId,
      sale_line_order: 1,
      sale_expected_lines: 2,
    });

    const deleteResponse = await authenticated.rpc("sync_income_expense", {
      payload: {
        ...basePayload(0),
        operation: "delete",
        expectedRevisionNo: stored.data![0].revision_no,
        idempotencyKey: `delete:${clientIds[0]}:${stored.data![0].revision_no}`,
        recordStatus: "deleted",
        deletedByName: me.profile.name,
        deletedByPhone: me.profile.phone,
      },
    });
    expect(deleteResponse.error).toBeNull();
    if ((deleteResponse.data as { status: string }).status !== "synced") {
      throw new Error(`delete failed: ${JSON.stringify(deleteResponse.data)}`);
    }
    expect(deleteResponse.data).toMatchObject({ status: "synced" });

    const remaining = await service
      .from("income_expense")
      .select("sale_line_order,sale_expected_lines")
      .eq("client_temp_id", clientIds[1])
      .single();
    expect(remaining.error).toBeNull();
    expect(remaining.data).toEqual({ sale_line_order: 2, sale_expected_lines: 1 });

    const changedToGeneralIncome = await authenticated.rpc("sync_income_expense", {
      payload: {
        ...basePayload(1),
        operation: "update",
        expectedRevisionNo: stored.data![1].revision_no,
        idempotencyKey: `update:${clientIds[1]}:${stored.data![1].revision_no}`,
        billOption: "รายรับ",
        incomeSaleItemId: null,
        stockProductId: null,
        stockQuantity: null,
        saleGroupId: null,
        saleLineOrder: null,
        saleExpectedLines: null,
      },
    });
    expect(changedToGeneralIncome.error).toBeNull();
    if ((changedToGeneralIncome.data as { status: string }).status !== "synced") {
      throw new Error(`sale-to-income update failed: ${JSON.stringify(changedToGeneralIncome.data)}`);
    }
    expect(changedToGeneralIncome.data).toMatchObject({ status: "synced" });
    const ungrouped = await service
      .from("income_expense")
      .select("bill_option,sale_group_id,sale_line_order,sale_expected_lines")
      .eq("client_temp_id", clientIds[1])
      .single();
    expect(ungrouped.error).toBeNull();
    expect(ungrouped.data).toEqual({
      bill_option: "รายรับ",
      sale_group_id: null,
      sale_line_order: null,
      sale_expected_lines: null,
    });

    const approvalTitle = `สินค้าขออนุมัติ ${clientIds[2].slice(0, 8)}`;
    const keyword = await service.from("income_expense_approval_keywords").insert({
      id: approvalKeywordId,
      keyword: approvalTitle,
      match_mode: "exact",
      applies_to: "income",
      is_active: true,
      created_by_user_id: me.profile.id,
      created_by_name: me.profile.name,
      created_by_phone: me.profile.phone,
    });
    expect(keyword.error).toBeNull();
    const approvalPayload = {
      ...basePayload(0),
      clientTempId: clientIds[2],
      idempotencyKey: `create:${clientIds[2]}:0`,
      localBillNo: `SALE-APPROVAL-${clientIds[2].slice(0, 8)}`,
      title: approvalTitle,
      saleGroupId: crypto.randomUUID(),
      saleLineOrder: 1,
      saleExpectedLines: 1,
    };
    const requested = await authenticated.rpc("create_income_expense_approval_request", {
      payload: approvalPayload,
    });
    expect(requested.error).toBeNull();
    expect(requested.data).toMatchObject({ status: "pending" });
    approvalRequestId = (requested.data as { requestId: string }).requestId;

    const decided = await authenticated.rpc("decide_income_expense_approval_request", {
      p_request_id: approvalRequestId,
      p_decision: "approved",
      p_comment: null,
    });
    expect(decided.error).toBeNull();
    expect(decided.data).toMatchObject({ status: "approved" });

    const approvedRow = await service
      .from("income_expense")
      .select("sale_group_id,sale_line_order,sale_expected_lines")
      .eq("client_temp_id", clientIds[2])
      .single();
    expect(approvedRow.error).toBeNull();
    expect(approvedRow.data).toEqual({
      sale_group_id: approvalPayload.saleGroupId,
      sale_line_order: 1,
      sale_expected_lines: 1,
    });
  } finally {
    await service.from("income_expense").delete().in("client_temp_id", [
      ...clientIds,
      ...rejectedClientIds,
    ]);
    if (approvalRequestId) {
      await service.from("income_expense_approval_requests").delete().eq("id", approvalRequestId);
    }
    await service.from("income_expense_approval_keywords").delete().eq("id", approvalKeywordId);
    await service.from("stock_entries").delete().eq("id", stockEntryId);
  }
});
