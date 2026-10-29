import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { selectedAppLocationId, confirmCurrentBranchIfRequired } from './helpers/select-app-location';
import { installThresholdAlertHandler } from './helpers/dismiss-threshold-alert';
import { assertSafeIntegrationTarget } from './support/integration-target';
import { installRubberBrowserTiming, type BrowserTimingEvent } from './helpers/rubber-browser-timing';
import { rubberServerTiming, type ServerTiming } from './helpers/rubber-server-timing';

const mode = process.env.RUBBER_PERFORMANCE_MODE === 'baseline' ? 'baseline'
  : process.env.RUBBER_PERFORMANCE_MODE === 'phase2' ? 'phase2' : 'candidate';
const rounds = Number(process.env.RUBBER_PERFORMANCE_ROUNDS ?? 3);
const detailed = process.env.RUBBER_DETAILED_TIMING === '1';
if (detailed && mode !== 'candidate') throw new Error('Detailed source-handler probes require candidate mode');
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10) throw new Error('Use 1–10 rounds');
const sql = (input: string) => execFileSync('docker', ['exec', '-i', 'supabase_db_webapp', 'psql', '-X', '-q', '-At',
  '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], { input, encoding: 'utf8', windowsHide: true }).trim();
type Sample = { n: number; round: number; batchMs: number; acceptanceMs: number[]; commandIds: string[];
  requests: Record<string, number>; businessMs: number[]; queueToCompleteMs: number[]; commitToUiMs: number[];
  details?: { browser: BrowserTimingEvent[]; server: ServerTiming; pdfCompletedAtMs: number; pdfBytes: number; injectedLock: boolean } };
const samples: Sample[] = [];
let savedCron: { command: string; schedule: string; active: boolean };
test.beforeAll(() => {
  assertSafeIntegrationTarget(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  savedCron = JSON.parse(sql("select row_to_json(j) from (select command,schedule,active from cron.job where jobname='rubber-central-queue')j"));
  if (mode !== 'candidate') sql("select cron.alter_job(jobid,schedule:='10 seconds',command:='set statement_timeout=''8s'';set lock_timeout=''2s'';select private.process_rubber_queue(20)') from cron.job where jobname='rubber-central-queue'");
  else sql(readFileSync('supabase/migrations/20261029021000_rubber_queue_committed_attempts.sql', 'utf8'));
  if (detailed) sql("select cron.alter_job(jobid,active:=false) from cron.job where jobname='rubber-central-queue'");
});
test.afterAll(() => {
  if (savedCron) sql(`select cron.alter_job(jobid,schedule:='${savedCron.schedule.replaceAll("'", "''")}',command:='${savedCron.command.replaceAll("'", "''")}',active:=${savedCron.active}) from cron.job where jobname='rubber-central-queue'`);
  mkdirSync('output', { recursive: true });
  const file = detailed ? 'output/rubber-timing-browser.json' : `output/rubber-performance-${mode}.json`;
  const previous = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).samples as Sample[] : [];
  const combined = [...previous.filter(old => !samples.some(current => current.n === old.n && current.round === old.round)), ...samples];
  writeFileSync(file, JSON.stringify({ mode, rounds,
    environment: detailed ? 'Diagnostic: real production handlers/auth/RPC/driver invoked at intercepted queue/context boundaries; cron paused, PDF gate and one injected lock. Not an HTTP latency benchmark.'
      : 'Warm local Next dev + real Local Supabase, synthetic branch, UI save through durable acknowledgement; separate from offline full real-data clone',
    source: mode === 'baseline' ? '0cd3024a9f5981d590ff99b2c7cc3077a8268bde' : 'working tree', samples: combined }, null, 2));
});

for (const n of [1, 5, 10]) for (let round = 0; round < rounds; round++) {
  test(`${mode} save ${n} independent bills round ${round + 1}`, async ({ browser, baseURL }) => {
    test.setTimeout(150_000);
    test.skip(detailed && n !== 1, 'Diagnostic trace binds one command at a time');
    const branch = crypto.randomUUID(), marker = `PERF-${branch.slice(0, 8)}`;
    const context = await browser.newContext({ baseURL, storageState: 'playwright/.auth/super_admin.json' });
    const page = await context.newPage();
    const requests: Record<string, number> = {};
    const commandIds: string[] = [];
    let diagnostics: ReturnType<typeof rubberServerTiming> | undefined;
    let pdfCompletedAtMs = 0, pdfBytes = 0;
    page.on('request', request => {
      const url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return;
      const key = `${request.method()} ${url.pathname}`;
      requests[key] = (requests[key] ?? 0) + 1;
      if (url.pathname === '/api/lanflow/rubber-bills/queue' && request.method() === 'POST') {
        const id = request.postDataJSON()?.commandId;
        if (typeof id === 'string' && !commandIds.includes(id)) commandIds.push(id);
      }
    });
    try {
      sql(`insert into public.locations(id,name,code,is_active) values('${branch}','${marker}','P${branch.slice(0,8)}',true)`);
      const me = await (await context.request.get('/api/auth/me')).json();
      if (detailed) {
        const cookies = (await context.storageState()).cookies.filter(cookie => /-auth-token(?:\.\d+)?$/.test(cookie.name)).sort((a, b) => a.name.localeCompare(b.name));
        const encoded = cookies.map(cookie => cookie.value).join('');
        const token = JSON.parse(Buffer.from(encoded.slice('base64-'.length), 'base64url').toString()).access_token;
        diagnostics = rubberServerTiming(token, round === 1);
        await installRubberBrowserTiming(page, marker);
        let pdfReady!: () => void;
        let pdfFailed!: (error: Error) => void;
        const pdf = new Promise<void>((resolve, reject) => { pdfReady = resolve; pdfFailed = reject; });
        page.on('download', download => { void (async () => {
          const file = await download.path();
          if (!file || !readFileSync(file).subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('Expected a completed PDF');
          pdfBytes = statSync(file).size;
          pdfCompletedAtMs = performance.timeOrigin + performance.now();
          pdfReady();
        })().catch(() => pdfFailed(new Error('Local PDF did not complete'))); });
        await page.route('**/api/lanflow/rubber-bills/command-context?**', async route => {
          const response = await diagnostics!.context(route.request().url());
          await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() });
        });
        await page.route('**/api/lanflow/rubber-bills/queue', async route => {
          if (route.request().method() !== 'POST') { await route.continue(); return; }
          await pdf; // Prove local PDF delivery without business admission.
          const response = await diagnostics!.post(route.request().url(), route.request().postDataJSON());
          await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() });
        });
      }
      // Compare warm routes on both revisions. Invalid admission warms auth/route
      // code without creating a command; cold startup is recorded separately.
      expect((await context.request.get(`/api/lanflow/rubber-bills/command-context?locationId=${branch}&clientTempId=${crypto.randomUUID()}`)).status()).toBe(200);
      expect((await context.request.post('/api/lanflow/rubber-bills/queue', { data: {} })).status()).toBe(400);
      await page.addInitScript(({ actor, location }) => localStorage.setItem(`lanflow:last-location:${actor}`, location),
        { actor: me.profile.id as string, location: branch });
      await installThresholdAlertHandler(page);
      await page.goto('/');
      await expect(async () => {
        if (await selectedAppLocationId(page) === branch) return;
        const option = page.locator(`[role="option"][data-location-id="${branch}"]`);
        if (!await option.isVisible()) await page.locator('button[data-location-id][aria-controls="location-selector-listbox"]').click();
        await option.click();
        expect(await selectedAppLocationId(page)).toBe(branch);
      }).toPass({ timeout: 25_000 });
      await page.getByRole('button', { name: 'บิลยาง', exact: true }).click();
      await expect(page.getByRole('button', { name: 'เพิ่มบิลยาง', exact: true })).toBeVisible();
      const acceptanceMs: number[] = [], clickedAt: number[] = [];
      let batchStart = 0;
      for (let index = 0; index < n; index++) {
        await page.getByRole('button', { name: 'เพิ่มบิลยาง', exact: true }).click();
        await confirmCurrentBranchIfRequired(page);
        const modal = page.getByRole('dialog', { name: 'บิลเครื่องชั่งเล็ก', exact: true });
        await modal.locator('input[placeholder*="ค้นหาชื่อ หรือ รหัสสมาชิก"]').fill(`${marker}-${index}`);
        await page.keyboard.press('Escape');
        const row = modal.locator('table').first().locator('tbody tr').first();
        await row.locator('input[type="number"]').nth(0).fill('100');
        await row.locator('input[type="number"]').nth(1).fill('0');
        await row.locator('input[type="number"]').nth(3).fill('1');
        const started = performance.now();
        clickedAt.push(Date.now()); if (!batchStart) batchStart = started;
        await modal.getByRole('button', { name: 'บันทึกบิล', exact: true }).click();
        await expect(modal).not.toBeVisible({ timeout: 15_000 });
        acceptanceMs.push(performance.now() - started); // Upper bound for local durable acceptance.
      }
      await expect.poll(() => commandIds.length, { timeout: 30_000 }).toBe(n);
      // Real native IndexedDB acknowledgement, plus final matching DB receipts.
      await expect.poll(() => page.evaluate(location => new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('lanflow_sync_db');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('sync_queue', 'readonly');
          const read = tx.objectStore('sync_queue').getAll();
          read.onsuccess = () => resolve(read.result.filter((event: { entity: string; locationId: string }) => event.entity === 'rubber_bills' && event.locationId === location).length);
          tx.oncomplete = () => db.close(); tx.onerror = () => { db.close(); reject(tx.error); };
        };
      }), branch), { timeout: 65_000, intervals: [250, 500] }).toBe(0);
      await expect(page.getByRole('row').filter({ hasText: marker })).toHaveCount(n);
      const finishedAt = Date.now();
      const outcomes = JSON.parse(sql(`select jsonb_agg(jsonb_build_object('commandId',command_id,'state',state,'status',result->>'status',
        'completedAt',completed_at,'acceptedAt',accepted_at,'attempts',attempts) order by accepted_at,command_id)
        from private.rubber_queue_jobs where location_id='${branch}'`)) as Array<{commandId:string;state:string;status:string;completedAt:string;acceptedAt:string;attempts:number}>;
      expect(outcomes).toHaveLength(n);
      expect(outcomes.every(row => row.state === 'done' && row.status === 'synced' && row.attempts === 1)).toBe(true);
      const result: Sample = { n, round, batchMs: performance.now() - batchStart, acceptanceMs, commandIds, requests,
        businessMs: outcomes.map((row, i) => Date.parse(row.completedAt) - clickedAt[i]),
        queueToCompleteMs: outcomes.map(row => Date.parse(row.completedAt) - Date.parse(row.acceptedAt)),
        commitToUiMs: outcomes.map(row => finishedAt - Date.parse(row.completedAt)) };
      if (diagnostics) {
        await expect(page.getByRole('row').filter({ hasText: marker }).getByText('ซิงก์แล้ว', { exact: true })).toBeVisible();
        await page.evaluate(commandId => window.rubberTimingEvents.push({ kind: 'confirmed-ui', commandId,
          atMs: window.performance.timeOrigin + window.performance.now() }), commandIds[0]);
        await diagnostics.close();
        result.details = { browser: await page.evaluate(() => window.rubberTimingEvents), server: diagnostics.trace,
          pdfCompletedAtMs, pdfBytes, injectedLock: round === 1 };
        expect(diagnostics.trace.commandId).toBe(commandIds[0]);
        expect(diagnostics.trace.synchronousCommit).toBe('on');
        const commit = diagnostics.trace.commitAcknowledgedMs!;
        expect(commit).toBeGreaterThan(diagnostics.trace.commitDispatchedMs!);
        expect(pdfCompletedAtMs).toBeLessThan(diagnostics.trace.spans.find(span => span.kind === 'submit_rubber_queue')!.startMs);
        expect(result.details.browser.some(event => event.kind === 'outbox-commit' && event.commandId === commandIds[0])).toBe(true);
        expect(result.details.browser.some(event => event.kind === 'acknowledgement-commit' && event.commandId === commandIds[0])).toBe(true);
        expect(result.details.browser.some(event => event.kind === 'confirmed-ui-dom' && event.atMs >= commit)).toBe(true);
        const clicked = result.details.browser.find(event => event.kind === 'click')!;
        const disabled = result.details.browser.find(event => event.kind === 'button-disabled' && event.atMs >= clicked.atMs)!;
        expect(disabled.atMs - clicked.atMs).toBeLessThan(100);
        expect(diagnostics.trace.locks.some(sample => sample.waiting)).toBe(round === 1);
      }
      samples.push(result);
      console.info(JSON.stringify({ mode, n, round, batchMs: result.batchMs, acceptanceMs }));
    } finally {
      await diagnostics?.close();
      await context.close();
      sql(`begin;set local app.history_retention_cleanup='on';
        delete from public.rubber_bill_approval_requests where location_id='${branch}';
        delete from public.rubber_bill_items where bill_id in(select id from public.rubber_bills where location_id='${branch}');
        delete from public.rubber_bills where location_id='${branch}';set constraints all immediate;
        delete from public.dashboard_money_events where location_id='${branch}';delete from public.dashboard_branch_snapshots where location_id='${branch}';
        delete from public.document_deletion_audits where location_id='${branch}';delete from public.user_locations where location_id='${branch}';
        delete from public.locations where id='${branch}';commit;`);
    }
  });
}
