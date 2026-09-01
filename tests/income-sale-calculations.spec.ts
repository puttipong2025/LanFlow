import { expect, test } from "@playwright/test";

import {
  calculateIncomeSaleLineTotal,
  calculateIncomeSaleTotals,
} from "../src/lib/income-expense/calculations";

test.describe("income sale calculations", () => {
  test("calculates each line and the whole bill in satang", () => {
    expect(calculateIncomeSaleLineTotal({ quantity: 2, unitPrice: 10.13 })).toBe(20.26);
    expect(calculateIncomeSaleTotals([
      { quantity: 2, unitPrice: 10.13 },
      { quantity: 3, unitPrice: 5.25 },
    ])).toEqual({
      lineTotals: [20.26, 15.75],
      total: 36.01,
    });
  });
});
