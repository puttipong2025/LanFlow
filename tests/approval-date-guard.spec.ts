import { expect, test } from "@playwright/test";
import { bangkokDateString } from "../src/lib/bangkok-date";
import { assertOfflineIncomeExpenseDateAllowed } from "../src/lib/income-expense/approval-cache";
import { assertOfflineRubberBillPriceAllowed } from "../src/lib/rubber-bills/approval";

function adjacentDate(dayOffset: number) {
  const today = bangkokDateString();
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return date.toISOString().slice(0, 10);
}

test.describe("offline non-current business-date guard", () => {
  const cachedAt = "2026-08-05T00:00:00.000Z";

  for (const date of [adjacentDate(-1), adjacentDate(1)]) {
    test(`blocks income/expense ${date} when enabled or cache is missing`, () => {
      expect(() => assertOfflineIncomeExpenseDateAllowed(date, null, false)).toThrow("ยังไม่เคยโหลด");
      expect(() => assertOfflineIncomeExpenseDateAllowed(date, {
        nonCurrentDateRequiresApproval: true,
        cachedAt,
      }, false)).toThrow("ต้องออนไลน์");
      expect(() => assertOfflineIncomeExpenseDateAllowed(date, {
        nonCurrentDateRequiresApproval: false,
        cachedAt,
      }, false)).not.toThrow();
    });

    test(`blocks rubber bill ${date} when enabled`, () => {
      expect(() => assertOfflineRubberBillPriceAllowed([], date, {
        editWindowMinutes: 30,
        configuredPrice: null,
        nonCurrentDateRequiresApproval: true,
      }, false)).toThrow("ต้องออนไลน์");
      expect(() => assertOfflineRubberBillPriceAllowed([], date, {
        editWindowMinutes: 30,
        configuredPrice: null,
        nonCurrentDateRequiresApproval: false,
      }, false)).not.toThrow();
    });
  }

  test("allows today's date through the new date rule", () => {
    const today = bangkokDateString();
    expect(() => assertOfflineIncomeExpenseDateAllowed(today, null, false)).not.toThrow();
    expect(() => assertOfflineRubberBillPriceAllowed([], today, {
      editWindowMinutes: 30,
      configuredPrice: null,
      nonCurrentDateRequiresApproval: true,
    }, false)).not.toThrow();
  });
});
