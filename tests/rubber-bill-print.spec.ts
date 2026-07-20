import { expect, request as playwrightRequest, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import {
  buildRubberBillReceiptModel,
  getRubberBillPrintBlockReason,
  renderRubberBillReceiptHtml,
  resolveReceiptCustomer
} from "../src/components/rubber-bills/bill-display";
import { thaiBahtText } from "../src/lib/thai-baht-text";
import type { Customer, RubberBill } from "../src/types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

test.use({ storageState: "playwright/.auth/user.json" });

function makeBill(patch: Partial<RubberBill> = {}): RubberBill {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    clientTempId: "client-1",
    localBillNo: "LOCAL-1",
    serverBillNo: "2607160001",
    syncStatus: "synced",
    idempotencyKey: "server:1",
    locationId: "22222222-2222-4222-8222-222222222222",
    billNo: "2607160001",
    billDate: "2026-07-16",
    customerId: "33333333-3333-4333-8333-333333333333",
    customerName: "สมชาย",
    customerType: "สาขานี้จ่าย",
    billType: "บิลเครื่องชั่งเล็ก",
    deductWeight: 2,
    weight: 10,
    price: 20,
    deductionTotal: 65,
    netTotal: 135,
    cashPayment: 135,
    transferPayment: 0,
    acidPackCount: 1,
    printStatus: "ยังไม่ได้ปริ้น",
    weighItems: [{ id: "w1", label: "ชั่ง <หนึ่ง>", inWeight: 15, outWeight: 5, netWeight: 10, price: 20 }],
    acidItems: [{ id: "s1", name: "กรด & สินค้า", stockProductId: "p1", quantity: 1, unit: "ถัง", unitPrice: 10 }],
    debtItems: [{ id: "d1", title: "หักหนี้", amount: 15 }],
    createdByUserId: "44444444-4444-4444-8444-444444444444",
    createdByName: "ผู้ใช้",
    createdByPhone: "000",
    clientCreatedAt: "2026-07-16T10:00:00.000Z",
    clientRecordedAt: "2026-07-16T10:00:00.000Z",
    revisionNo: 3,
    recordStatus: "active",
    ...patch
  };
}

const customer: Customer = {
  id: "33333333-3333-4333-8333-333333333333",
  class: "สาขานี้จ่าย",
  mainName: "สมชาย",
  fscStatus: "yes",
  farms: [{ id: "f1", ownerName: "สมชาย", address: "<img src=x onerror=alert(1)>", cardNumber: "1" }]
};

test.describe("Rubber Bill print model @rubber-bill-print", () => {
  test("converts Thai baht text edge cases", () => {
    expect(thaiBahtText(0)).toBe("ศูนย์บาทถ้วน");
    expect(thaiBahtText(21)).toBe("ยี่สิบเอ็ดบาทถ้วน");
    expect(thaiBahtText(1.999)).toBe("สองบาทถ้วน");
    expect(thaiBahtText(1_000_001.25)).toBe("หนึ่งล้านหนึ่งบาทยี่สิบห้าสตางค์");
    expect(thaiBahtText(-12.5)).toBe("ลบสิบสองบาทห้าสิบสตางค์");
    expect(() => thaiBahtText(Number.NaN)).toThrow("จำนวนเงินต้องเป็นตัวเลขที่มีค่าจำกัด");
  });

  test("uses stored aggregates and derives only the legacy deduction breakdown", () => {
    const model = buildRubberBillReceiptModel(makeBill(), customer);

    expect(model.grossTotal).toBe(200);
    expect(model.deductionTotal).toBe(65);
    expect(model.netTotal).toBe(135);
    expect(model.deductions).toEqual([
      { label: "กรด & สินค้า 1 ถัง", amount: 10 },
      { label: "หักหนี้", amount: 15 },
      { label: "หักน้ำหนัก 2 กก.", amount: 40 }
    ]);
    expect(model.showFscEudr).toBe(true);
  });

  test("escapes all receipt strings before inserting HTML", () => {
    const html = renderRubberBillReceiptHtml(buildRubberBillReceiptModel(
      makeBill({ customerName: '<img src=x onerror="alert(1)">' }),
      customer
    ));

    expect(html).not.toContain('<img src=x onerror="alert(1)">');
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("ชั่ง &lt;หนึ่ง&gt;");
    expect(html).toContain("กรด &amp; สินค้า");
  });

  test("uses customer ID first and refuses ambiguous legacy name matches", () => {
    const duplicate = { ...customer, id: "55555555-5555-4555-8555-555555555555" };
    expect(resolveReceiptCustomer(makeBill(), [duplicate, customer])?.id).toBe(customer.id);
    expect(resolveReceiptCustomer(makeBill({ customerId: null }), [customer, duplicate])).toBeUndefined();
  });

  test("allows only synced active small-scale bills while online", () => {
    expect(getRubberBillPrintBlockReason(makeBill(), true)).toBeNull();
    expect(getRubberBillPrintBlockReason(makeBill({ syncStatus: "pending", serverBillNo: undefined }), true)).toContain("ซิงก์");
    expect(getRubberBillPrintBlockReason(makeBill({ recordStatus: "deleted" }), true)).toContain("ยังใช้งาน");
    expect(getRubberBillPrintBlockReason(makeBill({ billType: "อื่น" }), true)).toContain("บิลเครื่องชั่งเล็ก");
    expect(getRubberBillPrintBlockReason(makeBill(), false)).toContain("ออนไลน์");
  });
});

test("marks print status through the authenticated RPC boundary without changing financial revision", async ({ request }) => {
  test.skip(!serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY is required for RPC verification");
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const meResponse = await request.get("/api/auth/me");
  expect(meResponse.ok()).toBeTruthy();
  const me = await meResponse.json() as { profile: { id: string; name: string; phone: string; locationIds: string[] } };
  const locationId = me.profile.locationIds[0];
  expect(locationId).toBeTruthy();

  const clientTempId = `print-test-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  let billId: string | undefined;
  let inaccessibleBillId: string | undefined;
  try {
    const createResponse = await request.post("/api/lanflow/rubber-bills", {
      data: {
        operation: "create",
        expectedRevisionNo: 0,
        clientTempId,
        idempotencyKey: `create:${clientTempId}:0`,
        locationId,
        recordStatus: "active",
        localBillNo: `LOCAL-${clientTempId.slice(-8)}`,
        billDate: now.slice(0, 10),
        customerId: null,
        customerName: "Print Test",
        customerType: "สาขานี้จ่าย",
        billType: "บิลเครื่องชั่งเล็ก",
        deductWeight: 2,
        weight: 10,
        rubberValue: 200,
        averagePrice: 20,
        deductionTotal: 40,
        netTotal: 160,
        cashPayment: 160,
        transferPayment: 0,
        acidPackCount: 0,
        clientRecordedAt: now,
        clientCreatedAt: now,
        items: [{
          itemType: "weigh",
          title: "ชั่ง1",
          description: "ชั่ง1",
          inWeight: 15,
          outWeight: 5,
          netWeight: 10,
          unitPrice: 20,
          totalAmount: 200,
          sequenceNo: 1
        }]
      }
    });
    expect(createResponse.ok()).toBeTruthy();
    const created = await createResponse.json() as { id: string; revisionNo: number };
    billId = created.id;

    const before = await admin.from("rubber_bills")
      .select("revision_no,net_total,deduction_total,customer_id,deduct_weight,bill_type,print_status")
      .eq("id", billId)
      .single();
    expect(before.error).toBeNull();
    expect(before.data).toMatchObject({
      customer_id: null,
      deduct_weight: 2,
      bill_type: "บิลเครื่องชั่งเล็ก",
      print_status: "ยังไม่ได้ปริ้น"
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const markResponse = await request.post(`/api/lanflow/rubber-bills/${billId}/print-status`);
      expect(markResponse.ok()).toBeTruthy();
      expect(await markResponse.json()).toMatchObject({ status: "synced", id: billId, printStatus: "ปริ้นแล้ว" });
    }

    const after = await admin.from("rubber_bills")
      .select("revision_no,net_total,deduction_total,print_status")
      .eq("id", billId)
      .single();
    expect(after.error).toBeNull();
    expect(after.data).toEqual({
      revision_no: before.data?.revision_no,
      net_total: before.data?.net_total,
      deduction_total: before.data?.deduction_total,
      print_status: "ปริ้นแล้ว"
    });

    const locations = await admin.from("locations").select("id").eq("is_active", true);
    expect(locations.error).toBeNull();
    const inaccessibleLocationId = locations.data?.find((location) => !me.profile.locationIds.includes(location.id))?.id;
    if (inaccessibleLocationId) {
      inaccessibleBillId = crypto.randomUUID();
      const inserted = await admin.from("rubber_bills").insert({
        id: inaccessibleBillId,
        client_temp_id: `cross-${inaccessibleBillId}`,
        local_bill_no: `CROSS-${inaccessibleBillId.slice(0, 8)}`,
        idempotency_key: `cross:${inaccessibleBillId}`,
        location_id: inaccessibleLocationId,
        bill_no: `CROSS-${inaccessibleBillId.slice(0, 8)}`,
        bill_date: now.slice(0, 10),
        customer_name: "Cross Location",
        customer_type: "สาขานี้จ่าย",
        bill_type: "บิลเครื่องชั่งเล็ก",
        created_by_user_id: me.profile.id,
        created_by_name: me.profile.name,
        created_by_phone: me.profile.phone
      });
      expect(inserted.error).toBeNull();
      const denied = await request.post(`/api/lanflow/rubber-bills/${inaccessibleBillId}/print-status`);
      expect(denied.status()).toBe(403);
    }

    const anonymous = await playwrightRequest.newContext({
      baseURL: "http://127.0.0.1:3000",
      storageState: { cookies: [], origins: [] },
      extraHTTPHeaders: { cookie: "" }
    });
    try {
      const denied = await anonymous.post(`/api/lanflow/rubber-bills/${billId}/print-status`);
      expect(denied.status()).toBe(401);
    } finally {
      await anonymous.dispose();
    }
  } finally {
    if (billId) await admin.from("rubber_bills").delete().eq("id", billId);
    if (inaccessibleBillId) await admin.from("rubber_bills").delete().eq("id", inaccessibleBillId);
  }
});
