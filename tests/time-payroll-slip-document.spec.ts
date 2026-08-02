import { expect, test } from "@playwright/test";

import {
  buildPayrollSlipDocument,
  buildWithdrawalSlipDocument,
  canCreateSlipDocument,
} from "@/lib/time-tracking/slip-document";

const SOURCE_ID = "a1b2c3d4-1111-4111-8111-123456789abc";
const GENERATED_AT = "2026-08-02T03:04:05.000Z";

test("withdrawal estimate uses live database totals and floors remaining wage at zero", () => {
  const document = buildWithdrawalSlipDocument({
    source: {
      id: SOURCE_ID,
      status: "PENDING",
      amount: 7_000,
      remaining_amount: 7_000,
      effective_date: "2026-08-02",
      created_at: "2026-08-02T01:00:00.000Z",
      description: "เบิกล่วงหน้า",
    },
    employeeName: "สมชาย ใจดี",
    dailyWage: 500,
    totalPaidDays: 10,
    existingDeductions: 0,
    segments: [],
    generatedAt: GENERATED_AT,
  });

  expect(document.summary).toEqual([
    { label: "วันทำงานสะสม", value: "10 วัน" },
    { label: "ค่าแรงสะสม", value: "5,000 บาท" },
    { label: "ค่าแรงคงเหลือหลังเบิก", value: "0 บาท" },
    { label: "ยอดเบิกที่ยังหักไม่หมด", value: "2,000 บาท" },
  ]);
  expect(document.notice).toContain("ประมาณการหากอนุมัติ");
  expect(document.filename).toBe("LanFlow-เบิกเงิน-20260802-a1b2c3d4-รออนุมัติ.pdf");
});

test("approved withdrawal uses actual ledger balance without deducting the source twice", () => {
  const document = buildWithdrawalSlipDocument({
    source: {
      id: SOURCE_ID,
      status: "APPROVED",
      amount: 3_000,
      remaining_amount: 1_000,
      effective_date: "2026-08-02",
      created_at: "2026-08-02T01:00:00.000Z",
      approved_at: "2026-08-02T02:00:00.000Z",
    },
    employeeName: "สมชาย ใจดี",
    dailyWage: 500,
    totalPaidDays: 10,
    existingDeductions: 2_000,
    segments: [],
    generatedAt: GENERATED_AT,
  });

  expect(document.summary.at(-2)?.value).toBe("3,000 บาท");
  expect(document.summary.at(-1)?.value).toBe("1,000 บาท");
  expect(document.filename).toBe("LanFlow-เบิกเงิน-20260802-a1b2c3d4-อนุมัติแล้ว.pdf");
});

test("payroll keeps snapshot amounts and produces a Thai filename", () => {
  const document = buildPayrollSlipDocument({
    source: {
      id: SOURCE_ID,
      month: "2026-07",
      status: "APPROVED",
      total_days: 10,
      daily_wage: 500,
      gross_pay: 5_000,
      total_deductions: 2_000,
      net_pay: 3_000,
      created_at: "2026-08-01T01:00:00.000Z",
      slip_data: { segments: [], transactions: [] },
    },
    employeeName: "สมชาย ใจดี",
    generatedAt: GENERATED_AT,
  });

  expect(document.title).toBe("สลิปเงินเดือน");
  expect(document.summary.map((row) => row.value)).toEqual([
    "10 วัน",
    "500 บาท",
    "5,000 บาท",
    "2,000 บาท",
    "3,000 บาท",
  ]);
  expect(document.filename).toBe("LanFlow-เงินเดือน-2026-07-a1b2c3d4-อนุมัติแล้ว.pdf");
  expect(JSON.stringify(document)).not.toMatch(/Payroll|Withdrawal/);
});

test("documents exist only for non-deleted pending or approved sources", () => {
  expect(canCreateSlipDocument("PENDING", null)).toBe(true);
  expect(canCreateSlipDocument("APPROVED", null)).toBe(true);
  expect(canCreateSlipDocument("REJECTED", null)).toBe(false);
  expect(canCreateSlipDocument("PENDING", "2026-08-02T05:00:00.000Z")).toBe(false);
});

test("withdrawal calendar uses the payroll paid-day rule for partial and full days", () => {
  const document = buildWithdrawalSlipDocument({
    source: {
      id: SOURCE_ID,
      status: "PENDING",
      amount: 100,
      remaining_amount: 100,
      effective_date: "2026-08-02",
      created_at: "2026-08-02T01:00:00.000Z",
    },
    employeeName: "สมชาย ใจดี",
    dailyWage: 500,
    totalPaidDays: 1.5,
    existingDeductions: 0,
    segments: [
      { start_time: "2026-08-03T08:00:00.000Z", end_time: "2026-08-03T12:00:00.000Z" },
      { start_time: "2026-08-04T07:59:00.000Z", end_time: "2026-08-04T08:00:00.000Z" },
    ],
    generatedAt: GENERATED_AT,
  });

  expect(document.calendar.find((day) => day.date === "2026-08-03")?.paidDays).toBe(0.5);
  expect(document.calendar.find((day) => day.date === "2026-08-04")?.paidDays).toBe(1);
});
