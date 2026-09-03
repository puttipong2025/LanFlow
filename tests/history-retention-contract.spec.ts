import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
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
      updatedAt: string;
      cutoffDate: string;
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

    const forbiddenCleanup = await admin.request.post("/api/lanflow/admin/history-retention", {
      data: { action: "cleanup", requestId: randomUUID(), expectedUpdatedAt: overview.updatedAt, cutoffDate: overview.cutoffDate },
    });
    expect(forbiddenCleanup.status()).toBe(403);
    expect((await admin.request.get("/api/lanflow/admin/history-retention?view=status")).status()).toBe(403);
    for (const requestId of [null, true, "not-a-uuid"]) {
      const invalid = await manager.request.post("/api/lanflow/admin/history-retention", {
        data: { action: "cleanup", requestId, expectedUpdatedAt: overview.updatedAt, cutoffDate: overview.cutoffDate },
      });
      expect(invalid.status()).toBe(400);
    }
    const stale = await manager.request.post("/api/lanflow/admin/history-retention", {
      data: { action: "cleanup", requestId: randomUUID(), expectedUpdatedAt: "2000-01-01T00:00:00Z", cutoffDate: overview.cutoffDate },
    });
    expect(stale.status()).toBe(409);
    for (const cutoffDate of ["2026-02-30", "0000-01-01", "September 3 2026"]) {
      const invalid = await manager.request.post("/api/lanflow/admin/history-retention", {
        data: { action: "cleanup", requestId: randomUUID(), expectedUpdatedAt: overview.updatedAt, cutoffDate },
      });
      expect(invalid.status()).toBe(400);
    }
    const requestId = randomUUID();
    const command = { action: "cleanup", requestId, expectedUpdatedAt: overview.updatedAt, cutoffDate: overview.cutoffDate };
    const accepted = await manager.request.post("/api/lanflow/admin/history-retention", { data: command });
    expect(accepted.status(), await accepted.text()).toBe(202);
    const firstJob = await accepted.json() as { runId: string };
    const retried = await manager.request.post("/api/lanflow/admin/history-retention", { data: command });
    expect((await retried.json() as { runId: string }).runId).toBe(firstJob.runId);
    const status = await manager.request.get("/api/lanflow/admin/history-retention?view=status");
    expect(status.ok()).toBeTruthy();
    const lightweight = await status.json() as Record<string, unknown>;
    expect(lightweight).toHaveProperty("lastCleanup");
    expect(lightweight).not.toHaveProperty("groups");
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

test("history retention rejects timezone offsets PostgreSQL cannot parse", async ({ browser }) => {
  const manager = await contextFor("super_admin", browser);
  try {
    const overview = await (await manager.request.get("/api/lanflow/admin/history-retention")).json() as { cutoffDate: string };
    for (const expectedUpdatedAt of ["2026-09-03T01:00:00+16:00", "2026-09-03T01:00:00-23:59"]) {
      for (const action of ["save", "cleanup"]) {
        const response = await manager.request.post("/api/lanflow/admin/history-retention", {
          data: { action, retentionDays: 15, requestId: randomUUID(), cutoffDate: overview.cutoffDate, expectedUpdatedAt },
        });
        expect(response.status()).toBe(400);
      }
    }
    for (const expectedUpdatedAt of ["2000-01-01T00:00:00Z", "2000-01-01T00:00:00+07:00", "2000-01-01T00:00:00-15:59"]) {
      const response = await manager.request.post("/api/lanflow/admin/history-retention", {
        data: { action: "cleanup", requestId: randomUUID(), cutoffDate: overview.cutoffDate, expectedUpdatedAt },
      });
      expect(response.status()).toBe(409); // Valid timestamps reach the policy-version check.
    }
  } finally { await manager.close(); }
});

test("real cron finishes an accepted job after the initiating browser context closes", async ({ browser }) => {
  test.setTimeout(90000);
  expect(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname).toBe("127.0.0.1");
  const localSql = (query: string) => execFileSync("docker", ["exec", "supabase_db_webapp", "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", query], { encoding: "utf8" }).trim();
  const starter = await contextFor("super_admin", browser);
  const observer = await contextFor("super_admin", browser);
  try {
    localSql("insert into cron.job_run_details(runid,status,start_time,end_time,username) values (-990001,'succeeded',now()-interval '20 days',now()-interval '20 days','postgres'),(-990002,'succeeded',now(),now(),'postgres')");
    const overview = await (await starter.request.get("/api/lanflow/admin/history-retention")).json() as { updatedAt: string; cutoffDate: string };
    const response = await starter.request.post("/api/lanflow/admin/history-retention", {
      data: { action: "cleanup", requestId: randomUUID(), expectedUpdatedAt: overview.updatedAt, cutoffDate: overview.cutoffDate },
    });
    expect(response.status()).toBe(202);
    await starter.close();
    // No manual worker call: only the installed scheduler may remove the old fixture.
    await expect.poll(() => Number(localSql("select count(*) from cron.job_run_details where runid=-990001")), { timeout: 70000, intervals: [1000, 2000] }).toBe(0);
    expect(Number(localSql("select count(*) from cron.job_run_details where runid=-990002"))).toBe(1);
    const status = await (await observer.request.get("/api/lanflow/admin/history-retention?view=status")).json() as { lastCleanup: { status: string } };
    expect(status.lastCleanup.status).toBe("succeeded");
  } finally {
    localSql("delete from cron.job_run_details where runid in (-990001,-990002)");
    await Promise.all([starter.close(), observer.close()]);
  }
});
