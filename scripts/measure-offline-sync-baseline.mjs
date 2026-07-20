import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import dotenv from "dotenv";
import { chromium } from "playwright";

dotenv.config({ path: ".env.local" });

const port = Number(process.env.OFFLINE_BASELINE_PORT || 3003);
const baseUrl = process.env.OFFLINE_BASELINE_BASE_URL || `http://127.0.0.1:${port}`;
const samples = Number(process.env.OFFLINE_BASELINE_SAMPLES || 10);
const phone = process.env.BASELINE_PHONE || process.env.TEST_PHONE || "0800000000";
const password = process.env.BASELINE_PASSWORD || process.env.TEST_PASSWORD || "password123";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to clean up benchmark records safely");
}

function percentile(values, nth) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil((nth / 100) * ordered.length) - 1)];
}

async function waitUntil(check, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function waitForServer() {
  await waitUntil(async () => {
    try {
      const response = await fetch(baseUrl);
      return response.ok || response.status === 307 || response.status === 308;
    } catch {
      return false;
    }
  }, 60_000, baseUrl);
}

async function readQueue(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("lanflow_sync_db", 3);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      request.transaction?.abort();
      resolve([]);
    };
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("sync_queue")) {
        db.close();
        resolve([]);
        return;
      }
      const transaction = db.transaction("sync_queue", "readonly");
      const rows = transaction.objectStore("sync_queue").getAll();
      rows.onsuccess = () => {
        db.close();
        resolve(rows.result);
      };
      rows.onerror = () => {
        db.close();
        reject(rows.error);
      };
    };
  }));
}

async function cleanupIncomeExpense(page, event) {
  const lookup = await page.request.fetch(
    `${supabaseUrl}/rest/v1/income_expense?client_temp_id=eq.${event.id}&select=revision_no`,
    { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } }
  );
  const rows = await lookup.json();
  if (!lookup.ok() || rows.length !== 1) throw new Error("Unable to locate the synced benchmark record for cleanup");

  const response = await page.request.post(`${baseUrl}/api/lanflow/income-expense`, {
    data: {
      ...event.payload,
      operation: "delete",
      recordStatus: "deleted",
      expectedRevisionNo: rows[0].revision_no,
      idempotencyKey: `delete:${event.id}:${rows[0].revision_no}`,
    },
  });
  if (!response.ok()) throw new Error(`Benchmark cleanup failed with ${response.status()}`);
}

function payloadFromStoredRow(row) {
  return {
    operation: "delete",
    expectedRevisionNo: row.revision_no,
    clientTempId: row.client_temp_id,
    idempotencyKey: `delete:${row.client_temp_id}:${row.revision_no}`,
    locationId: row.location_id,
    recordStatus: "deleted",
    localBillNo: row.local_bill_no,
    txDate: row.tx_date,
    type: row.type,
    title: row.title,
    cost: Number(row.cost),
    billOption: row.bill_option,
    unit: row.unit,
    price: row.price == null ? null : Number(row.price),
    incomeSaleItemId: row.income_sale_item_id,
    stockProductId: row.stock_product_id,
    stockQuantity: row.stock_quantity == null ? null : Number(row.stock_quantity),
    clientRecordedAt: row.client_recorded_at ?? row.created_at,
    clientCreatedAt: row.client_created_at ?? row.created_at,
    createdByUserId: row.created_by_user_id,
    createdByName: row.created_by_name,
    createdByPhone: row.created_by_phone,
    deletedByName: row.created_by_name,
    deletedByPhone: row.created_by_phone,
  };
}

async function cleanupStaleBenchmarkRecords(page) {
  const lookup = await page.request.fetch(
    `${supabaseUrl}/rest/v1/income_expense?title=like.P0-T2-*&record_status=eq.active&select=*`,
    { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } }
  );
  const rows = await lookup.json();
  if (!lookup.ok()) throw new Error("Unable to inspect stale benchmark records");
  for (const row of rows) {
    const response = await page.request.post(`${baseUrl}/api/lanflow/income-expense`, { data: payloadFromStoredRow(row) });
    if (!response.ok()) throw new Error(`Stale benchmark cleanup failed with ${response.status()}`);
  }
  return rows.length;
}

async function runSample(browser, index) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const marker = `P0-T2-${Date.now()}-${index}`;
  try {
    await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
    await page.locator('input[type="tel"]').fill(phone);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
    await page.getByRole("button", { name: "ออกจากระบบ" }).waitFor({ timeout: 30_000 });
    const staleRecordsCleaned = index === 0 ? await cleanupStaleBenchmarkRecords(page) : 0;
    await page.getByRole("button", { name: "รับ-จ่าย" }).click();
    await page.getByRole("button", { name: "เพิ่มรายรับ" }).waitFor({ timeout: 15_000 });
    await waitUntil(() => page.evaluate(() => Boolean(navigator.serviceWorker?.controller)), 15_000, "service worker control");

    await context.setOffline(true);
    await wait(250);
    await page.getByRole("button", { name: "เพิ่มรายรับ" }).click();
    const modal = page.locator(".fixed.inset-0").last();
    await modal.locator("table tbody tr").first().locator("input").first().fill(marker);
    await modal.locator("table tbody tr").first().locator('input[type="number"]').first().fill("1700");
    await modal.getByRole("button", { name: "บันทึกบิล" }).click();
    await modal.waitFor({ state: "hidden", timeout: 10_000 });

    const queued = await readQueue(page);
    const event = queued.find((item) => item.entity === "income_expense" && item.payload?.title === marker);
    if (!event || event.status !== "pending") throw new Error("Expected a pending Income/Expense event in IndexedDB");
    const pending = queued.filter((item) => item.status === "pending");
    const oldestTimestamp = Math.min(...pending.map((item) => item.timestamp));
    const oldestPendingAgeMs = Math.max(0, Date.now() - oldestTimestamp);

    const reconnectStartedAt = performance.now();
    await context.setOffline(false);
    await waitUntil(async () => {
      try {
        return !(await readQueue(page)).some((item) => item.queueId === event.queueId);
      } catch (error) {
        if (error instanceof Error && error.message.includes("Execution context was destroyed")) return false;
        throw error;
      }
    }, 30_000, "pending event sync");
    const reconnectToSyncedMs = Math.round(performance.now() - reconnectStartedAt);
    const queueAfterSync = await readQueue(page);
    const failed = queueAfterSync.filter((item) => item.status === "failed").length;
    const conflict = queueAfterSync.filter((item) => item.status === "conflict").length;
    if (failed || conflict) throw new Error(`Benchmark event did not sync cleanly (failed=${failed}, conflict=${conflict})`);

    await cleanupIncomeExpense(page, event);
    return { queueDepth: pending.length, oldestPendingAgeMs, reconnectToSyncedMs, success: 1, failed: 0, conflict: 0, staleRecordsCleaned };
  } finally {
    await context.setOffline(false).catch(() => {});
    await context.close();
  }
}

let server;
let browser;
try {
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], {
    cwd: process.cwd(), env: process.env, stdio: "ignore",
  });
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const results = [];
  for (let index = 0; index < samples; index += 1) results.push(await runSample(browser, index));

  const total = results.length;
  console.log(JSON.stringify({
    scenario: "Production PWA; authenticated super-admin creates one Income/Expense record offline, then reconnects. Each sample uses a fresh browser context and soft-deletes its synced test record.",
    samples: total,
    staleBenchmarkRecordsCleaned: results.reduce((sum, result) => sum + result.staleRecordsCleaned, 0),
    queueDepth: { beforeOfflineCreate: 0, atReconnectP50: percentile(results.map((result) => result.queueDepth), 50) },
    oldestPendingAgeMsAtReconnect: {
      p50: percentile(results.map((result) => result.oldestPendingAgeMs), 50),
      p95: percentile(results.map((result) => result.oldestPendingAgeMs), 95),
    },
    reconnectToSyncedMs: {
      p50: percentile(results.map((result) => result.reconnectToSyncedMs), 50),
      p95: percentile(results.map((result) => result.reconnectToSyncedMs), 95),
    },
    outcomeRatePercent: {
      success: (results.reduce((sum, result) => sum + result.success, 0) / total) * 100,
      failed: (results.reduce((sum, result) => sum + result.failed, 0) / total) * 100,
      conflict: (results.reduce((sum, result) => sum + result.conflict, 0) / total) * 100,
    },
  }, null, 2));
} finally {
  await browser?.close();
  server?.kill();
}
