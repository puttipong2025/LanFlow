import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { selectAppLocation } from "../helpers/select-app-location";
import { bangkokDateString } from "../../src/lib/bangkok-date";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const userId = "00000000-0000-4000-8000-000000000003";
const adminId = "00000000-0000-4000-8000-000000000002";
const managerId = "00000000-0000-4000-8000-000000000001";
const thousandOnly = { "1": 0, "2": 0, "5": 0, "10": 0, "20": 0, "50": 0, "100": 0, "500": 0, "1000": 1 };
const nineHundred = { "1": 0, "2": 0, "5": 0, "10": 0, "20": 0, "50": 0, "100": 4, "500": 1, "1000": 0 };
const zeroTransferCounts = {
  coin1: 0, coin2: 0, coin5: 0, coin10: 0,
  banknote20: 0, banknote50: 0, banknote100: 0, banknote500: 0, banknote1000: 0,
};

function assertLocalSupabaseTarget() {
  const target = new URL(supabaseUrl);
  expect(["127.0.0.1", "localhost"]).toContain(target.hostname);
  expect(target.port).toBe("55421");
}

function deletePrivateCountersAndLocations(fixtures: Array<{ id: string; code: string }>) {
  if (fixtures.length === 0) return;
  for (const fixture of fixtures) {
    if (!/^[0-9a-f-]{36}$/i.test(fixture.id) || !/^C[CS]\d+$/.test(fixture.code)) {
      throw new Error("Refusing to clean an unexpected Cash Count fixture");
    }
  }
  const fixtureValues = fixtures
    .map(({ id, code }) => `('${id}'::uuid, '${code}'::text)`)
    .join(", ");
  const sql = `
begin;
delete from private.document_number_counters c
using (values ${fixtureValues}) as fixture(id, code)
where c.location_id = fixture.id;
do $$
declare
  v_deleted integer;
begin
  delete from public.locations l
  using (values ${fixtureValues}) as fixture(id, code)
  where l.id = fixture.id and l.code = fixture.code;
  get diagnostics v_deleted = row_count;
  if v_deleted <> ${fixtures.length} then
    raise exception 'Cash Count fixture cleanup deleted % of ${fixtures.length} locations', v_deleted;
  end if;
end $$;
commit;
`;
  execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_webapp", "psql", "-U", "postgres", "-d", "postgres", "-X", "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );
}

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
  let sourceLocationId = "";
  let locationCode = "";
  let sourceLocationCode = "";
  let deniedUser: BrowserContext;
  let operator: BrowserContext;
  let manager: BrowserContext;
  const transferIds: string[] = [];

  test.beforeAll(async ({ browser }) => {
    assertLocalSupabaseTarget();
    expect(serviceRoleKey).toBeTruthy();
    const db = service();
    locationCode = `CC${Date.now()}`;
    const { data: location, error } = await db.from("locations").insert({ name: `Cash Count ${crypto.randomUUID().slice(0, 8)}`, code: locationCode }).select("id").single();
    expect(error).toBeNull();
    locationId = location!.id;
    sourceLocationCode = `CS${Date.now()}`;
    const { data: sourceLocation, error: sourceError } = await db.from("locations").insert({
      name: `Cash Count Source ${crypto.randomUUID().slice(0, 8)}`,
      code: sourceLocationCode,
    }).select("id").single();
    expect(sourceError).toBeNull();
    sourceLocationId = sourceLocation!.id;
    expect((await db.from("user_locations").insert([
      { user_id: userId, location_id: locationId },
      { user_id: adminId, location_id: locationId },
      { user_id: managerId, location_id: locationId },
      { user_id: managerId, location_id: sourceLocationId },
    ])).error).toBeNull();
    const { data: actors, error: actorsError } = await db.from("profiles")
      .select("id,role,is_active,can_access_super_admin_features,can_access_money_transfer,can_manage_time_payroll")
      .in("id", [userId, adminId]);
    expect(actorsError).toBeNull();
    expect(actors?.find(({ id }) => id === userId)).toMatchObject({
      role: "user", is_active: true, can_access_super_admin_features: false,
      can_access_money_transfer: false, can_manage_time_payroll: false,
    });
    expect(actors?.find(({ id }) => id === adminId)).toMatchObject({
      role: "admin", is_active: true, can_access_super_admin_features: false,
      can_access_money_transfer: false, can_manage_time_payroll: false,
    });
    deniedUser = await contextFor(browser, "user");
    operator = await contextFor(browser, "admin");
    manager = await contextFor(browser, "super_admin");
  });

  test.afterAll(async () => {
    const cleanupErrors: string[] = [];
    for (const [label, context] of [["denied user", deniedUser], ["operator", operator], ["manager", manager]] as const) {
      try { await context?.close(); } catch (error) { cleanupErrors.push(`${label} context: ${String(error)}`); }
    }
    const locationIds = [locationId, sourceLocationId].filter(Boolean);
    if (locationIds.length === 0) {
      if (cleanupErrors.length) throw new Error(cleanupErrors.join("\n"));
      return;
    }
    const db = service();
    const check = (label: string, error: { message: string } | null) => {
      if (error) cleanupErrors.push(`${label}: ${error.message}`);
    };
    const { data: reports, error: reportsError } = await db.from("report_batches").select("id").in("location_id", locationIds);
    check("read reports", reportsError);
    const reportIds = (reports ?? []).map((row) => row.id);
    check("delete cash counts", (await db.from("cash_counts").delete().in("location_id", locationIds)).error);
    check("delete cash count sessions", (await db.from("cash_count_sessions").delete().in("location_id", locationIds)).error);
    if (reportIds.length) check("delete report items", (await db.from("report_items").delete().in("report_id", reportIds)).error);
    if (transferIds.length) check("delete transfers", (await db.from("money_transfers").delete().in("id", transferIds)).error);
    check("delete reports", (await db.from("report_batches").delete().in("location_id", locationIds)).error);
    check("delete income and expense", (await db.from("income_expense").delete().in("location_id", locationIds)).error);
    check("delete audits", (await db.from("document_deletion_audits").delete().in("location_id", locationIds)).error);
    check("delete assignments", (await db.from("user_locations").delete().in("location_id", locationIds)).error);
    try {
      deletePrivateCountersAndLocations([
        ...(locationId && locationCode ? [{ id: locationId, code: locationCode }] : []),
        ...(sourceLocationId && sourceLocationCode ? [{ id: sourceLocationId, code: sourceLocationCode }] : []),
      ]);
    } catch (error) {
      cleanupErrors.push(`delete counters and locations: ${String(error)}`);
    }
    if (cleanupErrors.length) throw new Error(`Cash Count fixture cleanup failed:\n${cleanupErrors.join("\n")}`);
  });

  test("fixed cutoff keeps business writes open and creates a private paired result", async () => {
    const beforeId = await addIncome(locationId, adminId, "ก่อนเริ่มนับ");
    const start = await operator.request.post("/api/lanflow/cash-counts/session", { data: { locationId } });
    expect(start.status()).toBe(201);
    const session = (await start.json()).session as { id: string; cutoffAt: string };

    for (const response of [
      await deniedUser.request.get(`/api/lanflow/cash-counts/session?locationId=${locationId}`),
      await deniedUser.request.post("/api/lanflow/cash-counts/session", { data: { locationId } }),
      await deniedUser.request.post("/api/lanflow/cash-counts", { data: { sessionId: session.id, actualCounts: thousandOnly } }),
      await deniedUser.request.delete("/api/lanflow/cash-counts/session", { data: { sessionId: session.id } }),
    ]) {
      const body = await response.json();
      expect(response.status(), body.error).toBe(403);
      expect(body.error).toBe("ไม่มีสิทธิ์เข้าถึง");
    }
    const unassignedStart = await operator.request.post("/api/lanflow/cash-counts/session", { data: { locationId: sourceLocationId } });
    const unassignedBody = await unassignedStart.json();
    expect(unassignedStart.status(), unassignedBody.error).toBe(403);

    const blockedReport = await operator.request.post("/api/lanflow/reports", { data: { locationId } });
    expect(blockedReport.status()).toBe(409);
    expect((await blockedReport.json()).error).toContain("ตรวจนับ");

    const afterId = await addIncome(locationId, adminId, "หลังเริ่มนับ");
    const actualCounts = { "1": 0, "2": 0, "5": 0, "10": 0, "20": 0, "50": 0, "100": 0, "500": 0, "1000": 1 };
    const submit = await operator.request.post("/api/lanflow/cash-counts", { data: { sessionId: session.id, actualCounts } });
    expect(submit.status()).toBe(201);
    const receipt = await submit.json();
    expect(Object.keys(receipt).sort()).toEqual(["actualCounts", "actualTotal", "countedByName", "cutoffAt", "id", "reportId", "reportNo", "submittedAt"].sort());
    expect(receipt.actualTotal).toBe(1000);

    const { data: items } = await service().from("report_items").select("entity_id").eq("report_id", receipt.reportId);
    expect(items?.some((row) => row.entity_id === beforeId)).toBe(true);
    expect(items?.some((row) => row.entity_id === afterId)).toBe(false);

    expect((await deniedUser.request.get(`/api/lanflow/cash-counts?locationId=${locationId}`)).status()).toBe(403);
    expect((await operator.request.get(`/api/lanflow/cash-counts?locationId=${locationId}`)).status()).toBe(403);
    const history = await manager.request.get(`/api/lanflow/cash-counts?locationId=${locationId}`);
    expect(history.ok()).toBe(true);
    expect((await history.json()).counts[0]).toMatchObject({ id: receipt.id, anomalyScore: null, confidence: null, formulaVersion: "cash-v1-baseline" });

    const adminReports = await operator.request.get(`/api/lanflow/reports?locationId=${locationId}`);
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
    expect((await deniedUser.request.get(`/api/lanflow/cash-counts/${receipt.id}?locationId=${locationId}`)).status()).toBe(403);
    expect((await operator.request.get(`/api/lanflow/cash-counts/${receipt.id}?locationId=${locationId}`)).status()).toBe(403);

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
    const reportsAfterDelete = await operator.request.get(`/api/lanflow/reports?locationId=${locationId}`);
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
    expect((await operator.request.get(
      `/api/lanflow/cash-counts?locationId=${locationId}&view=deletions`,
    )).status()).toBe(403);

    const retryDelete = await manager.request.delete(
      `/api/lanflow/cash-counts/${receipt.id}?locationId=${locationId}`,
    );
    expect(retryDelete.ok(), await retryDelete.text()).toBe(true);
  });

  test("only the starter can cancel a live session", async () => {
    await addIncome(locationId, adminId, "รอบยกเลิก");
    const start = await operator.request.post("/api/lanflow/cash-counts/session", { data: { locationId } });
    const session = (await start.json()).session as { id: string };
    const otherCancel = await manager.request.delete("/api/lanflow/cash-counts/session", { data: { sessionId: session.id } });
    expect(otherCancel.status()).toBe(400);
    expect((await otherCancel.json()).error).toContain("ผู้เริ่ม");
    expect((await operator.request.delete("/api/lanflow/cash-counts/session", { data: { sessionId: session.id } })).ok()).toBe(true);
  });

  test("unknown-denomination income rebaselines the current physical count", async () => {
    await addIncome(locationId, adminId, "สร้างฐานก่อนทดสอบรายรับ", "income", 100);
    const baselineStart = await operator.request.post("/api/lanflow/cash-counts/session", { data: { locationId } });
    const baselineStartBody = await baselineStart.json();
    expect(baselineStart.ok(), baselineStartBody.error).toBe(true);
    const baselineSession = baselineStartBody.session as { id: string };
    const baselineSubmit = await operator.request.post("/api/lanflow/cash-counts", {
      data: { sessionId: baselineSession.id, actualCounts: thousandOnly },
    });
    expect(baselineSubmit.ok()).toBe(true);

    let latestReceipt: { id: string; reportId: string; reportNo: string } | null = null;
    for (const amount of [120, 1500]) {
      const title = `รายรับไม่ทราบชนิดเงิน ${amount}`;
      const incomeId = await addIncome(locationId, adminId, title, "income", amount);
      const start = await operator.request.post("/api/lanflow/cash-counts/session", { data: { locationId } });
      expect(start.ok()).toBe(true);
      const session = (await start.json()).session as { id: string };
      const submit = await operator.request.post("/api/lanflow/cash-counts", {
        data: { sessionId: session.id, actualCounts: thousandOnly },
      });
      expect(submit.ok()).toBe(true);
      const receipt = await submit.json() as { id: string; reportId: string; reportNo: string };
      latestReceipt = receipt;

      const detailResponse = await manager.request.get(`/api/lanflow/cash-counts/${receipt.id}?locationId=${locationId}`);
      expect(detailResponse.ok()).toBe(true);
      const detail = await detailResponse.json();
      expect(detail).toMatchObject({
        actualTotal: 1000,
        expectedTotal: 1000,
        differenceTotal: 0,
        anomalyScore: null,
        confidence: null,
        analysisStatus: null,
        formulaVersion: "cash-v1-rebaseline",
      });
      expect(detail.differenceCounts).toEqual({ "1": 0, "2": 0, "5": 0, "10": 0, "20": 0, "50": 0, "100": 0, "500": 0, "1000": 0 });
      expect(detail.evidence.references).toContainEqual(expect.objectContaining({ source: "income_expense", id: incomeId, amount }));
      const { data: stored } = await service().from("cash_counts").select("previous_cash_count_id").eq("id", receipt.id).single();
      expect(stored?.previous_cash_count_id).toBeNull();
    }

    expect(latestReceipt).not.toBeNull();
    const managerPage = await manager.newPage();
    await managerPage.goto("/");
    await selectAppLocation(managerPage, locationId);
    await managerPage.getByRole("button", { name: "นับเงิน", exact: true }).click();
    const latestRow = managerPage.getByRole("row").filter({ hasText: latestReceipt!.reportNo });
    await expect(latestRow.getByText("ตั้งฐานใหม่", { exact: true })).toBeVisible();
    await expect(latestRow).not.toContainText("คะแนน");
    await latestRow.getByRole("button", { name: "ดูรายละเอียด" }).click();
    await expect(managerPage.getByText("ตั้งฐานเงินสดใหม่จากผลนับจริง", { exact: false })).toBeVisible();
    await managerPage.getByText("รายการอ้างอิง (1)", { exact: true }).click();
    await expect(managerPage.getByText("รายรับไม่ทราบชนิดเงิน 1500", { exact: false })).toBeVisible();
    await managerPage.close();

    await addIncome(locationId, adminId, "รายจ่ายเพื่อทดสอบฐานรอบถัดไป", "expense", 100);
    const normalStart = await operator.request.post("/api/lanflow/cash-counts/session", { data: { locationId } });
    const normalStartBody = await normalStart.json();
    expect(normalStart.ok(), normalStartBody.error).toBe(true);
    const normalSession = normalStartBody.session as { id: string };
    const delayedIncomeId = await addIncome(locationId, adminId, "รายรับหลัง cutoff", "income", 75);
    const normalSubmit = await operator.request.post("/api/lanflow/cash-counts", {
      data: { sessionId: normalSession.id, actualCounts: nineHundred },
    });
    expect(normalSubmit.ok()).toBe(true);
    const normalReceipt = await normalSubmit.json();
    const normalDetail = await manager.request.get(`/api/lanflow/cash-counts/${normalReceipt.id}?locationId=${locationId}`);
    expect(await normalDetail.json()).toMatchObject({ formulaVersion: "cash-v1", expectedTotal: 900, differenceTotal: 0 });
    const { data: normalStored } = await service().from("cash_counts").select("previous_cash_count_id").eq("id", normalReceipt.id).single();
    expect(normalStored?.previous_cash_count_id).toBe(latestReceipt!.id);

    const delayedStart = await operator.request.post("/api/lanflow/cash-counts/session", { data: { locationId } });
    const delayedStartBody = await delayedStart.json();
    expect(delayedStart.ok(), delayedStartBody.error).toBe(true);
    const delayedSession = delayedStartBody.session as { id: string };
    const delayedSubmit = await operator.request.post("/api/lanflow/cash-counts", {
      data: { sessionId: delayedSession.id, actualCounts: nineHundred },
    });
    expect(delayedSubmit.ok()).toBe(true);
    const delayedReceipt = await delayedSubmit.json();
    const delayedDetail = await manager.request.get(`/api/lanflow/cash-counts/${delayedReceipt.id}?locationId=${locationId}`);
    expect(await delayedDetail.json()).toMatchObject({ formulaVersion: "cash-v1-rebaseline" });
    const { data: delayedItems } = await service().from("report_items").select("entity_id").eq("report_id", delayedReceipt.reportId);
    expect(delayedItems?.some((item) => item.entity_id === delayedIncomeId)).toBe(true);
  });

  test("late bank-transfer adjustments remain unknown-denomination income events", () => {
    const eventSource = readFileSync(resolve("supabase/migrations/20260802010000_cash_counts.sql"), "utf8");
    const rebaselineMigration = readFileSync(resolve("supabase/migrations/20260831040000_rebaseline_cash_count_unknown_inflow.sql"), "utf8");
    expect(eventSource).toContain("select mi.created_at, 'income', mi.amount, null::jsonb");
    expect(eventSource).toContain("'source', 'late_bank_transfer_adjustment'");
    expect(rebaselineMigration).toContain("where event.event_kind = 'income'");
    expect(rebaselineMigration).toContain("and event.counts is null");
    expect(rebaselineMigration).toContain("v_definition := replace(v_definition, chr(13) || chr(10), chr(10));");
  });

  test("known-denomination branch receipt stays on the normal formula", async () => {
    const transferId = crypto.randomUUID();
    transferIds.push(transferId);
    const create = await manager.request.post("/api/lanflow/cash-branch-transfers", {
      data: {
        id: transferId,
        sourceLocationId,
        targetLocationId: locationId,
        sent: { ...zeroTransferCounts, banknote20: 1 },
        clientTempId: transferId,
        idempotencyKey: `cash-count-known:${transferId}`,
      },
    });
    expect(create.ok(), await create.text()).toBe(true);
    const receive = await manager.request.post(`/api/lanflow/cash-branch-transfers/${transferId}/receive`, {
      data: { received: { ...zeroTransferCounts, banknote20: 1 } },
    });
    expect(receive.ok(), await receive.text()).toBe(true);

    const start = await operator.request.post("/api/lanflow/cash-counts/session", { data: { locationId } });
    const session = (await start.json()).session as { id: string };
    const actualCounts = { ...nineHundred, "20": 1 };
    const submit = await operator.request.post("/api/lanflow/cash-counts", {
      data: { sessionId: session.id, actualCounts },
    });
    expect(submit.ok()).toBe(true);
    const receipt = await submit.json();
    const detailResponse = await manager.request.get(`/api/lanflow/cash-counts/${receipt.id}?locationId=${locationId}`);
    const detail = await detailResponse.json();
    expect(detail).toMatchObject({ formulaVersion: "cash-v1", expectedTotal: 920, differenceTotal: 0 });
    expect(detail.evidence.references).toContainEqual(expect.objectContaining({
      source: "cash_transfer_received",
      id: transferId,
      amount: 20,
    }));
  });

  test("operator sees a blind nine-field form and only the immediate receipt", async () => {
    await addIncome(locationId, adminId, "รอบทดสอบหน้าจอ");
    const page = await operator.newPage();
    await page.goto("/");
    await selectAppLocation(page, locationId);
    await page.getByRole("button", { name: "นับเงิน", exact: true }).click();
    await page.getByRole("button", { name: "เริ่มนับเงิน" }).click();

    for (const denomination of [1000, 500, 100, 50, 20, 10, 5, 2, 1]) {
      const input = page.getByRole("spinbutton", { name: `จำนวนเงินชนิด ${denomination} บาท` });
      await expect(input).toHaveValue("0");
    }
    const thousandBaht = page.getByRole("spinbutton", { name: "จำนวนเงินชนิด 1000 บาท" });
    await thousandBaht.focus();
    await expect(thousandBaht).toHaveValue("");
    await thousandBaht.fill("1");

    const fiveHundredBaht = page.getByRole("spinbutton", { name: "จำนวนเงินชนิด 500 บาท" });
    await fiveHundredBaht.focus();
    await expect(fiveHundredBaht).toHaveValue("");
    await thousandBaht.focus();
    await expect(fiveHundredBaht).toHaveValue("0");
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

  test("ignores delayed session and history responses from the previously selected branch", async () => {
    const page = await manager.newPage();
    let releaseOldSession!: () => void;
    let releaseOldHistory!: () => void;
    let markOldSessionRequested!: () => void;
    let markOldHistoryRequested!: () => void;
    const oldSessionReleased = new Promise<void>((resolve) => { releaseOldSession = resolve; });
    const oldHistoryReleased = new Promise<void>((resolve) => { releaseOldHistory = resolve; });
    const oldSessionRequested = new Promise<void>((resolve) => { markOldSessionRequested = resolve; });
    const oldHistoryRequested = new Promise<void>((resolve) => { markOldHistoryRequested = resolve; });
    const summary = (id: string, reportNo: string) => ({
      id,
      reportNo,
      createdAt: "2026-09-02T03:00:00.000Z",
      createdByName: "ผู้ตรวจทดสอบ",
      actualTotal: 1000,
      expectedTotal: 1000,
      differenceTotal: 0,
      analysisStatus: "normal",
      formulaVersion: "cash-v1",
      isLatestActive: true,
      rubberExportLockNo: null,
    });

    await page.route("**/api/lanflow/cash-counts/session?*", async (route) => {
      const requestedLocationId = new URL(route.request().url()).searchParams.get("locationId");
      if (requestedLocationId === sourceLocationId) {
        markOldSessionRequested();
        await oldSessionReleased;
        await route.fulfill({
          json: {
            session: {
              id: "old-session",
              isOwner: false,
              startedByName: "OLD SESSION OWNER",
              cutoffAt: "2026-09-02T03:00:00.000Z",
              expiresAt: "2099-09-02T03:30:00.000Z",
            },
          },
        });
        return;
      }
      await route.fulfill({ json: { session: null } });
    });
    await page.route("**/api/lanflow/cash-counts?*", async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("view") === "deletions") {
        await route.fulfill({ json: { deletions: [], hasMore: false, nextCursor: null } });
        return;
      }
      const requestedLocationId = url.searchParams.get("locationId");
      if (requestedLocationId === sourceLocationId) {
        markOldHistoryRequested();
        await oldHistoryReleased;
        await route.fulfill({ json: { counts: [summary("old-count", "COUNT-OLD-BRANCH")] } });
        return;
      }
      await route.fulfill({ json: { counts: [summary("new-count", "COUNT-NEW-BRANCH")] } });
    });

    await page.goto("/");
    await selectAppLocation(page, sourceLocationId);
    await page.getByRole("button", { name: "นับเงิน", exact: true }).click();
    await Promise.all([oldSessionRequested, oldHistoryRequested]);
    await selectAppLocation(page, locationId);
    await expect(page.getByText("พร้อมเริ่มตรวจนับเงินสด", { exact: true })).toBeVisible();
    await expect(page.getByText("COUNT-NEW-BRANCH", { exact: true })).toBeVisible();
    releaseOldSession();
    releaseOldHistory();
    await expect(page.getByText("OLD SESSION OWNER", { exact: false })).toHaveCount(0);
    await expect(page.getByText("COUNT-NEW-BRANCH", { exact: true })).toBeVisible();
    await expect(page.getByText("COUNT-OLD-BRANCH", { exact: true })).toHaveCount(0);
    await page.close();
  });

  test("ignores a delayed start response after switching branches", async () => {
    const page = await manager.newPage();
    let releaseOldStart!: () => void;
    let markOldStartRequested!: () => void;
    const oldStartReleased = new Promise<void>((resolve) => { releaseOldStart = resolve; });
    const oldStartRequested = new Promise<void>((resolve) => { markOldStartRequested = resolve; });

    await page.route("**/api/lanflow/cash-counts/session?*", (route) => route.fulfill({ json: { session: null } }));
    await page.route("**/api/lanflow/cash-counts/session", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      const body = route.request().postDataJSON() as { locationId?: string };
      if (body.locationId !== sourceLocationId) {
        await route.continue();
        return;
      }
      markOldStartRequested();
      await oldStartReleased;
      await route.fulfill({
        status: 201,
        json: {
          session: {
            id: "old-start-session",
            isOwner: true,
            startedByName: "OLD START OWNER",
            cutoffAt: "2026-09-02T03:00:00.000Z",
            expiresAt: "2099-09-02T03:30:00.000Z",
          },
        },
      });
    });
    await page.route("**/api/lanflow/cash-counts?*", (route) => route.fulfill({ json: { counts: [] } }));

    await page.goto("/");
    await selectAppLocation(page, sourceLocationId);
    await page.getByRole("button", { name: "นับเงิน", exact: true }).click();
    await expect(page.getByText("พร้อมเริ่มตรวจนับเงินสด", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "เริ่มนับเงิน", exact: true }).click();
    await oldStartRequested;
    await selectAppLocation(page, locationId);
    await expect(page.getByRole("button", { name: "เริ่มนับเงิน", exact: true })).toBeEnabled();
    releaseOldStart();
    await expect(page.getByText("พร้อมเริ่มตรวจนับเงินสด", { exact: true })).toBeVisible();
    await expect(page.getByText("Cutoff", { exact: false })).toHaveCount(0);
    await page.close();
  });

  test("second round stores immutable score, confidence, and evidence separately", async () => {
    await addIncome(locationId, adminId, "รายจ่ายทดสอบสูตร", "expense", 100);
    const start = await operator.request.post("/api/lanflow/cash-counts/session", { data: { locationId } });
    expect(start.ok()).toBe(true);
    const session = (await start.json()).session as { id: string };
    const actualCounts = { "1": 0, "2": 0, "5": 0, "10": 0, "20": 0, "50": 0, "100": 0, "500": 0, "1000": 1 };
    const submit = await operator.request.post("/api/lanflow/cash-counts", { data: { sessionId: session.id, actualCounts } });
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

  test("submits promptly when the previous count has no small cash", async () => {
    const highOnlyCounts = { "1": 0, "2": 0, "5": 0, "10": 0, "20": 100, "50": 100, "100": 100, "500": 100, "1000": 100 };
    await addIncome(locationId, adminId, "รอบตั้งต้นเงินก้อน");
    const seedStart = await operator.request.post("/api/lanflow/cash-counts/session", { data: { locationId } });
    expect(seedStart.ok()).toBe(true);
    const seedSession = (await seedStart.json()) as { session: { id: string } };
    const seedSubmit = await operator.request.post("/api/lanflow/cash-counts", {
      data: { sessionId: seedSession.session.id, actualCounts: highOnlyCounts },
    });
    expect(seedSubmit.ok()).toBe(true);

    await addIncome(locationId, adminId, "รายจ่ายไม่มีเงินย่อย", "expense", 10001);
    const start = await operator.request.post("/api/lanflow/cash-counts/session", { data: { locationId } });
    expect(start.ok()).toBe(true);
    const session = (await start.json()) as { session: { id: string } };
    const submit = await operator.request.post("/api/lanflow/cash-counts", {
      data: { sessionId: session.session.id, actualCounts: highOnlyCounts },
    });
    expect(submit.ok()).toBe(true);
    const receipt = await submit.json();
    const detailResponse = await manager.request.get(`/api/lanflow/cash-counts/${receipt.id}?locationId=${locationId}`);
    expect(detailResponse.ok()).toBe(true);
    const detail = await detailResponse.json();
    expect(detail.formulaVersion).toBe("cash-v1");
    expect(detail.evidence.limitations).toContain("จำลองรับเงินทอน 1 ครั้ง รวม 9 บาท");
  });

  test("expired sessions reject stale submit and stop blocking normal reports", async () => {
    await addIncome(locationId, adminId, "รอบหมดเวลา");
    const start = await operator.request.post("/api/lanflow/cash-counts/session", { data: { locationId } });
    expect(start.ok()).toBe(true);
    const session = (await start.json()).session as { id: string };
    const cutoff = new Date(Date.now() - 31 * 60_000);
    const expires = new Date(cutoff.getTime() + 30 * 60_000);
    expect((await service().from("cash_count_sessions").update({ cutoff_at: cutoff.toISOString(), expires_at: expires.toISOString() }).eq("id", session.id)).error).toBeNull();
    const staleSubmit = await operator.request.post("/api/lanflow/cash-counts", { data: {
      sessionId: session.id,
      actualCounts: { "1": 0, "2": 0, "5": 0, "10": 0, "20": 0, "50": 0, "100": 0, "500": 0, "1000": 1 },
    } });
    expect(staleSubmit.status()).toBe(409);
    expect((await staleSubmit.json()).error).toContain("หมดเวลา");
    const status = await operator.request.get(`/api/lanflow/cash-counts/session?locationId=${locationId}`);
    expect((await status.json()).session).toBeNull();
    const normalReport = await operator.request.post("/api/lanflow/reports", { data: { locationId } });
    expect(normalReport.status()).toBe(201);
  });
});
