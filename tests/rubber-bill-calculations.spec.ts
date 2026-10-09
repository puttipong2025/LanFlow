import { expect, test } from "@playwright/test";

import {
  applyRubberBillCalculation,
  calculateRubberBill,
  calculateRubberPriceAdjustment,
  hasAtMostFiveDecimalPlaces,
  hasAtMostTwoDecimalPlaces,
  isValidRubberPriceAdjustmentTarget,
  prorateMoneyHalfUp,
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

  test("prorates money with PostgreSQL-compatible half-up rounding", () => {
    expect(prorateMoneyHalfUp(100.10, 35, 100)).toBe(35.04);
    expect(prorateMoneyHalfUp(2.26, 75, 100)).toBe(1.70);
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

  test("replaces stale item and summary totals in a local bill snapshot", () => {
    const bill = applyRubberBillCalculation({
      deductWeight: 0,
      weighItems: [{ netWeight: 10, price: 20, total: 160 }],
      acidItems: [{ quantity: 2, unitPrice: 10, total: 5 }],
      debtItems: [{ amount: 15 }],
      weight: 10,
      netWeight: 10,
      weighValueTotal: 160,
      rubberValue: 160,
      price: 16,
      deductionTotal: 20,
      payableBeforeRounding: 140,
      netTotal: 140,
    });

    expect(bill.weighItems[0].total).toBe(200);
    expect(bill.acidItems[0].total).toBe(20);
    expect(bill.weighValueTotal).toBe(200);
    expect(bill.rubberValue).toBe(200);
    expect(bill.price).toBe(20);
    expect(bill.deductionTotal).toBe(35);
    expect(bill.netTotal).toBe(165);
  });

  test("adjusts every positive price by the same cent increment without exceeding the target", () => {
    const result = calculateRubberPriceAdjustment({
      weighItems: [
        { netWeight: 60, price: 20 },
        { netWeight: 40, price: 10 },
        { netWeight: 10, price: 0 },
      ],
      deductWeight: 10,
      targetAmount: 91,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.actualIncrease).toBeGreaterThan(0);
    expect(result.actualIncrease).toBeLessThanOrEqual(91);
    expect(Math.round((result.weighItems[0].price - 20) * 100))
      .toBe(Math.round((result.weighItems[1].price - 10) * 100));
    expect(result.weighItems[2].price).toBe(0);
  });

  test("returns the greatest rounded result below the requested target", () => {
    const result = calculateRubberPriceAdjustment({
      weighItems: [{ netWeight: 100, price: 20 }],
      deductWeight: 10,
      targetAmount: 10,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.weighItems[0].price).toBe(20.12);
    expect(result.actualIncrease).toBe(10);
  });

  test("uses five-decimal price steps to reach targets smaller than one cent per kilogram", () => {
    const result = calculateRubberPriceAdjustment({
      weighItems: [{ netWeight: 800, price: 20 }],
      deductWeight: 0,
      targetAmount: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.weighItems[0].price).toBe(20.00125);
    expect(result.actualIncrease).toBe(1);
  });

  test("calculates weigh rows from five-decimal prices without cent rounding", () => {
    const result = calculateRubberBill({
      weighItems: [{ netWeight: 100_000, price: 20.12345 }],
      deductWeight: 0,
    });

    expect(result.lineTotals).toEqual([2_012_345]);
    expect(result.rubberValue).toBe(2_012_345);
  });

  test("accepts five-decimal prices across the supported database range", () => {
    expect(hasAtMostFiveDecimalPlaces(9_999_999_999.12345)).toBe(true);
    expect(hasAtMostFiveDecimalPlaces(9_999_999_999.123455)).toBe(false);
  });

  test("rejects a long zero-value rounding plateau instead of changing only the price", () => {
    const result = calculateRubberPriceAdjustment({
      weighItems: [{ netWeight: 0.01, price: 1 }],
      deductWeight: 0,
      targetAmount: 0.5,
    });

    expect(result).toEqual({
      ok: false,
      reason: "target-too-small",
      weighItems: [{ netWeight: 0.01, price: 1 }],
    });
  });

  test("rejects when the first positive rounded increase jumps over the target", () => {
    const result = calculateRubberPriceAdjustment({
      weighItems: [
        { netWeight: 100, price: 20 },
        { netWeight: 100, price: 20 },
      ],
      deductWeight: 0,
      targetAmount: 1,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("target-too-small");
  });

  test("does not compound when the same base items are recalculated", () => {
    const input = {
      weighItems: [{ netWeight: 800, price: 20 }],
      deductWeight: 0,
      targetAmount: 1_000,
    };
    const first = calculateRubberPriceAdjustment(input);
    const second = calculateRubberPriceAdjustment(input);

    expect(second).toEqual(first);
  });

  test("rejects invalid targets and bills without a positive price", () => {
    expect(isValidRubberPriceAdjustmentTarget(0.29)).toBe(true);
    expect(isValidRubberPriceAdjustmentTarget(1.001)).toBe(false);
    expect(isValidRubberPriceAdjustmentTarget(0.1 + 0.2)).toBe(false);
    expect(calculateRubberPriceAdjustment({
      weighItems: [{ netWeight: 10, price: 20 }],
      deductWeight: 0,
      targetAmount: 1.001,
    })).toMatchObject({ ok: false, reason: "invalid-target" });
    expect(calculateRubberPriceAdjustment({
      weighItems: [{ netWeight: 10, price: 0 }],
      deductWeight: 0,
      targetAmount: 100,
    })).toMatchObject({ ok: false, reason: "no-priced-items" });
  });

  test("does not alter items when a base price is invalid", () => {
    const weighItems = [
      { netWeight: 10, price: 20 },
      { netWeight: 10, price: -1 },
    ];

    expect(calculateRubberPriceAdjustment({
      weighItems,
      deductWeight: 0,
      targetAmount: 100,
    })).toEqual({ ok: false, reason: "invalid-base-price", weighItems });
    expect(calculateRubberPriceAdjustment({
      weighItems: [{ netWeight: 10, price: 20.000001 }],
      deductWeight: 0,
      targetAmount: 100,
    })).toMatchObject({ ok: false, reason: "invalid-base-price" });
  });
});
