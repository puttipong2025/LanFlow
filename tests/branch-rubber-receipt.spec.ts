import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildRubberBillReceiptModel,
  renderRubberBillReceiptHtml,
} from "@/components/rubber-bills/bill-display";
import { mapRubberExportRow } from "@/lib/server/rubber-export-response";
import type { RubberBill } from "@/types";

function branchReceiptBill(): RubberBill {
  return {
    id: "61000000-0000-4000-8000-000000000001",
    clientTempId: "branch-receipt-test",
    localBillNo: "2608100001",
    serverBillNo: "2608100001",
    syncStatus: "synced",
    idempotencyKey: "branch-receipt-test",
    locationId: "61000000-0000-4000-8000-000000000002",
    billNo: "2608100001",
    billDate: "2026-08-10",
    customerName: "รับยางจากสาขา สาขาต้นทาง",
    billType: "บิลเครื่องชั่งเล็ก",
    deductWeight: 0,
    weight: 100,
    netWeight: 100,
    weighValueTotal: 3_600,
    rubberValue: 3_600,
    price: 36,
    deductionTotal: 3_600,
    payableBeforeRounding: 0,
    netTotal: 0,
    acidPackCount: 0,
    approvalState: "not_required",
    weighItems: [{
      id: "weigh-1",
      label: "รับยางจากสาขา สาขาต้นทาง",
      inWeight: 100,
      outWeight: 0,
      netWeight: 100,
      price: 35.99,
      total: 3_600,
    }],
    debtItems: [{
      id: "debt-1",
      title: "หักมูลค่ายางรับจากสาขา สาขาต้นทาง",
      amount: 3_600,
    }],
    createdByUserId: "user-1",
    createdByName: "ผู้รับเข้า",
    createdByPhone: "",
    clientCreatedAt: "2026-08-10T08:00:00.000Z",
    clientRecordedAt: "2026-08-10T08:00:00.000Z",
    serverReceivedAt: "2026-08-10T08:00:00.000Z",
    revisionNo: 1,
    recordStatus: "active",
    sourceRubberExportId: "61000000-0000-4000-8000-000000000003",
    sourceExportNo: "REX-20260807-001",
    receivedAt: "2026-08-10T08:00:00.000Z",
    receivedAgeHours: 168,
    receivedAgeIsEstimated: true,
  };
}

test("renders branch source, compensated age, carried value and zero payable in the Rubber Bill receipt", () => {
  const model = buildRubberBillReceiptModel(branchReceiptBill());
  const html = renderRubberBillReceiptHtml(model);

  expect(model.weighItems[0].lineTotal).toBe(3_600);
  expect(html).toContain("ใบรับยางจากสาขา");
  expect(html).toContain("มูลค่ารวมค่าทำงาน");
  expect(html).toContain("REX-20260807-001");
  expect(html).toContain("7 วัน 0 ชั่วโมง (ประมาณการ)");
  expect(html).toContain("ยอดที่ต้องจ่ายลูกค้า");
  expect(html).not.toContain("ยังไม่กำหนดราคา");
});

test("maps the active destination receipt onto the source Rubber Export", () => {
  const summary = mapRubberExportRow({
    id: "export-1",
    export_no: "REX-001",
    location_id: "source-1",
    locations: { name: "สาขาต้นทาง" },
    status: "verified",
    original_weight_total: 100,
    paid_total: 3_600,
    rubber_value_total: 3_600,
    average_price: 36,
    other_operating_cost: 0,
    created_by_name: "ผู้สร้าง",
    created_at: "2026-08-07T08:00:00.000Z",
    rubber_export_items: [{ count: 1 }],
    receipt_bill_id: "bill-1",
    receipt_bill_no: "2608100001",
    receipt_location_name: "สาขาปลายทาง",
  });

  expect(summary).toMatchObject({
    receiptBillId: "bill-1",
    receiptBillNo: "2608100001",
    receiptLocationName: "สาขาปลายทาง",
    rubberValueTotal: 3_600,
  });
});

test("keeps the edit action out of branch-receipt rows", () => {
  const source = readFileSync(resolve("src/components/rubber-bills/RubberBillsTable.tsx"), "utf8");
  expect(source).toContain("!bill.sourceRubberExportId && <button");
  expect(source).toContain("รับจากสาขา");
  expect(source).toContain("อายุตอนรับ");
});
