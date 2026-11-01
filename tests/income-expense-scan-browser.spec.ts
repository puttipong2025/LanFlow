import { expect, test } from "@playwright/test";
import { assertSafeIntegrationTarget } from "./support/integration-target";

test("real income/expense routes reject impossible calendar values before business writes", async ({ browser }) => {
  assertSafeIntegrationTarget(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const context = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
  try {
    const bootstrap = await context.request.get("/api/lanflow");
    expect(bootstrap.ok()).toBe(true);
    const data = await bootstrap.json();
    const locationId = data.locations[0].id as string, clientTempId = crypto.randomUUID();
    const payload = { operation: "create", expectedRevisionNo: 0, clientTempId,
      idempotencyKey: `create:${clientTempId}:0`, locationId, recordStatus: "active", localBillNo: "SCAN-INVALID-CALENDAR",
      type: "expense", title: "invalid calendar validation only", cost: 1, billOption: "ค่าใช้จ่าย",
      clientCreatedAt: "2026-11-01T00:00:00Z", clientRecordedAt: "2026-11-01T00:00:00Z" };
    for (const suffix of ["", "/background", "/approval-requests"]) {
      for (const txDate of ["2026-13-01", "2026-01-32", "2026-02-29", "0000-01-01"]) {
        const response = await context.request.post(`/api/lanflow/income-expense${suffix}`, { data: { ...payload, txDate } });
        expect(response.status(), `${suffix} ${txDate}: ${await response.text()}`).toBe(400);
      }
    }
  } finally { await context.close(); }
});
