import { expect, test } from "@playwright/test";

import {
  buildPayrollSlipDocument,
  buildSlipDocumentDetailRows,
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
      history_creator_name: "ผู้สร้างต้นทาง",
      approver_name: "ผู้อนุมัติอีกคน",
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
  expect(buildSlipDocumentDetailRows(document)).toEqual(expect.arrayContaining([
    { label: "ผู้สร้างรายการ", value: "ผู้สร้างต้นทาง" },
    { label: "ผู้อนุมัติ", value: "ผู้อนุมัติอีกคน" },
  ]));
  expect(document.filename).toBe("LanFlow-เบิกเงิน-20260802-a1b2c3d4-รออนุมัติ-80mm.pdf");
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
      approver_name: "เฉพาะผู้อนุมัติ",
    },
    employeeName: "สมชาย ใจดี",
    dailyWage: 500,
    totalPaidDays: 10,
    existingDeductions: 2_000,
    segments: [],
    generatedAt: GENERATED_AT,
  });

  expect(document.summary.at(-2)?.value).toBe("3,000 บาท");
  expect(document.creatorName).toBe("ไม่ทราบผู้สร้างรายการ");
  expect(document.summary.at(-1)?.value).toBe("1,000 บาท");
  expect(document.filename).toBe("LanFlow-เบิกเงิน-20260802-a1b2c3d4-อนุมัติแล้ว-80mm.pdf");
});

test("payroll keeps snapshot amounts and produces a Thai filename", () => {
  const slipDataWithRoundingAudit = {
    segments: [],
    transactions: [],
    outstandingAdjustments: {
      beforeDeductions: 3_500.23,
      deductedThisSlip: 2_000.23,
      remainingAfterDeductions: 1_500,
    },
    netPayBeforeRounding: 3_000.5,
    roundingAdjustment: 0.5,
  };
  const document = buildPayrollSlipDocument({
    source: {
      id: SOURCE_ID,
      month: "2026-07",
      status: "APPROVED",
      total_days: 10,
      daily_wage: 500.1234,
      gross_pay: 5_001.23,
      total_deductions: 2_000.23,
      net_pay: 3_001,
      created_at: "2026-08-01T01:00:00.000Z",
      slip_data: slipDataWithRoundingAudit,
      history_creator_name: "ผู้สร้างเงินเดือน",
      approver_name: "ผู้อนุมัติเงินเดือน",
    },
    employeeName: "สมชาย ใจดี",
    generatedAt: GENERATED_AT,
  });

  expect(document.title).toBe("สลิปเงินเดือน");
  expect(buildSlipDocumentDetailRows(document)).toEqual(expect.arrayContaining([
    { label: "ผู้สร้างรายการ", value: "ผู้สร้างเงินเดือน" },
    { label: "ผู้อนุมัติ", value: "ผู้อนุมัติเงินเดือน" },
  ]));
  expect(document.workSummary?.map((row) => row.value)).toEqual([
    "10 วัน",
    "500.1234 บาท",
  ]);
  expect(document.summary.map((row) => row.value)).toEqual([
    "5,001.23 บาท",
    "3,500.23 บาท",
    "2,000.23 บาท",
    "1,500.00 บาท",
    "3,001.00 บาท",
  ]);
  expect(document).not.toHaveProperty("deductionRows");
  expect(document.summary.map((row) => row.label)).toEqual([
    "ค่าแรงรวม", "หนี้และเงินเบิกก่อนหักรวม", "หักรวมเดือนนี้",
    "ยอดค้างยกไปเดือนถัดไป", "เงินเดือนสุทธิที่ต้องจ่าย",
  ]);
  expect(document.filename).toBe("LanFlow-เงินเดือน-2026-07-a1b2c3d4-อนุมัติแล้ว-80mm.pdf");
  expect(JSON.stringify(document)).not.toMatch(/Payroll|Withdrawal/);
  expect(JSON.stringify(document)).not.toMatch(/netPayBeforeRounding|roundingAdjustment/);
});

test("payroll keeps saved descriptions and dates without repeating deductions", () => {
  const document = buildPayrollSlipDocument({
    source: {
      id: SOURCE_ID,
      month: "2026-07",
      status: "APPROVED",
      total_days: 10,
      daily_wage: 500,
      gross_pay: 5_000,
      total_deductions: 1_000,
      net_pay: 4_000,
      created_at: "2026-08-01T01:00:00.000Z",
      slip_data: {
        outstandingAdjustments: {
          beforeDeductions: 1_500,
          deductedThisSlip: 1_000,
          remainingAfterDeductions: 500,
        },
        transactions: [
          {
            id: "deduction-1",
            type: "DEBT_DEDUCTION",
            status: "APPROVED",
            amount: 500,
            applied_month: "2026-07-01",
          },
          {
            id: "debt-1",
            type: "DEBT",
            status: "APPROVED",
            amount: 500,
            description: "ค่าซ่อมรถ",
            effective_date: "2026-07-15",
          },
        ],
      },
    },
    employeeName: "สมชาย ใจดี",
    generatedAt: GENERATED_AT,
  });

  expect(document).not.toHaveProperty("deductionRows");
  expect(document.sourceRows).toEqual([{
    id: "debt-1", dateLabel: "15 ก.ค. 2569", label: "หนี้", description: "ค่าซ่อมรถ", amount: 500,
  }]);
  expect(document.sourceRows[0]).not.toHaveProperty("date");
});

test("payroll always shows a zero remaining aggregate when the debt is fully deducted", () => {
  const document = buildPayrollSlipDocument({
    source: {
      id: SOURCE_ID,
      month: "2026-08",
      status: "APPROVED",
      total_days: 10,
      daily_wage: 500,
      gross_pay: 5_000,
      total_deductions: 300,
      net_pay: 4_700,
      created_at: "2026-09-01T01:00:00.000Z",
      slip_data: {
        outstandingAdjustments: {
          beforeDeductions: 300,
          deductedThisSlip: 300,
          remainingAfterDeductions: 0,
        },
        transactions: [{
          id: "deduction-source-date",
          type: "WITHDRAWAL_DEDUCTION",
          status: "APPROVED",
          amount: 300,
          applied_month: "2026-08-01",
          source_effective_date: "2026-07-18",
        }],
      },
    },
    employeeName: "สมชาย ใจดี",
    generatedAt: GENERATED_AT,
  });

  expect(document).not.toHaveProperty("deductionRows");
  expect(document.summary).toContainEqual({ label: "ยอดค้างยกไปเดือนถัดไป", value: "0.00 บาท" });
});

for (const status of ["PENDING", "APPROVED"] as const) {
  test(`payroll ${status} shows carried balances instead of the original debt`, () => {
    const document = buildPayrollSlipDocument({
      source: {
        id: SOURCE_ID, month: "2026-10", status,
        total_days: 10, daily_wage: 500, gross_pay: 5_000,
        total_deductions: 5_000, net_pay: 0, created_at: GENERATED_AT,
        slip_data: {
          transactions: [{ id: "old-debt", type: "DEBT", status: "APPROVED", amount: 6_000 }],
          outstandingAdjustments: {
            beforeDeductions: 9_000, deductedThisSlip: 5_000, remainingAfterDeductions: 4_000,
          },
          outstandingSources: [
            { id: "old-debt", type: "DEBT", status: "APPROVED", amount: 2_000,
              carried_forward: true, effective_date: "2026-09-05", description: "ค่าซ่อมรถ" },
            { id: "new-withdrawal", type: "WITHDRAWAL", status: "APPROVED", amount: 7_000,
              carried_forward: false, effective_date: "2026-10-10", description: "ค่าใช้จ่ายส่วนตัว" },
          ],
        },
      },
      employeeName: "สมชาย ใจดี", generatedAt: GENERATED_AT,
    });

    expect(document.sourceRows).toEqual([
      { id: "old-debt", label: "หนี้ยกมา", dateLabel: "5 ก.ย. 2569", description: "ค่าซ่อมรถ", amount: 2_000 },
      { id: "new-withdrawal", label: "เบิกเงิน", dateLabel: "10 ต.ค. 2569", description: "ค่าใช้จ่ายส่วนตัว", amount: 7_000 },
    ]);
    expect(document.sourceRows.reduce((sum, row) => sum + row.amount, 0)).toBe(9_000);
    expect(document.summary).toEqual([
      { label: "ค่าแรงรวม", value: "5,000.00 บาท" },
      { label: "หนี้และเงินเบิกก่อนหักรวม", value: "9,000.00 บาท" },
      { label: "หักรวมเดือนนี้", value: "5,000.00 บาท" },
      { label: "ยอดค้างยกไปเดือนถัดไป", value: "4,000.00 บาท" },
      { label: "เงินเดือนสุทธิที่ต้องจ่าย", value: "0.00 บาท" },
    ]);
    expect(document).not.toHaveProperty("deductionRows");
    expect(document.notice).toContain("ไม่ใช่หลักฐานการรับเงินจริง");
  });
}

for (const malformed of [{}, [null], "stale-metadata"]) {
  test(`payroll tolerates malformed optional source metadata ${JSON.stringify(malformed)}`, () => {
    const source = JSON.parse(JSON.stringify({
      id: SOURCE_ID, month: "2026-10", status: "APPROVED",
      total_days: 10, daily_wage: 500, gross_pay: 5_000, total_deductions: 1_000,
      net_pay: 4_000, created_at: GENERATED_AT,
      slip_data: {
        outstandingSources: malformed,
        transactions: [{ id: "legacy", type: "DEBT", status: "APPROVED", amount: 1_000,
          description: "ค่าซ่อมรถ", effective_date: "2026-10-05" }],
      },
    }));
    const document = buildPayrollSlipDocument({ source, employeeName: "พนักงาน", generatedAt: GENERATED_AT });
    expect(document.sourceRows).toHaveLength(1);
    expect(document.sourceRows[0]).toMatchObject({ id: "legacy", description: "ค่าซ่อมรถ", amount: 1_000 });
    expect(document.summary.at(-1)).toEqual({ label: "เงินเดือนสุทธิที่ต้องจ่าย", value: "4,000.00 บาท" });
  });
}

test("payroll without debt keeps only gross, zero deduction and net pay in its summary", () => {
  const document = buildPayrollSlipDocument({
    source: {
      id: SOURCE_ID, month: "2026-10", status: "APPROVED", total_days: 20, daily_wage: 500,
      gross_pay: 10_000, total_deductions: 0, net_pay: 10_000, created_at: GENERATED_AT,
      slip_data: { outstandingSources: [], outstandingAdjustments: {
        beforeDeductions: 0, deductedThisSlip: 0, remainingAfterDeductions: 0,
      } },
    },
    employeeName: "พนักงาน", generatedAt: GENERATED_AT,
  });
  expect(document.summary).toEqual([
    { label: "ค่าแรงรวม", value: "10,000.00 บาท" },
    { label: "หักรวมเดือนนี้", value: "0.00 บาท" },
    { label: "เงินเดือนสุทธิที่ต้องจ่าย", value: "10,000.00 บาท" },
  ]);
  expect(document.sourceRows).toEqual([]);
  expect(document.workSummary).toContainEqual({ label: "จำนวนวันทำงานรวม", value: "20 วัน" });
});

for (const [cancelledAt, expectedRows] of [
  ["2026-10-10T00:00:00.000Z", 0],
  ["2026-11-01T07:00:00.000+07:00", 0],
  ["2026-11-02T00:00:00.000Z", 1],
  [null, 1],
] as const) {
  test(`legacy payroll source cancellation ${cancelledAt} respects the slip snapshot time`, () => {
    const source = JSON.parse(JSON.stringify({
      id: SOURCE_ID, month: "2026-10", status: "APPROVED", total_days: 20, daily_wage: 500,
      gross_pay: 10_000, total_deductions: 0, net_pay: 10_000,
      created_at: "2026-11-01T00:00:00.000Z",
      slip_data: {
        transactions: [{ id: "legacy-debt", type: "DEBT", status: "APPROVED", amount: 1_000,
          effective_date: "2026-10-05", description: "ค่าซ่อมรถ", cancelled_at: cancelledAt }],
        outstandingAdjustments: {
          beforeDeductions: expectedRows * 1_000, deductedThisSlip: 0,
          remainingAfterDeductions: expectedRows * 1_000,
        },
      },
    }));
    const document = buildPayrollSlipDocument({ source, employeeName: "พนักงาน", generatedAt: GENERATED_AT });
    expect(document.sourceRows).toHaveLength(expectedRows);
    expect(document.summary).toHaveLength(expectedRows ? 5 : 3);
  });
}

test("payroll attendance snapshot still populates the work-calendar table", () => {
  const document = buildPayrollSlipDocument({
    source: {
      id: SOURCE_ID,
      month: "2026-07",
      status: "APPROVED",
      total_days: 1.5,
      daily_wage: 500,
      gross_pay: 750,
      total_deductions: 0,
      net_pay: 750,
      created_at: "2026-08-01T01:00:00.000Z",
      slip_data: {
        transactions: [],
        attendance: {
          month: "2026-07",
          workdayEndTime: "16:00",
          eligibleThrough: "2026-07-03",
          periods: [{ startOn: "2026-07-01", endOn: "2026-07-04" }],
          exceptions: [
            { date: "2026-07-02", status: "HALF_DAY" },
            { date: "2026-07-03", status: "OFF" },
          ],
          summary: {
            fullDays: 1,
            halfDays: 1,
            offDays: 1,
            paidDays: 1.5,
            grossPay: 750,
          },
        },
      },
    },
    employeeName: "สมชาย ใจดี",
    generatedAt: GENERATED_AT,
  });

  expect(document.calendar).toHaveLength(31);
  expect(document.calendar.find((day) => day.date === "2026-07-01")?.paidDays).toBe(1);
  expect(document.calendar.find((day) => day.date === "2026-07-02")?.paidDays).toBe(0.5);
  expect(document.calendar.find((day) => day.date === "2026-07-03")?.paidDays).toBe(0);
  expect(document.calendar.find((day) => day.date === "2026-07-04")?.paidDays).toBe(0);
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
