import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { assertOfflineRubberBillPriceAllowed } from "../../src/lib/rubber-bills/approval";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

async function authContext(
  browser: Browser,
  role: "user" | "admin" | "super_admin"
) {
  return browser.newContext({ storageState: `playwright/.auth/${role}.json` });
}

async function profile(context: BrowserContext) {
  const response = await context.request.get("/api/auth/me");
  expect(response.ok()).toBeTruthy();
  return (await response.json() as {
    profile: { id: string; locationIds: string[]; name: string; phone: string };
  }).profile;
}

function service() {
  expect(serviceRoleKey).toBeTruthy();
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function billPayload({
  locationId,
  clientTempId = crypto.randomUUID(),
  operation = "create",
  expectedRevisionNo = 0,
  price = 20,
  prices,
  customerName = "ลูกค้าทดสอบอนุมัติบิลยาง",
}: {
  locationId: string;
  clientTempId?: string;
  operation?: "create" | "update" | "delete";
  expectedRevisionNo?: number;
  price?: number;
  prices?: number[];
  customerName?: string;
}) {
  const now = new Date().toISOString();
  const linePrices = prices ?? [price];
  const rubberValue = linePrices.reduce((total, linePrice) => total + 10 * linePrice, 0);
  const weight = linePrices.length * 10;
  return {
    operation,
    expectedRevisionNo,
    clientTempId,
    idempotencyKey: `${operation}:${clientTempId}:${expectedRevisionNo}`,
    locationId,
    recordStatus: operation === "delete" ? "deleted" : "active",
    localBillNo: `APP-${clientTempId.slice(0, 8)}`,
    billDate: now.slice(0, 10),
    customerId: null,
    customerName,
    customerType: "สาขานี้จ่าย",
    billType: "บิลเครื่องชั่งเล็ก",
    deductWeight: 0,
    weight,
    rubberValue,
    averagePrice: rubberValue / weight,
    deductionTotal: 0,
    netTotal: rubberValue,
    cashPayment: rubberValue,
    transferPayment: 0,
    acidPackCount: 0,
    clientRecordedAt: now,
    clientCreatedAt: now,
    items: linePrices.map((linePrice, index) => ({
      itemType: "weigh",
      title: `ชั่ง${index + 1}`,
      description: `ชั่ง${index + 1}`,
      inWeight: 20,
      outWeight: 10,
      netWeight: 10,
      unitPrice: linePrice,
      totalAmount: 10 * linePrice,
      sequenceNo: index + 1,
    })),
  };
}

async function syncBill(context: BrowserContext, payload: ReturnType<typeof billPayload>) {
  const response = await context.request.post("/api/lanflow/rubber-bills", { data: payload });
  return {
    response,
    body: await response.json() as {
      status?: string;
      requestId?: string;
      id?: string;
      revisionNo?: number;
      matchedReasons?: string[];
      errorMessage?: string;
    },
  };
}

async function saveSettings(
  context: BrowserContext,
  editWindowMinutes: number,
  configuredPrice: number | null
) {
  return context.request.put("/api/lanflow/rubber-bills/approval-settings", {
    data: { editWindowMinutes, configuredPrice },
  });
}

test.describe.serial("Rubber Bill approval contract @rubber-bill-approval", () => {
  test("offline cached-price guard blocks known mismatch only", () => {
    expect(() => assertOfflineRubberBillPriceAllowed([20, 20], 20, false)).not.toThrow();
    expect(() => assertOfflineRubberBillPriceAllowed([20.5], null, false)).not.toThrow();
    expect(() => assertOfflineRubberBillPriceAllowed([20.5], 20, true)).not.toThrow();
    expect(() => assertOfflineRubberBillPriceAllowed([20, 20.5], 20, false))
      .toThrow("ต้องออนไลน์เพื่อส่งคำขออนุมัติ");
  });

  test("settings permission, mismatched create, and permanent request delete", async ({ browser }) => {
    const user = await authContext(browser, "user");
    const superAdmin = await authContext(browser, "super_admin");
    const db = service();

    try {
      const userProfile = await profile(user);
      const locationId = userProfile.locationIds[0];

      expect((await saveSettings(user, 30, 20)).status()).toBe(403);
      expect((await saveSettings(superAdmin, -1, 20)).status()).toBe(400);
      expect((await saveSettings(superAdmin, 1.5, 20)).status()).toBe(400);
      expect((await saveSettings(superAdmin, 30, 20.555)).status()).toBe(400);
      expect((await saveSettings(superAdmin, 30, null)).ok()).toBeTruthy();

      const noSettingPayload = billPayload({ locationId, price: 20.5 });
      const noSettingCreate = await syncBill(user, noSettingPayload);
      expect(noSettingCreate.body.status).toBe("synced");

      expect((await saveSettings(superAdmin, 30, 20)).ok()).toBeTruthy();
      expect((await db.from("rubber_bill_approval_requests")
        .select("id", { count: "exact", head: true })
        .eq("bill_id", noSettingCreate.body.id!)).count).toBe(0);

      const payload = billPayload({ locationId, prices: [20, 20.5] });
      const pending = await syncBill(user, payload);
      expect(pending.response.ok(), pending.body.errorMessage).toBeTruthy();
      expect(pending.body.status).toBe("pending_approval");
      expect(pending.body.matchedReasons).toEqual(["price"]);

      const [{ data: source }, { data: request }] = await Promise.all([
        db.from("rubber_bills").select("id").eq("client_temp_id", payload.clientTempId).maybeSingle(),
        db.from("rubber_bill_approval_requests").select("*").eq("id", pending.body.requestId!).single(),
      ]);
      expect(source).toBeNull();
      expect(request).toMatchObject({
        operation: "create",
        request_status: "pending",
        configured_price_snapshot: 20,
      });

      expect((await saveSettings(superAdmin, 30, 21)).ok()).toBeTruthy();
      expect((await saveSettings(superAdmin, 30, null)).ok()).toBeTruthy();
      expect((await db.from("rubber_bill_approval_requests")
        .select("configured_price_snapshot")
        .eq("id", pending.body.requestId!)
        .single()).data?.configured_price_snapshot).toBe(20);

      const deleted = await superAdmin.request.delete(
        `/api/lanflow/rubber-bills/approval-requests/${pending.body.requestId}`
      );
      expect(deleted.ok(), await deleted.text()).toBeTruthy();
      expect((await db.from("rubber_bill_approval_requests")
        .select("id")
        .eq("id", pending.body.requestId!)
        .maybeSingle()).data).toBeNull();
      expect((await db.from("rubber_bills")
        .select("id")
        .eq("client_temp_id", payload.clientTempId)
        .maybeSingle()).data).toBeNull();
    } finally {
      await Promise.all([user.close(), superAdmin.close()]);
    }
  });

  test("manager requests and approves own exceptional price without retriggering unchanged price", async ({ browser }) => {
    const superAdmin = await authContext(browser, "super_admin");
    const db = service();

    try {
      const superProfile = await profile(superAdmin);
      const locationId = superProfile.locationIds[0];
      expect((await saveSettings(superAdmin, 1440, 20)).ok()).toBeTruthy();

      const createPayload = billPayload({ locationId, price: 20.5 });
      const pendingCreate = await syncBill(superAdmin, createPayload);
      expect(pendingCreate.body.status).toBe("pending_approval");

      const approved = await superAdmin.request.post(
        `/api/lanflow/rubber-bills/approval-requests/${pendingCreate.body.requestId}/approve`
      );
      const approvedBody = await approved.json() as { status?: string; billId?: string };
      expect(approved.ok(), JSON.stringify(approvedBody)).toBeTruthy();
      expect(approvedBody.status).toBe("approved");

      const retry = await syncBill(superAdmin, createPayload);
      expect(retry.body.status).toBe("synced");
      expect(retry.body.id).toBe(approvedBody.billId);

      const nonPriceUpdate = billPayload({
        locationId,
        clientTempId: createPayload.clientTempId,
        operation: "update",
        expectedRevisionNo: retry.body.revisionNo,
        price: 20.5,
        customerName: "ลูกค้าแก้ชื่อแต่ราคาเดิม",
      });
      const updated = await syncBill(superAdmin, nonPriceUpdate);
      expect(updated.body.status).toBe("synced");

      const changedPrice = billPayload({
        locationId,
        clientTempId: createPayload.clientTempId,
        operation: "update",
        expectedRevisionNo: updated.body.revisionNo,
        price: 20.75,
        customerName: "ลูกค้าแก้ราคา",
      });
      const pendingPriceUpdate = await syncBill(superAdmin, changedPrice);
      expect(pendingPriceUpdate.body.status).toBe("pending_approval");
      expect(pendingPriceUpdate.body.matchedReasons).toEqual(["price"]);

      const { data: source } = await db
        .from("rubber_bills")
        .select("customer_name, rubber_bill_items(price)")
        .eq("id", approvedBody.billId!)
        .single();
      expect(source?.customer_name).toBe("ลูกค้าแก้ชื่อแต่ราคาเดิม");
      expect(source?.rubber_bill_items).toEqual([expect.objectContaining({ price: 20.5 })]);

      expect((await superAdmin.request.delete(
        `/api/lanflow/rubber-bills/approval-requests/${pendingPriceUpdate.body.requestId}`
      )).ok()).toBeTruthy();

      const immutable = await db
        .from("rubber_bill_approval_requests")
        .delete()
        .eq("id", pendingCreate.body.requestId!);
      expect(immutable.error?.message).toContain("ประวัติคำขอที่อนุมัติแล้ว");
    } finally {
      await superAdmin.close();
    }
  });

  test("concurrent changes create one pending request and stale revisions conflict", async ({ browser }) => {
    const user = await authContext(browser, "user");
    const superAdmin = await authContext(browser, "super_admin");
    const db = service();

    try {
      const userProfile = await profile(user);
      const locationId = userProfile.locationIds[0];
      expect((await saveSettings(superAdmin, 0, null)).ok()).toBeTruthy();

      const createPayload = billPayload({ locationId, price: 20 });
      const created = await syncBill(user, createPayload);
      expect(created.body.status).toBe("synced");

      const updatePayload = billPayload({
        locationId,
        clientTempId: createPayload.clientTempId,
        operation: "update",
        expectedRevisionNo: created.body.revisionNo,
        customerName: "คำขอพร้อมกันแบบแก้ไข",
      });
      const deletePayload = {
        ...billPayload({
          locationId,
          clientTempId: createPayload.clientTempId,
          operation: "delete",
          expectedRevisionNo: created.body.revisionNo,
        }),
        deletedByName: userProfile.name,
        deletedByPhone: userProfile.phone,
      };
      const concurrent = await Promise.all([
        syncBill(user, updatePayload),
        syncBill(user, deletePayload),
      ]);
      expect(concurrent.map((result) => result.body.status)).toEqual([
        "pending_approval",
        "pending_approval",
      ]);

      const { data: pendingRows, count } = await db
        .from("rubber_bill_approval_requests")
        .select("id", { count: "exact" })
        .eq("bill_id", created.body.id!)
        .eq("request_status", "pending");
      expect(count).toBe(1);
      expect(pendingRows).toHaveLength(1);
      expect((await superAdmin.request.delete(
        `/api/lanflow/rubber-bills/approval-requests/${pendingRows![0].id}`
      )).ok()).toBeTruthy();

      expect((await saveSettings(superAdmin, 1440, null)).ok()).toBeTruthy();
      const directUpdate = await syncBill(user, updatePayload);
      expect(directUpdate.body.status).toBe("synced");
      const stale = await syncBill(user, {
        ...updatePayload,
        idempotencyKey: `stale:${createPayload.clientTempId}`,
      });
      expect(stale.response.status()).toBe(409);
      expect(stale.body.status).toBe("conflict");
    } finally {
      await Promise.all([user.close(), superAdmin.close()]);
    }
  });

  test("approved delete keeps the Rubber Bill as a soft-deleted source", async ({ browser }) => {
    const user = await authContext(browser, "user");
    const superAdmin = await authContext(browser, "super_admin");
    const db = service();

    try {
      const userProfile = await profile(user);
      const locationId = userProfile.locationIds[0];
      expect((await saveSettings(superAdmin, 0, null)).ok()).toBeTruthy();

      const createPayload = billPayload({ locationId, price: 20 });
      const created = await syncBill(user, createPayload);
      const deletePayload = {
        ...billPayload({
          locationId,
          clientTempId: createPayload.clientTempId,
          operation: "delete",
          expectedRevisionNo: created.body.revisionNo,
        }),
        deletedByName: userProfile.name,
        deletedByPhone: userProfile.phone,
      };
      const pendingDelete = await syncBill(user, deletePayload);
      expect(pendingDelete.body.status).toBe("pending_approval");

      const approved = await superAdmin.request.post(
        `/api/lanflow/rubber-bills/approval-requests/${pendingDelete.body.requestId}/approve`
      );
      expect(approved.ok(), await approved.text()).toBeTruthy();
      expect((await db.from("rubber_bills")
        .select("record_status, deleted_at, deleted_by_name, deleted_by_phone")
        .eq("id", created.body.id!)
        .single()).data).toMatchObject({
          record_status: "deleted",
          deleted_by_name: userProfile.name,
          deleted_by_phone: userProfile.phone,
        });
    } finally {
      await Promise.all([user.close(), superAdmin.close()]);
    }
  });

  test("time request keeps source unchanged and cannot enter transfer or report", async ({ browser }) => {
    const user = await authContext(browser, "user");
    const admin = await authContext(browser, "admin");
    const superAdmin = await authContext(browser, "super_admin");
    const db = service();
    let firstReportId: string | undefined;
    let secondReportId: string | undefined;
    let transferId: string | undefined;

    try {
      const userProfile = await profile(user);
      const locationId = userProfile.locationIds[0];
      expect((await saveSettings(superAdmin, 0, 20)).ok()).toBeTruthy();

      const createPayload = billPayload({ locationId, price: 20 });
      const created = await syncBill(user, createPayload);
      expect(created.body.status).toBe("synced");

      const updatePayload = billPayload({
        locationId,
        clientTempId: createPayload.clientTempId,
        operation: "update",
        expectedRevisionNo: created.body.revisionNo,
        price: 20.5,
        customerName: "ชื่อใหม่ที่ยังไม่ควรถูกใช้",
      });
      const pending = await syncBill(user, updatePayload);
      expect(pending.body.status).toBe("pending_approval");
      expect(pending.body.matchedReasons).toEqual(["time", "price"]);

      const { data: unchanged } = await db
        .from("rubber_bills")
        .select("id, customer_name, print_status")
        .eq("id", created.body.id!)
        .single();
      expect(unchanged?.customer_name).toBe("ลูกค้าทดสอบอนุมัติบิลยาง");

      const printed = await user.request.post(
        `/api/lanflow/rubber-bills/${created.body.id}/print-status`
      );
      expect(printed.ok(), await printed.text()).toBeTruthy();
      const { data: printedSource } = await db
        .from("rubber_bills")
        .select("customer_name, print_status")
        .eq("id", created.body.id!)
        .single();
      expect(printedSource).toMatchObject({
        customer_name: "ลูกค้าทดสอบอนุมัติบิลยาง",
        print_status: "ปริ้นแล้ว",
      });

      transferId = crypto.randomUUID();
      expect((await db.from("money_transfers").insert({
        id: transferId,
        client_temp_id: transferId,
        idempotency_key: `approval-transfer:${transferId}`,
        location_id: locationId,
        customer_name: "ทดสอบ",
        net_amount_to_pay: 200,
      })).error).toBeNull();
      const blockedTransfer = await db.from("money_transfer_items").insert({
        transfer_id: transferId,
        source_type: "rubber_bill",
        source_id: created.body.id!,
        customer_name: "ทดสอบ",
        amount: 200,
      });
      expect(blockedTransfer.error?.message).toContain("กำลังรออนุมัติ");

      const report = await admin.request.post("/api/lanflow/reports", {
        data: { locationId },
      });
      const reportBody = await report.json() as { id?: string; error?: string };
      expect(report.status(), reportBody.error).toBe(201);
      firstReportId = reportBody.id;
      const { data: pendingReportItem } = await db
        .from("report_items")
        .select("id")
        .eq("report_id", firstReportId!)
        .eq("entity_type", "rubber_bill")
        .eq("entity_id", created.body.id!)
        .maybeSingle();
      expect(pendingReportItem).toBeNull();

      const approved = await superAdmin.request.post(
        `/api/lanflow/rubber-bills/approval-requests/${pending.body.requestId}/approve`
      );
      expect(approved.ok(), await approved.text()).toBeTruthy();
      expect((await db.from("rubber_bills")
        .select("customer_name")
        .eq("id", created.body.id!)
        .single()).data?.customer_name).toBe("ชื่อใหม่ที่ยังไม่ควรถูกใช้");

      const secondReport = await admin.request.post("/api/lanflow/reports", {
        data: { locationId },
      });
      const secondReportBody = await secondReport.json() as { id?: string; error?: string };
      expect(secondReport.status(), secondReportBody.error).toBe(201);
      secondReportId = secondReportBody.id;
      expect((await db.from("report_items")
        .select("id")
        .eq("report_id", secondReportId!)
        .eq("entity_type", "rubber_bill")
        .eq("entity_id", created.body.id!)
        .maybeSingle()).data).not.toBeNull();

      const reportedUpdate = billPayload({
        locationId,
        clientTempId: createPayload.clientTempId,
        operation: "update",
        expectedRevisionNo: 2,
        price: 20.5,
        customerName: "ห้ามสร้างคำขอหลังทำรายงาน",
      });
      const blocked = await syncBill(user, reportedUpdate);
      expect(blocked.response.status()).toBe(400);
      expect(blocked.body.errorMessage).toContain("อยู่ในรายงาน");
      expect((await db.from("rubber_bill_approval_requests")
        .select("id", { count: "exact", head: true })
        .eq("bill_id", created.body.id!)
        .eq("request_status", "pending")).count).toBe(0);
    } finally {
      if (secondReportId) {
        await superAdmin.request.delete(`/api/lanflow/reports/${secondReportId}`);
      }
      if (firstReportId) {
        await superAdmin.request.delete(`/api/lanflow/reports/${firstReportId}`);
      }
      if (transferId) {
        await db.from("money_transfers").delete().eq("id", transferId);
      }
      await Promise.all([user.close(), admin.close(), superAdmin.close()]);
    }
  });

  test("only system managers see the simple settings and approval modal", async ({ browser }) => {
    const user = await authContext(browser, "user");
    const superAdmin = await authContext(browser, "super_admin");

    try {
      const [userPage, superPage] = await Promise.all([
        user.newPage(),
        superAdmin.newPage(),
      ]);
      await Promise.all([userPage.goto("/"), superPage.goto("/")]);
      await Promise.all([
        userPage.getByRole("button", { name: "บิลยาง" }).click(),
        superPage.getByRole("button", { name: "บิลยาง" }).click(),
      ]);

      await expect(
        userPage.getByRole("button", { name: /ตั้งค่าและอนุมัติบิลยาง/ })
      ).toBeHidden();
      const managerButton = superPage.getByRole("button", {
        name: /ตั้งค่าและอนุมัติบิลยาง/,
      });
      await expect(managerButton).toBeVisible();
      await managerButton.click();

      await expect(superPage.getByText("เกณฑ์อนุมัติ")).toBeVisible();
      await expect(superPage.getByLabel("เวลาแก้ไขได้ (นาที)")).toBeVisible();
      await expect(superPage.getByLabel("ราคายางที่กำหนด")).toBeVisible();
      await expect(superPage.getByText("คำขอบิลยาง")).toBeVisible();
      await expect(superPage.getByRole("option", { name: "รออนุมัติ" })).toBeAttached();
      await expect(superPage.getByRole("option", { name: "อนุมัติแล้ว" })).toBeAttached();
    } finally {
      await Promise.all([user.close(), superAdmin.close()]);
    }
  });
});
