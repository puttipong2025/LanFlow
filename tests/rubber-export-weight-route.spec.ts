import { expect, test } from "@playwright/test";
import { loadSourceModule } from "./helpers/load-source-module";

const exportId = "a1030000-0000-4000-8000-000000000001";
function harness(authorized = true, error?: string) {
  const calls: { name: string; args: unknown }[] = [];
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-exports/[exportId]/weight/route")>(
    "src/app/api/lanflow/rubber-exports/[exportId]/weight/route.ts", {
      "@/lib/server/auth": { requireAuth: async () => authorized
        ? { ok: true, supabase: { rpc: async (name: string, args: unknown) => {
          calls.push({ name, args }); return { data: { id: exportId }, error: error ? { message: error } : null };
        } } } : { ok: false, response: Response.json({}, { status: 401 }) } },
    });
  const patch = (body: unknown, id = exportId) => route.PATCH(new Request("http://localhost/api/weight", {
    method: "PATCH", body: JSON.stringify(body),
  }), { params: Promise.resolve({ exportId: id }) });
  return { calls, patch };
}
const values = { currentWeight: 11737.25, expectedCurrentWeight: 12355, note: " ชั่งจริง " };

test("weight adjustment requires authentication and a valid export ID", async () => {
  const denied = harness(false); expect((await denied.patch(values)).status).toBe(401); expect(denied.calls).toHaveLength(0);
  const h = harness(); expect((await h.patch(values, "bad-id")).status).toBe(400); expect(h.calls).toHaveLength(0);
});
for (const body of [null, [], {}, { ...values, currentWeight: 0 }, { ...values, currentWeight: 1.001 },
  { ...values, currentWeight: "12" }, { ...values, expectedCurrentWeight: null },
  { ...values, note: "x".repeat(301) }, { ...values, workRate: 0.99 }, { ...values, note: [] }]) {
  test(`rejects invalid or unrelated weight payload ${JSON.stringify(body).slice(0, 90)}`, async () => {
    const h = harness(); expect((await h.patch(body)).status).toBe(400); expect(h.calls).toHaveLength(0);
  });
}
test("only weight, expected weight and note reach the guarded RPC", async () => {
  const h = harness(); const response = await h.patch(values);
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
  expect(h.calls).toEqual([{ name: "adjust_rubber_export_weight", args: {
    p_export_id: exportId, p_current_weight: 11737.25, p_expected_current_weight: 12355, p_note: "ชั่งจริง",
  } }]);
});
for (const [message, status] of [["ไม่มีสิทธิ์ปรับน้ำหนัก", 403], ["RUBBER_EXPORT_WEIGHT_CONFLICT: น้ำหนักเปลี่ยนไปแล้ว", 409],
  ["RUBBER_EXPORT_WEIGHT_CONFLICT: รายการกำลังถูกใช้งาน กรุณาลองปรับน้ำหนักอีกครั้ง", 409],
  ["WEX_RESERVATION_LOCKED: ถูกจอง", 409], ["REPORT_LOCKED:RPT-TEST", 409]] as const) {
  test(`maps live database rejection: ${message}`, async () => { expect((await harness(true, message).patch(values)).status).toBe(status); });
}
