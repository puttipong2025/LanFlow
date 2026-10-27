import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { assertSafeIntegrationTarget } from "../support/integration-target";
test.use({ storageState: "playwright/.auth/super_admin.json" });
test.setTimeout(90_000);
test("real group route, count submission and alert RPC preserve cents, omission and clearing", async ({ request }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!; assertSafeIntegrationTarget(url);
  const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const locationId = crypto.randomUUID(); let groupId: string | null = null;
  try {
    expect((await db.from("locations").insert({ id: locationId, code: `DF${locationId.slice(0,8)}`, name: "Discrepancy API fixture", is_active: true })).error).toBeNull();
    const save = (patch: Record<string, unknown>) => request.post("/api/lanflow/cash-count-alert/groups", { data: { ...(groupId ? { id: groupId } : {}), locationIds: [locationId], dueDays: 1, ...patch } });
    const created = await save({ discrepancyThreshold: 99.99 }); expect(created.status()).toBe(200); groupId = (await created.json()).id;
    const session = await request.post("/api/lanflow/cash-counts/session", { data: { locationId } }); expect(session.status()).toBe(201);
    const submitted = await request.post("/api/lanflow/cash-counts", { data: { sessionId: (await session.json()).session.id, actualCounts: { "1": 0, "2": 0, "5": 0, "10": 0, "20": 0, "50": 0, "100": 1, "500": 0, "1000": 0 }, evidenceIds: [] } });
    expect(submitted.ok()).toBe(true);
    const candidate = async () => {
      const response = await request.get("/api/lanflow/threshold-alert"); expect(response.ok()).toBe(true);
      return (await response.json()).candidates.filter((c: { locationId: string }) => c.locationId === locationId);
    };
    expect(await candidate()).toEqual([expect.objectContaining({ kind: "count", value: 0, discrepancyThreshold: 99.99, discrepancy: expect.objectContaining({ amount: 100 }) })]);
    expect((await save({})).ok()).toBe(true);
    expect((await candidate())[0].discrepancyThreshold).toBe(99.99);
    expect((await save({ discrepancyThreshold: 100 })).ok()).toBe(true); expect(await candidate()).toEqual([]);
    expect((await save({ discrepancyThreshold: 0 })).ok()).toBe(true); expect((await candidate())[0].discrepancy.amount).toBe(100);
    expect((await save({ discrepancyThreshold: null })).ok()).toBe(true); expect(await candidate()).toEqual([]);
    const groups = await request.get("/api/lanflow/cash-count-alert/groups");
    expect((await groups.json()).groups.find((g: { id: string }) => g.id === groupId).discrepancyThreshold).toBeNull();
  } finally {
    if (groupId) await request.delete(`/api/lanflow/cash-count-alert/groups?id=${groupId}`);
    await db.from("cash_counts").delete().eq("location_id", locationId);
    await db.from("cash_count_sessions").delete().eq("location_id", locationId);
    await db.from("locations").delete().eq("id", locationId);
  }
});
