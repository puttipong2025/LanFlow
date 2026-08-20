import { expect, test } from "@playwright/test";
import {
  calculatePurchaseCostIncludingWork,
  calculateWeightLossPercent,
  calculateWorkTotal,
  isValidCurrentWeight,
} from "../src/lib/rubber-exports/calculations";
import { bangkokDateString, bangkokDateWindow } from "../src/lib/bangkok-date";

test.describe("Rubber export calculations @rubber-export", () => {
  test("uses current weight for loss and total net weight for work cost", () => {
    expect(calculateWeightLossPercent(540, 500)).toBe(7.41);
    expect(calculateWeightLossPercent(3, 2)).toBe(33.33);
    expect(calculateWeightLossPercent(540, 541)).toBeNull();
    expect(calculateWorkTotal(540, 2, 100)).toBe(1180);
    expect(calculateWorkTotal(1.005, 1, 0)).toBe(1.01);
    expect(calculateWorkTotal(400, 0, 0)).toBe(0);
    expect(calculatePurchaseCostIncludingWork(2800, 225, 100)).toEqual({
      total: 3025,
      average: 30.25,
    });
    expect(calculatePurchaseCostIncludingWork(3000, 0, 100)).toEqual({
      total: 3000,
      average: 30,
    });
    expect(isValidCurrentWeight(540, 0)).toBeFalsy();
    expect(isValidCurrentWeight(540, 540)).toBeTruthy();
  });

  test("rejects non-positive, impossible, and non-finite inputs", () => {
    expect(calculateWeightLossPercent(0, 0)).toBeNull();
    expect(calculateWeightLossPercent(100, Number.NaN)).toBeNull();
    expect(calculateWorkTotal(null, 1, 0)).toBeNull();
    expect(calculateWorkTotal(100, -1, 0)).toBeNull();
    expect(calculateWorkTotal(100, 1, Number.POSITIVE_INFINITY)).toBeNull();
    expect(calculatePurchaseCostIncludingWork(3000, null, 100)).toEqual({
      total: null,
      average: null,
    });
    expect(calculatePurchaseCostIncludingWork(3000, undefined, 100)).toEqual({
      total: null,
      average: null,
    });
    expect(isValidCurrentWeight(Number.NaN, 1)).toBeFalsy();
    expect(isValidCurrentWeight(100, Number.NaN)).toBeFalsy();
  });

  test("uses Bangkok calendar dates for the 90-day feed window", () => {
    const beforeMidnight = new Date("2026-07-23T16:59:59.999Z");
    const afterMidnight = new Date("2026-07-23T17:00:00.000Z");
    expect(bangkokDateString(beforeMidnight)).toBe("2026-07-23");
    expect(bangkokDateString(afterMidnight)).toBe("2026-07-24");

    const window = bangkokDateWindow(90, afterMidnight);
    expect(window.to).toBe("2026-07-24");
    expect(
      (Date.parse(window.to) - Date.parse(window.from)) / (24 * 60 * 60 * 1000),
    ).toBe(89);
  });
});
