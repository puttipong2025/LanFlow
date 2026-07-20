import { test, expect, type APIRequestContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

type FeedRow = {
  id: string;
  type: "income" | "expense";
  cost: number | string;
  title: string;
  relationSourceType?: string;
  relationSourceId?: string;
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function startDate() {
  const date = new Date();
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
    const search = new URLSearchParams({ locationId, from: startDate(), to: today(), pageSize: "100" });
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
    const inaccessibleLocationId = locations?.find((location) => !me.profile.locationIds.includes(location.id))?.id;
    expect(inaccessibleLocationId, "the test fixture must have a branch unavailable to a normal user").toBeTruthy();

    const denied = await request.get(`/api/lanflow/income-expense/feed?locationId=${inaccessibleLocationId}&from=${startDate()}&to=${today()}`);
    expect(denied.status()).toBe(403);

    const feed = await fetchAllFeed(request, locationId);
    const feedActual = feed.filter((row) => !row.relationSourceType);
    const feedIncoming = feed.filter((row) => row.id.startsWith("money-transfer-income:"));
    const feedOutgoing = feed.filter((row) => row.id.startsWith("money-transfer-branch-expense:"));
    const feedBranchPaid = feed.filter((row) => row.id.startsWith("money-transfer-branch-paid-expense:"));
    const feedRubber = feed.filter((row) => row.relationSourceType === "rubber_bill_daily");
    const feedOcr = feed.filter((row) => row.relationSourceType === "ocr_ticket_daily");

    const rangeStart = startDate();
    const rangeEnd = today();
    const [actualResult, transferResult, rubberResult, ocrResult] = await Promise.all([
      admin.from("income_expense").select("type,cost").eq("location_id", locationId).eq("record_status", "active").gte("tx_date", rangeStart).lte("tx_date", rangeEnd),
      admin.from("money_transfers").select("id,location_id,target_location_id,transfer_type,transfer_status,record_status,net_amount_to_pay,branch_paid_amount,created_at").gte("created_at", `${rangeStart}T00:00:00.000Z`).lte("created_at", `${rangeEnd}T23:59:59.999Z`),
      admin.from("rubber_bills").select("id,bill_date,net_total").eq("location_id", locationId).eq("record_status", "active").gt("net_total", 0).gte("bill_date", rangeStart).lte("bill_date", rangeEnd),
      admin.from("ocr_tickets").select("id,date_in,total_amount").eq("location_id", locationId).eq("record_status", "active").gt("total_amount", 0).gte("date_in", rangeStart).lte("date_in", rangeEnd),
    ]);
    expect(actualResult.error).toBeNull();
    expect(transferResult.error).toBeNull();
    expect(rubberResult.error).toBeNull();
    expect(ocrResult.error).toBeNull();

    expect(sum(feedActual)).toBe((actualResult.data ?? []).reduce((total, row) => total + Number(row.cost), 0));

    const transfers = transferResult.data ?? [];
    expect(sum(feedIncoming)).toBe(transfers.filter((row) => row.transfer_type === "branch" && row.target_location_id === locationId && row.record_status !== "deleted" && row.transfer_status !== "cancelled" && Number(row.net_amount_to_pay) > 0).reduce((total, row) => total + Number(row.net_amount_to_pay), 0));
    expect(sum(feedOutgoing)).toBe(transfers.filter((row) => row.transfer_type === "branch" && row.location_id === locationId && row.target_location_id !== locationId && row.record_status !== "deleted" && row.transfer_status !== "cancelled" && Number(row.net_amount_to_pay) > 0).reduce((total, row) => total + Number(row.net_amount_to_pay), 0));
    expect(sum(feedBranchPaid)).toBe(transfers.filter((row) => row.transfer_type === "customer" && row.location_id === locationId && row.transfer_status === "branch_and_transfer" && row.record_status !== "deleted" && Number(row.branch_paid_amount) > 0).reduce((total, row) => total + Number(row.branch_paid_amount), 0));

    const rubberIds = (rubberResult.data ?? []).map((row) => row.id);
    const ocrIds = (ocrResult.data ?? []).map((row) => row.id);
    const [usedRubberResult, usedOcrResult] = await Promise.all([
      rubberIds.length ? admin.from("money_transfer_items").select("source_id").eq("source_type", "rubber_bill").in("source_id", rubberIds) : Promise.resolve({ data: [], error: null }),
      ocrIds.length ? admin.from("money_transfer_items").select("source_id").eq("source_type", "ocr_ticket").in("source_id", ocrIds) : Promise.resolve({ data: [], error: null }),
    ]);
    expect(usedRubberResult.error).toBeNull();
    expect(usedOcrResult.error).toBeNull();
    const usedRubberIds = new Set((usedRubberResult.data ?? []).map((row) => row.source_id));
    const usedOcrIds = new Set((usedOcrResult.data ?? []).map((row) => row.source_id));

    expect(Object.fromEntries(feedRubber.map((row) => [row.relationSourceId, Number(row.cost)]))).toEqual(dailyTotals((rubberResult.data ?? []).filter((row) => !usedRubberIds.has(row.id)).map((row) => ({ date: row.bill_date, amount: row.net_total }))));
    expect(Object.fromEntries(feedOcr.map((row) => [row.relationSourceId, Number(row.cost)]))).toEqual(dailyTotals((ocrResult.data ?? []).filter((row) => !usedOcrIds.has(row.id)).map((row) => ({ date: row.date_in, amount: row.total_amount }))));
  });

  test("paginates pageSize=1 without duplicate or missing fixture rows", async ({ request }) => {
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

      const rows: FeedRow[] = [];
      let cursor: string | null = null;
      do {
        const search = new URLSearchParams({ locationId, from: today(), to: today(), pageSize: "1" });
        if (cursor) search.set("cursor", cursor);
        const response = await request.get(`/api/lanflow/income-expense/feed?${search}`);
        expect(response.ok()).toBeTruthy();
        const page = await response.json() as { rows: FeedRow[]; nextCursor: string | null };
        expect(page.rows).toHaveLength(1);
        rows.push(...page.rows);
        cursor = page.nextCursor;
      } while (cursor);

      expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
      expect(rows.filter((row) => row.title.startsWith(marker)).map((row) => row.title).sort()).toEqual([
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
});
