import { expect, test } from "@playwright/test";
import { loadSourceModule } from "./helpers/load-source-module";
const id = "bd140000-0000-4000-8000-000000000021", snapshot = "a".repeat(64);
const mode = "clear_registry_v1";
const request = { mode, requestId: id, snapshot, confirmation: "รีเซ็ตทั้งหมด" };
const receipt = { mode, requestId: id, snapshot, retiredCount: 2, completedAt: "2026-11-01T12:00:00Z" };
function harness(data: unknown = receipt, code?: string, authorized = true, originAllowed = true) {
  const calls: { name: string; args: unknown }[] = [];
  const roles: string[][] = [];
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/admin/rubber-bill-issuers/reset/route")>(
    "src/app/api/lanflow/admin/rubber-bill-issuers/reset/route.ts", {
      "@/lib/server/auth": { requireRole: async (_request: Request, required: string[]) => {
        roles.push(required); return authorized ? { ok: true, supabase: { rpc: async (name: string, args: unknown) => {
          calls.push({ name, args });
          return { data, error: code ? { code } : null };
        } } } : { ok: false, response: Response.json({ error: "denied" }, { status: 403 }) };
      } },
      "@/lib/server/sms-otp": { isSmsMutationAllowed: () => originAllowed, SMS_HEADERS: { "Cache-Control": "private, no-store" } },
    });
  return { route, calls, roles };
}
const post = (value: unknown = request) => new Request("http://localhost/api/reset", { method: "POST", body: JSON.stringify(value) });
test("reset preview and mutation require exact Super Admin role", async () => {
  const h = harness(null, undefined, false);
  expect((await h.route.GET(new Request("http://localhost/api/reset"))).status).toBe(403);
  expect((await h.route.POST(post())).status).toBe(403);
  expect(h.roles).toEqual([["super_admin"], ["super_admin"]]); expect(h.calls).toHaveLength(0);
});
test("cross-origin reset never reaches database", async () => {
  const h = harness(null, undefined, true, false);
  expect((await h.route.POST(post())).status).toBe(403); expect(h.calls).toHaveLength(0);
});
for (const value of [null, {}, { ...request, confirmation: "รีเซ็ต" }, { ...request, snapshot: [] }, { ...request, requestId: "bad" }]) {
  test(`invalid reset payload ${JSON.stringify(value)}`, async () => {
    const h = harness(); expect((await h.route.POST(post(value))).status).toBe(400); expect(h.calls).toHaveLength(0);
  });
}
test("valid preview includes zero and no-store", async () => {
  const h = harness({ mode, count: 0, snapshot }); const response = await h.route.GET(new Request("http://localhost/api/reset"));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
  expect(h.calls).toEqual([{ name: "preview_bill_device_reset", args: undefined }]);
});
for (const value of [{ count: -1, snapshot }, { count: 1, snapshot: [snapshot] }, { count: "1", snapshot }, {}]) {
  test(`invalid preview ${JSON.stringify(value)}`, async () => {
    const h = harness(value); expect((await h.route.GET(new Request("http://localhost/api/reset"))).status).toBe(503);
  });
}
for (const [code, status] of [["42501", 403], ["22023", 400], ["PT409", 409], ["40001", 503], ["55P03", 503], ["XX000", 503]] as const) {
  test(`database ${code} maps to ${status}`, async () => {
    const h = harness(null, code); const response = await h.route.POST(post()); expect(response.status).toBe(status);
    if (status === 409) expect((await response.json()).errorCode).toBe("DEVICE_RESET_CONFLICT");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
}
for (const value of [{}, { ...receipt, requestId: "bd140000-0000-4000-8000-000000000022" },
  { ...receipt, snapshot: "b".repeat(64) }, { ...receipt, retiredCount: 0 }, { ...receipt, completedAt: null }]) {
  test(`unconfirmed acknowledgement ${JSON.stringify(value)}`, async () => {
    expect((await harness(value).route.POST(post())).status).toBe(503);
  });
}
for (const completedAt of ["1", "2026-11-01", "2026-02-30T12:00:00Z"]) {
  test(`reset rejects a non-timestamp or impossible completion date: ${completedAt}`, async () => {
    expect((await harness({ ...receipt, completedAt }).route.POST(post())).status).toBe(503);
  });
}
for (const completedAt of ["2026-11-01T12:00:00.123456+07:00", "2026-11-01T12:00:00Z"]) {
  test(`reset keeps valid PostgreSQL timestamp: ${completedAt}`, async () => {
    expect((await harness({ ...receipt, completedAt }).route.POST(post())).status).toBe(200);
  });
}
test("exact receipt is returned unchanged and UUID is canonicalized", async () => {
  const h = harness(); const response = await h.route.POST(post({ ...request, requestId: id.toUpperCase() }));
  expect(response.status).toBe(200); expect(await response.json()).toEqual(receipt);
  expect(h.calls).toEqual([{ name: "reset_all_bill_devices", args: {
    p_request_id: id, p_snapshot: snapshot, p_confirmation: request.confirmation, p_mode: mode } }]);
});

test("a legacy retire-only backend cannot advertise readiness for clearing the registry", async () => {
  const h = harness({ count: 2, snapshot });
  expect((await h.route.GET(new Request("http://localhost/api/reset"))).status).toBe(503);
});

test("a retire-only acknowledgement cannot be reported as a successful registry clear", async () => {
  const legacy = { requestId: id, snapshot, retiredCount: 2, completedAt: "2026-11-01T12:00:00Z" };
  const h = harness(legacy);
  expect((await h.route.POST(post({ ...request, mode: "clear_registry_v1" }))).status).toBe(503);
});

test("a cached retire-only client cannot start the newly destructive clear operation", async () => {
  const legacy = { requestId: id, snapshot, confirmation: "รีเซ็ตทั้งหมด" };
  const h = harness();
  expect((await h.route.POST(post(legacy))).status).toBe(400); expect(h.calls).toHaveLength(0);
});

test("an old backend without the explicit-mode RPC is unavailable instead of using the legacy operation", async () => {
  const h = harness(null, "PGRST202");
  expect((await h.route.POST(post())).status).toBe(503);
  expect(h.calls).toEqual([{ name: "reset_all_bill_devices", args: {
    p_request_id: id, p_snapshot: snapshot, p_confirmation: request.confirmation, p_mode: mode } }]);
});

test("receipt replay performs no current-registry preview check", async () => {
  const h = harness();
  const response = await h.route.POST(post());
  expect(response.status).toBe(200); expect(await response.json()).toEqual(receipt);
  expect(h.calls.map(call => call.name)).toEqual(["reset_all_bill_devices"]);
});
