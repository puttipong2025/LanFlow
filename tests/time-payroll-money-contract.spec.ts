import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  formatDailyWage,
  formatDailyWageCurrency,
  formatPayrollCurrency,
  formatPayrollMoney,
} from "@/lib/time-tracking/format";
import { parseDailyWageInput } from "@/lib/time-tracking/wage";

const readSource = (relativePath: string) => readFileSync(path.resolve(relativePath), "utf8");

test.describe("time/payroll money contract", () => {
  for (const [raw, expected] of [
    ["0", 0],
    ["500", 500],
    ["500.1", 500.1],
    ["500.1234", 500.1234],
  ] as const) {
    test(`accepts raw daily wage ${raw}`, () => {
      expect(parseDailyWageInput(raw)).toBe(expected);
    });
  }

  for (const raw of ["", "-1", "500.", ".5", "500.12345", "5e2", "NaN", "Infinity"]) {
    test(`rejects invalid raw daily wage ${raw} without rounding`, () => {
      expect(parseDailyWageInput(raw)).toBeNull();
    });
  }

  test("formats only payroll amounts with the payroll precision contract", () => {
    expect(formatDailyWage(500)).toBe("500");
    expect(formatDailyWage(500.1)).toBe("500.1");
    expect(formatDailyWage(500.1234)).toBe("500.1234");
    expect(formatDailyWageCurrency(500.1234)).toBe("฿500.1234");
    expect(formatPayrollMoney(1_001)).toBe("1,001.00");
    expect(formatPayrollCurrency(1_001)).toBe("฿1,001.00");
  });

  test("keeps the raw-string API and versioned database seams explicit", () => {
    const moduleSource = readSource("src/components/TimeTrackingModule.tsx");
    const routeSource = readSource("src/app/api/lanflow/time-tracking/admin/route.ts");
    const userRouteSource = readSource("src/app/api/lanflow/time-tracking/user/route.ts");
    const incomeExpenseSource = readSource("src/components/income-expense/IncomeExpenseModule.tsx");
    const dashboardSource = readSource("src/components/dashboard/Dashboard.tsx");
    const paymentModalSource = readSource("src/components/time-tracking/ExpenseLocationChangeModal.tsx");
    const documentRouteSource = readSource(
      "src/app/api/lanflow/time-tracking/documents/[sourceType]/[id]/route.ts",
    );
    const migrationSource = readSource(
      "supabase/migrations/20260901050000_time_payroll_wage_precision_and_whole_baht_net_pay.sql",
    );

    expect(moduleSource).toContain("daily_wage: wageText.trim()");
    expect(routeSource).toContain("parseDailyWageInput(daily_wage)");
    expect(migrationSource).toContain("create_time_tracking_payroll_slip_internal_20260901");
    expect(migrationSource).toContain("update_time_tracking_wage_internal_20260901");
    expect(migrationSource).toContain("'netPayBeforeRounding'");
    expect(migrationSource).toContain("'roundingAdjustment'");
    expect(migrationSource).toContain("v_net := round(v_net_before_rounding, 0)");
    expect(migrationSource).toContain("v_net_before_rounding := greatest(v_gross - v_deductions, 0)");
    expect(routeSource).not.toMatch(/from\("payroll_slips"\)[\s\S]{0,80}select\("\*/);
    expect(userRouteSource).not.toMatch(/from\("payroll_slips"\)[\s\S]{0,80}select\("\*/);
    expect(incomeExpenseSource).toContain('transaction.relationSourceType === "payroll_slip"');
    expect(dashboardSource).toContain('row.sourceType === "payroll_slip"');
    expect(paymentModalSource).toContain("paymentAmount");
    expect(paymentModalSource).toContain("amountLabel");
    expect(paymentModalSource).toContain("tabular-nums");
    expect(documentRouteSource).toContain("ยอดสุทธิ 0.00 บาท");
    expect(documentRouteSource).not.toContain("ยอดสุทธิ 0 บาท");
    expect(migrationSource).toContain("'sourceType', source_type");
  });
});
