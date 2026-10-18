import { expect, test } from "@playwright/test";

import { loadSourceModule } from "./helpers/load-source-module";

const locationId = "71aa0000-0000-4000-8000-000000000001";

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

test("dashboard branch-summary route rejects a malformed response before it reaches UI formatters", async () => {
  const malformedResponses = [
    { name: "null response", data: null },
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
