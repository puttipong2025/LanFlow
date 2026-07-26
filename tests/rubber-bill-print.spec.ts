import { expect, test } from "@playwright/test";

import {
  buildRubberBillReceiptModel,
  getRubberBillPrintBlockReason,
  resolveRubberBillReceiptForPrint,
  renderRubberBillReceiptHtml,
} from "../src/components/rubber-bills/bill-display";
import { thaiBahtText } from "../src/lib/thai-baht-text";
import type { RubberBill } from "../src/types";

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
    billType: "บิลเครื่องชั่งเล็ก",
    deductWeight: 2,
    weight: 10,
    price: 20,
    deductionTotal: 65,
    netTotal: 135,
    acidPackCount: 1,
    configuredPriceSnapshot: 20,
    approvalState: "not_required",
    approvalApprovedByName: null,
    approvalRevisionNo: null,
    weighItems: [{
      id: "w1",
      label: "ชั่ง <หนึ่ง>",
      inWeight: 15,
      outWeight: 5,
      netWeight: 10,
      price: 20,
    }],
    acidItems: [{
      id: "s1",
      name: "กรด & สินค้า",
      stockProductId: "p1",
      quantity: 1,
      unit: "ถัง",
      unitPrice: 10,
    }],
    debtItems: [{ id: "d1", title: "หักหนี้", amount: 15 }],
    createdByUserId: "44444444-4444-4444-8444-444444444444",
    createdByName: "ผู้ใช้",
    createdByPhone: "000",
    clientCreatedAt: "2026-07-16T10:00:00.000Z",
    clientRecordedAt: "2026-07-16T10:00:00.000Z",
    revisionNo: 3,
    recordStatus: "active",
    ...patch,
  };
}

test.describe("Rubber Bill receipt contract @rubber-bill-print", () => {
  test("converts Thai baht text edge cases", () => {
    expect(thaiBahtText(0)).toBe("ศูนย์บาทถ้วน");
    expect(thaiBahtText(21)).toBe("ยี่สิบเอ็ดบาทถ้วน");
    expect(thaiBahtText(1.999)).toBe("สองบาทถ้วน");
    expect(thaiBahtText(1_000_001.25)).toBe("หนึ่งล้านหนึ่งบาทยี่สิบห้าสตางค์");
    expect(thaiBahtText(-12.5)).toBe("ลบสิบสองบาทห้าสิบสตางค์");
    expect(() => thaiBahtText(Number.NaN)).toThrow("จำนวนเงินต้องเป็นตัวเลขที่มีค่าจำกัด");
  });

  test("prints full payment details but customer name only", () => {
    const model = buildRubberBillReceiptModel(makeBill());
    const html = renderRubberBillReceiptHtml(model);

    expect(model.grossTotal).toBe(200);
    expect(model.deductionTotal).toBe(65);
    expect(model.netTotal).toBe(135);
    expect(model.payerName).toBe("ผู้ใช้");
    expect(model.approvalLabel).toBe("ไม่ต้องอนุมัติ");
    expect(model.deductions).toEqual([
      { label: "กรด & สินค้า 1 ถัง", amount: 10 },
      { label: "หักหนี้", amount: 15 },
      { label: "หักน้ำหนัก 2 กก.", amount: 40 },
    ]);
    expect(html).toContain("ยอดที่ต้องจ่ายลูกค้า");
    expect(html).toContain("สถานะอนุมัติ");
    expect(html).not.toContain("ที่อยู่:");
    expect(html).not.toContain("FSC");
    expect(html).not.toContain("EUDR");
  });

  test("uses local reference and blocks payment warning when any row price is zero", () => {
    const model = buildRubberBillReceiptModel(makeBill({
      serverBillNo: undefined,
      syncStatus: "pending",
      price: 0,
      netTotal: 0,
      deductionTotal: 0,
      weighItems: [{
        id: "w1",
        label: "ชั่ง1",
        inWeight: 15,
        outWeight: 5,
        netWeight: 10,
        price: 0,
      }],
    }));
    const html = renderRubberBillReceiptHtml(model);

    expect(model.receiptKind).toBe("offline");
    expect(model.referenceLabel).toBe("เลขอ้างอิงบนเครื่อง");
    expect(model.referenceNo).toBe("LOCAL-1");
    expect(model.approvalLabel).toBe("ผ่านการตรวจราคาบนเครื่อง — ไม่ต้องอนุมัติ");
    expect(html).toContain("ใบรับซื้อยางออฟไลน์");
    expect(html).toContain("ยังไม่กำหนดราคา — ห้ามจ่าย");

    expect(buildRubberBillReceiptModel(makeBill({
      serverBillNo: undefined,
      syncStatus: "pending",
      configuredPriceSnapshot: null,
    })).approvalLabel).toBe("ไม่ได้เปิดใช้กฎอนุมัติราคา");
  });

  test("shows only the approver of the current approved revision", () => {
    expect(buildRubberBillReceiptModel(makeBill({
      approvalState: "approved",
      approvalApprovedByName: "หัวหน้าสาขา",
      approvalRevisionNo: 3,
    })).approvalLabel).toBe("อนุมัติแล้ว — หัวหน้าสาขา");

    expect(buildRubberBillReceiptModel(makeBill({
      revisionNo: 4,
      approvalState: "not_required",
      approvalApprovedByName: null,
      approvalRevisionNo: null,
    })).approvalLabel).toBe("ไม่ต้องอนุมัติ");
  });

  test("keeps the original creator as payer on later revisions and falls back to ไม่ระบุ", () => {
    const original = makeBill({ createdByName: "ผู้สร้างเดิม" });
    const edited = { ...original, revisionNo: 4, customerName: "ชื่อที่แก้ภายหลัง" };

    expect(buildRubberBillReceiptModel(original).payerName).toBe("ผู้สร้างเดิม");
    expect(buildRubberBillReceiptModel(edited).payerName).toBe("ผู้สร้างเดิม");
    expect(buildRubberBillReceiptModel(makeBill({ createdByName: "   " })).payerName)
      .toBe("ไม่ระบุ");
  });

  test("escapes every dynamic receipt string", () => {
    const html = renderRubberBillReceiptHtml(buildRubberBillReceiptModel(
      makeBill({ customerName: '<img src=x onerror="alert(1)">' })
    ));

    expect(html).not.toContain('<img src=x onerror="alert(1)">');
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("ชั่ง &lt;หนึ่ง&gt;");
    expect(html).toContain("กรด &amp; สินค้า");
  });

  test("allows local, synced, and report-locked PDF receipts but blocks approval and sync failures", () => {
    expect(getRubberBillPrintBlockReason(makeBill())).toBeNull();
    expect(getRubberBillPrintBlockReason(makeBill({ reportLockNo: "RPT-20260725-001" }))).toBeNull();
    expect(getRubberBillPrintBlockReason(makeBill({
      syncStatus: "pending",
      serverBillNo: undefined,
    }))).toBeNull();
    expect(getRubberBillPrintBlockReason(makeBill({ approvalPending: true }))).toContain("รออนุมัติ");
    expect(getRubberBillPrintBlockReason(makeBill({ syncStatus: "failed" }))).toContain("ปัญหาการซิงก์");
    expect(getRubberBillPrintBlockReason(makeBill({ recordStatus: "deleted" }))).toContain("ยังใช้งาน");
    expect(getRubberBillPrintBlockReason(makeBill({ billType: "อื่น" }))).toContain("บิลเครื่องชั่งเล็ก");
  });

  test("never prints a stale cached revision over the latest synced bill", () => {
    const currentBill = makeBill({ customerName: "ข้อมูล revision ล่าสุด" });
    const staleReceipt = buildRubberBillReceiptModel(makeBill({ customerName: "ข้อมูล cache เก่า" }));
    const staleSnapshot = { revisionNo: currentBill.revisionNo - 1, receipt: staleReceipt };

    expect(resolveRubberBillReceiptForPrint(currentBill, staleSnapshot, true).customerName)
      .toBe("ข้อมูล revision ล่าสุด");
    expect(() => resolveRubberBillReceiptForPrint(currentBill, staleSnapshot, false))
      .toThrow("กรุณาออนไลน์เพื่อโหลดใหม่");
    expect(resolveRubberBillReceiptForPrint(
      currentBill,
      { revisionNo: currentBill.revisionNo, receipt: staleReceipt },
      false
    )).toBe(staleReceipt);
  });
});
