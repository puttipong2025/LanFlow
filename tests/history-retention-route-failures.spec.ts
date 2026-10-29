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
    const request = new NextRequest(`http://localhost/api/lanflow/admin/history-retention${action === "status" ? "?view=status" : ""}`,
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
