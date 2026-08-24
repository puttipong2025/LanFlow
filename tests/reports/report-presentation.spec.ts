import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildReportPresentation,
  reportPdfFilename,
  reportShareTitle,
  reportStatusLabel,
  rubberBillTotals,
} from "@/lib/reports/report-presentation";
import type { ReportDetails } from "@/types/reports";

function reportDetails(): ReportDetails {
  return {
    report: {
      id: "report-presentation-test",
      reportNo: "RPT/2569:004",
      locationId: "location-presentation-test",
      locationName: "สาขาทดสอบ",
      cutoffAt: "2026-07-29T08:00:00.000Z",
      status: "active",
      createdByName: "ผู้ทดสอบ",
      createdAt: "2026-07-29T08:04:00.000Z",
      deletedAt: null,
      itemCount: 6,
      isLatestActive: true,
    },
    rubberBills: [
      {
        date: "2026-07-29",
        number: "RB-TRADER",
        customer: "ผู้ค้าขาย",
        customerGroup: "trader",
        billType: "ชั่ง",
        netWeight: 100,
        averagePrice: 30,
        rubberValue: 3_000,
        deduction: 50,
        net: 2_950,
      },
      {
        date: "2026-07-29",
        number: "RB-FARMER",
        customer: "ชาวสวน",
        customerGroup: "farmer",
        billType: "ชั่ง",
        netWeight: 50,
        averagePrice: 31,
        rubberValue: 1_550,
        deduction: 0,
        net: 1_550,
      },
      {
        date: "2026-07-29",
        number: "RB-BRANCH",
        customer: "รับยางจากสาขา สาขาต้นทาง",
        customerGroup: "branch_receipt",
        billType: "ชั่ง",
        netWeight: 25,
        averagePrice: 30,
        rubberValue: 750,
        deduction: 750,
        net: 0,
      },
    ],
    incomeExpense: [
      { date: "2026-07-28", number: "RPT-OPENING", type: "income", title: "ยอดยกมา", amount: 5_000 },
      { date: "2026-07-29", number: "INC-001", type: "income", title: "รับเงิน", amount: 10_000 },
      { date: "2026-07-29", number: "EXP-001", type: "expense", title: "จ่ายเงิน", amount: 2_500 },
    ],
    stock: [{
      date: "2026-07-29",
      number: "ST-001",
      product: "ปุ๋ย",
      type: "รับเข้า",
      quantity: 20,
      amount: 1_000,
    }],
    stockBalances: [{ product: "ปุ๋ย", quantity: 20 }],
    timePayroll: [
      { date: "2026-07-29", number: "TM-001", category: "เวลาทำงาน", employee: "หนึ่ง", detail: "", quantity: 8, amount: null },
      { date: "2026-07-29", number: "PY-001", category: "เงินเดือน", employee: "สาม", detail: "", quantity: null, amount: 500 },
    ],
    bankTransfers: [{
      date: "2026-07-29",
      number: "TR-001",
      direction: "out",
      party: "สาขาปลายทาง",
      status: "สำเร็จ",
      amount: 5_000,
      slipAmount: 4_990,
      fee: 10,
      branchPaid: 5_000,
    }],
  };
}

test("builds shared report groups, split ledger columns and totals", () => {
  const details = reportDetails();
  const presentation = buildReportPresentation(details);

  expect(presentation.traderRubberBills.map((row) => row.number)).toEqual(["RB-TRADER"]);
  expect(presentation.farmerRubberBills.map((row) => row.number)).toEqual(["RB-FARMER"]);
  expect(presentation.branchReceiptRubberBills.map((row) => row.number)).toEqual(["RB-BRANCH"]);
  expect(presentation.incomeExpense).toMatchObject([
    { number: "RPT-OPENING", title: "ยอดยกมา", income: 5_000, expense: null },
    { number: "INC-001", income: 10_000, expense: null },
    { number: "EXP-001", income: null, expense: 2_500 },
  ]);
  expect(presentation.totals).toMatchObject({
    income: 15_000,
    expense: 2_500,
    balance: 12_500,
    stockQuantity: 20,
    workHours: 8,
    payrollAmount: 500,
    transferAmount: 5_000,
    fee: 10,
  });
  expect(rubberBillTotals(details.rubberBills)).toEqual({
    weight: 175,
    value: 5_300,
    deduction: 800,
    net: 4_500,
  });
});

test("formats a sanitized filename, human share title and active status in Bangkok time", () => {
  const report = reportDetails().report;

  expect(reportPdfFilename(report)).toBe(
    "LanFlow-report-RPT-2569-004-20260729-1504-A4-landscape.pdf"
  );
  expect(reportShareTitle(report)).toContain("RPT/2569:004 · สาขาทดสอบ");
  expect(reportShareTitle(report)).toContain("15:04");
  expect(reportStatusLabel(report)).toBe("ใช้งาน");
});

test("uses the combined branch-receipt and current-branch heading in preview and PDF", () => {
  const expected = "1.3 ยางรับเข้าและยางคงเหลือภายในสาขา";
  expect(readFileSync(resolve("src/components/reports/ReportPreviewModal.tsx"), "utf8")).toContain(expected);
  expect(readFileSync(resolve("src/lib/reports/report-pdf.ts"), "utf8")).toContain(expected);
});
