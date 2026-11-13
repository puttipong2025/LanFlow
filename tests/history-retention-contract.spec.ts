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
    const overviewResponse = await manager.request.get("/api/lanflow/admin/history-retention?counts=nullable");
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
    expect(overview.groups).toHaveLength(12);

    for (const retentionDays of [true, "15", null]) {
      const invalid = await manager.request.post("/api/lanflow/admin/history-retention?counts=nullable", {
        data: { action: "preview", retentionDays },
      });
      expect(invalid.status()).toBe(400);
    }

    const preview = await manager.request.post("/api/lanflow/admin/history-retention?counts=nullable", {
      data: { action: "preview", retentionDays: 14 },
    });
    expect(preview.ok(), await preview.text()).toBeTruthy();
    expect((await preview.json() as { requestedDays: number }).requestedDays).toBe(14);

    const forbidden = await admin.request.get("/api/lanflow/admin/history-retention?counts=nullable");
    expect(forbidden.status()).toBe(403);

    const forbiddenCleanup = await admin.request.post("/api/lanflow/admin/history-retention?counts=nullable", {
      data: { action: "cleanup", requestId: randomUUID(), expectedUpdatedAt: overview.updatedAt, cutoffDate: overview.cutoffDate },
    });
    expect(forbiddenCleanup.status()).toBe(403);
    expect((await admin.request.get("/api/lanflow/admin/history-retention?counts=nullable&view=status")).status()).toBe(403);
    for (const requestId of [null, true, "not-a-uuid"]) {
      const invalid = await manager.request.post("/api/lanflow/admin/history-retention?counts=nullable", {
        data: { action: "cleanup", requestId, expectedUpdatedAt: overview.updatedAt, cutoffDate: overview.cutoffDate },
      });
      expect(invalid.status()).toBe(400);
    }
    const stale = await manager.request.post("/api/lanflow/admin/history-retention?counts=nullable", {
      data: { action: "cleanup", requestId: randomUUID(), expectedUpdatedAt: "2000-01-01T00:00:00Z", cutoffDate: overview.cutoffDate },
    });
    expect(stale.status()).toBe(409);
    for (const cutoffDate of ["2026-02-30", "0000-01-01", "September 3 2026"]) {
      const invalid = await manager.request.post("/api/lanflow/admin/history-retention?counts=nullable", {
        data: { action: "cleanup", requestId: randomUUID(), expectedUpdatedAt: overview.updatedAt, cutoffDate },
      });
      expect(invalid.status()).toBe(400);
    }
    const requestId = randomUUID();
    const command = { action: "cleanup", requestId, expectedUpdatedAt: overview.updatedAt, cutoffDate: overview.cutoffDate };
    const accepted = await manager.request.post("/api/lanflow/admin/history-retention?counts=nullable", { data: command });
    expect(accepted.status(), await accepted.text()).toBe(202);
    const firstJob = await accepted.json() as { runId: string };
    const retried = await manager.request.post("/api/lanflow/admin/history-retention?counts=nullable", { data: command });
    expect((await retried.json() as { runId: string }).runId).toBe(firstJob.runId);
    const status = await manager.request.get("/api/lanflow/admin/history-retention?counts=nullable&view=status");
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

  expect(adminSource).toContain('if (!canManageSystem && isManagerTab(tab)) setTab("employees")');
  expect(adminSource).toContain('if (isManagerTab(tab) && !canManageSystem) return null');
  expect(retentionSource).toContain("เข้าเกณฑ์ลบ");
  expect(retentionSource).not.toContain(">ลบทันที</th>");
});

test("history retention rejects timezone offsets PostgreSQL cannot parse", async ({ browser }) => {
  const manager = await contextFor("super_admin", browser);
  try {
    const overview = await (await manager.request.get("/api/lanflow/admin/history-retention?counts=nullable")).json() as { cutoffDate: string };
    for (const expectedUpdatedAt of ["2026-09-03T01:00:00+16:00", "2026-09-03T01:00:00-23:59"]) {
      for (const action of ["save", "cleanup"]) {
        const response = await manager.request.post("/api/lanflow/admin/history-retention?counts=nullable", {
          data: { action, retentionDays: 15, requestId: randomUUID(), cutoffDate: overview.cutoffDate, expectedUpdatedAt },
        });
        expect(response.status()).toBe(400);
      }
    }
    for (const expectedUpdatedAt of ["2000-01-01T00:00:00Z", "2000-01-01T00:00:00+07:00", "2000-01-01T00:00:00-15:59"]) {
      const response = await manager.request.post("/api/lanflow/admin/history-retention?counts=nullable", {
        data: { action: "cleanup", requestId: randomUUID(), cutoffDate: overview.cutoffDate, expectedUpdatedAt },
      });
      expect(response.status()).toBe(409); // Valid timestamps reach the policy-version check.
    }
  } finally { await manager.close(); }
});

test("real cron finishes an accepted job after the initiating browser context closes", async ({ browser }) => {
  test.setTimeout(90000);
  const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
  const container = origin === "http://127.0.0.1:55461" ? "supabase_db_lanflow-retention-split-test" : "supabase_db_webapp";
  expect(["http://127.0.0.1:55421", "http://127.0.0.1:55461"]).toContain(origin);
  const localSql = (query: string) => execFileSync("docker", ["exec", container, "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", query], { encoding: "utf8" }).trim();
  // Reserve real run IDs from the extension's sequence, which its owner controls.
  const [expiredSchedulerRun, freshSchedulerRun] = execFileSync("docker", ["exec", container, "psql",
    "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "supabase_admin", "-d", "postgres", "-c",
    "select nextval('cron.runid_seq'), nextval('cron.runid_seq')"], { encoding: "utf8" }).trim().split("|").map(BigInt);
  const starter = await contextFor("super_admin", browser);
  const observer = await contextFor("super_admin", browser);
  const expiredAppRun = randomUUID();
  try {
    localSql(`insert into public.history_cleanup_runs(id,retention_days,cutoff_date,status,completed_at)
      values ('${expiredAppRun}',15,current_date-400,'succeeded',now()-interval '400 days');
      insert into cron.job_run_details(runid,status,start_time,end_time,username)
      values (${expiredSchedulerRun},'succeeded',now()-interval '400 days',now()-interval '400 days','postgres'),
             (${freshSchedulerRun},'succeeded',now(),now(),'postgres')`);
    const overview = await (await starter.request.get("/api/lanflow/admin/history-retention?counts=nullable")).json() as { updatedAt: string; cutoffDate: string };
    const response = await starter.request.post("/api/lanflow/admin/history-retention?counts=nullable", {
      data: { action: "cleanup", requestId: randomUUID(), expectedUpdatedAt: overview.updatedAt, cutoffDate: overview.cutoffDate },
    });
    expect(response.status()).toBe(202);
    await starter.close();
    // Both installed jobs work independently after the originating context closes.
    await expect.poll(async () => {
      const fixturesRemoved = localSql(`select (not exists(select 1 from cron.job_run_details where runid=${expiredSchedulerRun})
        and not exists(select 1 from public.history_cleanup_runs where id='${expiredAppRun}'))::text`);
      if (fixturesRemoved !== "true") return false;
      const status = await observer.request.get("/api/lanflow/admin/history-retention?counts=nullable&view=status");
      if (!status.ok()) return false;
      const data = await status.json();
      return data.lastCleanup?.status === "succeeded" && data.schedulerCleanup?.errorCode === null;
    },
    { timeout: 70000, intervals: [1000, 2000] }).toBe(true);
    expect(Number(localSql(`select count(*) from cron.job_run_details where runid=${freshSchedulerRun}`))).toBe(1);
  } finally {
    localSql(`delete from cron.job_run_details where runid in (${expiredSchedulerRun},${freshSchedulerRun});
      delete from public.history_cleanup_runs where id='${expiredAppRun}'`);
    await Promise.all([starter.close(), observer.close()]);
  }
});
