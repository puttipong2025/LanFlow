import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { selectAppLocation } from "../helpers/select-app-location";
import { bangkokDateString } from "../../src/lib/bangkok-date";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const userId = "00000000-0000-4000-8000-000000000003";
const adminId = "00000000-0000-4000-8000-000000000002";
const managerId = "00000000-0000-4000-8000-000000000001";

async function contextFor(browser: Browser, role: "user" | "admin" | "super_admin") {
  return browser.newContext({ storageState: `playwright/.auth/${role}.json` });
}

function service() {
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function addIncome(locationId: string, actorId: string, title: string, type: "income" | "expense" = "income", cost = 1000) {
  const db = service();
  const { data: actor } = await db.from("profiles").select("name,phone").eq("id", actorId).single();
  const id = crypto.randomUUID();
  const number = `CC-${id.slice(0, 8)}`;
  const { error } = await db.from("income_expense").insert({
    id, client_temp_id: id, local_bill_no: number, server_bill_no: number,
    idempotency_key: `cash-count:${id}`, sync_status: "synced", record_status: "active",
    location_id: locationId, type, number, tx_date: bangkokDateString(),
    title, cost, bill_option: type === "income" ? "รายรับ" : "ค่าใช้จ่าย", server_received_at: new Date().toISOString(), revision_no: 0,
    created_by_user_id: actorId, created_by_name: actor?.name ?? "", created_by_phone: actor?.phone ?? "",
  });
  expect(error).toBeNull();
  return id;
}

test.describe.serial("cash count aggregate contract", () => {
  let locationId = "";
  let user: BrowserContext;
  let admin: BrowserContext;
  let manager: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    expect(serviceRoleKey).toBeTruthy();
    const db = service();
    const { data: location, error } = await db.from("locations").insert({ name: `Cash Count ${crypto.randomUUID().slice(0, 8)}`, code: `CC${Date.now()}` }).select("id").single();
    expect(error).toBeNull();
    locationId = location!.id;
    expect((await db.from("user_locations").insert([
      { user_id: userId, location_id: locationId },
      { user_id: adminId, location_id: locationId },
      { user_id: managerId, location_id: locationId },
    ])).error).toBeNull();
    user = await contextFor(browser, "user");
    admin = await contextFor(browser, "admin");
    manager = await contextFor(browser, "super_admin");
  });

  test.afterAll(async () => {
    await user?.close(); await admin?.close(); await manager?.close();
    if (!locationId) return;
    const db = service();
    const { data: reports } = await db.from("report_batches").select("id").eq("location_id", locationId);
    const reportIds = (reports ?? []).map((row) => row.id);
    await db.from("cash_counts").delete().eq("location_id", locationId);
    await db.from("cash_count_sessions").delete().eq("location_id", locationId);
    if (reportIds.length) await db.from("report_items").delete().in("report_id", reportIds);
    await db.from("report_batches").delete().eq("location_id", locationId);
    await db.from("income_expense").delete().eq("location_id", locationId);
    await db.from("document_deletion_audits").delete().eq("location_id", locationId);
    await db.from("user_locations").delete().eq("location_id", locationId);
    await db.from("locations").delete().eq("id", locationId);
  });

  test("fixed cutoff keeps business writes open and creates a private paired result", async () => {
    const beforeId = await addIncome(locationId, userId, "ก่อนเริ่มนับ");
    const start = await user.request.post("/api/lanflow/cash-counts/session", { data: { locationId } });
    expect(start.status()).toBe(201);
    const session = (await start.json()).session as { id: string; cutoffAt: string };

    const blockedReport = await admin.request.post("/api/lanflow/reports", { data: { locationId } });
    expect(blockedReport.status()).toBe(409);
    expect((await blockedReport.json()).error).toContain("ตรวจนับ");

    const afterId = await addIncome(locationId, userId, "หลังเริ่มนับ");
    const actualCounts = { "1": 0, "2": 0, "5": 0, "10": 0, "20": 0, "50": 0, "100": 0, "500": 0, "1000": 1 };
    const submit = await user.request.post("/api/lanflow/cash-counts", { data: { sessionId: session.id, actualCounts } });
    expect(submit.status()).toBe(201);
    const receipt = await submit.json();
    expect(Object.keys(receipt).sort()).toEqual(["actualCounts", "actualTotal", "countedByName", "cutoffAt", "id", "reportId", "reportNo", "submittedAt"].sort());
    expect(receipt.actualTotal).toBe(1000);

    const { data: items } = await service().from("report_items").select("entity_id").eq("report_id", receipt.reportId);
    expect(items?.some((row) => row.entity_id === beforeId)).toBe(true);
    expect(items?.some((row) => row.entity_id === afterId)).toBe(false);

    expect((await user.request.get(`/api/lanflow/cash-counts?locationId=${locationId}`)).status()).toBe(403);
    expect((await admin.request.get(`/api/lanflow/cash-counts?locationId=${locationId}`)).status()).toBe(403);
    const history = await manager.request.get(`/api/lanflow/cash-counts?locationId=${locationId}`);
    expect(history.ok()).toBe(true);
    expect((await history.json()).counts[0]).toMatchObject({ id: receipt.id, anomalyScore: null, confidence: null, formulaVersion: "cash-v1-baseline" });

    const adminReports = await admin.request.get(`/api/lanflow/reports?locationId=${locationId}`);
    const adminMarker = (await adminReports.json()).reports.find((row: { id: string }) => row.id === receipt.reportId);
    expect(adminMarker).toMatchObject({ hasCashCount: true, cashCountId: null });
    expect(adminMarker.cashCountCheckerName).toBeTruthy();

    const managerPage = await manager.newPage();
    let detailRequestCount = 0;
    managerPage.on("request", (request) => {
      if (new URL(request.url()).pathname === `/api/lanflow/cash-counts/${receipt.id}`) {
        detailRequestCount += 1;
      }
    });
    await managerPage.goto("/");
    await selectAppLocation(managerPage, locationId);
    await managerPage.getByRole("button", { name: "รายงาน", exact: true }).click();
    await expect(managerPage.getByText("มีผลตรวจนับเงินสด", { exact: true })).toBeVisible();
    await managerPage.getByRole("button", { name: "เปิดผลตรวจนับ", exact: true }).click();
    await expect(managerPage.getByRole("heading", { name: `รายละเอียด ${receipt.reportNo}` })).toBeVisible();
    expect(detailRequestCount).toBe(1);
    await managerPage.close();

    const detail = await manager.request.get(`/api/lanflow/cash-counts/${receipt.id}?locationId=${locationId}`);
    expect(detail.ok()).toBe(true);
    expect(await detail.json()).toMatchObject({ actualTotal: 1000, anomalyScore: null, confidence: null });
    expect((await manager.request.get(`/api/lanflow/cash-counts/${receipt.id}?locationId=00000000-0000-4000-8000-000000000099`)).status()).toBe(404);
    expect((await admin.request.get(`/api/lanflow/cash-counts/${receipt.id}?locationId=${locationId}`)).status()).toBe(403);

    const directDelete = await manager.request.delete(`/api/lanflow/reports/${receipt.reportId}`);
    expect(directDelete.status()).toBe(409);
    expect((await directDelete.json()).error).toContain("โมดูลนับเงิน");
    const pairedDelete = await manager.request.delete(`/api/lanflow/cash-counts/${receipt.id}?locationId=${locationId}`);
    expect(pairedDelete.ok()).toBe(true);
    const [{ data: count }, { data: report }, { data: submittedSession }, { data: reportItems }] = await Promise.all([
      service().from("cash_counts").select("id").eq("id", receipt.id).maybeSingle(),
      service().from("report_batches").select("id").eq("id", receipt.reportId).maybeSingle(),
      service().from("cash_count_sessions").select("id").eq("id", session.id).maybeSingle(),
      service().from("report_items").select("id").eq("report_id", receipt.reportId),
    ]);
    expect(count).toBeNull();
    expect(report).toBeNull();
    expect(submittedSession).toBeNull();
    expect(reportItems).toEqual([]);
    const reportsAfterDelete = await admin.request.get(`/api/lanflow/reports?locationId=${locationId}`);
    const deletedMarker = (await reportsAfterDelete.json()).reports.find((row: { id: string }) => row.id === receipt.reportId);
    expect(deletedMarker).toBeUndefined();
    expect((await manager.request.get(`/api/lanflow/cash-counts/${receipt.id}?locationId=${locationId}`)).status()).toBe(404);

    const deletionHistory = await manager.request.get(
      `/api/lanflow/cash-counts?locationId=${locationId}&view=deletions`,
    );
    expect(deletionHistory.ok(), await deletionHistory.text()).toBe(true);
    expect((await deletionHistory.json()).deletions).toContainEqual(expect.objectContaining({
      documentKind: "cash_count",
      documentNo: receipt.reportNo,
      originalActorName: expect.any(String),
    }));
    expect((await admin.request.get(
      `/api/lanflow/cash-counts?locationId=${locationId}&view=deletions`,
    )).status()).toBe(403);

    const retryDelete = await manager.request.delete(
      `/api/lanflow/cash-counts/${receipt.id}?locationId=${locationId}`,
    );
    expect(retryDelete.ok(), await retryDelete.text()).toBe(true);
  });

  test("only the starter can cancel a live session", async () => {
    await addIncome(locationId, userId, "รอบยกเลิก");
    const start = await user.request.post("/api/lanflow/cash-counts/session", { data: { locationId } });
    const session = (await start.json()).session as { id: string };
    const otherCancel = await admin.request.delete("/api/lanflow/cash-counts/session", { data: { sessionId: session.id } });
    expect(otherCancel.status()).toBe(400);
    expect((await otherCancel.json()).error).toContain("ผู้เริ่ม");
    expect((await user.request.delete("/api/lanflow/cash-counts/session", { data: { sessionId: session.id } })).ok()).toBe(true);
  });

  test("user sees a blind nine-field form and only the immediate receipt", async () => {
    await addIncome(locationId, userId, "รอบทดสอบหน้าจอ");
    const page = await user.newPage();
    await page.goto("/");
    await selectAppLocation(page, locationId);
    await page.getByRole("button", { name: "นับเงิน", exact: true }).click();
    await page.getByRole("button", { name: "เริ่มนับเงิน" }).click();

    for (const denomination of [1000, 500, 100, 50, 20, 10, 5, 2, 1]) {
      const input = page.getByRole("spinbutton", { name: `จำนวนเงินชนิด ${denomination} บาท` });
      await expect(input).toHaveValue("");
      await input.fill(denomination === 1000 ? "1" : "0");
    }
    await expect(page.getByText("1,000.00 บาท", { exact: false }).first()).toBeVisible();
    await page.getByRole("button", { name: "ยืนยันและส่งผล" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("จำนวนที่กรอกครบ 9 ชนิด");
    await expect(dialog).not.toContainText("คาดการณ์");
    await dialog.getByRole("button", { name: "ส่งผลตรวจนับ" }).click();
    await expect(page.getByRole("heading", { name: "ส่งผลตรวจนับสำเร็จ" })).toBeVisible();
    await expect(page.getByText("ประวัติผลตรวจนับสาขานี้")).toHaveCount(0);
    await page.close();
  });

  test("second round stores immutable score, confidence, and evidence separately", async () => {
    await addIncome(locationId, userId, "รายจ่ายทดสอบสูตร", "expense", 100);
    const start = await user.request.post("/api/lanflow/cash-counts/session", { data: { locationId } });
    expect(start.ok()).toBe(true);
    const session = (await start.json()).session as { id: string };
    const actualCounts = { "1": 0, "2": 0, "5": 0, "10": 0, "20": 0, "50": 0, "100": 0, "500": 0, "1000": 1 };
    const submit = await user.request.post("/api/lanflow/cash-counts", { data: { sessionId: session.id, actualCounts } });
    expect(submit.ok()).toBe(true);
    const receipt = await submit.json();
    expect(receipt).not.toHaveProperty("anomalyScore");
    expect(receipt).not.toHaveProperty("confidence");
    expect(receipt).not.toHaveProperty("expectedCounts");
    expect(receipt).not.toHaveProperty("evidence");

    const detailResponse = await manager.request.get(`/api/lanflow/cash-counts/${receipt.id}?locationId=${locationId}`);
    expect(detailResponse.ok()).toBe(true);
    const detail = await detailResponse.json();
    expect(detail).toMatchObject({ expectedTotal: 900, differenceTotal: 100, formulaVersion: "cash-v1" });
    expect(detail.expectedCounts).toEqual({ "1": 0, "2": 0, "5": 0, "10": 0, "20": 0, "50": 0, "100": 4, "500": 1, "1000": 0 });
    expect(detail.differenceCounts).toEqual({ "1": 0, "2": 0, "5": 0, "10": 0, "20": 0, "50": 0, "100": -4, "500": -1, "1000": 1 });
    expect(detail).toMatchObject({ anomalyScore: 44, confidence: 85, analysisStatus: "review" });
    expect(detail.evidence.components).toEqual({ total: 14, denomination: 20, pattern: 10 });
    expect(detail.evidence.limitations).toContain("จำลองรับเงินทอน 1 ครั้ง รวม 900 บาท");
    expect(detail.anomalyScore).toBeGreaterThan(0);
    expect(detail.confidence).toBeLessThan(100);
    expect(detail.evidence.highlights.length).toBeGreaterThan(0);
    expect(detail.evidence.limitations.length).toBeGreaterThan(0);
    expect(detail.evidence.limitations.some((item: string) => item.includes("เงินทอน"))).toBe(true);
    expect(detail.evidence.references.length).toBeGreaterThan(0);
  });

  test("expired sessions reject stale submit and stop blocking normal reports", async () => {
    await addIncome(locationId, userId, "รอบหมดเวลา");
    const start = await user.request.post("/api/lanflow/cash-counts/session", { data: { locationId } });
    expect(start.ok()).toBe(true);
    const session = (await start.json()).session as { id: string };
    const cutoff = new Date(Date.now() - 31 * 60_000);
    const expires = new Date(cutoff.getTime() + 30 * 60_000);
    expect((await service().from("cash_count_sessions").update({ cutoff_at: cutoff.toISOString(), expires_at: expires.toISOString() }).eq("id", session.id)).error).toBeNull();
    const staleSubmit = await user.request.post("/api/lanflow/cash-counts", { data: {
      sessionId: session.id,
      actualCounts: { "1": 0, "2": 0, "5": 0, "10": 0, "20": 0, "50": 0, "100": 0, "500": 0, "1000": 1 },
    } });
    expect(staleSubmit.status()).toBe(409);
    expect((await staleSubmit.json()).error).toContain("หมดเวลา");
    const status = await user.request.get(`/api/lanflow/cash-counts/session?locationId=${locationId}`);
    expect((await status.json()).session).toBeNull();
    const normalReport = await admin.request.post("/api/lanflow/reports", { data: { locationId } });
    expect(normalReport.status()).toBe(201);
  });
});
