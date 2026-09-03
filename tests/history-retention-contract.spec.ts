import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

async function contextFor(role: "super_admin" | "admin", browser: Browser) {
  return browser.newContext({ storageState: `playwright/.auth/${role}.json` });
}

async function closeAll(...contexts: BrowserContext[]) {
  await Promise.all(contexts.map((context) => context.close()));
}

test("history retention API rejects coercible values and enforces manager access", async ({ browser }) => {
  const manager = await contextFor("super_admin", browser);
  const admin = await contextFor("admin", browser);
  try {
    const overviewResponse = await manager.request.get("/api/lanflow/admin/history-retention");
    expect(overviewResponse.ok(), await overviewResponse.text()).toBeTruthy();
    const overview = await overviewResponse.json() as {
      currentDays: number;
      requestedDays: number;
      groups: unknown[];
    };
    expect(overview.currentDays).toBe(15);
    expect(overview.requestedDays).toBe(15);
    expect(overview.groups).toHaveLength(10);

    for (const retentionDays of [true, "15", null]) {
      const invalid = await manager.request.post("/api/lanflow/admin/history-retention", {
        data: { action: "preview", retentionDays },
      });
      expect(invalid.status()).toBe(400);
    }

    const preview = await manager.request.post("/api/lanflow/admin/history-retention", {
      data: { action: "preview", retentionDays: 14 },
    });
    expect(preview.ok(), await preview.text()).toBeTruthy();
    expect((await preview.json() as { requestedDays: number }).requestedDays).toBe(14);

    const forbidden = await admin.request.get("/api/lanflow/admin/history-retention");
    expect(forbidden.status()).toBe(403);
  } finally {
    await closeAll(manager, admin);
  }
});

test("history retention UI closes stale manager-only state and describes bounded cleanup", () => {
  const adminSource = readFileSync(resolve(process.cwd(), "src/components/admin/AdminContent.tsx"), "utf8");
  const retentionSource = readFileSync(resolve(process.cwd(), "src/components/admin/HistoryRetentionSettings.tsx"), "utf8");

  expect(adminSource).toContain('if (!canManageSystem && tab === "history") setTab("employees")');
  expect(adminSource).toContain('canManageSystem ? <HistoryRetentionSettings /> : null');
  expect(retentionSource).toContain("เข้าเกณฑ์ลบ");
  expect(retentionSource).not.toContain(">ลบทันที</th>");
});
