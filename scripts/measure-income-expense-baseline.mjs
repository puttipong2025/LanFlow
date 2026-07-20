import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import dotenv from "dotenv";
import { chromium } from "playwright";

dotenv.config({ path: ".env.local" });

const port = Number(process.env.BASELINE_PORT || 3002);
const baseUrl = process.env.BASELINE_BASE_URL || `http://127.0.0.1:${port}`;
const samples = Number(process.env.BASELINE_SAMPLES || 20);
const phone = process.env.BASELINE_PHONE || process.env.TEST_PHONE || "0800000000";
const password = process.env.BASELINE_PASSWORD || process.env.TEST_PASSWORD || "password123";
const feedPath = "/api/lanflow/income-expense/feed";

function percentile(values, nth) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil((nth / 100) * ordered.length) - 1)];
}

function isFeedRequest(url) {
  const parsed = new URL(url);
  return parsed.pathname === feedPath;
}

async function waitForServer() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok || [307, 308].includes(response.status)) return;
    } catch {
      // The dev server is still starting.
    }
    await wait(500);
  }
  throw new Error(`Timed out waiting for ${baseUrl}`);
}

async function login(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="tel"]').fill(phone);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await page.getByRole("button", { name: "ออกจากระบบ" }).waitFor({ timeout: 30_000 });
  const storageState = await context.storageState();
  await context.close();
  return storageState;
}

async function measureOpen(browser, storageState) {
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();
  const startedAt = performance.now();
  const responses = [];
  let inFlight = 0;
  let firstResponseAt = 0;
  let lastResponseAt = 0;

  page.on("request", (request) => {
    if (isFeedRequest(request.url())) inFlight += 1;
  });
  page.on("requestfailed", (request) => {
    if (isFeedRequest(request.url())) inFlight -= 1;
  });
  const onResponse = (response) => {
    if (!isFeedRequest(response.url())) return;
    inFlight -= 1;
    const completedAt = performance.now() - startedAt;
    firstResponseAt ||= completedAt;
    lastResponseAt = completedAt;
    responses.push((async () => {
      const body = await response.body();
      let rowCount = 0;
      try {
        const parsed = JSON.parse(body.toString("utf8"));
        rowCount = Array.isArray(parsed?.rows) ? parsed.rows.length : 0;
      } catch {
        // Count the response and its bytes even if it is not JSON.
      }
      return { bytes: body.byteLength, rowCount };
    })());
  };
  page.on("response", onResponse);

  await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
  const deadline = Date.now() + 60_000;
  while (!firstResponseAt || inFlight > 0 || performance.now() - startedAt - lastResponseAt < 1_000) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for the Income/Expense feed to settle");
    await wait(100);
  }
  page.off("response", onResponse);
  await page.getByRole("button", { name: "รับ-จ่าย" }).click();
  await page.getByRole("heading", { name: /CRUD รายรับ-รายจ่าย/ }).waitFor({ timeout: 10_000 });
  const completed = await Promise.all(responses);
  await context.close();

  return {
    requestCount: completed.length,
    payloadBytes: completed.reduce((sum, response) => sum + response.bytes, 0),
    loadMs: Math.round(lastResponseAt),
    feedRowCount: completed.reduce((sum, response) => sum + response.rowCount, 0),
  };
}

let server;
let browser;
try {
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(port)], {
    cwd: process.cwd(), env: { ...process.env, NODE_ENV: "development" }, stdio: "ignore",
  });
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const storageState = await login(browser);
  await measureOpen(browser, storageState); // Warm-up; excluded from metrics.
  const results = [];
  for (let index = 0; index < samples; index += 1) results.push(await measureOpen(browser, storageState));

  console.log(JSON.stringify({
    scenario: "Authenticated super-admin opens the workspace, then the Income/Expense tab, with a fresh browser context per sample.",
    samples,
    sourceRequestScope: "Income/Expense server feed API requests only; excludes auth, Next assets, bootstrap, and unrelated module requests.",
    payloadScope: "Decoded JSON response bytes for the scoped feed request.",
    requestsPerOpen: percentile(results.map((result) => result.requestCount), 50),
    initialPayloadBytes: percentile(results.map((result) => result.payloadBytes), 50),
    loadMs: { p50: percentile(results.map((result) => result.loadMs), 50), p95: percentile(results.map((result) => result.loadMs), 95) },
    feedRowsPerOpen: percentile(results.map((result) => result.feedRowCount), 50),
  }, null, 2));
} finally {
  await browser?.close();
  server?.kill();
}
