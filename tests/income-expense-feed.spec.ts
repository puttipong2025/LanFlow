import { test, expect, type APIRequestContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { bangkokDateString, bangkokWallClockToUtcIso } from "../src/lib/bangkok-date";

type FeedRow = {
  id: string;
  type: "income" | "expense";
  cost: number | string;
  title: string;
  txDate?: string;
  relationSourceType?: string;
  relationSourceId?: string;
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function today() {
  return bangkokDateString();
}

function startDate() {
  const date = new Date(`${today()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 89);
  return date.toISOString().slice(0, 10);
}

function sum(rows: FeedRow[]) {
  return rows.reduce((total, row) => total + Number(row.cost), 0);
}

function dailyTotals(rows: Array<{ date: string; amount: number | string }>) {
  return Object.fromEntries(rows.reduce((groups, row) => {
    groups.set(row.date, (groups.get(row.date) ?? 0) + Number(row.amount));
    return groups;
  }, new Map<string, number>()));
}

async function fetchAllFeed(request: APIRequestContext, locationId: string) {
  const rows: FeedRow[] = [];
  let cursor: string | null = null;
  do {
    const search = new URLSearchParams({ locationId });
    if (cursor) search.set("cursor", cursor);
    const response = await request.get(`/api/lanflow/income-expense/feed?${search}`);
    expect(response.ok()).toBeTruthy();
    const page = await response.json() as { rows: FeedRow[]; nextCursor: string | null };
    rows.push(...page.rows);
    cursor = page.nextCursor;
  } while (cursor);
  return rows;
}

function createIncomePayload(locationId: string, title: string) {
  const clientTempId = crypto.randomUUID();
  const now = new Date().toISOString();
  return {
    operation: "create",
    expectedRevisionNo: 0,
    clientTempId,
    idempotencyKey: `create:${clientTempId}:0`,
    locationId,
    recordStatus: "active",
    localBillNo: `LOCAL-${clientTempId.slice(0, 8)}`,
    txDate: today(),
    type: "income",
    title,
    cost: 100,
    billOption: "รายรับ",
    unit: null,
    price: null,
    clientRecordedAt: now,
    clientCreatedAt: now,
  };
}

test.describe("Income/Expense feed correctness @income-expense-feed", () => {
  test.use({ storageState: "playwright/.auth/user.json" });

  test("preserves legacy source totals and rejects an inaccessible branch", async ({ request }) => {
    expect(serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY is required for feed verification").toBeTruthy();

    const meResponse = await request.get("/api/auth/me");
    expect(meResponse.ok()).toBeTruthy();
    const me = await meResponse.json() as { profile: { locationIds: string[] } };
    const locationId = me.profile.locationIds[0];
    expect(locationId).toBeTruthy();

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: locations, error: locationsError } = await admin.from("locations").select("id").eq("is_active", true);
    expect(locationsError).toBeNull();
    let temporaryLocationId: string | null = null;
    let inaccessibleLocationId = locations?.find((location) => !me.profile.locationIds.includes(location.id))?.id;
    if (!inaccessibleLocationId) {
      temporaryLocationId = crypto.randomUUID();
      inaccessibleLocationId = temporaryLocationId;
      expect((await admin.from("locations").insert({
        id: temporaryLocationId,
        name: `Income feed inaccessible ${temporaryLocationId.slice(0, 8)}`,
        code: `IF-${temporaryLocationId.slice(0, 5)}`,
        is_active: true,
      })).error).toBeNull();
    }

    try {
      const denied = await request.get(`/api/lanflow/income-expense/feed?locationId=${inaccessibleLocationId}`);
      expect(denied.status()).toBe(403);

    const feed = await fetchAllFeed(request, locationId);
    const feedActual = feed.filter((row) => !row.relationSourceType);
    const feedIncoming = feed.filter((row) => row.id.startsWith("money-transfer-income:"));
    const feedOutgoing = feed.filter((row) => row.id.startsWith("money-transfer-branch-expense:"));
    const feedBranchPaid = feed.filter((row) => row.id.startsWith("money-transfer-branch-paid-expense:"));
    const feedRubber = feed.filter((row) => row.relationSourceType === "rubber_bill_daily");

    const rangeStart = startDate();
    const rangeEnd = today();
    const afterRange = new Date(`${rangeEnd}T00:00:00.000Z`);
    afterRange.setUTCDate(afterRange.getUTCDate() + 1);
    const transferStart = bangkokWallClockToUtcIso(`${rangeStart}T00:00`);
    const transferEndExclusive = bangkokWallClockToUtcIso(`${afterRange.toISOString().slice(0, 10)}T00:00`);
    const [actualResult, transferResult, rubberResult] = await Promise.all([
      admin.from("income_expense").select("type,cost").eq("location_id", locationId).eq("record_status", "active").gte("tx_date", rangeStart).lte("tx_date", rangeEnd),
      admin.from("money_transfers").select("id,location_id,target_location_id,transfer_type,transfer_status,record_status,net_amount_to_pay,branch_paid_amount,created_at").gte("created_at", transferStart).lt("created_at", transferEndExclusive),
      admin.from("rubber_bills").select("id,bill_date,net_total,sync_status,server_bill_no").eq("location_id", locationId).eq("record_status", "active").gt("net_total", 0).gte("bill_date", rangeStart).lte("bill_date", rangeEnd),
    ]);
    expect(actualResult.error).toBeNull();
    expect(transferResult.error).toBeNull();
    expect(rubberResult.error).toBeNull();

    expect(sum(feedActual)).toBe((actualResult.data ?? []).reduce((total, row) => total + Number(row.cost), 0));

    const transfers = transferResult.data ?? [];
    expect(sum(feedIncoming)).toBe(transfers.filter((row) => row.transfer_type === "branch" && row.target_location_id === locationId && row.record_status !== "deleted" && row.transfer_status !== "cancelled" && Number(row.net_amount_to_pay) > 0).reduce((total, row) => total + Number(row.net_amount_to_pay), 0));
    expect(sum(feedOutgoing)).toBe(transfers.filter((row) => row.transfer_type === "branch" && row.location_id === locationId && row.target_location_id !== locationId && row.record_status !== "deleted" && row.transfer_status !== "cancelled" && Number(row.net_amount_to_pay) > 0).reduce((total, row) => total + Number(row.net_amount_to_pay), 0));
    expect(sum(feedBranchPaid)).toBe(transfers.filter((row) => row.transfer_type === "customer" && row.location_id === locationId && row.transfer_status === "branch_and_transfer" && row.record_status !== "deleted" && Number(row.branch_paid_amount) > 0).reduce((total, row) => total + Number(row.branch_paid_amount), 0));

    const rubberIds = (rubberResult.data ?? []).map((row) => row.id);
    const [usedRubberResult, rubberItemResult] = await Promise.all([
      rubberIds.length ? admin.from("money_transfer_items").select("source_id").eq("source_type", "rubber_bill").in("source_id", rubberIds) : Promise.resolve({ data: [], error: null }),
      rubberIds.length ? admin.from("rubber_bill_items").select("bill_id,item_type,price").in("bill_id", rubberIds) : Promise.resolve({ data: [], error: null }),
    ]);
    expect(usedRubberResult.error).toBeNull();
    expect(rubberItemResult.error).toBeNull();
    const usedRubberIds = new Set((usedRubberResult.data ?? []).map((row) => row.source_id));
    const weighItemsByBill = new Map<string, Array<{ price: number | string }>>();
    for (const item of rubberItemResult.data ?? []) {
      if (item.item_type !== "weigh") continue;
      const items = weighItemsByBill.get(item.bill_id) ?? [];
      items.push({ price: item.price });
      weighItemsByBill.set(item.bill_id, items);
    }

    expect(Object.fromEntries(feedRubber.map((row) => [row.relationSourceId, Number(row.cost)]))).toEqual(dailyTotals((rubberResult.data ?? []).filter((row) => {
      const weighItems = weighItemsByBill.get(row.id) ?? [];
      return row.sync_status === "synced"
        && Boolean(row.server_bill_no)
        && weighItems.length > 0
        && weighItems.every((item) => Number(item.price) > 0)
        && !usedRubberIds.has(row.id);
    }).map((row) => ({ date: row.bill_date, amount: row.net_total }))));
    } finally {
      if (temporaryLocationId) {
        await admin.from("locations").delete().eq("id", temporaryLocationId);
      }
    }
  });

  test("uses the fixed operational batch instead of the legacy pageSize parameter", async ({ request }) => {
    const meResponse = await request.get("/api/auth/me");
    expect(meResponse.ok()).toBeTruthy();
    const me = await meResponse.json() as { profile: { locationIds: string[] } };
    const locationId = me.profile.locationIds[0];
    const marker = `E2E-FEED-PAGE-${Date.now()}`;
    const payloads = [
      createIncomePayload(locationId, `${marker}-A`),
      createIncomePayload(locationId, `${marker}-B`),
    ];
    const created: Array<{ payload: ReturnType<typeof createIncomePayload>; revisionNo: number }> = [];

    try {
      for (const payload of payloads) {
        const response = await request.post("/api/lanflow/income-expense", { data: payload });
        expect(response.ok()).toBeTruthy();
        const data = await response.json() as { revisionNo: number };
        created.push({ payload, revisionNo: data.revisionNo });
      }

      const search = new URLSearchParams({ locationId, mode: "latest", search: marker, pageSize: "1" });
      const response = await request.get(`/api/lanflow/income-expense/feed?${search}`);
      expect(response.ok()).toBeTruthy();
      const page = await response.json() as { rows: FeedRow[]; nextCursor: string | null };

      expect(page.rows).toHaveLength(2);
      expect(page.nextCursor).toBeNull();
      expect(page.rows.map((row) => row.title).sort()).toEqual([
        `${marker}-A`,
        `${marker}-B`,
      ]);
    } finally {
      for (const { payload, revisionNo } of created) {
        await request.post("/api/lanflow/income-expense", {
          data: {
            ...payload,
            operation: "delete",
            recordStatus: "deleted",
            expectedRevisionNo: revisionNo,
            idempotencyKey: `delete:${payload.clientTempId}:${revisionNo}`,
          },
        });
      }
    }
  });

  test("projects all money-transfer feed branches at Bangkok midnight", async ({ request }) => {
    expect(serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY is required for feed verification").toBeTruthy();
    const meResponse = await request.get("/api/auth/me");
    expect(meResponse.ok()).toBeTruthy();
    const me = await meResponse.json() as {
      profile: { id: string; locationIds: string[]; name: string; phone: string };
    };
    const locationId = me.profile.locationIds[0];
    const otherLocationId = crypto.randomUUID();
    const marker = crypto.randomUUID();
    const transferIds = Array.from({ length: 9 }, () => crypto.randomUUID());
    const beforeMidnight = "2026-08-03T16:59:59.999Z";
    const atMidnight = "2026-08-03T17:00:00.000Z";
    const businessDate = "2026-08-04";
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const common = {
      transfer_method: "bank",
      transfer_status: "paid",
      record_status: "active",
      created_by_user_id: me.profile.id,
      created_by_name: me.profile.name,
      created_by_phone: me.profile.phone,
    };
    const transferRows = [beforeMidnight, atMidnight].flatMap((createdAt, boundaryIndex) => {
      const offset = boundaryIndex * 3;
      return [
        {
          ...common,
          id: transferIds[offset],
          client_temp_id: transferIds[offset],
          idempotency_key: `${marker}:incoming:${boundaryIndex}`,
          location_id: otherLocationId,
          target_location_id: locationId,
          target_location_name: "สาขาทดสอบปลายทาง",
          transfer_type: "branch",
          net_amount_to_pay: 101,
          created_at: createdAt,
        },
        {
          ...common,
          id: transferIds[offset + 1],
          client_temp_id: transferIds[offset + 1],
          idempotency_key: `${marker}:outgoing:${boundaryIndex}`,
          location_id: locationId,
          target_location_id: otherLocationId,
          target_location_name: "สาขาทดสอบต้นทาง",
          transfer_type: "branch",
          net_amount_to_pay: 102,
          created_at: createdAt,
        },
        {
          ...common,
          id: transferIds[offset + 2],
          client_temp_id: transferIds[offset + 2],
          idempotency_key: `${marker}:branch-paid:${boundaryIndex}`,
          location_id: locationId,
          customer_name: "ลูกค้าทดสอบเส้นแบ่งวัน",
          transfer_type: "customer",
          transfer_status: "branch_and_transfer",
          net_amount_to_pay: 103,
          branch_paid_amount: 33,
          created_at: createdAt,
        },
      ];
    });
    const excludedRows = [
      {
        ...common,
        id: transferIds[6],
        client_temp_id: transferIds[6],
        idempotency_key: `${marker}:cancelled-incoming`,
        location_id: otherLocationId,
        target_location_id: locationId,
        target_location_name: "สาขาทดสอบปลายทาง",
        transfer_type: "branch",
        transfer_status: "cancelled",
        net_amount_to_pay: 201,
        created_at: atMidnight,
      },
      {
        ...common,
        id: transferIds[7],
        client_temp_id: transferIds[7],
        idempotency_key: `${marker}:deleted-outgoing`,
        location_id: locationId,
        target_location_id: otherLocationId,
        target_location_name: "สาขาทดสอบต้นทาง",
        transfer_type: "branch",
        record_status: "deleted",
        net_amount_to_pay: 202,
        created_at: atMidnight,
      },
      {
        ...common,
        id: transferIds[8],
        client_temp_id: transferIds[8],
        idempotency_key: `${marker}:unpaid-customer`,
        location_id: locationId,
        customer_name: "ลูกค้าทดสอบที่ยังไม่เข้าเงื่อนไข",
        transfer_type: "customer",
        transfer_status: "paid",
        net_amount_to_pay: 203,
        branch_paid_amount: 33,
        created_at: atMidnight,
      },
    ];

    try {
      expect((await admin.from("locations").insert({
        id: otherLocationId,
        name: `Feed boundary ${marker.slice(0, 8)}`,
        code: `FB-${marker.slice(0, 5)}`,
        is_active: true,
      })).error).toBeNull();
      expect((await admin.from("money_transfers").insert([...transferRows, ...excludedRows])).error).toBeNull();

      const response = await request.get(
        `/api/lanflow/income-expense/feed?locationId=${locationId}`
      );
      expect(response.ok()).toBeTruthy();
      const page = await response.json() as { rows: FeedRow[] };
      const expectedIds = [
        `money-transfer-income:${transferIds[0]}`,
        `money-transfer-branch-expense:${transferIds[1]}`,
        `money-transfer-branch-paid-expense:${transferIds[2]}`,
        `money-transfer-income:${transferIds[3]}`,
        `money-transfer-branch-expense:${transferIds[4]}`,
        `money-transfer-branch-paid-expense:${transferIds[5]}`,
      ];
      const excludedIds = [
        `money-transfer-income:${transferIds[6]}`,
        `money-transfer-branch-expense:${transferIds[7]}`,
        `money-transfer-branch-paid-expense:${transferIds[8]}`,
      ];
      expect(page.rows.filter((row) => expectedIds.includes(row.id)).map((row) => row.id).sort())
        .toEqual([...expectedIds].sort());
      expect(Object.fromEntries(page.rows.filter((row) => expectedIds.includes(row.id)).map((row) => [row.id, row.txDate])))
        .toEqual({
          [`money-transfer-income:${transferIds[0]}`]: "2026-08-03",
          [`money-transfer-branch-expense:${transferIds[1]}`]: "2026-08-03",
          [`money-transfer-branch-paid-expense:${transferIds[2]}`]: "2026-08-03",
          [`money-transfer-income:${transferIds[3]}`]: businessDate,
          [`money-transfer-branch-expense:${transferIds[4]}`]: businessDate,
          [`money-transfer-branch-paid-expense:${transferIds[5]}`]: businessDate,
        });
      expect(page.rows.some((row) => excludedIds.includes(row.id))).toBe(false);
    } finally {
      await admin.from("money_transfers").delete().in("id", transferIds);
      await admin.from("locations").delete().eq("id", otherLocationId);
    }
  });
});
