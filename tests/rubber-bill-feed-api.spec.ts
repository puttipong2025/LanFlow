import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

test.describe("Rubber Bill cursor feed @rubber-bill-feed", () => {
  test.use({ storageState: "playwright/.auth/super_admin.json" });

  test("paginates without overlap and rejects malformed or cross-scope cursors", async ({ request }) => {
    const me = await (await request.get("/api/auth/me")).json() as {
      profile: { id: string; locationIds: string[] };
    };
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const counts = await Promise.all(me.profile.locationIds.map(async (locationId) => ({
      locationId,
      count: (await admin.from("rubber_bills").select("id", { count: "exact", head: true })
        .eq("location_id", locationId).eq("record_status", "active")).count ?? 0,
    })));
    const locationId = counts.sort((a, b) => b.count - a.count)[0]?.locationId;
    expect(locationId).toBeTruthy();

    const firstResponse = await request.get(`/api/lanflow/rubber-bills/feed?locationId=${locationId}&limit=2`);
    expect(firstResponse.ok()).toBeTruthy();
    const first = await firstResponse.json() as { rows: Array<{ id: string }>; nextCursor: string | null; hasMore: boolean };
    expect(first.rows.length).toBeLessThanOrEqual(2);
    expect(new Set(first.rows.map((row) => row.id)).size).toBe(first.rows.length);

    if (first.nextCursor) {
      const secondResponse = await request.get(`/api/lanflow/rubber-bills/feed?locationId=${locationId}&limit=2&cursor=${encodeURIComponent(first.nextCursor)}`);
      expect(secondResponse.ok()).toBeTruthy();
      const second = await secondResponse.json() as { rows: Array<{ id: string }> };
      const firstIds = new Set(first.rows.map((row) => row.id));
      expect(second.rows.some((row) => firstIds.has(row.id))).toBe(false);

      const mismatch = await request.get(`/api/lanflow/rubber-bills/feed?locationId=${locationId}&limit=2&search=คนละขอบเขต&cursor=${encodeURIComponent(first.nextCursor)}`);
      expect(mismatch.status()).toBe(400);
      expect((await mismatch.json()).code).toBe("CURSOR_SCOPE_MISMATCH");
    }

    const malformed = await request.get(`/api/lanflow/rubber-bills/feed?locationId=${locationId}&cursor=not-a-cursor`);
    expect(malformed.status()).toBe(400);
    expect((await malformed.json()).code).toBe("INVALID_CURSOR");

    const forgedCursor = Buffer.from(JSON.stringify({
      version: 2,
      ownerUserId: me.profile.id,
      locationId,
      mode: "latest",
      documentStatus: "any",
      search: "",
      sortAt: "not-a-timestamp",
      workIdentity: "bill:not-a-uuid",
    }), "utf8").toString("base64url");
    const forged = await request.get(
      `/api/lanflow/rubber-bills/feed?locationId=${locationId}&cursor=${encodeURIComponent(forgedCursor)}`,
    );
    expect(forged.status()).toBe(400);
    expect((await forged.json()).code).toBe("INVALID_CURSOR");

    const invalidLocation = await request.get("/api/lanflow/rubber-bills/feed?locationId=not-a-uuid");
    expect(invalidLocation.status()).toBe(400);

    for (const search of ["ภาษาไทย", "%", "_", ",", "  หลาย   ช่อง  "]) {
      const response = await request.get(`/api/lanflow/rubber-bills/feed?locationId=${locationId}&search=${encodeURIComponent(search)}`);
      expect(response.ok()).toBeTruthy();
    }
  });

  test("loads 150 rows first and the next cursor continues with older rows", async ({ request }) => {
    const me = await (await request.get("/api/auth/me")).json() as {
      profile: { id: string; name: string; phone: string; locationIds: string[] };
    };
    const locationId = me.profile.locationIds[0];
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const marker = `CURSOR-${Date.now()}`;
    const billIds = Array.from({ length: 151 }, () => crypto.randomUUID());
    const base = Date.now() + 86_400_000;
    const bills = billIds.map((id, index) => {
      const createdAt = new Date(base + index * 1_000).toISOString();
      return {
        id, client_temp_id: id, local_bill_no: `${marker}-${index}`, server_bill_no: `${marker}-${index}`,
        idempotency_key: `${marker}:${index}`, sync_status: "synced", record_status: "active",
        location_id: locationId, bill_no: `${marker}-${index}`, bill_date: createdAt.slice(0, 10),
        customer_name: marker, bill_type: "weighing", weight: 100,
        rubber_value: 1_000, average_price: 10, net_total: 1_000,
        client_recorded_at: createdAt, client_created_at: createdAt, server_received_at: createdAt,
        created_at: createdAt, created_by_user_id: me.profile.id,
        created_by_name: me.profile.name, created_by_phone: me.profile.phone,
      };
    });
    try {
      expect((await admin.from("rubber_bills").insert(bills)).error).toBeNull();
      expect((await admin.from("rubber_bill_items").insert(billIds.map((billId) => ({
        bill_id: billId, item_type: "weigh", description: "ชั่ง", weight_in: 100,
        weight_out: 0, net_weight: 100, price: 10, total: 1_000, sequence_no: 1,
      })))).error).toBeNull();

      const firstResponse = await request.get(`/api/lanflow/rubber-bills/feed?locationId=${locationId}&search=${marker}&limit=150`);
      expect(firstResponse.ok()).toBeTruthy();
      const first = await firstResponse.json() as { rows: Array<{ id: string }>; nextCursor: string | null; hasMore: boolean };
      expect(first.rows).toHaveLength(150);
      expect(first.hasMore).toBe(true);
      expect(first.nextCursor).toBeTruthy();

      const secondResponse = await request.get(`/api/lanflow/rubber-bills/feed?locationId=${locationId}&search=${marker}&limit=100&cursor=${encodeURIComponent(first.nextCursor!)}`);
      expect(secondResponse.ok()).toBeTruthy();
      const second = await secondResponse.json() as { rows: Array<{ id: string }>; hasMore: boolean };
      expect(second.rows).toHaveLength(1);
      expect(second.hasMore).toBe(false);
      expect(new Set([...first.rows, ...second.rows].map((row) => row.id)).size).toBe(151);
    } finally {
      await admin.from("rubber_bill_items").delete().in("bill_id", billIds);
      await admin.from("rubber_bills").delete().in("id", billIds);
    }
  });

  test("keeps proposed approval values separate from the current bill", async ({ request }) => {
    const me = await (await request.get("/api/auth/me")).json() as {
      profile: { id: string; name: string; phone: string; locationIds: string[] };
    };
    const locationId = me.profile.locationIds[0];
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const billId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const marker = `APPROVAL-SUMMARY-${Date.now()}`;
    const requesterName = `${marker}-REQUESTER`;
    const now = new Date().toISOString();
    const currentPayload = {
      locationId,
      localBillNo: marker,
      billDate: "2026-09-28",
      customerName: `${marker}-CURRENT`,
      billType: "บิลปัจจุบัน",
      netWeight: 50,
      averagePrice: 10,
      netRubberValue: 500,
      deductionTotal: 20,
      netTotal: 480,
    };
    const proposedPayload = {
      ...currentPayload,
      operation: "update",
      expectedRevisionNo: 0,
      clientTempId: billId,
      idempotencyKey: `update:${billId}:0`,
      customerName: `${marker}-PROPOSED`,
      billType: "บิลที่เสนอ",
      netWeight: 75,
      averagePrice: 12,
      netRubberValue: 900,
      deductionTotal: 30,
      netTotal: 870,
    };

    try {
      expect((await admin.from("rubber_bills").insert({
        id: billId,
        client_temp_id: billId,
        local_bill_no: marker,
        server_bill_no: marker,
        idempotency_key: `create:${billId}:0`,
        sync_status: "synced",
        record_status: "active",
        location_id: locationId,
        bill_no: marker,
        bill_date: currentPayload.billDate,
        customer_name: currentPayload.customerName,
        bill_type: currentPayload.billType,
        weight: 50,
        rubber_value: 500,
        average_price: currentPayload.averagePrice,
        deduction_total: currentPayload.deductionTotal,
        net_total: currentPayload.netTotal,
        formula_version: 2,
        client_recorded_at: now,
        client_created_at: now,
        server_received_at: now,
        created_at: now,
        created_by_user_id: me.profile.id,
        created_by_name: me.profile.name,
        created_by_phone: me.profile.phone,
      })).error).toBeNull();
      expect((await admin.from("rubber_bill_approval_requests").insert({
        id: requestId,
        operation: "update",
        request_status: "pending",
        bill_id: billId,
        location_id: locationId,
        client_temp_id: billId,
        idempotency_key: proposedPayload.idempotencyKey,
        base_revision_no: 0,
        matched_reasons: ["time"],
        edit_window_minutes_snapshot: 30,
        original_payload: currentPayload,
        proposed_payload: proposedPayload,
        requested_by_user_id: me.profile.id,
        requested_by_name: requesterName,
        requested_by_phone: me.profile.phone,
        requested_at: now,
      })).error).toBeNull();

      const response = await request.get(
        `/api/lanflow/rubber-bills/feed?locationId=${locationId}&mode=pending_approval&search=${marker}`
      );
      expect(response.ok()).toBeTruthy();
      const body = await response.json() as {
        rows: Array<Record<string, any>>;
        evidenceStates: Array<Record<string, unknown>>;
      };
      expect(body.rows).toHaveLength(1);
      expect(body.evidenceStates).toEqual([]);
      expect(body.rows[0]).toMatchObject({
        customer_name: currentPayload.customerName,
        bill_type: currentPayload.billType,
        net_weight: currentPayload.netWeight,
        average_price: currentPayload.averagePrice,
        net_rubber_value: currentPayload.netRubberValue,
        deduction_total: currentPayload.deductionTotal,
        net_total: currentPayload.netTotal,
      });
      expect(body.rows[0].approval_proposed_summary).toEqual({
        customerName: proposedPayload.customerName,
        billDate: proposedPayload.billDate,
        billType: proposedPayload.billType,
        netWeight: proposedPayload.netWeight,
        averagePrice: proposedPayload.averagePrice,
        netRubberValue: proposedPayload.netRubberValue,
        deductionTotal: proposedPayload.deductionTotal,
        netTotal: proposedPayload.netTotal,
      });
      expect(body.rows[0].approval_requested_by_name).toBe(requesterName);
      expect(body.rows[0]).not.toHaveProperty("proposed_payload");
      expect(body.rows[0]).not.toHaveProperty("approval_original_summary");
      expect(body.rows[0]).not.toHaveProperty("approval_requested_at");

      const latestResponse = await request.get(
        `/api/lanflow/rubber-bills/feed?locationId=${locationId}&mode=latest&search=${marker}`
      );
      expect(latestResponse.ok()).toBeTruthy();
      const latest = await latestResponse.json() as { rows: Array<Record<string, any>> };
      expect(latest.rows).toHaveLength(1);
      expect(latest.rows[0].approval_proposed_summary).toBeNull();
      expect(latest.rows[0].approval_requested_by_name).toBeNull();
    } finally {
      await admin.from("rubber_bill_approval_requests").delete().eq("id", requestId);
      await admin.from("rubber_bills").delete().eq("id", billId);
    }
  });

  test("pages more than 150 pending creates through the same minimal work feed", async ({ request }) => {
    const me = await (await request.get("/api/auth/me")).json() as {
      profile: { id: string; name: string; phone: string; locationIds: string[] };
    };
    const locationId = me.profile.locationIds[0];
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const marker = `APPROVAL-FEED-${Date.now()}`;
    const requestIds = Array.from({ length: 151 }, () => crypto.randomUUID());
    const rows = requestIds.map((id, index) => {
      const requestedAt = new Date(Date.now() + index * 1_000).toISOString();
      return {
        id,
        operation: "create",
        request_status: "pending",
        location_id: locationId,
        client_temp_id: `${marker}-${index}`,
        idempotency_key: `${marker}:${index}`,
        base_revision_no: 0,
        matched_reasons: ["price"],
        configured_price_snapshot: 10,
        edit_window_minutes_snapshot: 30,
        original_payload: null,
        proposed_payload: {
          locationId,
          localBillNo: `${marker}-${index}`,
          billDate: requestedAt.slice(0, 10),
          customerName: marker,
          billType: "บิลเครื่องชั่งเล็ก",
          netWeight: 100,
          averagePrice: 10,
          netRubberValue: 1_000,
          deductionTotal: 0,
          netTotal: 1_000,
          clientCreatedAt: requestedAt,
          clientRecordedAt: requestedAt,
          items: [{ itemType: "weigh", sequenceNo: 1, title: "ชั่ง", inWeight: 100, outWeight: 0, netWeight: 100, unitPrice: 10, totalAmount: 1_000 }],
        },
        requested_by_user_id: me.profile.id,
        requested_by_name: me.profile.name,
        requested_by_phone: me.profile.phone,
        requested_at: requestedAt,
      };
    });
    try {
      expect((await admin.from("rubber_bill_approval_requests").insert(rows)).error).toBeNull();
      const firstStartedAt = performance.now();
      const firstResponse = await request.get(`/api/lanflow/rubber-bills/feed?locationId=${locationId}&mode=pending_approval&search=${marker}&limit=150`);
      expect(firstResponse.ok()).toBeTruthy();
      const firstBody = await firstResponse.body();
      const firstPageMs = Math.round(performance.now() - firstStartedAt);
      const first = JSON.parse(firstBody.toString("utf8")) as {
        rows: Array<Record<string, unknown>>; nextCursor: string | null; hasMore: boolean;
      };
      expect(first.rows).toHaveLength(150);
      expect(first.hasMore).toBe(true);
      expect(first.nextCursor).toBeTruthy();
      expect(first.rows.every((row) => row.row_kind === "approval_create")).toBe(true);
      expect(first.rows.every((row) => String(row.work_identity).startsWith("approval:"))).toBe(true);
      expect(first.rows.every((row) => !("original_payload" in row) && !("proposed_payload" in row))).toBe(true);
      expect(first.rows.every((row) => !("approval_proposed_summary" in row))).toBe(true);
      expect(first.rows.every((row) => !("approval_requested_by_name" in row))).toBe(true);

      const secondStartedAt = performance.now();
      const secondResponse = await request.get(`/api/lanflow/rubber-bills/feed?locationId=${locationId}&mode=pending_approval&search=${marker}&limit=150&cursor=${encodeURIComponent(first.nextCursor!)}`);
      expect(secondResponse.ok()).toBeTruthy();
      const secondBody = await secondResponse.body();
      const second = JSON.parse(secondBody.toString("utf8")) as { rows: Array<Record<string, unknown>>; hasMore: boolean };
      expect(second.rows).toHaveLength(1);
      expect(second.hasMore).toBe(false);
      const identities = [...first.rows, ...second.rows].map((row) => String(row.work_identity));
      expect(new Set(identities).size).toBe(151);
      console.info("[rubber-approval-feed-benchmark]", JSON.stringify({
        rows: 151,
        firstPageRows: first.rows.length,
        firstPageMs,
        firstPageBytes: firstBody.byteLength,
        secondPageMs: Math.round(performance.now() - secondStartedAt),
        secondPageBytes: secondBody.byteLength,
      }));
    } finally {
      await admin.from("rubber_bill_approval_requests").delete().in("id", requestIds);
    }
  });
});

test.describe("Rubber Bill pending approval feed authorization @rubber-bill-feed", () => {
  test.use({ storageState: "playwright/.auth/admin.json" });

  test("rejects a branch admin before calling the manager-only feed", async ({ request }) => {
    const me = await (await request.get("/api/auth/me")).json() as {
      profile: { locationIds: string[] };
    };
    const locationId = me.profile.locationIds[0];
    expect(locationId).toBeTruthy();

    const response = await request.get(
      `/api/lanflow/rubber-bills/feed?locationId=${locationId}&mode=pending_approval`,
    );
    expect(response.status()).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "ไม่มีสิทธิ์เข้าถึงงานอนุมัติ" });
  });
});
