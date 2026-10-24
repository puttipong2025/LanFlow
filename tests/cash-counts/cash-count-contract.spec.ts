import { expect, test, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { assertSafeIntegrationTarget } from "../support/integration-target";
import { selectAppLocation } from "../helpers/select-app-location";
import { dismissRubberWeightAlertIfVisible } from "../helpers/dismiss-threshold-alert";
import { deleteUnusedPrivateDriveImage, downloadPrivateImageFromDrive } from "../../src/lib/server/google-drive";
import { prepareCashCountSubmission } from "../../src/lib/server/submit-cash-count";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const managerId = "00000000-0000-4000-8000-000000000001";
const adminId = "00000000-0000-4000-8000-000000000002";
const counts = { "1000": 70, "500": 0, "100": 0, "50": 0, "20": 0, "10": 0, "5": 0, "2": 0, "1": 0 };

test.describe.serial("independent cash count end-to-end", () => {
  let manager: BrowserContext;
  let admin: BrowserContext;
  let branch = "";
  let countId = "";
  let countNo = "";
  const driveIds: string[] = [];
  const db = () => createClient(url, key, { auth: { persistSession: false } });
  test.beforeAll(async ({ browser }) => {
    assertSafeIntegrationTarget(url);
    const { data, error } = await db().from("locations").insert({ name: "Cash count independent test", code: `CR${Date.now()}` }).select("id").single();
    expect(error).toBeNull(); branch = data!.id;
    const { error: accessError } = await db().from("user_locations").insert([{ user_id: adminId, location_id: branch }, { user_id: managerId, location_id: branch }]);
    expect(accessError).toBeNull();
    const income = await db().from("income_expense").insert({ local_bill_no: `CR-${branch}`, location_id: branch,
      type: "income", number: "CR-IN", tx_date: "2026-10-24", title: "Test baseline", cost: 100000, bill_option: "รายรับ", sync_status: "synced",
      created_by_user_id: managerId, created_by_name: "Test manager", created_by_phone: "0800000000" });
    expect(income.error).toBeNull();
    manager = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
    admin = await browser.newContext({ storageState: "playwright/.auth/admin.json" });
  });
  test.afterAll(async () => {
    await manager?.close(); await admin?.close();
    if (!branch) return;
    const files = await db().from("cash_count_bank_evidence").select("drive_file_id,cash_count_sessions!inner(location_id)").eq("cash_count_sessions.location_id", branch);
    for (const row of files.data ?? []) if (row.drive_file_id) driveIds.push(row.drive_file_id);
    // Delete only IDs returned by this test's own branch evidence.
    for (const fileId of new Set(driveIds)) await deleteUnusedPrivateDriveImage(fileId);
    if (!/^[0-9a-f-]{36}$/.test(branch)) throw new Error("Unexpected fixture scope");
    execFileSync("docker", ["exec", "supabase_db_webapp", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `begin;
      update public.cash_count_sessions set status='cancelled',ended_at=now() where location_id='${branch}' and status='active';
      delete from public.cash_count_bank_evidence where session_id in(select id from public.cash_count_sessions where location_id='${branch}');
      delete from public.cash_counts where location_id='${branch}';delete from public.cash_count_sessions where location_id='${branch}';
      delete from public.report_items where location_id='${branch}';delete from public.report_batches where location_id='${branch}';
      delete from public.income_expense where location_id='${branch}';set constraints all immediate;
      delete from public.document_deletion_audits where location_id='${branch}';
      delete from public.dashboard_money_events where location_id='${branch}';delete from public.dashboard_branch_snapshots where location_id='${branch}';
      delete from public.cash_count_alert_members where location_id='${branch}';delete from public.user_locations where location_id='${branch}';
      delete from private.document_number_counters where location_id='${branch}';delete from public.locations where id='${branch}';commit;`]);
  });
  test("counts without a report, preserves shortage and replays a lost response", async () => {
    const start = await manager.request.post("/api/lanflow/cash-counts/session", { data: { locationId: branch } });
    expect(start.status(), await start.text()).toBe(201);
    const { session } = await start.json(); expect(session.systemBalance).toBe(100000);
    const submit = await manager.request.post("/api/lanflow/cash-counts", { data: { sessionId: session.id, actualCounts: counts } });
    expect(submit.status(), await submit.text()).toBe(201);
    const saved = await submit.json(); countId = saved.id; countNo = saved.reportNo;
    expect(saved).toMatchObject({ actualTotal: 70000, accountBalance: 0, countedTotal: 70000, systemBalance: 100000, differenceTotal: -30000 });
    const replay = await manager.request.post("/api/lanflow/cash-counts", { data: { sessionId: session.id, actualCounts: counts } });
    expect((await replay.json()).id).toBe(countId);
    expect((await db().from("report_batches").select("id").eq("location_id", branch)).data).toHaveLength(0);
  });
  test("checking is optional, manager-only, shown in UI, and produces a real PDF", async () => {
    expect((await admin.request.patch(`/api/lanflow/cash-counts/${countId}`)).status()).toBe(403);
    expect((await manager.request.patch(`/api/lanflow/cash-counts/${countId}`)).ok()).toBe(true);
    const detail = await manager.request.get(`/api/lanflow/cash-counts/${countId}?locationId=${branch}`);
    expect((await detail.json()).checkedByName).toBeTruthy();
    const page = await manager.newPage(); await page.goto("/"); await dismissRubberWeightAlertIfVisible(page);
    await selectAppLocation(page, branch); await page.getByRole("button", { name: "นับเงิน", exact: true }).click();
    await page.getByRole("row").filter({ hasText: countNo }).getByRole("button", { name: "ดูรายละเอียด" }).click();
    const modal = page.getByRole("dialog", { name: `รายละเอียด ${countNo}` });
    await expect(modal.getByText("เงินขาด 30,000.00 บาท", { exact: true })).toBeVisible();
    await expect(modal.getByRole("button", { name: "ยืนยันตรวจสอบ" })).toHaveCount(0);
    const download = page.waitForEvent("download"); await modal.getByRole("button", { name: "พิมพ์ / PDF 80 มม." }).click();
    await (await download).saveAs("output/pdf/cash-count-browser-80mm.pdf");
    await page.screenshot({ path: test.info().outputPath("cash-count-details.png") }); await page.close();
  });
  test("deleting counts and reports is independent in both directions", async () => {
    const reportResponse = await manager.request.post("/api/lanflow/reports", { data: { locationId: branch } });
    expect(reportResponse.ok(), await reportResponse.text()).toBe(true);
    const report = await reportResponse.json();
    const deletedReport = await manager.request.delete(`/api/lanflow/reports/${report.id}`);
    expect(deletedReport.ok(), await deletedReport.text()).toBe(true);
    expect((await manager.request.get(`/api/lanflow/cash-counts/${countId}?locationId=${branch}`)).ok()).toBe(true);
    const nextReport = await manager.request.post("/api/lanflow/reports", { data: { locationId: branch } });
    expect(nextReport.ok()).toBe(true);
    const next = await nextReport.json();
    const deletion = await manager.request.delete(`/api/lanflow/cash-counts/${countId}?locationId=${branch}`);
    expect(deletion.ok(), await deletion.text()).toBe(true);
    expect((await db().from("report_batches").select("id").eq("id", next.id)).data).toHaveLength(1);
  });
  test("live OCR stores one private Drive image and retries submit without duplication", async () => {
    test.skip(process.env.RUN_BANK_OCR !== "1", "Opt in to the live OCR/Drive acceptance test"); test.setTimeout(90_000);
    const start = await manager.request.post("/api/lanflow/cash-counts/session", { data: { locationId: branch } });
    expect(start.ok(), await start.text()).toBe(true); const { session } = await start.json();
    const image = { name: "bank.jpg", mimeType: "image/jpeg", buffer: readFileSync("C:/Users/Do/AppData/Local/Temp/codex-clipboard-b87920f9-1919-4798-a43d-3c56154cbca5.jpg") };
    const ocr = await manager.request.post("/api/lanflow/cash-counts/ocr", { multipart: { sessionId: session.id, slotId: crypto.randomUUID(), image } });
    expect(ocr.ok(), await ocr.text()).toBe(true); const result = await ocr.json(); expect(result.amount).toBe(1366.68);
    const form = { sessionId: session.id, actualCounts: JSON.stringify(counts), image, evidenceId: result.evidenceId, confirmed: "true" };
    const submitted = await manager.request.post("/api/lanflow/cash-counts", { multipart: form });
    expect(submitted.ok(), await submitted.text()).toBe(true); const saved = await submitted.json();
    expect(saved.countedTotal).toBe(71366.68); expect(saved.differenceTotal).toBe(-28633.32);
    const replay = await manager.request.post("/api/lanflow/cash-counts", { multipart: form });
    expect((await replay.json()).id).toBe(saved.id);
    const photo = await manager.request.get(`/api/lanflow/cash-counts/${saved.id}/image`);
    expect(photo.ok()).toBe(true); expect(await photo.body()).toEqual(image.buffer);
    const files = await db().from("cash_count_bank_evidence").select("id,drive_file_id").eq("count_id", saved.id);
    expect(files.data).toHaveLength(1); expect(files.data?.[0].drive_file_id).toBeTruthy();
  });
  test("unused private Drive evidence respects the grace period and is cleaned after cancellation", async () => {
    test.skip(process.env.RUN_BANK_OCR !== "1", "Opt in to live Drive acceptance"); test.setTimeout(60_000);
    const start = await manager.request.post("/api/lanflow/cash-counts/session", { data: { locationId: branch } });
    expect(start.ok(), await start.text()).toBe(true); const { session } = await start.json();
    const bytes = readFileSync("tests/fixtures/cash-count/balance-priority.png");
    const { data: evidence, error } = await db().from("cash_count_bank_evidence").insert({
      session_id: session.id, owner_user_id: managerId, amount: 1500.25, balance_kind: "balance",
      image_sha256: createHash("sha256").update(bytes).digest("hex"),
    }).select("id").single();
    expect(error).toBeNull();
    const form = new FormData(); form.set("sessionId", session.id); form.set("evidenceId", evidence!.id);
    form.set("actualCounts", JSON.stringify(counts)); form.set("confirmed", "true");
    form.set("image", new File([bytes], "synthetic-bank.png", { type: "image/png" }));
    await prepareCashCountSubmission(new Request("http://localhost", { method: "POST", body: form }), managerId);
    const { data: uploaded } = await db().from("cash_count_bank_evidence").select("drive_file_id").eq("id", evidence!.id).single();
    const fileId = uploaded!.drive_file_id; driveIds.push(fileId);
    expect((await downloadPrivateImageFromDrive(fileId)).ok).toBe(true);
    const cancelled = await manager.request.delete("/api/lanflow/cash-counts/session", { data: { sessionId: session.id } });
    expect(cancelled.ok()).toBe(true);
    expect((await db().from("cash_count_bank_evidence").select("id").eq("id", evidence!.id)).data).toHaveLength(1);
    expect((await db().from("cash_count_bank_evidence").update({ upload_started_at: new Date(Date.now() - 180_000).toISOString() }).eq("id", evidence!.id)).error).toBeNull();
    expect((await manager.request.get(`/api/lanflow/cash-counts/session?locationId=${branch}`)).ok()).toBe(true);
    await expect.poll(async () => (await db().from("cash_count_bank_evidence").select("id").eq("id", evidence!.id)).data?.length).toBe(0);
    expect(await downloadPrivateImageFromDrive(fileId).then(() => false, () => true)).toBe(true);
  });
  test("four duplicate accounts attach independently, preserve order and expose only their selected image", async () => {
    test.skip(process.env.RUN_BANK_OCR !== "1", "Opt in to live Drive acceptance"); test.setTimeout(120_000);
    const start = await manager.request.post("/api/lanflow/cash-counts/session", { data: { locationId: branch } });
    expect(start.ok(), await start.text()).toBe(true); const { session } = await start.json();
    const image = { name: "bank.jpg", mimeType: "image/jpeg", buffer: readFileSync("C:/Users/Do/AppData/Local/Temp/codex-clipboard-b87920f9-1919-4798-a43d-3c56154cbca5.jpg") };
    const ids: string[] = [];
    for (let index = 0; index < 4; index++) {
      const read = await manager.request.post("/api/lanflow/cash-counts/ocr", { multipart: { sessionId: session.id, slotId: crypto.randomUUID(), image } });
      expect(read.ok(), await read.text()).toBe(true); const result = await read.json(); expect(result.amount).toBe(1366.68); ids.push(result.evidenceId);
    }
    const form = new FormData(); form.set("sessionId", session.id); form.set("actualCounts", JSON.stringify(counts));
    for (const id of ids) { form.append("evidenceId", id); form.append("confirmed", "true"); form.append("image", new File([image.buffer], "bank.jpg", { type: "image/jpeg" })); }
    const makeRequest = () => new Request("http://localhost", { method: "POST", body: form });
    const prepared = await prepareCashCountSubmission(makeRequest(), managerId);
    const submit = await manager.request.post("/api/lanflow/cash-counts", { data: { sessionId: session.id, actualCounts: counts, evidenceIds: prepared.evidenceIds } });
    expect(submit.ok(), await submit.text()).toBe(true); const result = await submit.json();
    expect(result.accountBalance).toBe(5466.72); expect(result.countedTotal).toBe(75466.72); expect(result.bankAccounts.map((item: { id: string }) => item.id)).toEqual(ids);
    const replay = await manager.request.post("/api/lanflow/cash-counts", { data: { sessionId: session.id, actualCounts: counts, evidenceIds: ids } });
    expect((await replay.json()).id).toBe(result.id);
    const detail = await manager.request.get(`/api/lanflow/cash-counts/${result.id}?locationId=${branch}`);
    expect((await detail.json()).bankAccounts).toHaveLength(4);
    for (const position of [1, 4]) {
      const photo = await manager.request.get(`/api/lanflow/cash-counts/${result.id}/image?position=${position}`);
      expect(photo.ok()).toBe(true); expect(await photo.body()).toEqual(image.buffer);
    }
    expect((await manager.request.get(`/api/lanflow/cash-counts/${result.id}/image?position=5`)).status()).toBe(400);
    const files = await db().from("cash_count_bank_evidence").select("drive_file_id").eq("count_id", result.id);
    expect(new Set(files.data?.map((row) => row.drive_file_id)).size).toBe(4);
  });
});
