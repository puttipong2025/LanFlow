import { expect, test } from "@playwright/test";
import { NextRequest } from "next/server";
import { loadSourceModule } from "./helpers/load-source-module";

for (const action of ["get", "status", "preview", "save", "cleanup"]) {
  test(`retention ${action} bounds thrown transport errors`, async () => {
    const route = loadSourceModule<typeof import("../src/app/api/lanflow/admin/history-retention/route")>(
      "src/app/api/lanflow/admin/history-retention/route.ts", {
        "@/lib/server/auth": { requireSystemManager: async () => ({ ok: true,
          supabase: { rpc: async () => { throw new Error("private transport failure"); } } }) },
      });
    const body = { action, retentionDays: 15, expectedUpdatedAt: "2026-10-29T01:00:00Z",
      requestId: "62000000-0000-4000-8000-000000000001", cutoffDate: "2026-10-15" };
    const request = new NextRequest(`http://localhost/api/lanflow/admin/history-retention${action === "status" ? "?counts=nullable&view=status" : "?counts=nullable"}`,
      action === "get" || action === "status" ? undefined : { method: "POST", body: JSON.stringify(body) });
    const response = await (action === "get" || action === "status" ? route.GET(request) : route.POST(request));
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toContain("private, no-store");
    expect(await response.text()).not.toContain("private transport failure");
  });
}

test("returned DB errors and denied access already have bounded responses", async () => {
  for (const denied of [true, false]) {
    let calls = 0;
    const route = loadSourceModule<typeof import("../src/app/api/lanflow/admin/history-retention/route")>(
      "src/app/api/lanflow/admin/history-retention/route.ts", {
        "@/lib/server/auth": { requireSystemManager: async () => denied
          ? { ok: false, response: new Response(null, { status: 403 }) }
          : { ok: true, supabase: { rpc: async () => {
            calls++;
            return { data: null, error: { message: "HISTORY_RETENTION_CONFLICT" } };
          } } } },
      });
    expect((await route.GET(new NextRequest("http://localhost/api/lanflow/admin/history-retention"))).status).toBe(denied ? 403 : 409);
    expect(calls).toBe(denied ? 0 : 1);
  }
});

test("authentication transport exceptions stay private for both methods", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/admin/history-retention/route")>(
    "src/app/api/lanflow/admin/history-retention/route.ts", {
      "@/lib/server/auth": { requireSystemManager: async () => { throw new Error("auth secret"); } },
    });
  for (const method of [route.GET, route.POST]) {
    const response = await method(new NextRequest("http://localhost/api/lanflow/admin/history-retention"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("auth secret");
  }
});

for (const failure of ["timeout", "lock timeout", "empty payload", "array payload"]) {
  test(`retention ${failure} returns a retryable response instead of success or internal error`, async () => {
    const route = loadSourceModule<typeof import("../src/app/api/lanflow/admin/history-retention/route")>(
      "src/app/api/lanflow/admin/history-retention/route.ts", {
        "@/lib/server/auth": { requireSystemManager: async () => ({ ok: true,
          supabase: { rpc: async () => failure === "timeout" || failure === "lock timeout"
            ? { data: null, error: { code: failure === "timeout" ? "57014" : "55P03", message: "private query text" } }
            : { data: failure === "array payload" ? [] : null, error: null } } }) },
      });
    for (const action of ["get", "status", "preview", "save", "cleanup"]) {
      const read = action === "get" || action === "status";
      const request = new NextRequest(`http://localhost/api/lanflow/admin/history-retention${action === "status" ? "?counts=nullable&view=status" : "?counts=nullable"}`,
        read ? undefined : { method: "POST", body: JSON.stringify({ action, retentionDays: 15,
          expectedUpdatedAt: "2026-10-29T01:00:00Z", cutoffDate: "2026-10-15",
          requestId: "64000000-0000-4000-8000-000000000001" }) });
      const response = await (read ? route.GET(request) : route.POST(request));
      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toContain("private, no-store");
      expect(await response.text()).not.toContain("private query text");
    }
  });
}

test("incomplete successful RPC objects cannot reach the UI or acknowledge a cleanup", async () => {
  for (const action of ["get", "status", "preview", "save", "cleanup"]) {
    for (const data of [{}, { groups: null }, { status: "running", runId: null }]) {
      const route = loadSourceModule<typeof import("../src/app/api/lanflow/admin/history-retention/route")>(
        "src/app/api/lanflow/admin/history-retention/route.ts", {
          "@/lib/server/auth": { requireSystemManager: async () => ({ ok: true,
            supabase: { rpc: async () => ({ data, error: null }) } }) },
        });
      const read = action === "get" || action === "status";
      const request = new NextRequest(`http://localhost/api/lanflow/admin/history-retention${action === "status" ? "?counts=nullable&view=status" : "?counts=nullable"}`,
        read ? undefined : { method: "POST", body: JSON.stringify({ action, retentionDays: 15,
          expectedUpdatedAt: "2026-10-29T01:00:00Z", cutoffDate: "2026-10-15",
          requestId: "64000000-0000-4000-8000-000000000001" }) });
      const response = await (read ? route.GET(request) : route.POST(request));
      expect(response.status, `${action}: ${JSON.stringify(data)}`).toBe(503);
    }
  }
});

const overview = {
  currentDays: 15, requestedDays: 15, cutoffDate: "2026-10-15", updatedAt: "2026-10-29T01:00:00Z",
  updatedByName: null, totalEligible: 3,
  groups: [{ key: "scheduler_run_history", eligibleCount: 3, oldestDate: "2026-10-01" }],
  lastCleanup: {
    id: "64000000-0000-4000-8000-000000000002", source: "automatic", status: "running",
    retentionDays: 15, cutoffDate: "2026-10-15", deletedCounts: {}, remainingCounts: {},
    countsAsOf: null, batches: 0, hasMore: true, errorMessage: null,
    startedAt: "2026-10-29T01:00:00.123456+00:00", completedAt: null,
  },
};

test("complete RPC contracts preserve successful reads, saves and accepted jobs", async () => {
  const calls: string[] = [];
  const receipt = { status: "running", runId: overview.lastCleanup.id };
  const status = { currentDays: overview.currentDays, cutoffDate: overview.cutoffDate,
    updatedAt: overview.updatedAt, lastCleanup: overview.lastCleanup };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/admin/history-retention/route")>(
    "src/app/api/lanflow/admin/history-retention/route.ts", {
      "@/lib/server/auth": { requireSystemManager: async () => ({ ok: true,
        supabase: { rpc: async (name: string) => {
          calls.push(name);
          return { data: name === "get_history_cleanup_status" ? status
            : name === "request_history_retention_cleanup" ? receipt : overview, error: null };
        } } }) },
    });
  for (const action of ["get", "status", "preview", "save", "cleanup"]) {
    const read = action === "get" || action === "status";
    const response = await (read ? route.GET : route.POST)(new NextRequest(
      `http://localhost/api/lanflow/admin/history-retention${action === "status" ? "?counts=nullable&view=status" : "?counts=nullable"}`,
      read ? undefined : { method: "POST", body: JSON.stringify({ action, retentionDays: 15,
        expectedUpdatedAt: overview.updatedAt, cutoffDate: overview.cutoffDate, requestId: overview.lastCleanup.id }) }));
    expect(response.status).toBe(action === "cleanup" ? 202 : 200);
    expect(await response.json()).toEqual(action === "cleanup" ? receipt : action === "status" ? status : overview);
    expect(response.headers.get("Cache-Control")).toContain("private, no-store");
  }
  expect(calls).toEqual(["get_history_retention_overview", "get_history_cleanup_status",
    "get_history_retention_overview", "save_history_retention_settings", "request_history_retention_cleanup"]);
});

test("malformed nested RPC fields and inconsistent totals fail closed", async () => {
  for (const data of [
    { ...overview, groups: [{ ...overview.groups[0], eligibleCount: "3" }] },
    { ...overview, groups: [overview.groups[0], overview.groups[0]], totalEligible: 6 },
    { ...overview, totalEligible: 4 },
    { ...overview, cutoffDate: "2026-02-30" },
    { ...overview, lastCleanup: { ...overview.lastCleanup, deletedCounts: null } },
    { ...overview, lastCleanup: { ...overview.lastCleanup, startedAt: "invalid" } },
  ]) {
    const route = loadSourceModule<typeof import("../src/app/api/lanflow/admin/history-retention/route")>(
      "src/app/api/lanflow/admin/history-retention/route.ts", {
        "@/lib/server/auth": { requireSystemManager: async () => ({ ok: true,
          supabase: { rpc: async () => ({ data, error: null }) } }) },
      });
    const response = await route.GET(new NextRequest("http://localhost/api/lanflow/admin/history-retention"));
    expect(response.status).toBe(503);
  }
});

test("a bounded preview preserves unknown counts without inventing a zero total", async () => {
  const data = { ...overview, totalEligible: null,
    groups: [{ key: "scheduler_run_history", eligibleCount: null, oldestDate: null }] };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/admin/history-retention/route")>(
    "src/app/api/lanflow/admin/history-retention/route.ts", {
      "@/lib/server/auth": { requireSystemManager: async () => ({ ok: true,
        supabase: { rpc: async () => ({ data, error: null }) } }) },
    });
  const response = await route.GET(new NextRequest("http://localhost/api/lanflow/admin/history-retention?counts=nullable"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(data);
});

test("older open tabs receive a reload message instead of incompatible nullable counts", async () => {
  const data = { ...overview, totalEligible: null,
    groups: [{ key: "scheduler_run_history", eligibleCount: null, oldestDate: null }] };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/admin/history-retention/route")>(
    "src/app/api/lanflow/admin/history-retention/route.ts", {
      "@/lib/server/auth": { requireSystemManager: async () => ({ ok: true,
        supabase: { rpc: async () => ({ data, error: null }) } }) },
    });
  const response = await route.GET(new NextRequest("http://localhost/api/lanflow/admin/history-retention"));
  expect(response.status).toBe(503);
  expect((await response.json()).error).toContain("โหลดหน้าเว็บใหม่");
});

test("an older open save dialog cannot mutate policy before reloading the new client", async () => {
  let calls = 0;
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/admin/history-retention/route")>(
    "src/app/api/lanflow/admin/history-retention/route.ts", {
      "@/lib/server/auth": { requireSystemManager: async () => ({ ok: true,
        supabase: { rpc: async () => { calls++; return { data: overview, error: null }; } } }) },
    });
  const response = await route.POST(new NextRequest("http://localhost/api/lanflow/admin/history-retention", {
    method: "POST", body: JSON.stringify({ action: "save", retentionDays: 30, expectedUpdatedAt: overview.updatedAt }),
  }));
  expect(response.status).toBe(503);
  expect(calls).toBe(0);
});

test("an oversized streamed retention request cannot reach the RPC", async () => {
  let calls = 0;
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/admin/history-retention/route")>(
    "src/app/api/lanflow/admin/history-retention/route.ts", {
      "@/lib/server/auth": { requireSystemManager: async () => ({ ok: true,
        supabase: { rpc: async () => { calls++; return { data: overview, error: null }; } } }) },
    });
  const body = new ReadableStream({ start(controller) {
    controller.enqueue(Buffer.from(JSON.stringify({ action: "preview", retentionDays: 30, padding: "ก".repeat(2048) })));
    controller.close();
  } });
  const request = new NextRequest("http://localhost/api/lanflow/admin/history-retention?counts=nullable", {
    method: "POST", body, duplex: "half",
  });
  const response = await route.POST(request);
  expect([response.status, calls]).toEqual([413, 0]);
});

test("retention rejects noncanonical policy version timestamps before RPC", async () => {
  let calls = 0;
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/admin/history-retention/route")>(
    "src/app/api/lanflow/admin/history-retention/route.ts", {
      "@/lib/server/auth": { requireSystemManager: async () => ({ ok: true,
        supabase: { rpc: async () => { calls++; return { data: overview, error: null }; } } }) },
    });
  const request = new NextRequest("http://localhost/api/lanflow/admin/history-retention?counts=nullable", {
    method: "POST", body: JSON.stringify({ action: "save", retentionDays: 30, expectedUpdatedAt: "2026-10-29T24:00:00Z" }),
  });
  expect((await route.POST(request)).status).toBe(400);
  expect(calls).toBe(0);
});
