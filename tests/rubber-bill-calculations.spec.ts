import { expect, test } from "@playwright/test";

import {
  calculateRubberBill,
  hasAtMostTwoDecimalPlaces,
} from "../src/lib/rubber-bills/calculations";

test.describe("rubber bill calculations", () => {
  test("floors calculated money rows and rubber value before saving", () => {
    const result = calculateRubberBill({
      weighItems: [
        { netWeight: 50, price: 20 },
        { netWeight: 40.13, price: 13.75 },
      ],
      deductWeight: 10.01,
      stockDeductionItems: [{ quantity: 1, unitPrice: 75.25 }],
      debtItems: [{ amount: 20.1 }],
    });

    expect(result).toEqual({
      totalWeight: 90.13,
      netWeight: 80.12,
      weighValueTotal: 1551,
      averagePrice: 17.21,
      rubberValue: 1378,
      deductionTotal: 95.1,
      payableBeforeRounding: 1282.9,
      netTotal: 1282,
      lineTotals: [1000, 551],
      stockDeductionLineTotals: [75],
    });
  });

  test("keeps the weighted average as display data, not the payable calculation input", () => {
    const result = calculateRubberBill({
      weighItems: [
        { netWeight: 60, price: 20 },
        { netWeight: 40, price: 10 },
      ],
      deductWeight: 10,
    });

    expect(result.totalWeight).toBe(100);
    expect(result.netWeight).toBe(90);
    expect(result.weighValueTotal).toBe(1600);
    expect(result.averagePrice).toBe(16);
    expect(result.rubberValue).toBe(1440);
    expect(result.netTotal).toBe(1440);
  });

  test("rejects decimal precision beyond hundredths", () => {
    expect(hasAtMostTwoDecimalPlaces(90.12)).toBe(true);
    expect(hasAtMostTwoDecimalPlaces(90.126)).toBe(false);
  });

  test("keeps direct debt precision after calculated values are floored", () => {
    const result = calculateRubberBill({
      weighItems: [{ netWeight: 80.12, price: 17.23 }],
      deductWeight: 0,
      debtItems: [{ amount: 95.35 }],
    });

    expect(result.weighValueTotal).toBe(1380);
    expect(result.rubberValue).toBe(1380);
    expect(result.lineTotals).toEqual([1380]);
    expect(result.stockDeductionLineTotals).toEqual([]);
    expect(result.deductionTotal).toBe(95.35);
    expect(result.payableBeforeRounding).toBe(1284.65);
    expect(result.netTotal).toBe(1284);
  });
});
