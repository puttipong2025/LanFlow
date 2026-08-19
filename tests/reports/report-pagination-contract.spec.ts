import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

async function authContext(browser: Browser, role: "admin" | "super_admin") {
  return browser.newContext({ storageState: `playwright/.auth/${role}.json` });
}

async function profile(context: BrowserContext) {
  const response = await context.request.get("/api/auth/me");
  expect(response.ok()).toBeTruthy();
  return (await response.json() as {
    profile: { id: string; name: string; phone: string; locationIds: string[] };
  }).profile;
}

test("reports and deletion audits use stable manager-scoped pages", async ({ browser }) => {
  const manager = await authContext(browser, "super_admin");
  const admin = await authContext(browser, "admin");
  const managerProfile = await profile(manager);
  const adminProfile = await profile(admin);
  const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const locationId = crypto.randomUUID();
  const reportIds = Array.from({ length: 51 }, () => crypto.randomUUID());
  const auditIds = Array.from({ length: 51 }, () => crypto.randomUUID());
  const base = Date.now() - 100_000;

  try {
    expect((await db.from("locations").insert({
      id: locationId,
      name: "สาขาทดสอบ bounded reports",
      code: `BP${locationId.slice(0, 6)}`,
      is_active: true,
    })).error).toBeNull();
    expect((await db.from("report_batches").insert(reportIds.map((id, index) => ({
      id,
      report_no: `RPT-PAGE-${String(index + 1).padStart(3, "0")}`,
      report_date: "2026-08-19",
      sequence_no: index + 1,
      location_id: locationId,
      cutoff_at: new Date(base + index * 1_000).toISOString(),
      created_by_user_id: managerProfile.id,
      created_by_name: managerProfile.name,
      created_by_phone: managerProfile.phone,
      created_at: new Date(base + index * 1_000).toISOString(),
    })))).error).toBeNull();
    expect((await db.from("document_deletion_audits").insert(auditIds.map((id, index) => ({
      id,
      document_kind: "report_batch",
      source_id: crypto.randomUUID(),
      document_no: `RPT-DELETED-PAGE-${String(index + 1).padStart(3, "0")}`,
      location_id: locationId,
      deleted_by_user_id: managerProfile.id,
      deleted_by_name: managerProfile.name,
      deleted_at: new Date(base + index * 1_000).toISOString(),
    })))).error).toBeNull();

    const firstResponse = await manager.request.get(`/api/lanflow/reports?locationId=${locationId}`);
    expect(firstResponse.ok(), await firstResponse.text()).toBeTruthy();
    const first = await firstResponse.json() as {
      reports: Array<{ id: string; isLatestActive: boolean }>;
      hasMore: boolean;
      nextCursor: string | null;
    };
    expect(first.reports).toHaveLength(50);
    expect(first.reports.filter((row) => row.isLatestActive)).toHaveLength(1);
    expect(first.hasMore).toBe(true);

    const secondResponse = await manager.request.get(
      `/api/lanflow/reports?locationId=${locationId}&cursor=${encodeURIComponent(first.nextCursor!)}`,
    );
    expect(secondResponse.ok(), await secondResponse.text()).toBeTruthy();
    const second = await secondResponse.json() as {
      reports: Array<{ id: string; isLatestActive: boolean }>;
      hasMore: boolean;
    };
    expect(second.reports).toHaveLength(1);
    expect(second.reports[0].isLatestActive).toBe(false);
    expect(second.hasMore).toBe(false);
    expect(new Set([...first.reports, ...second.reports].map((row) => row.id)).size).toBe(51);

    expect((await admin.request.get(
      `/api/lanflow/reports?locationId=${adminProfile.locationIds[0]}&view=deletions`,
    )).status()).toBe(403);
    for (const path of [
      `/api/lanflow/rubber-exports?locationId=${adminProfile.locationIds[0]}&view=deletions`,
      `/api/lanflow/cash-counts?locationId=${adminProfile.locationIds[0]}&view=deletions`,
    ]) {
      expect((await admin.request.get(path)).status()).toBe(403);
      expect((await manager.request.get(path)).ok()).toBe(true);
    }

    const auditFirstResponse = await manager.request.get(
      `/api/lanflow/reports?locationId=${locationId}&view=deletions`,
    );
    expect(auditFirstResponse.ok(), await auditFirstResponse.text()).toBeTruthy();
    const auditFirst = await auditFirstResponse.json() as {
      deletions: Array<{ id: string }>;
      hasMore: boolean;
      nextCursor: string | null;
    };
    expect(auditFirst.deletions).toHaveLength(50);
    expect(auditFirst.hasMore).toBe(true);
    const auditSecondResponse = await manager.request.get(
      `/api/lanflow/reports?locationId=${locationId}&view=deletions&cursor=${encodeURIComponent(auditFirst.nextCursor!)}`,
    );
    expect(auditSecondResponse.ok(), await auditSecondResponse.text()).toBeTruthy();
    const auditSecond = await auditSecondResponse.json() as { deletions: Array<{ id: string }>; hasMore: boolean };
    expect(auditSecond.deletions).toHaveLength(1);
    expect(auditSecond.hasMore).toBe(false);
    expect(new Set([...auditFirst.deletions, ...auditSecond.deletions].map((row) => row.id)).size).toBe(51);
  } finally {
    await db.from("document_deletion_audits").delete().in("id", auditIds);
    await db.from("report_batches").delete().in("id", reportIds);
    await db.from("locations").delete().eq("id", locationId);
    await Promise.all([manager.close(), admin.close()]);
  }
});
