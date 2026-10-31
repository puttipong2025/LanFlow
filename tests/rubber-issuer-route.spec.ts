import { expect, test } from "@playwright/test";
import { loadSourceModule } from "./helpers/load-source-module";
const uuid = "af000000-0000-4000-8000-000000000001";
function route(manager = true, allowed = true, result: unknown = { total: 0, rows: [] }) {
  let calls = 0;
  const module = loadSourceModule<typeof import("../src/app/api/lanflow/admin/rubber-bill-issuers/route")>("src/app/api/lanflow/admin/rubber-bill-issuers/route.ts", {
    "@/lib/server/auth": { hasSystemManagerAccess: () => manager, requireAuth: async () => ({ ok: true, auth: { sub: uuid },
      supabase: { rpc: async (_name: string, args: Record<string, unknown>) => { calls++;
        return args.p_location_id === "" ? { data: null, error: { code: "22P02" } } : { data: result, error: null }; } } }) },
    "@/lib/server/sms-otp": { isSmsMutationAllowed: () => allowed, SMS_HEADERS: { "Cache-Control": "no-store" } },
  });
  return { module, calls: () => calls };
}
test("issuer management denies ordinary admins before invoking RPC", async () => {
  const h = route(false);
  expect((await h.module.GET(new Request("http://localhost/api/issuers"))).status).toBe(403);
  expect((await h.module.PATCH(new Request("http://localhost/api/issuers", { method: "PATCH", body: JSON.stringify({ id: uuid }) }))).status).toBe(403);
  expect(h.calls()).toBe(0);
});
for (const suffix of ["?offset=-1", "?offset=NaN", "?offset=2147483648", "?status=other", "?locationId=bad"]) test(`invalid issuer filters ${suffix}`, async () => {
  const h = route(); expect((await h.module.GET(new Request(`http://localhost/api/issuers${suffix}`))).status).toBe(400); expect(h.calls()).toBe(0);
});
test("retirement rejects cross-origin mutations before invoking RPC", async () => {
  const h = route(true, false);
  expect((await h.module.PATCH(new Request("http://localhost/api/issuers", { method: "PATCH", body: JSON.stringify({ id: uuid }) }))).status).toBe(403);
  expect(h.calls()).toBe(0);
});
test("an empty branch filter uses the all-branches default instead of an invalid PostgreSQL UUID", async () => {
  const h = route(); expect((await h.module.GET(new Request("http://localhost/api/issuers?locationId="))).status).toBe(200);
});
test("invalid list and retirement acknowledgements never become confirmed success", async () => {
  const h = route(true, true, {});
  expect((await h.module.GET(new Request("http://localhost/api/issuers"))).status).toBe(503);
  expect((await h.module.PATCH(new Request("http://localhost/api/issuers", { method: "PATCH", body: JSON.stringify({ id: uuid }) }))).status).toBe(503);
});
test("a different issuer acknowledgement remains rejected even with valid UUID syntax", async () => {
  const h = route(true, true, { id: "af000000-0000-4000-8000-000000000002", retired: true });
  expect((await h.module.PATCH(new Request("http://localhost/api/issuers", {
    method: "PATCH", body: JSON.stringify({ id: uuid }),
  }))).status).toBe(503);
});
test("confirmed list and exact retirement acknowledgement return no-store responses", async () => {
  const h = route(); const response = await h.module.GET(new Request("http://localhost/api/issuers"));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
  const retired = route(true, true, { id: uuid, retired: true });
  expect((await retired.module.PATCH(new Request("http://localhost/api/issuers", { method: "PATCH", body: JSON.stringify({ id: uuid }) }))).status).toBe(200);
});
test("retirement accepts canonical database acknowledgement for an uppercase UUID", async () => {
  const h = route(true, true, { id: uuid, retired: true });
  const response = await h.module.PATCH(new Request("http://localhost/api/issuers", {
    method: "PATCH", body: JSON.stringify({ id: uuid.toUpperCase() }),
  }));
  expect(response.status).toBe(200);
});
