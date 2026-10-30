import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { selectedAppLocationId, confirmCurrentBranchIfRequired } from "./helpers/select-app-location";
import { installThresholdAlertHandler } from "./helpers/dismiss-threshold-alert";
import { assertSafeIntegrationTarget } from "./support/integration-target";

const stage = process.env.RUBBER_RESUME_STAGE ?? "candidate";
if (!["baseline", "candidate"].includes(stage)) throw new Error("Unknown stage");
const sql = (query: string) => execFileSync("docker", ["exec", "supabase_db_webapp", "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", query], { encoding: "utf8", windowsHide: true }).trim();

async function open(page: Page, location: string) {
  await installThresholdAlertHandler(page);
  await page.goto("/");
  await expect(async () => {
    if (await selectedAppLocationId(page) === location) return;
    const option = page.locator(`[role="option"][data-location-id="${location}"]`);
    if (!await option.isVisible()) await page.locator('button[data-location-id][aria-controls="location-selector-listbox"]').click();
    await option.click(); expect(await selectedAppLocationId(page)).toBe(location);
  }).toPass({ timeout: 25_000 });
  await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
  await expect(page.getByRole("button", { name: "เพิ่มบิลยาง", exact: true })).toBeVisible();
}

for (const tabs of [1, 3]) test(`${stage} resume workload with ${tabs} tabs`, async ({ browser }) => {
  test.setTimeout(180_000);
  assertSafeIntegrationTarget(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const samples: unknown[] = [];
  for (let round = 0; round < 3; round++) {
    const location = crypto.randomUUID(), marker = `RESUMEPERF-${location.slice(0, 8)}`;
    const context = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
    try {
      sql(`insert into public.locations(id,name,code,is_active) values('${location}','${marker}','P${location.slice(0, 6)}',true)`);
      const me = await (await context.request.get("/api/auth/me")).json();
      await context.addInitScript(({ actor, branch }) => localStorage.setItem(`lanflow:last-location:${actor}`, branch),
        { actor: me.profile.id as string, branch: location });
      const pages = await Promise.all(Array.from({ length: tabs }, () => context.newPage()));
      let phase: "open" | "idle" | "work" | "resume" = "open";
      const requests = { open: 0, idle: 0, work: 0, resume: 0 };
      for (const page of pages) page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/")) requests[phase]++; });
      const opening = Date.now();
      for (const page of pages) await open(page, location);
      const openMs = Date.now() - opening;
      phase = "idle"; await pages[0].waitForTimeout(11_000);
      phase = "work";
      const feedbackMs: number[] = [], completionMs: number[] = [], clickedAt: number[] = [];
      await Promise.all(pages.map(async (page, index) => {
        await page.getByRole("button", { name: "เพิ่มบิลยาง", exact: true }).click();
        await confirmCurrentBranchIfRequired(page);
        const modal = page.getByRole("dialog", { name: "บิลเครื่องชั่งเล็ก", exact: true });
        await modal.locator('input[placeholder*="ค้นหาชื่อ หรือ รหัสสมาชิก"]').fill(`${marker}-${index}`);
        await page.keyboard.press("Escape");
        const weigh = modal.locator("table").first().locator("tbody tr").first();
        await weigh.locator('input[type="number"]').nth(0).fill("100");
        await weigh.locator('input[type="number"]').nth(1).fill("0");
        await weigh.locator('input[type="number"]').nth(3).fill("0");
        const started = Date.now();
        clickedAt[index] = started;
        await modal.getByRole("button", { name: "บันทึกบิล", exact: true }).click();
        await expect(modal).toBeHidden(); feedbackMs.push(Date.now() - started);
        await expect(page.getByRole("row").filter({ hasText: `${marker}-${index}` }).getByText("ซิงก์แล้ว", { exact: true })).toBeVisible({ timeout: 40_000 });
        completionMs.push(Date.now() - started);
      }));
      expect(sql(`select count(*) from public.rubber_bills where location_id='${location}'`)).toBe(String(tabs));
      const outcomes = JSON.parse(sql(`select json_agg(json_build_object('index',right(b.customer_name,1)::integer,'status',j.result->>'status','acceptedAtMs',extract(epoch from j.accepted_at)*1000,'workerMs',extract(epoch from j.completed_at-j.accepted_at)*1000)) from private.rubber_queue_jobs j join public.rubber_bills b on b.location_id=j.location_id and b.client_temp_id=j.client_temp_id where j.location_id='${location}'`))
        .map((outcome: { index: number; acceptedAtMs: number }) => ({ ...outcome, admissionMs: outcome.acceptedAtMs - clickedAt[outcome.index] }));
      phase = "resume";
      await Promise.all(pages.map(page => page.evaluate(() => { for (let i = 0; i < 5; i++) window.dispatchEvent(new Event("focus")); })));
      await pages[0].waitForTimeout(1_000);
      samples.push({ round, openMs, feedbackMs, completionMs, requests, outcomes });
    } finally {
      await context.close();
      sql(`begin;set local app.history_retention_cleanup='on';
        delete from public.rubber_bill_approval_requests where location_id='${location}';
        delete from public.rubber_bill_items where bill_id in(select id from public.rubber_bills where location_id='${location}');
        delete from public.rubber_bills where location_id='${location}';set constraints all immediate;
        delete from public.dashboard_money_events where location_id='${location}';delete from public.dashboard_branch_snapshots where location_id='${location}';
        delete from public.document_deletion_audits where location_id='${location}';delete from public.user_locations where location_id='${location}';
        delete from public.locations where id='${location}';commit;`);
    }
  }
  mkdirSync("output", { recursive: true });
  writeFileSync(`output/rubber-resume-perf-${stage}-${tabs}.json`, JSON.stringify({ stage, tabs, samples }, null, 2));
});
