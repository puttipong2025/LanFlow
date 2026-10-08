import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { assertOfflineRubberBillPriceAllowed } from "../../src/lib/rubber-bills/approval";
import { bangkokDateString } from "../../src/lib/bangkok-date";
import { selectedAppLocationId } from "../helpers/select-app-location";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

async function authContext(
  browser: Browser,
  role: "user" | "admin" | "super_admin"
) {
  return browser.newContext({ storageState: `playwright/.auth/${role}.json` });
}

async function profile(context: BrowserContext) {
  const response = await context.request.get("/api/auth/me");
  expect(response.ok()).toBeTruthy();
  return (await response.json() as {
    profile: { id: string; locationIds: string[]; name: string; phone: string };
  }).profile;
}

function service() {
  expect(serviceRoleKey).toBeTruthy();
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function billPayload({
  locationId,
  clientTempId = crypto.randomUUID(),
  operation = "create",
  expectedRevisionNo = 0,
  price = 20,
  prices,
  configuredPriceSnapshot = 20,
  customerName = "ลูกค้าทดสอบอนุมัติบิลยาง",
  billType = "บิลเครื่องชั่งเล็ก",
  stockDeduction,
}: {
  locationId: string;
  clientTempId?: string;
  operation?: "create" | "update" | "delete";
  expectedRevisionNo?: number;
  price?: number;
  prices?: number[];
  configuredPriceSnapshot?: number | null;
  customerName?: string;
  billType?: string;
  stockDeduction?: { productId: string; quantity: number; unitPrice: number };
}) {
  const now = new Date().toISOString();
  const linePrices = prices ?? [price];
  const rubberValue = linePrices.reduce((total, linePrice) => total + 10 * linePrice, 0);
  const weight = linePrices.length * 10;
  return {
    operation,
    expectedRevisionNo,
    clientTempId,
    idempotencyKey: `${operation}:${clientTempId}:${expectedRevisionNo}`,
    locationId,
    recordStatus: operation === "delete" ? "deleted" : "active",
    localBillNo: `APP-${clientTempId.slice(0, 8)}`,
    billDate: bangkokDateString(),
    customerId: null,
    customerName,
    configuredPriceSnapshot,
    billType,
    deductWeight: 0,
    weight,
    rubberValue,
    averagePrice: rubberValue / weight,
    deductionTotal: 0,
    netTotal: rubberValue,
    acidPackCount: stockDeduction?.quantity ?? 0,
    clientRecordedAt: now,
    clientCreatedAt: now,
    items: [
      ...linePrices.map((linePrice, index) => ({
        itemType: "weigh",
        title: `ชั่ง${index + 1}`,
        description: `ชั่ง${index + 1}`,
        inWeight: 20,
        outWeight: 10,
        netWeight: 10,
        unitPrice: linePrice,
        totalAmount: 10 * linePrice,
        sequenceNo: index + 1,
      })),
      ...(stockDeduction ? [{
        itemType: "stock_deduction",
        title: "สินค้าหักจากบิลยาง",
        description: "สินค้าหักจากบิลยาง",
        quantity: stockDeduction.quantity,
        unit: "แพ็ค",
        unitPrice: stockDeduction.unitPrice,
        totalAmount: stockDeduction.quantity * stockDeduction.unitPrice,
        stockProductId: stockDeduction.productId,
        sequenceNo: linePrices.length + 1,
      }] : []),
    ],
  };
}

async function syncBill(
  context: BrowserContext,
  payload: ReturnType<typeof billPayload> & { submissionMode?: "replay" },
) {
  const response = await context.request.post("/api/lanflow/rubber-bills", { data: payload });
  return {
    response,
    body: await response.json() as {
      status?: string;
      requestId?: string;
      id?: string;
      revisionNo?: number;
      matchedReasons?: string[];
      errorMessage?: string;
      serverBillNo?: string;
    },
  };
}

async function saveSettings(
  context: BrowserContext,
  locationId: string,
  editWindowMinutes: number,
  priceAllowance: number | null
) {
  const listed = await context.request.get("/api/lanflow/rubber-bills/approval-groups");
  if (!listed.ok()) return listed;
  const { groups } = await listed.json() as {
    groups: Array<{ id: string; locationIds: string[]; revisionNo: number }>;
  };
  const group = groups.find((item) => item.locationIds.includes(locationId));
  if (!group) {
    return context.request.post("/api/lanflow/rubber-bills/approval-groups", {
      data: { locationIds: [locationId], editWindowMinutes, priceAllowance: priceAllowance ?? 0 },
    });
  }
  return context.request.put(`/api/lanflow/rubber-bills/approval-groups/${group.id}`, {
    data: { locationIds: group.locationIds, editWindowMinutes, priceAllowance: priceAllowance ?? 0, revisionNo: group.revisionNo },
  });
}

test.describe.serial("Rubber Bill approval contract @rubber-bill-approval", () => {
  let originalMaxPriceAllowance = 0;

  test.beforeAll(async () => {
    const db = service();
    const current = await db.from("rubber_bill_approval_settings")
      .select("max_price_allowance")
      .eq("id", true)
      .single();
    expect(current.error).toBeNull();
    originalMaxPriceAllowance = Number(current.data!.max_price_allowance);
    expect((await db.from("rubber_bill_approval_settings")
      .update({ max_price_allowance: 100 })
      .eq("id", true)).error).toBeNull();
  });

  test.afterAll(async () => {
    const db = service();
    expect((await db.from("rubber_bill_approval_settings")
      .update({ max_price_allowance: originalMaxPriceAllowance })
      .eq("id", true)).error).toBeNull();
  });

  test("offline cached-price guard blocks only values above the cached cap", () => {
    const today = bangkokDateString();
    const cap45 = { effectivePriceCap: 45, nonCurrentDateRequiresApproval: false };
    expect(() => assertOfflineRubberBillPriceAllowed([0, 44.99, 45], today, cap45, false)).not.toThrow();
    expect(() => assertOfflineRubberBillPriceAllowed([45.5], today, cap45, true)).not.toThrow();
    expect(() => assertOfflineRubberBillPriceAllowed([45, 45.01], today, cap45, false))
      .toThrow("ต้องออนไลน์เพื่อส่งคำขออนุมัติ");
    expect(() => assertOfflineRubberBillPriceAllowed([0], today, { effectivePriceCap: 0, nonCurrentDateRequiresApproval: false }, false)).not.toThrow();
    expect(() => assertOfflineRubberBillPriceAllowed([0.01], today, { effectivePriceCap: 0, nonCurrentDateRequiresApproval: false }, false))
      .toThrow("ต้องออนไลน์เพื่อส่งคำขออนุมัติ");
    expect(() => assertOfflineRubberBillPriceAllowed([0], today, null, false))
      .toThrow("ยังไม่เคยโหลดกติกาอนุมัติ");
  });

  test("approval route classifies a corrupted pending payload as an internal failure", async ({ browser }) => {
    const superAdmin = await authContext(browser, "super_admin");
    const db = service();
    const actor = await profile(superAdmin);
    const requestId = crypto.randomUUID();

    try {
      const inserted = await db.from("rubber_bill_approval_requests").insert({
        id: requestId,
        operation: "create",
        request_status: "pending",
        location_id: actor.locationIds[0],
        client_temp_id: requestId,
        idempotency_key: `internal-failure:${requestId}`,
        base_revision_no: 0,
        matched_reasons: ["non_current_date"],
        configured_price_snapshot: null,
        edit_window_minutes_snapshot: 30,
        proposed_payload: {},
        requested_by_user_id: actor.id,
        requested_by_name: actor.name,
        requested_by_phone: actor.phone,
      });
      expect(inserted.error).toBeNull();

      const response = await superAdmin.request.post(
        `/api/lanflow/rubber-bills/approval-requests/${requestId}/approve`,
      );

      expect(response.status()).toBe(500);
      expect(await response.json()).toEqual({ errorMessage: "อนุมัติคำขอไม่สำเร็จ" });

      const deleted = await superAdmin.request.delete(
        `/api/lanflow/rubber-bills/approval-requests/${requestId}`,
      );
      expect(deleted.ok(), await deleted.text()).toBeTruthy();
    } finally {
      await db.from("rubber_bill_approval_requests").delete().eq("id", requestId);
      await superAdmin.close();
    }
  });

  test("Rubber Bill numbering advances past a hard-delete gap", async ({ browser }) => {
    const superAdmin = await authContext(browser, "super_admin");
    const db = service();
    const locationId = crypto.randomUUID();
    const clientTempIds = Array.from({ length: 4 }, () => crypto.randomUUID());
    const billType = `ทดสอบช่องว่างเลขบิล-${locationId}`;

    try {
      expect((await db.from("locations").insert({
        id: locationId,
        name: `สาขาทดสอบเลขบิล ${locationId.slice(0, 8)}`,
        code: `NG${locationId.replaceAll("-", "").slice(0, 6).toUpperCase()}`,
        is_active: true,
      })).error).toBeNull();
      expect((await saveSettings(superAdmin, locationId, 1440, 0)).ok()).toBeTruthy();

      const created = [];
      for (const clientTempId of clientTempIds.slice(0, 3)) {
        const result = await syncBill(superAdmin, billPayload({
          locationId,
          clientTempId,
          billType,
          price: 20,
        }));
        expect(result.body.status).toBe("synced");
        created.push(result.body);
      }
      expect(created.map((item) => item.serverBillNo?.slice(-4))).toEqual(["0001", "0002", "0003"]);

      expect((await db.from("rubber_bills").delete().eq("id", created[1].id!)).error).toBeNull();

      const afterGap = await syncBill(superAdmin, billPayload({
        locationId,
        clientTempId: clientTempIds[3],
        billType,
        price: 20,
      }));
      expect(afterGap.body.status).toBe("synced");
      expect(afterGap.body.serverBillNo?.slice(-4)).toBe("0004");
    } finally {
      await db.from("rubber_bills").delete().in("client_temp_id", clientTempIds);
      const listed = await superAdmin.request.get("/api/lanflow/rubber-bills/approval-groups");
      if (listed.ok()) {
        const body = await listed.json() as {
          groups: Array<{ id: string; revisionNo: number; locationIds: string[] }>;
        };
        const group = body.groups.find((item) => item.locationIds.includes(locationId));
        if (group) {
          await superAdmin.request.delete(
            `/api/lanflow/rubber-bills/approval-groups/${group.id}?revision=${group.revisionNo}`,
          );
        }
      }
      await db.from("locations").delete().eq("id", locationId);
      await superAdmin.close();
    }
  });

  test("create uses the effective group or ungrouped policy instead of a client snapshot", async ({ browser }) => {
    const manager = await authContext(browser, "super_admin");
    const db = service();
    const locationIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    const groups: Array<{ id: string; revisionNo: number }> = [];
    const payloads = {
      missing: billPayload({ locationId: locationIds[0], price: 46, configuredPriceSnapshot: null }),
      tooHigh: billPayload({ locationId: locationIds[0], price: 46, configuredPriceSnapshot: 999 }),
      staleLow: billPayload({ locationId: locationIds[0], price: 42, configuredPriceSnapshot: 10 }),
      zeroAllowance: billPayload({ locationId: locationIds[1], price: 43, configuredPriceSnapshot: 999 }),
      ungrouped: billPayload({ locationId: locationIds[2], price: 43, configuredPriceSnapshot: 999 }),
    };
    const requestIds: string[] = [];

    try {
      expect((await db.from("locations").insert(locationIds.map((id, index) => ({
        id,
        name: `สาขาทดสอบ server price ${index + 1}`,
        code: `SP${id.replaceAll("-", "").slice(0, 6).toUpperCase()}`,
        is_active: true,
      })))).error).toBeNull();

      for (const [locationId, priceAllowance] of [
        [locationIds[0], 3],
        [locationIds[1], 0],
      ] as const) {
        const created = await manager.request.post("/api/lanflow/rubber-bills/approval-groups", {
          data: { locationIds: [locationId], editWindowMinutes: 30, priceAllowance },
        });
        expect(created.status(), await created.text()).toBe(201);
        groups.push((await created.json() as { group: { id: string; revisionNo: number } }).group);
      }

      for (const payload of [payloads.missing, payloads.tooHigh]) {
        const pending = await syncBill(manager, payload);
        expect(pending.body.status).toBe("pending_approval");
        expect(pending.body.matchedReasons).toEqual(["price"]);
        requestIds.push(pending.body.requestId!);
        expect((await db.from("rubber_bill_approval_requests")
          .select("configured_price_snapshot,approval_group_id_snapshot")
          .eq("id", pending.body.requestId!)
          .single()).data).toEqual({
          configured_price_snapshot: 45,
          approval_group_id_snapshot: groups[0].id,
        });
      }

      const pendingReplay = await syncBill(manager, payloads.missing);
      expect(pendingReplay.body).toMatchObject({
        status: "pending_approval",
        requestId: requestIds[0],
      });
      expect((await db.from("rubber_bill_approval_requests")
        .select("id", { count: "exact", head: true })
        .eq("idempotency_key", payloads.missing.idempotencyKey)).count).toBe(1);

      const staleLow = await syncBill(manager, payloads.staleLow);
      expect(staleLow.body.status).toBe("synced");
      expect((await db.from("rubber_bills")
        .select("id,configured_price_snapshot")
        .eq("client_temp_id", payloads.staleLow.clientTempId)
        .single()).data).toEqual({
        id: staleLow.body.id,
        configured_price_snapshot: 45,
      });
      const staleLowReplay = await syncBill(manager, payloads.staleLow);
      expect(staleLowReplay.body).toMatchObject({ status: "synced", id: staleLow.body.id });

      for (const payload of [payloads.zeroAllowance, payloads.ungrouped]) {
        const pending = await syncBill(manager, payload);
        expect(pending.body.status).toBe("pending_approval");
        requestIds.push(pending.body.requestId!);
        expect((await db.from("rubber_bill_approval_requests")
          .select("configured_price_snapshot,effective_price_cap_snapshot")
          .eq("id", pending.body.requestId!).single()).data).toEqual({
          configured_price_snapshot: 42,
          effective_price_cap_snapshot: 42,
        });
      }
    } finally {
      if (requestIds.length > 0) {
        await db.from("rubber_bill_approval_requests").delete().in("id", requestIds);
      }
      await db.from("rubber_bills").delete().in(
        "client_temp_id",
        Object.values(payloads).map((payload) => payload.clientTempId),
      );
      for (const group of groups) {
        const row = await db.from("rubber_approval_groups").select("revision_no").eq("id", group.id).maybeSingle();
        if (row.data) await manager.request.delete(`/api/lanflow/rubber-bills/approval-groups/${group.id}?revision=${row.data.revision_no}`);
      }
      await db.from("locations").delete().in("id", locationIds);
      await manager.close();
    }
  });

  test("synced create replay stays idempotent after the central price changes", async ({ browser }) => {
    const manager = await authContext(browser, "super_admin");
    const db = service();
    const locationId = crypto.randomUUID();
    const originalPayload = billPayload({
      locationId,
      price: 42,
      configuredPriceSnapshot: 999,
    });
    const pendingPayload = billPayload({
      locationId,
      price: 42,
      configuredPriceSnapshot: null,
    });
    let pendingRequestId: string | null = null;
    let centralRevision: number | null = null;

    try {
      expect((await db.from("locations").insert({
        id: locationId,
        name: `สาขาทดสอบ create replay ${locationId.slice(0, 6)}`,
        code: `SI${locationId.replaceAll("-", "").slice(0, 6).toUpperCase()}`,
        is_active: true,
      })).error).toBeNull();
      const first = await syncBill(manager, originalPayload);
      expect(first.body.status, JSON.stringify(first.body)).toBe("synced");
      expect((await db.from("rubber_bills")
        .select("id,configured_price_snapshot")
        .eq("client_temp_id", originalPayload.clientTempId)
        .single()).data).toEqual({
        id: first.body.id,
        configured_price_snapshot: 42,
      });

      const currentPolicy = await manager.request.get("/api/lanflow/rubber-bills/approval-groups");
      const currentPolicyBody = await currentPolicy.json() as { centralPrice: { revision: number } };
      const lowered = await manager.request.put("/api/lanflow/rubber-bills/approval-settings/central", {
        data: { centralPrice: 41, expectedRevision: currentPolicyBody.centralPrice.revision },
      });
      expect(lowered.ok(), await lowered.text()).toBeTruthy();
      centralRevision = (await lowered.json() as { centralPrice: { revision: number } }).centralPrice.revision;

      const replay = await syncBill(manager, originalPayload);
      expect(replay.body).toMatchObject({ status: "synced", id: first.body.id });
      expect((await db.from("rubber_bills")
        .select("configured_price_snapshot,central_price_snapshot")
        .eq("id", first.body.id!)
        .single()).data).toEqual({ configured_price_snapshot: 42, central_price_snapshot: 42 });

      const mismatchedUpdate = await syncBill(manager, {
        ...originalPayload,
        operation: "update",
        expectedRevisionNo: first.body.revisionNo!,
        customerName: "ต้องไม่ถูกยอมรับเป็น replay เดิม",
      });
      expect(mismatchedUpdate.response.status()).toBe(409);
      expect(mismatchedUpdate.body.status).toBe("conflict");

      const mismatchedDelete = await syncBill(manager, {
        ...originalPayload,
        operation: "delete",
        expectedRevisionNo: first.body.revisionNo!,
        recordStatus: "deleted",
      });
      expect(mismatchedDelete.response.status()).toBe(409);
      expect(mismatchedDelete.body.status).toBe("conflict");
      expect((await db.from("rubber_bills")
        .select("customer_name,record_status")
        .eq("id", first.body.id!)
        .single()).data).toMatchObject({
          customer_name: originalPayload.customerName,
          record_status: "active",
        });
      expect((await db.from("rubber_bill_approval_requests")
        .select("id", { count: "exact", head: true })
        .eq("client_temp_id", originalPayload.clientTempId)).count).toBe(0);

      const changedKey = await syncBill(manager, {
        ...originalPayload,
        idempotencyKey: `different:${crypto.randomUUID()}`,
      });
      expect(changedKey.body.status).toBe("conflict");

      const reusedKey = await syncBill(manager, {
        ...billPayload({ locationId, price: 42 }),
        idempotencyKey: originalPayload.idempotencyKey,
      });
      expect(reusedKey.body.status).toBe("conflict");
      expect(reusedKey.body.id).toBeUndefined();

      const pending = await syncBill(manager, pendingPayload);
      expect(pending.body.status).toBe("pending_approval");
      pendingRequestId = pending.body.requestId ?? null;
      const pendingReplay = await syncBill(manager, pendingPayload);
      expect(pendingReplay.body).toMatchObject({
        status: "pending_approval",
        requestId: pendingRequestId,
      });
      const pendingCrossOperation = await syncBill(manager, {
        ...pendingPayload,
        operation: "update",
        expectedRevisionNo: 1,
      });
      expect(pendingCrossOperation.response.status()).toBe(409);
      expect(pendingCrossOperation.body.status).toBe("conflict");
      const pendingWrongRevision = await syncBill(manager, {
        ...pendingPayload,
        expectedRevisionNo: 1,
      });
      expect(pendingWrongRevision.response.status()).toBe(400);
      expect(pendingWrongRevision.body.status).toBe("failed");
      expect((await syncBill(manager, {
        ...pendingPayload,
        idempotencyKey: `different-pending:${crypto.randomUUID()}`,
      })).body.status).toBe("conflict");
      expect((await syncBill(manager, {
        ...billPayload({ locationId, price: 42 }),
        idempotencyKey: pendingPayload.idempotencyKey,
      })).body.status).toBe("conflict");
      expect((await db.from("rubber_bill_approval_requests")
        .select("id", { count: "exact", head: true })
        .eq("location_id", locationId)
        .eq("request_status", "pending")).count).toBe(1);

      const updatePayload = billPayload({
        locationId,
        clientTempId: originalPayload.clientTempId,
        operation: "update",
        expectedRevisionNo: 1,
        price: 42,
        configuredPriceSnapshot: 42,
        customerName: "ลูกค้าหลังแก้ไข",
      });
      const update = await syncBill(manager, updatePayload);
      expect(update.body).toMatchObject({ status: "synced", revisionNo: 2 });
      expect((await syncBill(manager, updatePayload)).body).toMatchObject({
        status: "synced",
        id: first.body.id,
        revisionNo: 2,
      });

      const deletePayload = billPayload({
        locationId,
        clientTempId: originalPayload.clientTempId,
        operation: "delete",
        expectedRevisionNo: 2,
        price: 42,
        configuredPriceSnapshot: 42,
      });
      const deleted = await syncBill(manager, deletePayload);
      expect(deleted.body).toMatchObject({ status: "synced", revisionNo: 3 });
      expect((await syncBill(manager, deletePayload)).body).toMatchObject({
        status: "synced",
        id: first.body.id,
        revisionNo: 3,
      });
    } finally {
      await db.from("rubber_bill_approval_requests").delete().in(
        "client_temp_id",
        [originalPayload.clientTempId, pendingPayload.clientTempId],
      );
      await db.from("rubber_bills").delete().in(
        "client_temp_id",
        [originalPayload.clientTempId, pendingPayload.clientTempId],
      );
      if (centralRevision !== null) {
        await manager.request.put("/api/lanflow/rubber-bills/approval-settings/central", {
          data: { centralPrice: 42, expectedRevision: centralRevision },
        });
      }
      await db.from("locations").delete().eq("id", locationId);
      await manager.close();
    }
  });

  test("server gates a non-current create and approval preserves billDate", async ({ browser }) => {
    const superAdmin = await authContext(browser, "super_admin");
    const db = service();
    const locationId = (await profile(superAdmin)).locationIds[0];
    const clientTempId = crypto.randomUUID();
    const date = new Date(`${bangkokDateString()}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    const billDate = date.toISOString().slice(0, 10);
    const payload = { ...billPayload({ locationId, clientTempId, configuredPriceSnapshot: null }), billDate };
    let requestId: string | null = null;

    try {
      expect((await saveSettings(superAdmin, locationId, 30, null)).ok()).toBeTruthy();
      const settings = await superAdmin.request.put(`/api/lanflow/rubber-bills/approval-settings?locationId=${locationId}`, {
        data: { nonCurrentDateRequiresApproval: true },
      });
      expect(settings.ok()).toBeTruthy();
      const oldClientSettings = await superAdmin.request.put(`/api/lanflow/rubber-bills/approval-settings?locationId=${locationId}`, {
        data: { editWindowMinutes: 30, configuredPrice: null },
      });
      expect(oldClientSettings.status()).toBe(400);

      const pending = await syncBill(superAdmin, payload);
      expect(pending.response.ok()).toBeTruthy();
      expect(pending.body.status).toBe("pending_approval");
      expect(pending.body.matchedReasons).toEqual(["non_current_date"]);
      requestId = pending.body.requestId ?? null;
      expect(requestId).toBeTruthy();
      expect((await db.from("rubber_bills").select("id").eq("client_temp_id", clientTempId)).data).toHaveLength(0);

      const approval = await superAdmin.request.post(`/api/lanflow/rubber-bills/approval-requests/${requestId}/approve`);
      expect(approval.ok()).toBeTruthy();
      const created = await db.from("rubber_bills").select("bill_date").eq("client_temp_id", clientTempId).single();
      expect(created.error).toBeNull();
      expect(created.data?.bill_date).toBe(billDate);
    } finally {
      if (requestId) await db.from("rubber_bill_approval_requests").delete().eq("id", requestId);
      await db.from("rubber_bills").delete().eq("client_temp_id", clientTempId);
      await superAdmin.request.put(`/api/lanflow/rubber-bills/approval-settings?locationId=${locationId}`, {
        data: { nonCurrentDateRequiresApproval: false },
      });
      await superAdmin.close();
    }
  });

  test("non-current update uses the proposed date and delete uses the persisted date", async ({ browser }) => {
    const superAdmin = await authContext(browser, "super_admin");
    const db = service();
    const locationId = (await profile(superAdmin)).locationIds[0];
    const clientTempId = crypto.randomUUID();
    const billType = `ทดสอบอนุมัติวันที่-${clientTempId}`;
    const createPayload = billPayload({
      locationId,
      clientTempId,
      configuredPriceSnapshot: null,
      billType,
    });
    let updateRequestId: string | null = null;
    let deleteRequestId: string | null = null;

    try {
      expect((await saveSettings(superAdmin, locationId, 1440, null)).ok()).toBeTruthy();
      expect((await superAdmin.request.put(`/api/lanflow/rubber-bills/approval-settings?locationId=${locationId}`, {
        data: { nonCurrentDateRequiresApproval: false },
      })).ok()).toBeTruthy();
      const created = await syncBill(superAdmin, createPayload);
      expect(created.body.status).toBe("synced");

      expect((await superAdmin.request.put(`/api/lanflow/rubber-bills/approval-settings?locationId=${locationId}`, {
        data: { nonCurrentDateRequiresApproval: true },
      })).ok()).toBeTruthy();
      const date = new Date(`${bangkokDateString()}T00:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() - 1);
      const pastDate = date.toISOString().slice(0, 10);
      const updatePayload = {
        ...billPayload({
          locationId,
          clientTempId,
          operation: "update",
          expectedRevisionNo: created.body.revisionNo,
          configuredPriceSnapshot: null,
          billType,
        }),
        billDate: pastDate,
      };
      const pendingUpdate = await syncBill(superAdmin, updatePayload);
      expect(pendingUpdate.body.status).toBe("pending_approval");
      expect(pendingUpdate.body.matchedReasons).toEqual(["non_current_date"]);
      updateRequestId = pendingUpdate.body.requestId ?? null;

      const unchanged = await db.from("rubber_bills").select("bill_date,revision_no").eq("client_temp_id", clientTempId).single();
      expect(unchanged.data?.bill_date).toBe(bangkokDateString());
      expect(unchanged.data?.revision_no).toBe(created.body.revisionNo);

      const approved = await superAdmin.request.post(
        `/api/lanflow/rubber-bills/approval-requests/${updateRequestId}/approve`
      );
      expect(approved.ok(), await approved.text()).toBeTruthy();
      const updated = await db.from("rubber_bills").select("bill_date,revision_no").eq("client_temp_id", clientTempId).single();
      expect(updated.data?.bill_date).toBe(pastDate);

      const deletePayload = {
        ...billPayload({
          locationId,
          clientTempId,
          operation: "delete",
          expectedRevisionNo: updated.data!.revision_no,
          configuredPriceSnapshot: null,
          billType,
        }),
        billDate: bangkokDateString(),
      };
      const pendingDelete = await syncBill(superAdmin, deletePayload);
      expect(pendingDelete.body.status).toBe("pending_approval");
      expect(pendingDelete.body.matchedReasons).toEqual(["non_current_date"]);
      deleteRequestId = pendingDelete.body.requestId ?? null;

      expect((await superAdmin.request.delete(
        `/api/lanflow/rubber-bills/approval-requests/${deleteRequestId}`
      )).ok()).toBeTruthy();
      const retained = await db.from("rubber_bills").select("record_status,bill_date").eq("client_temp_id", clientTempId).single();
      expect(retained.data).toMatchObject({ record_status: "active", bill_date: pastDate });

      const replayedDelete = await syncBill(superAdmin, {
        ...deletePayload,
        submissionMode: "replay",
      });
      expect(replayedDelete.response.ok(), replayedDelete.body.errorMessage).toBeTruthy();
      expect(replayedDelete.body.status).toBe("discarded");
      expect((await db.from("rubber_bills")
        .select("record_status,bill_date")
        .eq("client_temp_id", clientTempId)
        .single()).data).toMatchObject({ record_status: "active", bill_date: pastDate });
    } finally {
      if (deleteRequestId) await db.from("rubber_bill_approval_requests").delete().eq("id", deleteRequestId);
      await db.from("rubber_bills").delete().eq("client_temp_id", clientTempId);
      await superAdmin.request.put(`/api/lanflow/rubber-bills/approval-settings?locationId=${locationId}`, {
        data: { nonCurrentDateRequiresApproval: false },
      });
      await superAdmin.close();
    }
  });

  test("a mismatched expected Server identity cannot delete the submitted client identity", async ({ browser }) => {
    const superAdmin = await authContext(browser, "super_admin");
    const db = service();
    const actor = await profile(superAdmin);
    const locationId = actor.locationIds[0];
    const clientTempId = crypto.randomUUID();

    try {
      expect((await saveSettings(superAdmin, locationId, 1440, null)).ok()).toBeTruthy();
      expect((await superAdmin.request.put(`/api/lanflow/rubber-bills/approval-settings?locationId=${locationId}`, {
        data: { nonCurrentDateRequiresApproval: false },
      })).ok()).toBeTruthy();
      const created = await syncBill(superAdmin, billPayload({ locationId, clientTempId }));
      expect(created.body.status).toBe("synced");

      const mismatchedDelete = await superAdmin.request.post("/api/lanflow/rubber-bills", {
        data: {
          ...billPayload({
            locationId,
            clientTempId,
            operation: "delete",
            expectedRevisionNo: created.body.revisionNo,
          }),
          expectedServerId: crypto.randomUUID(),
          deletedByName: actor.name,
          deletedByPhone: actor.phone,
        },
      });
      expect(mismatchedDelete.ok()).toBeFalsy();
      expect(mismatchedDelete.status()).toBe(409);

      const retained = await db.from("rubber_bills")
        .select("record_status,revision_no")
        .eq("client_temp_id", clientTempId)
        .single();
      expect(retained.error).toBeNull();
      expect(retained.data).toEqual({
        record_status: "active",
        revision_no: created.body.revisionNo,
      });

      const matchingDeletePayload = {
        ...billPayload({
          locationId,
          clientTempId,
          operation: "delete" as const,
          expectedRevisionNo: created.body.revisionNo,
        }),
        expectedServerId: created.body.id,
        deletedByName: actor.name,
        deletedByPhone: actor.phone,
      };
      const matchingDelete = await superAdmin.request.post("/api/lanflow/rubber-bills", {
        data: matchingDeletePayload,
      });
      expect(matchingDelete.ok(), await matchingDelete.text()).toBeTruthy();
      const matchingBody = await matchingDelete.json() as { status: string; revisionNo: number };
      expect(matchingBody).toMatchObject({ status: "synced", revisionNo: 2 });

      const replay = await superAdmin.request.post("/api/lanflow/rubber-bills", {
        data: matchingDeletePayload,
      });
      expect(replay.ok(), await replay.text()).toBeTruthy();
      expect(await replay.json()).toMatchObject({ status: "synced", revisionNo: 2 });
    } finally {
      await db.from("rubber_bills").delete().eq("client_temp_id", clientTempId);
      await superAdmin.close();
    }
  });

  test("ungrouped branch uses the same price, time, and date rules", async ({ browser }) => {
    const manager = await authContext(browser, "super_admin");
    const db = service();
    const locationId = crypto.randomUUID();
    const code = `UG${locationId.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
    const clientTempId = crypto.randomUUID();
    const priceClientTempId = crypto.randomUUID();
    const dateClientTempId = crypto.randomUUID();
    let priceRequestId: string | null = null;
    let dateRequestId: string | null = null;

    try {
      expect((await db.from("locations").insert({
        id: locationId,
        name: `สาขายกเว้น ${code}`,
        code,
        is_active: true,
      })).error).toBeNull();

      const created = await syncBill(manager, billPayload({
        locationId,
        clientTempId,
        price: 42,
        configuredPriceSnapshot: 20,
      }));
      expect(created.body.status).toBe("synced");
      expect((await db.from("rubber_bills")
        .select("configured_price_snapshot")
        .eq("id", created.body.id!)
        .single()).data?.configured_price_snapshot).toBe(42);

      const updated = await syncBill(manager, billPayload({
        locationId,
        clientTempId,
        operation: "update",
        expectedRevisionNo: created.body.revisionNo,
        price: 42,
        configuredPriceSnapshot: 20,
      }));
      expect(updated.body.status).toBe("synced");
      const deleted = await syncBill(manager, billPayload({
        locationId,
        clientTempId,
        operation: "delete",
        expectedRevisionNo: updated.body.revisionNo,
        configuredPriceSnapshot: 20,
      }));
      expect(deleted.body.status).toBe("synced");
      expect((await db.from("rubber_bill_approval_requests")
        .select("id", { count: "exact", head: true })
        .eq("location_id", locationId)).count).toBe(0);

      const pricePending = await syncBill(manager, billPayload({
        locationId,
        clientTempId: priceClientTempId,
        price: 43,
        configuredPriceSnapshot: 999,
      }));
      expect(pricePending.body.status).toBe("pending_approval");
      expect(pricePending.body.matchedReasons).toEqual(["price"]);
      priceRequestId = pricePending.body.requestId ?? null;

      expect((await manager.request.put(
        `/api/lanflow/rubber-bills/approval-settings?locationId=${locationId}`,
        { data: { nonCurrentDateRequiresApproval: true } },
      )).ok()).toBeTruthy();
      const past = new Date(`${bangkokDateString()}T00:00:00.000Z`);
      past.setUTCDate(past.getUTCDate() - 1);
      const datePending = await syncBill(manager, {
        ...billPayload({
          locationId,
          clientTempId: dateClientTempId,
          price: 42,
          configuredPriceSnapshot: 20,
        }),
        billDate: past.toISOString().slice(0, 10),
      });
      expect(datePending.body.status).toBe("pending_approval");
      expect(datePending.body.matchedReasons).toEqual(["non_current_date"]);
      dateRequestId = datePending.body.requestId ?? null;
      expect((await db.from("rubber_bill_approval_requests")
        .select("approval_group_id_snapshot,configured_price_snapshot,edit_window_minutes_snapshot")
        .eq("id", dateRequestId!)
        .single()).data).toEqual({
        approval_group_id_snapshot: null,
        configured_price_snapshot: 42,
        edit_window_minutes_snapshot: 30,
      });
    } finally {
      if (priceRequestId) {
        await manager.request.delete(`/api/lanflow/rubber-bills/approval-requests/${priceRequestId}`);
      }
      if (dateRequestId) {
        await manager.request.delete(`/api/lanflow/rubber-bills/approval-requests/${dateRequestId}`);
      }
      await manager.request.put(
        `/api/lanflow/rubber-bills/approval-settings?locationId=${locationId}`,
        { data: { nonCurrentDateRequiresApproval: false } },
      );
      await db.from("rubber_bills").delete().eq("location_id", locationId);
      await db.from("locations").delete().eq("id", locationId);
      await manager.close();
    }
  });

  test("server recalculates every summary value from the item inputs", async ({ browser }) => {
    const context = await authContext(browser, "super_admin");
    const db = service();
    const me = await profile(context);
    const payload: any = billPayload({
      locationId: me.locationIds[0],
      price: 10,
      configuredPriceSnapshot: null,
      customerName: `ServerCalc-${Date.now()}`,
    });
    payload.deductWeight = 1.11;
    payload.weight = 999;
    payload.rubberValue = 1;
    payload.averagePrice = 1;
    payload.deductionTotal = 99;
    payload.netTotal = 1;
    payload.items.push({
      itemType: "debt",
      title: "หักหนี้",
      description: "หักหนี้",
      totalAmount: 0.45,
      sequenceNo: 2,
    });

    try {
      const synced = await syncBill(context, payload);
      expect(synced.response.ok()).toBeTruthy();
      expect(synced.body.status).toBe("synced");
      expect(synced.body.id).toBeTruthy();

      const { data: bill, error } = await db
        .from("rubber_bills")
        .select(`
          weight,
          net_weight,
          formula_version,
          rubber_value,
          net_rubber_value,
          average_price,
          deduction_total,
          payable_before_rounding,
          net_total
        `)
        .eq("id", synced.body.id)
        .single();
      expect(error).toBeNull();
      expect(bill).toMatchObject({
        weight: 10,
        net_weight: 8.89,
        formula_version: 2,
        rubber_value: 100,
        net_rubber_value: 88,
        average_price: 10,
        deduction_total: 0.45,
        payable_before_rounding: 87.55,
        net_total: 87,
      });
    } finally {
      await db.from("rubber_bills").delete().eq("client_temp_id", payload.clientTempId);
      await context.close();
    }
  });

  test("server rejects negative individual weigh-row inputs", async ({ browser }) => {
    const context = await authContext(browser, "super_admin");
    const me = await profile(context);
    const payload: any = billPayload({
      locationId: me.locationIds[0],
      configuredPriceSnapshot: null,
    });
    payload.items[0].inWeight = -10;
    payload.items[0].outWeight = -20;
    payload.items[0].netWeight = 10;

    try {
      const result = await syncBill(context, payload);
      expect(result.body.status).toBe("failed");
      expect(result.body.errorMessage).toContain("non-negative");
    } finally {
      await service().from("rubber_bills").delete().eq("client_temp_id", payload.clientTempId);
      await context.close();
    }
  });

  test("settings permission, mismatched create, and permanent request delete", async ({ browser }) => {
    const branchAdmin = await authContext(browser, "admin");
    const superAdmin = await authContext(browser, "super_admin");
    const db = service();
    const cleanupClientTempIds: string[] = [];

    try {
      const branchAdminProfile = await profile(branchAdmin);
      const locationId = branchAdminProfile.locationIds[0];

      expect((await branchAdmin.request.post("/api/lanflow/rubber-bills/approval-groups", {
        data: { locationIds: [locationId], editWindowMinutes: 30, priceAllowance: 0 },
      })).status()).toBe(403);
      expect((await saveSettings(superAdmin, locationId, -1, 20)).status()).toBe(400);
      expect((await saveSettings(superAdmin, locationId, 1.5, 20)).status()).toBe(400);
      expect((await saveSettings(superAdmin, locationId, 30, 20.555)).status()).toBe(400);
      expect((await saveSettings(superAdmin, locationId, 30, 0)).ok()).toBeTruthy();
      expect((await saveSettings(superAdmin, locationId, 30, null)).ok()).toBeTruthy();

      const noSettingPayload = billPayload({
        locationId,
        price: 42,
        configuredPriceSnapshot: null,
      });
      cleanupClientTempIds.push(noSettingPayload.clientTempId);
      const noSettingCreate = await syncBill(branchAdmin, noSettingPayload);
      expect(
        noSettingCreate.response.ok(),
        JSON.stringify(noSettingCreate.body)
      ).toBeTruthy();
      expect(noSettingCreate.body.status).toBe("synced");

      expect((await saveSettings(superAdmin, locationId, 30, 0)).ok()).toBeTruthy();
      expect((await db.from("rubber_bill_approval_requests")
        .select("id", { count: "exact", head: true })
        .eq("bill_id", noSettingCreate.body.id!)).count).toBe(0);

      const payload = billPayload({ locationId, prices: [42, 43] });
      cleanupClientTempIds.push(payload.clientTempId);
      const pending = await syncBill(branchAdmin, payload);
      expect(pending.response.ok(), pending.body.errorMessage).toBeTruthy();
      expect(pending.body.status).toBe("pending_approval");
      expect(pending.body.matchedReasons).toEqual(["price"]);

      const [{ data: source }, { data: request }] = await Promise.all([
        db.from("rubber_bills").select("id").eq("client_temp_id", payload.clientTempId).maybeSingle(),
        db.from("rubber_bill_approval_requests").select("*").eq("id", pending.body.requestId!).single(),
      ]);
      expect(source).toBeNull();
      expect(request).toMatchObject({
        operation: "create",
        request_status: "pending",
        configured_price_snapshot: 42,
        edit_window_minutes_snapshot: 30,
        approval_group_id_snapshot: expect.any(String),
      });

      expect((await saveSettings(superAdmin, locationId, 30, 1)).ok()).toBeTruthy();
      expect((await saveSettings(superAdmin, locationId, 30, null)).ok()).toBeTruthy();
      expect((await db.from("rubber_bill_approval_requests")
        .select("configured_price_snapshot")
        .eq("id", pending.body.requestId!)
        .single()).data?.configured_price_snapshot).toBe(42);

      const deleted = await superAdmin.request.delete(
        `/api/lanflow/rubber-bills/approval-requests/${pending.body.requestId}`
      );
      expect(deleted.ok(), await deleted.text()).toBeTruthy();
      expect((await db.from("rubber_bill_approval_requests")
        .select("id")
        .eq("id", pending.body.requestId!)
        .maybeSingle()).data).toBeNull();
      expect((await db.from("rubber_bills")
        .select("id")
        .eq("client_temp_id", payload.clientTempId)
        .maybeSingle()).data).toBeNull();

      const replay = await syncBill(branchAdmin, {
        ...payload,
        submissionMode: "replay",
      });
      expect(replay.response.ok(), replay.body.errorMessage).toBeTruthy();
      expect(replay.body.status).toBe("discarded");
      expect((await db.from("rubber_bill_approval_requests")
        .select("id", { count: "exact", head: true })
        .eq("client_temp_id", payload.clientTempId)).count).toBe(0);

      const changedPayloadReplay = await syncBill(branchAdmin, {
        ...payload,
        customerName: "ลูกค้าคนละรายการ",
        submissionMode: "replay",
      });
      expect(changedPayloadReplay.response.status()).toBe(409);
      expect(changedPayloadReplay.body.status).toBe("conflict");

      const differentClientTempId = crypto.randomUUID();
      cleanupClientTempIds.push(differentClientTempId);
      const mismatchedReplay = await syncBill(branchAdmin, {
        ...payload,
        clientTempId: differentClientTempId,
        submissionMode: "replay",
      });
      expect(mismatchedReplay.response.status()).toBe(409);
      expect(mismatchedReplay.body.status).toBe("conflict");
      expect((await db.from("rubber_bill_approval_requests")
        .select("id", { count: "exact", head: true })
        .eq("client_temp_id", differentClientTempId)).count).toBe(0);
    } finally {
      for (const clientTempId of cleanupClientTempIds) {
        await db.from("rubber_bill_approval_requests").delete().eq("client_temp_id", clientTempId);
        await db.from("rubber_bills").delete().eq("client_temp_id", clientTempId);
      }
      const listed = await superAdmin.request.get("/api/lanflow/rubber-bills/approval-groups");
      if (listed.ok()) {
        const body = await listed.json() as { groups: Array<{ id: string; revisionNo: number; locationIds: string[] }> };
        const branchLocationId = (await profile(branchAdmin)).locationIds[0];
        const group = body.groups.find((item) => item.locationIds.includes(branchLocationId));
        if (group) await superAdmin.request.delete(`/api/lanflow/rubber-bills/approval-groups/${group.id}?revision=${group.revisionNo}`);
      }
      await Promise.all([branchAdmin.close(), superAdmin.close()]);
    }
  });

  test("manager requests and approves own exceptional price without retriggering unchanged price", async ({ browser }) => {
    const superAdmin = await authContext(browser, "super_admin");
    const db = service();
    const clientTempId = crypto.randomUUID();
    const billType = `ทดสอบอนุมัติราคา-${clientTempId}`;

    try {
      const superProfile = await profile(superAdmin);
      const locationId = superProfile.locationIds[0];
      expect((await saveSettings(superAdmin, locationId, 1440, 0)).ok()).toBeTruthy();

      const createPayload = billPayload({ locationId, clientTempId, price: 43, billType });
      const pendingCreate = await syncBill(superAdmin, createPayload);
      expect(pendingCreate.body.status).toBe("pending_approval");

      const approved = await superAdmin.request.post(
        `/api/lanflow/rubber-bills/approval-requests/${pendingCreate.body.requestId}/approve`
      );
      const approvedBody = await approved.json() as { status?: string; billId?: string };
      expect(approved.ok(), JSON.stringify(approvedBody)).toBeTruthy();
      expect(approvedBody.status).toBe("approved");
      expect((await db.from("rubber_bills")
        .select("configured_price_snapshot,approval_state,approved_by_name,approval_revision_no,revision_no")
        .eq("id", approvedBody.billId!)
        .single()).data).toMatchObject({
          configured_price_snapshot: 42,
          approval_state: "approved",
          approved_by_name: superProfile.name,
          approval_revision_no: 1,
          revision_no: 1,
        });

      const retry = await syncBill(superAdmin, createPayload);
      expect(retry.body.status).toBe("synced");
      expect(retry.body.id).toBe(approvedBody.billId);

      const nonPriceUpdate = billPayload({
        locationId,
        clientTempId: createPayload.clientTempId,
        operation: "update",
        expectedRevisionNo: retry.body.revisionNo,
        price: 43,
        customerName: "ลูกค้าแก้ชื่อแต่ราคาเดิม",
        billType,
      });
      const updated = await syncBill(superAdmin, nonPriceUpdate);
      expect(updated.body.status).toBe("synced");
      expect((await db.from("rubber_bills")
        .select("approval_state,approved_by_name,approval_revision_no,revision_no")
        .eq("id", approvedBody.billId!)
        .single()).data).toMatchObject({
          approval_state: "not_required",
          approved_by_name: null,
          approval_revision_no: null,
          revision_no: updated.body.revisionNo,
        });

      const changedPrice = billPayload({
        locationId,
        clientTempId: createPayload.clientTempId,
        operation: "update",
        expectedRevisionNo: updated.body.revisionNo,
        price: 43.25,
        customerName: "ลูกค้าแก้ราคา",
        billType,
      });
      const pendingPriceUpdate = await syncBill(superAdmin, changedPrice);
      expect(pendingPriceUpdate.body.status).toBe("pending_approval");
      expect(pendingPriceUpdate.body.matchedReasons).toEqual(["price"]);

      const { data: source } = await db
        .from("rubber_bills")
        .select("customer_name, rubber_bill_items(price)")
        .eq("id", approvedBody.billId!)
        .single();
      expect(source?.customer_name).toBe("ลูกค้าแก้ชื่อแต่ราคาเดิม");
      expect(source?.rubber_bill_items).toEqual([expect.objectContaining({ price: 43 })]);

      expect((await superAdmin.request.delete(
        `/api/lanflow/rubber-bills/approval-requests/${pendingPriceUpdate.body.requestId}`
      )).ok()).toBeTruthy();

      const immutable = await db
        .from("rubber_bill_approval_requests")
        .delete()
        .eq("id", pendingCreate.body.requestId!);
      expect(immutable.error?.message).toContain("ประวัติคำขอที่อนุมัติแล้ว");
    } finally {
      await db.from("rubber_bill_approval_requests")
        .delete()
        .eq("client_temp_id", clientTempId)
        .eq("request_status", "pending");
      const superProfile = await profile(superAdmin);
      const listed = await superAdmin.request.get("/api/lanflow/rubber-bills/approval-groups");
      if (listed.ok()) {
        const body = await listed.json() as { groups: Array<{ id: string; revisionNo: number; locationIds: string[] }> };
        const group = body.groups.find((item) => item.locationIds.includes(superProfile.locationIds[0]));
        if (group) await superAdmin.request.delete(`/api/lanflow/rubber-bills/approval-groups/${group.id}?revision=${group.revisionNo}`);
      }
      await superAdmin.close();
    }
  });

  test("concurrent changes create one pending request and stale revisions conflict", async ({ browser }) => {
    const branchAdmin = await authContext(browser, "admin");
    const superAdmin = await authContext(browser, "super_admin");
    const db = service();
    let createdBillId: string | undefined;
    let createdClientTempId: string | undefined;

    try {
      const branchAdminProfile = await profile(branchAdmin);
      const locationId = branchAdminProfile.locationIds[0];
      expect((await saveSettings(superAdmin, locationId, 0, null)).ok()).toBeTruthy();

      const createPayload = billPayload({ locationId, price: 20 });
      createdClientTempId = createPayload.clientTempId;
      const created = await syncBill(branchAdmin, createPayload);
      expect(created.body.status).toBe("synced");
      createdBillId = created.body.id;

      const updatePayload = billPayload({
        locationId,
        clientTempId: createPayload.clientTempId,
        operation: "update",
        expectedRevisionNo: created.body.revisionNo,
        customerName: "คำขอพร้อมกันแบบแก้ไข",
      });
      const deletePayload = {
        ...billPayload({
          locationId,
          clientTempId: createPayload.clientTempId,
          operation: "delete",
          expectedRevisionNo: created.body.revisionNo,
        }),
        deletedByName: branchAdminProfile.name,
        deletedByPhone: branchAdminProfile.phone,
      };
      const concurrent = await Promise.all([
        syncBill(branchAdmin, updatePayload),
        syncBill(branchAdmin, deletePayload),
      ]);
      expect(concurrent.map((result) => result.body.status).sort()).toEqual([
        "conflict",
        "pending_approval",
      ]);

      const { data: pendingRows, count } = await db
        .from("rubber_bill_approval_requests")
        .select("id", { count: "exact" })
        .eq("bill_id", created.body.id!)
        .eq("request_status", "pending");
      expect(count).toBe(1);
      expect(pendingRows).toHaveLength(1);
      expect((await superAdmin.request.delete(
        `/api/lanflow/rubber-bills/approval-requests/${pendingRows![0].id}`
      )).ok()).toBeTruthy();

      expect((await saveSettings(superAdmin, locationId, 1440, null)).ok()).toBeTruthy();
      const directUpdate = await syncBill(branchAdmin, updatePayload);
      expect(directUpdate.body.status).toBe("synced");
      const stale = await syncBill(branchAdmin, {
        ...updatePayload,
        idempotencyKey: `stale:${createPayload.clientTempId}`,
      });
      expect(stale.response.status()).toBe(409);
      expect(stale.body.status).toBe("conflict");
    } finally {
      if (createdClientTempId) {
        await db.from("rubber_bill_approval_requests").delete().eq("client_temp_id", createdClientTempId);
      }
      if (createdBillId) {
        await db.from("rubber_bill_items").delete().eq("bill_id", createdBillId);
        await db.from("rubber_bills").delete().eq("id", createdBillId);
      }
      await Promise.all([branchAdmin.close(), superAdmin.close()]);
    }
  });

  test("approved delete keeps the Rubber Bill as a soft-deleted source", async ({ browser }) => {
    const branchAdmin = await authContext(browser, "admin");
    const superAdmin = await authContext(browser, "super_admin");
    const db = service();

    try {
      const branchAdminProfile = await profile(branchAdmin);
      const locationId = branchAdminProfile.locationIds[0];
      expect((await saveSettings(superAdmin, locationId, 0, null)).ok()).toBeTruthy();

      const createPayload = billPayload({ locationId, price: 20 });
      const created = await syncBill(branchAdmin, createPayload);
      const deletePayload = {
        ...billPayload({
          locationId,
          clientTempId: createPayload.clientTempId,
          operation: "delete",
          expectedRevisionNo: created.body.revisionNo,
        }),
        deletedByName: branchAdminProfile.name,
        deletedByPhone: branchAdminProfile.phone,
      };
      const pendingDelete = await syncBill(branchAdmin, deletePayload);
      expect(pendingDelete.body.status).toBe("pending_approval");

      const approved = await superAdmin.request.post(
        `/api/lanflow/rubber-bills/approval-requests/${pendingDelete.body.requestId}/approve`
      );
      expect(approved.ok(), await approved.text()).toBeTruthy();
      expect((await db.from("rubber_bills")
        .select("record_status, deleted_at, deleted_by_name, deleted_by_phone, central_price_snapshot, effective_price_cap_snapshot")
        .eq("id", created.body.id!)
        .single()).data).toMatchObject({
          record_status: "deleted",
          deleted_by_name: branchAdminProfile.name,
          deleted_by_phone: branchAdminProfile.phone,
          central_price_snapshot: 42,
          effective_price_cap_snapshot: 42,
        });
    } finally {
      await Promise.all([branchAdmin.close(), superAdmin.close()]);
    }
  });

  test("time request keeps source unchanged and cannot enter transfer or report", async ({ browser }) => {
    const admin = await authContext(browser, "admin");
    const superAdmin = await authContext(browser, "super_admin");
    const db = service();
    let secondReportId: string | undefined;
    let transferId: string | undefined;
    let billId: string | undefined;
    let requestId: string | undefined;

    try {
      const adminProfile = await profile(admin);
      const locationId = adminProfile.locationIds[0];
      expect((await saveSettings(superAdmin, locationId, 0, 0)).ok()).toBeTruthy();

      const createPayload = billPayload({ locationId, price: 42 });
      const created = await syncBill(admin, createPayload);
      expect(created.body.status).toBe("synced");
      billId = created.body.id;

      const updatePayload = billPayload({
        locationId,
        clientTempId: createPayload.clientTempId,
        operation: "update",
        expectedRevisionNo: created.body.revisionNo,
        price: 43,
        customerName: "ชื่อใหม่ที่ยังไม่ควรถูกใช้",
      });
      const pending = await syncBill(admin, updatePayload);
      expect(pending.body.status).toBe("pending_approval");
      expect(pending.body.matchedReasons).toEqual(["time", "price"]);
      requestId = pending.body.requestId;

      const { data: unchanged } = await db
        .from("rubber_bills")
        .select("id, customer_name")
        .eq("id", created.body.id!)
        .single();
      expect(unchanged?.customer_name).toBe("ลูกค้าทดสอบอนุมัติบิลยาง");

      transferId = crypto.randomUUID();
      expect((await db.from("money_transfers").insert({
        id: transferId,
        client_temp_id: transferId,
        idempotency_key: `approval-transfer:${transferId}`,
        location_id: locationId,
        customer_name: "ทดสอบ",
        net_amount_to_pay: 200,
      })).error).toBeNull();
      const blockedTransfer = await db.from("money_transfer_items").insert({
        transfer_id: transferId,
        source_type: "rubber_bill",
        source_id: created.body.id!,
        customer_name: "ทดสอบ",
        amount: 200,
      });
      expect(blockedTransfer.error?.message).toContain("กำลังรออนุมัติ");

      const report = await admin.request.post("/api/lanflow/reports", {
        data: { locationId },
      });
      const reportBody = await report.json() as {
        error?: string;
        blockers?: Array<{ key: string; label: string; count: number }>;
      };
      expect(report.status(), reportBody.error).toBe(409);
      expect(reportBody.blockers).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: "rubber_bill_pending", label: "บิลยางที่ยังไม่พร้อม" }),
      ]));
      expect(reportBody.blockers?.find((blocker) => blocker.key === "rubber_bill_pending")?.count).toBeGreaterThanOrEqual(1);

      const approved = await superAdmin.request.post(
        `/api/lanflow/rubber-bills/approval-requests/${pending.body.requestId}/approve`
      );
      expect(approved.ok(), await approved.text()).toBeTruthy();
      expect((await db.from("rubber_bills")
        .select("customer_name")
        .eq("id", created.body.id!)
        .single()).data?.customer_name).toBe("ชื่อใหม่ที่ยังไม่ควรถูกใช้");

      const secondReport = await admin.request.post("/api/lanflow/reports", {
        data: { locationId },
      });
      const secondReportBody = await secondReport.json() as {
        id?: string;
        error?: string;
        blockers?: Array<{ key: string; label: string; count: number }>;
      };
      expect(secondReport.status(), JSON.stringify(secondReportBody)).toBe(201);
      secondReportId = secondReportBody.id;
      expect((await db.from("report_items")
        .select("id")
        .eq("report_id", secondReportId!)
        .eq("entity_type", "rubber_bill")
        .eq("entity_id", created.body.id!)
        .maybeSingle()).data).not.toBeNull();

      const reportedUpdate = billPayload({
        locationId,
        clientTempId: createPayload.clientTempId,
        operation: "update",
        expectedRevisionNo: 2,
        price: 20.5,
        customerName: "ห้ามสร้างคำขอหลังทำรายงาน",
      });
      const blocked = await syncBill(admin, reportedUpdate);
      expect(blocked.response.status()).toBe(400);
      expect(blocked.body.errorMessage).toContain("อยู่ในรายงาน");
      expect((await db.from("rubber_bill_approval_requests")
        .select("id", { count: "exact", head: true })
        .eq("bill_id", created.body.id!)
        .eq("request_status", "pending")).count).toBe(0);
    } finally {
      if (secondReportId) {
        await superAdmin.request.delete(`/api/lanflow/reports/${secondReportId}`);
      }
      if (transferId) {
        await db.from("money_transfers").delete().eq("id", transferId);
      }
      if (requestId) {
        await db.from("rubber_bill_approval_requests").delete().eq("id", requestId);
      }
      if (billId) {
        await db.from("rubber_bill_items").delete().eq("bill_id", billId);
        await db.from("rubber_bills").delete().eq("id", billId);
      }
      await Promise.all([admin.close(), superAdmin.close()]);
    }
  });

  test("stock deduction updates atomically and rejects insufficient balance", async ({ browser }) => {
    const branchAdmin = await authContext(browser, "admin");
    const superAdmin = await authContext(browser, "super_admin");
    const db = service();
    const productId = crypto.randomUUID();
    const stockEntryId = crypto.randomUUID();
    let billId: string | undefined;

    try {
      const branchAdminProfile = await profile(branchAdmin);
      const locationId = branchAdminProfile.locationIds[0];
      const productName = `สินค้าทดสอบหักบิล-${productId.slice(0, 8)}`;
      const today = bangkokDateString();

      expect((await saveSettings(superAdmin, locationId, 30, 20)).ok()).toBeTruthy();
      expect((await db.from("stock_products").insert({
        id: productId,
        name: productName,
        unit: "แพ็ค",
        is_active: true,
        created_by_user_id: branchAdminProfile.id,
        created_by_name: branchAdminProfile.name,
        created_by_phone: branchAdminProfile.phone,
      })).error).toBeNull();
      expect((await db.from("stock_entries").insert({
        id: stockEntryId,
        server_bill_no: `STOCK-${stockEntryId.slice(0, 8)}`,
        tx_date: today,
        product_id: productId,
        product_name: productName,
        quantity_delta: 10,
        amount: 0,
        location_id: locationId,
        tx_type: "receive",
        record_status: "active",
        created_by_user_id: branchAdminProfile.id,
        created_by_name: branchAdminProfile.name,
        created_by_phone: branchAdminProfile.phone,
      })).error).toBeNull();

      const createPayload = billPayload({
        locationId,
        stockDeduction: { productId, quantity: 3, unitPrice: 10 },
      });
      const created = await syncBill(branchAdmin, createPayload);
      expect(created.response.ok(), created.body.errorMessage).toBeTruthy();
      expect(created.body).toMatchObject({ status: "synced", revisionNo: 1 });
      billId = created.body.id;

      let { data: movements } = await db
        .from("stock_movements")
        .select("source_id, source_type, quantity_delta")
        .eq("location_id", locationId)
        .eq("product_id", productId);
      expect(movements).toContainEqual(expect.objectContaining({
        source_id: billId,
        source_type: "rubber_bill_stock_deduction",
        quantity_delta: -3,
      }));
      expect(movements!.reduce((sum, row) => sum + Number(row.quantity_delta), 0)).toBe(7);

      const updated = await syncBill(branchAdmin, billPayload({
        locationId,
        clientTempId: createPayload.clientTempId,
        operation: "update",
        expectedRevisionNo: 1,
        stockDeduction: { productId, quantity: 5, unitPrice: 10 },
      }));
      expect(updated.response.ok(), updated.body.errorMessage).toBeTruthy();
      expect(updated.body).toMatchObject({ status: "synced", revisionNo: 2 });

      ({ data: movements } = await db
        .from("stock_movements")
        .select("source_id, source_type, quantity_delta")
        .eq("location_id", locationId)
        .eq("product_id", productId));
      expect(movements!.filter((row) => row.source_id === billId)).toEqual([
        expect.objectContaining({ quantity_delta: -5 }),
      ]);
      expect(movements!.reduce((sum, row) => sum + Number(row.quantity_delta), 0)).toBe(5);

      const rejected = await syncBill(branchAdmin, billPayload({
        locationId,
        clientTempId: createPayload.clientTempId,
        operation: "update",
        expectedRevisionNo: 2,
        stockDeduction: { productId, quantity: 11, unitPrice: 10 },
      }));
      expect(rejected.response.status()).toBe(400);
      expect(rejected.body).toMatchObject({
        status: "failed",
        errorMessage: "สต็อกสินค้าไม่พอสำหรับรายการหักสินค้าในบิลยาง",
      });

      const { data: unchangedBill } = await db
        .from("rubber_bills")
        .select("revision_no")
        .eq("id", billId!)
        .single();
      const { data: unchangedItems } = await db
        .from("rubber_bill_items")
        .select("quantity")
        .eq("bill_id", billId!)
        .eq("item_type", "stock_deduction");
      const { data: unchangedMovements } = await db
        .from("stock_movements")
        .select("source_id, quantity_delta")
        .eq("location_id", locationId)
        .eq("product_id", productId);
      expect(unchangedBill?.revision_no).toBe(2);
      expect(unchangedItems).toEqual([{ quantity: 5 }]);
      expect(unchangedMovements!.filter((row) => row.source_id === billId)).toEqual([
        expect.objectContaining({ quantity_delta: -5 }),
      ]);
      expect(unchangedMovements!.reduce((sum, row) => sum + Number(row.quantity_delta), 0)).toBe(5);
    } finally {
      if (billId) {
        await db.from("rubber_bill_items").delete().eq("bill_id", billId);
        await db.from("rubber_bills").delete().eq("id", billId);
      }
      await db.from("stock_entries").delete().eq("id", stockEntryId);
      await db.from("stock_products").delete().eq("id", productId);
      await Promise.all([branchAdmin.close(), superAdmin.close()]);
    }
  });

  test("approval UI derives the payable total from items instead of client summary fields", async ({ browser }) => {
    const context = await authContext(browser, "super_admin");
    const db = service();
    const customerName = `ApprovalCalc-${Date.now()}`;
    let requestId: string | undefined;

    try {
      const page = await context.newPage();
      await page.goto("/");
      const locationId = await selectedAppLocationId(page);
      expect(locationId).toBeTruthy();
      expect((await saveSettings(context, locationId!, 30, 0)).ok()).toBeTruthy();
      const payload: any = billPayload({
        locationId: locationId!,
        price: 43,
        configuredPriceSnapshot: 42,
        customerName,
      });
      payload.netTotal = 1;
      const result = await syncBill(context, payload);
      expect(result.body.status).toBe("pending_approval");
      requestId = result.body.requestId;
      expect(requestId).toBeTruthy();

      const { data: storedRequest, error: storedRequestError } = await db
        .from("rubber_bill_approval_requests")
        .select("proposed_payload")
        .eq("id", requestId!)
        .single();
      expect(storedRequestError).toBeNull();
      expect(storedRequest?.proposed_payload).toEqual(expect.objectContaining({
        netWeight: 10,
        rubberValue: 430,
        netRubberValue: 430,
        payableBeforeRounding: 430,
        netTotal: 430,
      }));

      await page.getByRole("button", { name: "บิลยาง" }).click();
      await page.getByRole("button", { name: /ตั้งค่าและอนุมัติบิลยาง/ }).click();
      const approvalDialog = page.getByRole("dialog", { name: "ตั้งค่าและอนุมัติบิลยาง" });
      const requestCard = page.locator("article", { hasText: customerName });
      await expect(requestCard).toBeVisible();
      await expect(requestCard.locator("p.text-pretty.text-ink\\/70")).toContainText(
        `${customerName} · ${payload.billDate} · ประเภทบิล: บิลเครื่องชั่งเล็ก · น้ำหนักสุทธิ: 10 กก. · ราคาเฉลี่ย: 43 บาท · มูลค่ายาง: 430 บาท · ยอดหัก: 0 บาท · ยอดสุทธิ: 430 บาท`
      );
      expect(await requestCard.locator(":scope > div").evaluate((row) => (
        row.firstElementChild?.querySelector('[aria-label="อนุมัติ"]') !== null
      ))).toBe(true);

      const headingOrder = await approvalDialog.locator("h3").allTextContents();
      expect(headingOrder.indexOf("งานรออนุมัติบิลยาง")).toBeLessThan(
        headingOrder.indexOf("กลุ่มราคาและเวลา")
      );
    } finally {
      if (requestId) {
        await db.from("rubber_bill_approval_requests").delete().eq("id", requestId);
      }
      await context.close();
    }
  });

  test("approval UI displays proposed values for pending updates", async ({ browser }) => {
    const context = await authContext(browser, "super_admin");
    const db = service();
    const clientTempId = crypto.randomUUID();
    const currentCustomer = `ApprovalCurrent-${Date.now()}`;
    const proposedCustomer = `ApprovalProposed-${Date.now()}`;
    const requesterName = `ApprovalRequester-${Date.now()}`;
    let billId: string | undefined;
    let requestId: string | undefined;

    try {
      const page = await context.newPage();
      await page.goto("/");
      const locationId = await selectedAppLocationId(page);
      expect(locationId).toBeTruthy();
      expect((await saveSettings(context, locationId!, 30, 0)).ok()).toBeTruthy();

      const created = await syncBill(context, billPayload({
        locationId: locationId!,
        clientTempId,
        price: 42,
        configuredPriceSnapshot: 42,
        customerName: currentCustomer,
      }));
      expect(created.body.status).toBe("synced");
      billId = created.body.id;
      expect(billId).toBeTruthy();

      const proposed = billPayload({
        locationId: locationId!,
        clientTempId,
        operation: "update",
        expectedRevisionNo: created.body.revisionNo,
        price: 43,
        configuredPriceSnapshot: 42,
        customerName: proposedCustomer,
        billType: "บิลที่เสนออนุมัติ",
      });
      const pending = await syncBill(context, proposed);
      expect(pending.body.status).toBe("pending_approval");
      requestId = pending.body.requestId;
      expect(requestId).toBeTruthy();
      expect((await db.from("rubber_bill_approval_requests")
        .update({ requested_by_name: requesterName })
        .eq("id", requestId!)).error).toBeNull();

      await page.getByRole("button", { name: "บิลยาง" }).click();
      await page.getByRole("button", { name: /ตั้งค่าและอนุมัติบิลยาง/ }).click();
      const approvalDialog = page.getByRole("dialog", { name: "ตั้งค่าและอนุมัติบิลยาง" });
      const requestCard = page.locator("article", { hasText: proposedCustomer });
      await expect(requestCard).toBeVisible();
      await expect(requestCard.locator("p.text-pretty.text-ink\\/70")).toContainText(
        `${proposedCustomer} · ${proposed.billDate} · ประเภทบิล: บิลที่เสนออนุมัติ · น้ำหนักสุทธิ: 10 กก. · ราคาเฉลี่ย: 43 บาท · มูลค่ายาง: 430 บาท · ยอดหัก: 0 บาท · ยอดสุทธิ: 430 บาท`
      );
      await expect(requestCard).toContainText(requesterName);
      await expect(requestCard).not.toContainText(currentCustomer);

      await context.setOffline(true);
      await page.evaluate(() => window.dispatchEvent(new Event("offline")));
      await expect(approvalDialog.getByRole("alert")).toContainText(
        "งานอนุมัติบิลยางใช้ได้เมื่อออนไลน์เท่านั้น",
      );
      await expect(requestCard).toHaveCount(0);
    } finally {
      await context.setOffline(false).catch(() => undefined);
      if (requestId) {
        await db.from("rubber_bill_approval_requests").delete().eq("id", requestId);
      }
      if (billId) {
        await db.from("rubber_bill_items").delete().eq("bill_id", billId);
        await db.from("rubber_bills").delete().eq("id", billId);
      }
      await context.close();
    }
  });

  test("ungrouped approval settings use a read-first inline editor", async ({ browser }) => {
    const superAdmin = await authContext(browser, "super_admin");

    try {
      const page = await superAdmin.newPage();
      await page.goto("/");
      await page.getByRole("button", { name: "บิลยาง" }).click();
      await page.getByRole("button", { name: /ตั้งค่าและอนุมัติบิลยาง/ }).click();

      const approvalDialog = page.getByRole("dialog", { name: "ตั้งค่าและอนุมัติบิลยาง" });
      const ungroupedSettings = approvalDialog.getByTestId("ungrouped-approval-settings");
      await expect(ungroupedSettings.getByRole("heading", { name: "สาขาที่ยังไม่จัดกลุ่ม" })).toBeVisible();
      await expect(ungroupedSettings.getByText(/เวลา \d+ นาที · ราคากลาง/)).toBeVisible();
      await expect(ungroupedSettings.getByRole("button", { name: "ลบ", exact: true })).toHaveCount(0);
      await expect(ungroupedSettings.getByLabel("เวลาแก้ไขได้ (นาที)")).toHaveCount(0);

      await ungroupedSettings.getByRole("button", { name: "แก้ไข", exact: true }).click();
      await expect(ungroupedSettings.getByRole("heading", { name: "สาขาในกลุ่ม" })).toBeVisible();
      await expect(ungroupedSettings.getByRole("heading", { name: "แก้ไขการตั้งค่า" })).toBeVisible();
      const minutesInput = ungroupedSettings.getByLabel("เวลาแก้ไขได้ (นาที)");
      await expect(minutesInput).toBeFocused();
      const originalMinutes = await minutesInput.inputValue();
      await minutesInput.fill(originalMinutes === "0" ? "1" : "0");
      await expect(ungroupedSettings.getByLabel("ราคายางที่กำหนด — ซื้อเกินราคากลางได้ (บาท/กก.)")).toBeVisible();
      await expect(ungroupedSettings.getByRole("button", { name: "บันทึกการตั้งค่า", exact: true })).toBeVisible();
      await ungroupedSettings.getByRole("button", { name: "ยกเลิก", exact: true }).click();
      await expect(ungroupedSettings.getByLabel("เวลาแก้ไขได้ (นาที)")).toHaveCount(0);
      await expect(ungroupedSettings.getByRole("button", { name: "แก้ไข", exact: true })).toBeFocused();
      await ungroupedSettings.getByRole("button", { name: "แก้ไข", exact: true }).click();
      await expect(ungroupedSettings.getByLabel("เวลาแก้ไขได้ (นาที)")).toHaveValue(originalMinutes);

      await page.route("**/api/lanflow/rubber-bills/approval-settings/ungrouped", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ errorMessage: "ค่ากลุ่มเริ่มต้นถูกแก้ไขโดยผู้ใช้อื่น" }),
        });
      });
      await ungroupedSettings.getByRole("button", { name: "บันทึกการตั้งค่า", exact: true }).click();
      await expect(ungroupedSettings.getByRole("button", { name: "บันทึกการตั้งค่า", exact: true })).toBeDisabled();
      await expect(ungroupedSettings.getByRole("button", { name: "ยกเลิก", exact: true })).toBeDisabled();
      await expect(ungroupedSettings.getByRole("alert")).toContainText("ค่ากลุ่มเริ่มต้นถูกแก้ไขโดยผู้ใช้อื่น");
    } finally {
      await superAdmin.close();
    }
  });

  test("only system managers see the approval entry point and it is disabled offline", async ({ browser }) => {
    const branchAdmin = await authContext(browser, "admin");
    const superAdmin = await authContext(browser, "super_admin");

    try {
      const [branchAdminPage, superPage] = await Promise.all([
        branchAdmin.newPage(),
        superAdmin.newPage(),
      ]);
      await Promise.all([branchAdminPage.goto("/"), superPage.goto("/")]);
      await Promise.all([
        branchAdminPage.getByRole("button", { name: "บิลยาง" }).click(),
        superPage.getByRole("button", { name: "บิลยาง" }).click(),
      ]);

      await expect(
        branchAdminPage.getByRole("button", { name: /ตั้งค่าและอนุมัติบิลยาง/ })
      ).toHaveCount(0);
      const managerButton = superPage.getByRole("button", {
        name: /ตั้งค่าและอนุมัติบิลยาง/,
      });
      await expect(managerButton).toBeVisible();
      await expect(managerButton).toBeEnabled();

      await superPage.evaluate(() => {
        Object.defineProperty(window.navigator, "onLine", {
          configurable: true,
          get: () => false,
        });
        window.dispatchEvent(new Event("offline"));
      });
      await expect(managerButton).toBeDisabled();
      await expect(managerButton).toHaveAttribute(
        "title",
        "ตั้งค่าและอนุมัติบิลยางใช้ได้เมื่อออนไลน์เท่านั้น",
      );
      await managerButton.dispatchEvent("click");
      await expect(
        superPage.getByRole("heading", { name: "ตั้งค่าและอนุมัติบิลยาง" })
      ).toHaveCount(0);

      await superPage.evaluate(() => {
        Object.defineProperty(window.navigator, "onLine", {
          configurable: true,
          get: () => true,
        });
        window.dispatchEvent(new Event("online"));
      });
      await expect(managerButton).toBeEnabled();
      await managerButton.click();
      const approvalDialog = superPage.getByRole("dialog", { name: "ตั้งค่าและอนุมัติบิลยาง" });
      await expect(approvalDialog.getByText("ราคากลางยางทั้งระบบ")).toBeVisible();
      await expect(approvalDialog.getByText("กลุ่มราคาและเวลา")).toBeVisible();
      const ungroupedSettings = approvalDialog.getByTestId("ungrouped-approval-settings");
      await expect(ungroupedSettings.getByRole("heading", { name: "สาขาที่ยังไม่จัดกลุ่ม" })).toBeVisible();
      await expect(approvalDialog.getByText("ราคายางที่กำหนดสูงสุด", { exact: true })).toBeVisible();
      await expect(approvalDialog.getByText("กฎวันที่บิล")).toBeVisible();
      await expect(approvalDialog.getByText("งานรออนุมัติบิลยาง")).toBeVisible();
      await ungroupedSettings.getByRole("button", { name: "แก้ไข", exact: true }).click();
      await expect(ungroupedSettings.getByLabel("เวลาแก้ไขได้ (นาที)")).toBeVisible();
      await expect(ungroupedSettings.getByLabel("ราคายางที่กำหนด — ซื้อเกินราคากลางได้ (บาท/กก.)")).toBeVisible();
    } finally {
      await Promise.all([branchAdmin.close(), superAdmin.close()]);
    }
  });
});
