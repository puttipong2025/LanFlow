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

async function syncBill(context: BrowserContext, payload: ReturnType<typeof billPayload>) {
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
    },
  };
}

async function saveSettings(
  context: BrowserContext,
  locationId: string,
  editWindowMinutes: number,
  configuredPrice: number | null
) {
  const listed = await context.request.get("/api/lanflow/rubber-bills/approval-groups");
  if (!listed.ok()) return listed;
  const { groups } = await listed.json() as {
    groups: Array<{ id: string; locationIds: string[] }>;
  };
  const group = groups.find((item) => item.locationIds.includes(locationId));
  if (!group) {
    return context.request.post("/api/lanflow/rubber-bills/approval-groups", {
      data: { locationIds: [locationId], editWindowMinutes, configuredPrice },
    });
  }
  return context.request.put(`/api/lanflow/rubber-bills/approval-groups/${group.id}`, {
    data: { locationIds: group.locationIds, editWindowMinutes, configuredPrice },
  });
}

test.describe.serial("Rubber Bill approval contract @rubber-bill-approval", () => {
  test("offline cached-price guard blocks only values above the cached cap", () => {
    const today = bangkokDateString();
    const cap20 = { editWindowMinutes: 30, configuredPrice: 20, nonCurrentDateRequiresApproval: false };
    const cap0 = { editWindowMinutes: 30, configuredPrice: 0, nonCurrentDateRequiresApproval: false };
    const noCap = { editWindowMinutes: 30, configuredPrice: null, nonCurrentDateRequiresApproval: false };
    expect(() => assertOfflineRubberBillPriceAllowed([0, 19.99, 20], today, cap20, false)).not.toThrow();
    expect(() => assertOfflineRubberBillPriceAllowed([20.5], today, noCap, false)).not.toThrow();
    expect(() => assertOfflineRubberBillPriceAllowed([20.5], today, cap20, true)).not.toThrow();
    expect(() => assertOfflineRubberBillPriceAllowed([20, 20.5], today, cap20, false))
      .toThrow("ต้องออนไลน์เพื่อส่งคำขออนุมัติ");
    expect(() => assertOfflineRubberBillPriceAllowed([0], today, cap0, false)).not.toThrow();
    expect(() => assertOfflineRubberBillPriceAllowed([0.01], today, cap0, false))
      .toThrow("ต้องออนไลน์เพื่อส่งคำขออนุมัติ");
    expect(() => assertOfflineRubberBillPriceAllowed([0], today, null, false))
      .toThrow("ยังไม่เคยโหลดกติกาอนุมัติ");
  });

  test("create uses the effective DB price group instead of a client snapshot", async ({ browser }) => {
    const manager = await authContext(browser, "super_admin");
    const db = service();
    const locationIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    const groupIds: string[] = [];
    const payloads = {
      missing: billPayload({ locationId: locationIds[0], price: 20.5, configuredPriceSnapshot: null }),
      tooHigh: billPayload({ locationId: locationIds[0], price: 20.5, configuredPriceSnapshot: 999 }),
      staleLow: billPayload({ locationId: locationIds[0], price: 15, configuredPriceSnapshot: 10 }),
      blankGroup: billPayload({ locationId: locationIds[1], price: 100, configuredPriceSnapshot: 0 }),
      ungrouped: billPayload({ locationId: locationIds[2], price: 100, configuredPriceSnapshot: 0 }),
    };
    const requestIds: string[] = [];

    try {
      expect((await db.from("locations").insert(locationIds.map((id, index) => ({
        id,
        name: `สาขาทดสอบ server price ${index + 1}`,
        code: `SP${id.replaceAll("-", "").slice(0, 6).toUpperCase()}`,
        is_active: true,
      })))).error).toBeNull();

      for (const [locationId, configuredPrice] of [
        [locationIds[0], 20],
        [locationIds[1], null],
      ] as const) {
        const created = await manager.request.post("/api/lanflow/rubber-bills/approval-groups", {
          data: { locationIds: [locationId], editWindowMinutes: 30, configuredPrice },
        });
        expect(created.status(), await created.text()).toBe(201);
        groupIds.push((await created.json() as { id: string }).id);
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
          configured_price_snapshot: 20,
          approval_group_id_snapshot: groupIds[0],
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
        configured_price_snapshot: 20,
      });
      const staleLowReplay = await syncBill(manager, payloads.staleLow);
      expect(staleLowReplay.body).toMatchObject({ status: "synced", id: staleLow.body.id });

      for (const payload of [payloads.blankGroup, payloads.ungrouped]) {
        const synced = await syncBill(manager, payload);
        expect(synced.body.status).toBe("synced");
        expect((await db.from("rubber_bills")
          .select("configured_price_snapshot")
          .eq("client_temp_id", payload.clientTempId)
          .single()).data).toEqual({ configured_price_snapshot: null });
      }
    } finally {
      if (requestIds.length > 0) {
        await db.from("rubber_bill_approval_requests").delete().in("id", requestIds);
      }
      await db.from("rubber_bills").delete().in(
        "client_temp_id",
        Object.values(payloads).map((payload) => payload.clientTempId),
      );
      for (const groupId of groupIds) {
        await manager.request.delete(`/api/lanflow/rubber-bills/approval-groups/${groupId}`);
      }
      await db.from("locations").delete().in("id", locationIds);
      await manager.close();
    }
  });

  test("synced create replay stays idempotent after the DB price cap changes", async ({ browser }) => {
    const manager = await authContext(browser, "super_admin");
    const db = service();
    const locationId = crypto.randomUUID();
    const originalPayload = billPayload({
      locationId,
      price: 15,
      configuredPriceSnapshot: 999,
    });
    const pendingPayload = billPayload({
      locationId,
      price: 11,
      configuredPriceSnapshot: null,
    });
    let groupId: string | null = null;
    let pendingRequestId: string | null = null;

    try {
      expect((await db.from("locations").insert({
        id: locationId,
        name: `สาขาทดสอบ create replay ${locationId.slice(0, 6)}`,
        code: `SI${locationId.replaceAll("-", "").slice(0, 6).toUpperCase()}`,
        is_active: true,
      })).error).toBeNull();
      const createdGroup = await manager.request.post("/api/lanflow/rubber-bills/approval-groups", {
        data: { locationIds: [locationId], editWindowMinutes: 30, configuredPrice: 20 },
      });
      expect(createdGroup.status(), await createdGroup.text()).toBe(201);
      groupId = (await createdGroup.json() as { id: string }).id;

      const first = await syncBill(manager, originalPayload);
      expect(first.body.status, JSON.stringify(first.body)).toBe("synced");
      expect((await db.from("rubber_bills")
        .select("id,configured_price_snapshot")
        .eq("client_temp_id", originalPayload.clientTempId)
        .single()).data).toEqual({
        id: first.body.id,
        configured_price_snapshot: 20,
      });

      const lowered = await manager.request.put(
        `/api/lanflow/rubber-bills/approval-groups/${groupId}`,
        { data: { locationIds: [locationId], editWindowMinutes: 30, configuredPrice: 10 } },
      );
      expect(lowered.ok(), await lowered.text()).toBeTruthy();

      const replay = await syncBill(manager, originalPayload);
      expect(replay.body).toMatchObject({ status: "synced", id: first.body.id });
      expect((await db.from("rubber_bills")
        .select("configured_price_snapshot")
        .eq("id", first.body.id!)
        .single()).data).toEqual({ configured_price_snapshot: 20 });
      expect((await db.from("rubber_bill_approval_requests")
        .select("id", { count: "exact", head: true })
        .eq("client_temp_id", originalPayload.clientTempId)).count).toBe(0);

      const changedKey = await syncBill(manager, {
        ...originalPayload,
        idempotencyKey: `different:${crypto.randomUUID()}`,
      });
      expect(changedKey.body.status).toBe("conflict");

      const reusedKey = await syncBill(manager, {
        ...billPayload({ locationId, price: 15 }),
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
      expect((await syncBill(manager, {
        ...pendingPayload,
        idempotencyKey: `different-pending:${crypto.randomUUID()}`,
      })).body.status).toBe("conflict");
      expect((await syncBill(manager, {
        ...billPayload({ locationId, price: 11 }),
        idempotencyKey: pendingPayload.idempotencyKey,
      })).body.status).toBe("conflict");
      expect((await db.from("rubber_bill_approval_requests")
        .select("id", { count: "exact", head: true })
        .eq("location_id", locationId)
        .eq("request_status", "pending")).count).toBe(1);
    } finally {
      await db.from("rubber_bill_approval_requests").delete().in(
        "client_temp_id",
        [originalPayload.clientTempId, pendingPayload.clientTempId],
      );
      await db.from("rubber_bills").delete().in(
        "client_temp_id",
        [originalPayload.clientTempId, pendingPayload.clientTempId],
      );
      if (groupId) await manager.request.delete(`/api/lanflow/rubber-bills/approval-groups/${groupId}`);
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
    } finally {
      if (deleteRequestId) await db.from("rubber_bill_approval_requests").delete().eq("id", deleteRequestId);
      await db.from("rubber_bills").delete().eq("client_temp_id", clientTempId);
      await superAdmin.request.put(`/api/lanflow/rubber-bills/approval-settings?locationId=${locationId}`, {
        data: { nonCurrentDateRequiresApproval: false },
      });
      await superAdmin.close();
    }
  });

  test("ungrouped branch bypasses price/time on create, update, delete but keeps the global date rule", async ({ browser }) => {
    const manager = await authContext(browser, "super_admin");
    const db = service();
    const locationId = crypto.randomUUID();
    const code = `UG${locationId.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
    const clientTempId = crypto.randomUUID();
    const dateClientTempId = crypto.randomUUID();
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
        price: 999,
        configuredPriceSnapshot: 20,
      }));
      expect(created.body.status).toBe("synced");
      expect((await db.from("rubber_bills")
        .select("configured_price_snapshot")
        .eq("id", created.body.id!)
        .single()).data?.configured_price_snapshot).toBeNull();

      const updated = await syncBill(manager, billPayload({
        locationId,
        clientTempId,
        operation: "update",
        expectedRevisionNo: created.body.revisionNo,
        price: 1_000,
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
          price: 999,
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
        configured_price_snapshot: null,
        edit_window_minutes_snapshot: null,
      });
    } finally {
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

    try {
      const branchAdminProfile = await profile(branchAdmin);
      const locationId = branchAdminProfile.locationIds[0];

      expect((await branchAdmin.request.post("/api/lanflow/rubber-bills/approval-groups", {
        data: { locationIds: [locationId], editWindowMinutes: 30, configuredPrice: 20 },
      })).status()).toBe(403);
      expect((await saveSettings(superAdmin, locationId, -1, 20)).status()).toBe(400);
      expect((await saveSettings(superAdmin, locationId, 1.5, 20)).status()).toBe(400);
      expect((await saveSettings(superAdmin, locationId, 30, 20.555)).status()).toBe(400);
      expect((await saveSettings(superAdmin, locationId, 30, 0)).ok()).toBeTruthy();
      expect((await saveSettings(superAdmin, locationId, 30, null)).ok()).toBeTruthy();

      const noSettingPayload = billPayload({
        locationId,
        price: 20.5,
        configuredPriceSnapshot: null,
      });
      const noSettingCreate = await syncBill(branchAdmin, noSettingPayload);
      expect(
        noSettingCreate.response.ok(),
        JSON.stringify(noSettingCreate.body)
      ).toBeTruthy();
      expect(noSettingCreate.body.status).toBe("synced");

      expect((await saveSettings(superAdmin, locationId, 30, 20)).ok()).toBeTruthy();
      expect((await db.from("rubber_bill_approval_requests")
        .select("id", { count: "exact", head: true })
        .eq("bill_id", noSettingCreate.body.id!)).count).toBe(0);

      const payload = billPayload({ locationId, prices: [20, 20.5] });
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
        configured_price_snapshot: 20,
        edit_window_minutes_snapshot: 30,
        approval_group_id_snapshot: expect.any(String),
      });

      expect((await saveSettings(superAdmin, locationId, 30, 21)).ok()).toBeTruthy();
      expect((await saveSettings(superAdmin, locationId, 30, null)).ok()).toBeTruthy();
      expect((await db.from("rubber_bill_approval_requests")
        .select("configured_price_snapshot")
        .eq("id", pending.body.requestId!)
        .single()).data?.configured_price_snapshot).toBe(20);

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
    } finally {
      await Promise.all([branchAdmin.close(), superAdmin.close()]);
    }
  });

  test("manager requests and approves own exceptional price without retriggering unchanged price", async ({ browser }) => {
    const superAdmin = await authContext(browser, "super_admin");
    const db = service();

    try {
      const superProfile = await profile(superAdmin);
      const locationId = superProfile.locationIds[0];
      expect((await saveSettings(superAdmin, locationId, 1440, 20)).ok()).toBeTruthy();

      const createPayload = billPayload({ locationId, price: 20.5 });
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
          configured_price_snapshot: 20,
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
        price: 20.5,
        customerName: "ลูกค้าแก้ชื่อแต่ราคาเดิม",
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
        price: 20.75,
        customerName: "ลูกค้าแก้ราคา",
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
      expect(source?.rubber_bill_items).toEqual([expect.objectContaining({ price: 20.5 })]);

      expect((await superAdmin.request.delete(
        `/api/lanflow/rubber-bills/approval-requests/${pendingPriceUpdate.body.requestId}`
      )).ok()).toBeTruthy();

      const immutable = await db
        .from("rubber_bill_approval_requests")
        .delete()
        .eq("id", pendingCreate.body.requestId!);
      expect(immutable.error?.message).toContain("ประวัติคำขอที่อนุมัติแล้ว");
    } finally {
      await superAdmin.close();
    }
  });

  test("concurrent changes create one pending request and stale revisions conflict", async ({ browser }) => {
    const branchAdmin = await authContext(browser, "admin");
    const superAdmin = await authContext(browser, "super_admin");
    const db = service();

    try {
      const branchAdminProfile = await profile(branchAdmin);
      const locationId = branchAdminProfile.locationIds[0];
      expect((await saveSettings(superAdmin, locationId, 0, null)).ok()).toBeTruthy();

      const createPayload = billPayload({ locationId, price: 20 });
      const created = await syncBill(branchAdmin, createPayload);
      expect(created.body.status).toBe("synced");

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
      expect(concurrent.map((result) => result.body.status)).toEqual([
        "pending_approval",
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
        .select("record_status, deleted_at, deleted_by_name, deleted_by_phone")
        .eq("id", created.body.id!)
        .single()).data).toMatchObject({
          record_status: "deleted",
          deleted_by_name: branchAdminProfile.name,
          deleted_by_phone: branchAdminProfile.phone,
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
      expect((await saveSettings(superAdmin, locationId, 0, 20)).ok()).toBeTruthy();

      const createPayload = billPayload({ locationId, price: 20 });
      const created = await syncBill(admin, createPayload);
      expect(created.body.status).toBe("synced");
      billId = created.body.id;

      const updatePayload = billPayload({
        locationId,
        clientTempId: createPayload.clientTempId,
        operation: "update",
        expectedRevisionNo: created.body.revisionNo,
        price: 20.5,
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
      const reportBody = await report.json() as { error?: string; errorGroups?: string[] };
      expect(report.status(), reportBody.error).toBe(409);
      expect(reportBody.errorGroups).toEqual(["บิลยาง"]);

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
      const secondReportBody = await secondReport.json() as { id?: string; error?: string };
      expect(secondReport.status(), secondReportBody.error).toBe(201);
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
      expect((await saveSettings(context, locationId!, 30, 20)).ok()).toBeTruthy();
      const payload: any = billPayload({
        locationId: locationId!,
        price: 20.5,
        configuredPriceSnapshot: 20,
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
        rubberValue: 205,
        netRubberValue: 205,
        payableBeforeRounding: 205,
        netTotal: 205,
      }));

      await page.getByRole("button", { name: "บิลยาง" }).click();
      await page.getByRole("button", { name: /ตั้งค่าและอนุมัติบิลยาง/ }).click();
      const requestCard = page.locator("article", { hasText: customerName });
      await expect(requestCard).toBeVisible();
      await expect(requestCard).toContainText("ยอดสุทธิ: 205");
    } finally {
      if (requestId) {
        await db.from("rubber_bill_approval_requests").delete().eq("id", requestId);
      }
      await context.close();
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

      await superAdmin.setOffline(true);
      await superPage.evaluate(() => window.dispatchEvent(new Event("offline")));
      await expect(managerButton).toBeDisabled();
      await expect(managerButton).toHaveAttribute(
        "title",
        "ตั้งค่าและอนุมัติบิลยางใช้ได้เมื่อออนไลน์เท่านั้น",
      );
      await managerButton.dispatchEvent("click");
      await expect(
        superPage.getByRole("heading", { name: "ตั้งค่าและอนุมัติบิลยาง" })
      ).toHaveCount(0);

      await superAdmin.setOffline(false);
      await superPage.evaluate(() => window.dispatchEvent(new Event("online")));
      await expect(managerButton).toBeEnabled();
      await managerButton.click();
      const approvalDialog = superPage.getByRole("dialog", { name: "ตั้งค่าและอนุมัติบิลยาง" });
      await expect(approvalDialog.getByText("กลุ่มเกณฑ์ราคาและเวลา")).toBeVisible();
      await expect(approvalDialog.getByText("กฎวันที่บิล")).toBeVisible();
      await expect(approvalDialog.getByText("งานรออนุมัติบิลยาง")).toBeVisible();
      await approvalDialog.getByRole("button", { name: "แก้ไข" }).first().click();
      await expect(approvalDialog.getByLabel("เวลาแก้ไขได้ (นาที)")).toBeVisible();
      await expect(approvalDialog.getByLabel("ราคายางที่กำหนด")).toBeVisible();
    } finally {
      await Promise.all([branchAdmin.close(), superAdmin.close()]);
    }
  });
});
