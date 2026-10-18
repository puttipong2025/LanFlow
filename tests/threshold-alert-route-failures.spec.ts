import { expect, test } from "@playwright/test";
import { NextRequest } from "next/server";
import { loadSourceModule } from "./helpers/load-source-module";
import type { thresholdAlertGroupRoutes } from "../src/lib/server/threshold-alert-group-routes";
const id = "a1000000-0000-4000-8000-000000000001";
const rpc = async () => { throw new Error("transport disconnected: private-upstream-diagnostic"); };
const auth = async () => ({ ok: true, supabase: { rpc } });
for (const kind of ["cash", "weight"] as const) {
  for (const method of ["GET", "POST", "PUT", "DELETE"] as const) {
    test(`${kind} group ${method} returns private JSON when RPC throws`, async () => {
      const module = loadSourceModule<{ thresholdAlertGroupRoutes: typeof thresholdAlertGroupRoutes }>("src/lib/server/threshold-alert-group-routes.ts", {
        "@/lib/server/auth": { requireSystemManager: auth },
      });
      const handlers = module.thresholdAlertGroupRoutes(kind);
      const body = { locationIds: [id], ...(kind === "cash" ? { thresholdAmount: 0 } : { thresholdKg: 100 }) };
      const request = new NextRequest("http://localhost/api/test", { method, ...(method === "POST" || method === "PUT" ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}) });
      const response = method === "PUT" || method === "DELETE" ? await handlers[method](request, { params: Promise.resolve({ id }) }) : await handlers[method](request);
      expect(response.status).toBe(500);
      expect(response.headers.get("Cache-Control")).toContain("no-store");
      const payload = await response.json(); expect(payload.errorMessage).toBeTruthy();
      expect(JSON.stringify(payload)).not.toContain("private-upstream-diagnostic");
    });
  }
}
for (const route of ["threshold-alert", "rubber-weight-alert"]) {
  test(`${route} check returns private JSON when RPC throws`, async () => {
    const module = loadSourceModule<{ GET: (request: NextRequest) => Promise<Response> }>(`src/app/api/lanflow/${route}/route.ts`, {
      "@/lib/server/auth": { requireRole: auth },
    });
    const response = await module.GET(new NextRequest("http://localhost/api/test"));
    expect(response.status).toBe(500); expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect((await response.json()).error).toBeTruthy();
  });
}

test("interval settings returns private JSON when save RPC throws", async () => {
  const module = loadSourceModule<{ PUT: (request: NextRequest) => Promise<Response> }>("src/app/api/lanflow/admin/rubber-weight-alert/route.ts", {
    "@/lib/server/auth": { requireSystemManager: auth },
  });
  const response = await module.PUT(new NextRequest("http://localhost/api/test", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intervalMinutes: 30 }),
  }));
  expect(response.status).toBe(500);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect((await response.json()).error).toBeTruthy();
});

test("interval settings keeps input validation and returned RPC errors distinct", async () => {
  const request = (intervalMinutes: number) => new NextRequest("http://localhost/api/test", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intervalMinutes }),
  });
  const invalid = loadSourceModule<{ PUT: (request: NextRequest) => Promise<Response> }>("src/app/api/lanflow/admin/rubber-weight-alert/route.ts", {
    "@/lib/server/auth": { requireSystemManager: auth },
  });
  expect((await invalid.PUT(request(0))).status).toBe(400);
  const returned = loadSourceModule<{ PUT: (request: NextRequest) => Promise<Response> }>("src/app/api/lanflow/admin/rubber-weight-alert/route.ts", {
    "@/lib/server/auth": { requireSystemManager: async () => ({ ok: true, supabase: { rpc: async () => ({ data: null, error: { message: "RUBBER_WEIGHT_ALERT_INVALID: invalid interval" } }) } }) },
  });
  expect((await returned.PUT(request(30))).status).toBe(400);
});
