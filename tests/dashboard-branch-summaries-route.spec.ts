import { expect, test } from "@playwright/test";
import { NextRequest } from "next/server";

import { loadSourceModule } from "./helpers/load-source-module";
import { dashboardSummaryFixture } from "./helpers/dashboard-summary";

const locationId = "71aa0000-0000-4000-8000-000000000001";

for (const endpoint of ["", "feed", "snapshot"] as const) test(`dashboard ${endpoint || "overview"} blocks unauthorized reads before RPC`, async () => {
  let calls = 0;
  let authenticated = false;
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/dashboard/feed/route")>(
    `src/app/api/lanflow/dashboard/${endpoint ? `${endpoint}/` : ""}route.ts`, {
      "@/lib/server/auth": {
        requireAuth: async () => authenticated
          ? { ok: true, auth: { locationIds: [] }, supabase: { rpc: async () => { calls++; } } }
          : { ok: false, response: new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401 }) },
        hasSystemManagerAccess: () => false,
      },
    },
  );
  const get = () => route.GET(new NextRequest(`http://localhost/api/lanflow/dashboard${endpoint ? `/${endpoint}` : ""}?locationId=${locationId}`));
  expect((await get()).status).toBe(401);
  authenticated = true;
  expect((await get()).status).toBe(403);
  expect(calls).toBe(0);
});

for (const endpoint of ["", "feed"] as const) test(`dashboard ${endpoint || "overview"} accepts PostgreSQL microsecond offset cursors`, async () => {
  const calls: Record<string, unknown>[] = [];
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/dashboard/feed/route")>(
    `src/app/api/lanflow/dashboard/${endpoint ? `${endpoint}/` : ""}route.ts`, {
      "@/lib/server/auth": {
        requireAuth: async () => ({ ok: true, auth: { locationIds: [locationId] }, supabase: {
          rpc: async (_name: string, args: Record<string, unknown>) => {
            calls.push(args);
            return { data: { rows: [], summary: {}, counts: {}, nextCursor: null }, error: null };
          },
        } }),
        hasSystemManagerAccess: () => false,
      },
    },
  );
  const timestamp = "2026-10-31T09:15:30.123456+07:00";
  const cursor = Buffer.from(`${timestamp}|${locationId}`, "utf8").toString("base64");
  const response = await route.GET(new NextRequest(`http://localhost/api/lanflow/dashboard${endpoint ? `/${endpoint}` : ""}?locationId=${locationId}&cursor=${encodeURIComponent(cursor)}`));
  expect(response.status).toBe(200);
  expect(calls).toHaveLength(1);
  expect(calls[0].p_cursor_at).toBe(timestamp);
});

for (const endpoint of ["", "feed"] as const) test(`dashboard ${endpoint || "overview"} rejects non-ISO cursor timestamps before RPC`, async () => {
  let calls = 0;
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/dashboard/feed/route")>(
    `src/app/api/lanflow/dashboard/${endpoint ? `${endpoint}/` : ""}route.ts`, {
      "@/lib/server/auth": {
        requireAuth: async () => ({ ok: true, auth: { locationIds: [locationId] }, supabase: {
          rpc: async () => { calls++; return { data: { rows: [], summary: {}, counts: {}, nextCursor: null }, error: null }; },
        } }),
        hasSystemManagerAccess: () => false,
      },
    },
  );
  for (const at of ["0", "0000-01-01T00:00:00Z", "2026-02-30T00:00:00Z"]) {
    const cursor = Buffer.from(`${at}|${locationId}`, "utf8").toString("base64");
    const response = await route.GET(new NextRequest(`http://localhost/api/lanflow/dashboard${endpoint ? `/${endpoint}` : ""}?locationId=${locationId}&cursor=${encodeURIComponent(cursor)}`));
    expect(response.status).toBe(400);
  }
  expect(calls).toBe(0);
});

for (const endpoint of ["snapshot", "", "feed"] as const) test(`dashboard ${endpoint || "overview"} converts a thrown transport failure into redacted JSON`, async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/dashboard/snapshot/route")>(
    `src/app/api/lanflow/dashboard/${endpoint ? `${endpoint}/` : ""}route.ts`,
    { "@/lib/server/auth": {
      requireAuth: async () => ({ ok: true, auth: { locationIds: [locationId] },
        supabase: { rpc: async () => { throw new Error("private snapshot transport failure"); } } }),
      hasSystemManagerAccess: () => false,
    } },
  );
  const response = await route.GET(new NextRequest(`http://localhost/api/lanflow/dashboard${endpoint ? `/${endpoint}` : ""}?locationId=${locationId}`));
  expect(response.status).toBe(500);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(await response.json()).toEqual({ error: endpoint === "feed" ? "โหลดรายการเงินล่าสุดไม่สำเร็จ"
    : endpoint ? "โหลดผลคำนวณ Dashboard ไม่สำเร็จ" : "โหลดข้อมูลภาพรวมไม่สำเร็จ" });
});

test("money history validates numbered pages and preserves the legacy cursor path", async () => {
  const calls: Record<string, unknown>[] = [];
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/dashboard/feed/route")>(
    "src/app/api/lanflow/dashboard/feed/route.ts", {
      "@/lib/server/auth": {
        requireAuth: async () => ({ ok: true, auth: { locationIds: [locationId] }, supabase: {
          rpc: async (_name: string, args: Record<string, unknown>) => {
            calls.push(args);
            return { data: { rows: [], counts: { all: 0 }, nextCursor: null }, error: null };
          },
        } }),
        hasSystemManagerAccess: () => false,
      },
    },
  );
  const get = (query: string) => route.GET(new NextRequest(`http://localhost/api/lanflow/dashboard/feed?locationId=${locationId}&${query}`));
  for (const query of ["page=0", "page=2147483648", "page=2&cursor=bad", "date=2026-02-30", "date=", "date=0000-01-01", "action=bad"]) {
    expect((await get(query)).status).toBe(400);
  }
  expect(calls).toHaveLength(0);
  expect((await get("page=2")).status).toBe(200);
  expect(calls[0]).toMatchObject({ p_page: 2, p_cursor_at: null, p_cursor_id: null });
  expect((await get("")).status).toBe(200);
  expect(calls[1]).not.toHaveProperty("p_page");
  const cursor = Buffer.from(`2026-10-31T01:00:00Z|${locationId}`, "utf8").toString("base64");
  expect((await get(`cursor=${encodeURIComponent(cursor)}`)).status).toBe(200);
  expect(calls[2]).toMatchObject({ p_cursor_at: "2026-10-31T01:00:00Z", p_cursor_id: locationId });
  expect(calls[2]).not.toHaveProperty("p_page");
});

for (const [message, expectedStatus] of [
  ["Money history date is outside retention window", 400],
  ["private database failure", 500],
] as const) test(`money history preserves returned RPC status ${expectedStatus}`, async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/dashboard/feed/route")>(
    "src/app/api/lanflow/dashboard/feed/route.ts", {
      "@/lib/server/auth": {
        requireAuth: async () => ({ ok: true, auth: { locationIds: [locationId] },
          supabase: { rpc: async () => ({ data: null, error: { message } }) } }),
        hasSystemManagerAccess: () => false,
      },
    },
  );
  const response = await route.GET(new NextRequest(`http://localhost/api/lanflow/dashboard/feed?locationId=${locationId}`));
  expect(response.status).toBe(expectedStatus);
  expect(await response.text()).not.toContain("private database");
});

function validSummary() {
  return {
    locationId,
    snapshotStatus: "ready",
    calculatedAt: "2026-10-11T01:00:00.000Z",
    isOverdue: false,
    cashStatus: "normal",
    summary: {
      netCashFlow: 300,
      rubberInventoryWeight: -10,
      purchaseToday: {
        billCount: 2,
        netWeight: 100,
        paidTotal: 1_000,
        averagePrice: 10,
        rubberValue: 1_000,
        deductionTotal: 0,
        unpricedBillCount: 0,
        pendingApprovalCount: 0,
      },
    },
  };
}

function loadRoute(data: unknown, rpc = async () => ({ data, error: null as { message: string } | null })) {
  return loadSourceModule<typeof import("../src/app/api/lanflow/dashboard/branch-summaries/route")>(
    "src/app/api/lanflow/dashboard/branch-summaries/route.ts",
    {
      "@/lib/server/auth": {
        requireAuth: async () => ({
          ok: true,
          supabase: { rpc },
        }),
      },
    },
  );
}

test("dashboard branch-summary route preserves a valid response", async () => {
  const route = loadRoute([validSummary()]);
  const response = await route.GET(new Request("http://localhost/api/lanflow/dashboard/branch-summaries") as never);

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual([validSummary()]);
});

test("live cash-threshold snapshot fixture satisfies branch-summary route contract", async () => {
  for (const cash of [9999.99, 10000]) {
    const snapshot = dashboardSummaryFixture(cash);
    const summary = { ...validSummary(), summary: {
      netCashFlow: snapshot.netCashFlow,
      rubberInventoryWeight: snapshot.rubberInventoryWeight,
      purchaseToday: snapshot.purchaseToday,
    } };
    const response = await loadRoute([summary]).GET(new Request("http://localhost/api") as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([summary]);
  }
});

test("dashboard branch-summary route rejects a malformed response before it reaches UI formatters", async () => {
  const malformedResponses = [
    { name: "null response", data: null },
    { name: "partial test snapshot", data: [{ ...validSummary(), summary: { netCashFlow: 10000 } }] },
    { name: "non-canonical location UUID", data: [{ ...validSummary(), locationId: locationId.toUpperCase() }] },
    { name: "invalid timestamp", data: [{ ...validSummary(), calculatedAt: "not-a-date" }] },
    { name: "summary without timestamp", data: [{ ...validSummary(), calculatedAt: null }] },
    { name: "summary without snapshot status", data: [{ ...validSummary(), snapshotStatus: null }] },
    { name: "missing overdue flag", data: [{ ...validSummary(), isOverdue: undefined }] },
    { name: "ready snapshot without summary", data: [{
      ...validSummary(),
      calculatedAt: null,
      cashStatus: "no_data",
      summary: null,
    }] },
    { name: "ready snapshot marked overdue", data: [{ ...validSummary(), isOverdue: true }] },
    { name: "missing snapshot marked overdue", data: [{
      ...validSummary(),
      snapshotStatus: null,
      calculatedAt: null,
      isOverdue: true,
      cashStatus: "no_data",
      summary: null,
    }] },
    { name: "no-data cash status with inconsistent summary", data: [{ ...validSummary(), cashStatus: "no_data", summary: null }] },
    { name: "non-numeric net cash flow", data: [{ ...validSummary(), summary: { ...validSummary().summary, netCashFlow: "300" } }] },
    { name: "duplicate location UUID", data: [validSummary(), validSummary()] },
  ];

  for (const malformed of malformedResponses) {
    await test.step(malformed.name, async () => {
      const route = loadRoute(malformed.data);
      const response = await route.GET(new Request("http://localhost/api/lanflow/dashboard/branch-summaries") as never);
      expect.soft(response.status).toBe(500);
      expect.soft(await response.json()).toEqual({ error: "โหลดสรุปภาพรวมสาขาไม่สำเร็จ" });
    });
  }
});

for (const mode of ["throw", "returned", "malformed"] as const) {
  test(`branch summaries ${mode} failure stays private JSON`, async () => {
    const rpc = async () => {
      if (mode === "throw") throw new Error("private-upstream-diagnostic");
      return { data: null, error: mode === "returned" ? { message: "private-upstream-diagnostic" } : null };
    };
    const route = loadRoute(null, rpc);
    const response = await route.GET(new Request("http://localhost/api/lanflow/dashboard/branch-summaries") as never);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "โหลดสรุปภาพรวมสาขาไม่สำเร็จ" });
    expect(response.headers.get("Cache-Control")).toContain("private");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
}
