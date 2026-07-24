import { expect, test } from "@playwright/test";
import {
  calculateAveragePrice,
  calculateNetWeight,
  calculateWeightLossPercent,
  calculateWorkTotal,
  isValidCurrentWeight,
} from "../src/lib/rubber-exports/calculations";
import { bangkokDateString, bangkokDateWindow } from "../src/lib/bangkok-date";

test.describe("Rubber export calculations @rubber-export", () => {
  test("calculates net weight and average price with 2-decimal rounding", () => {
    expect(calculateNetWeight(100.555, 0.111)).toBe(100.44);
    expect(calculateNetWeight(100, 2.345)).toBe(97.66);
    expect(calculateAveragePrice(1000, 3)).toBe(333.33);
    expect(calculateAveragePrice(1234.56, 97.66)).toBe(12.64);
  });

  test("uses the confirmed weight-loss and work-total formulas", () => {
    expect(calculateWeightLossPercent(540, 500)).toBe(7.41);
    expect(calculateWeightLossPercent(3, 2)).toBe(33.33);
    expect(calculateWeightLossPercent(540, 541)).toBeNull();
    expect(calculateWorkTotal(500, 2, 100)).toBe(1100);
    expect(calculateWorkTotal(1.005, 1, 0)).toBe(1.01);
    expect(calculateWorkTotal(400, 0, 0)).toBe(0);
    expect(isValidCurrentWeight(540, 0)).toBeFalsy();
    expect(isValidCurrentWeight(540, 540)).toBeTruthy();
  });

  test("rejects non-positive, impossible, and non-finite inputs", () => {
    expect(calculateNetWeight(100, 100)).toBeNull();
    expect(calculateNetWeight(100, -1)).toBeNull();
    expect(calculateNetWeight(Number.NaN, 1)).toBeNull();
    expect(calculateAveragePrice(0, 100)).toBeNull();
    expect(calculateAveragePrice(100, 0)).toBeNull();
    expect(calculateAveragePrice(Number.POSITIVE_INFINITY, 100)).toBeNull();
    expect(calculateWeightLossPercent(0, 0)).toBeNull();
    expect(calculateWeightLossPercent(100, Number.NaN)).toBeNull();
    expect(calculateWorkTotal(null, 1, 0)).toBeNull();
    expect(calculateWorkTotal(100, -1, 0)).toBeNull();
    expect(calculateWorkTotal(100, 1, Number.POSITIVE_INFINITY)).toBeNull();
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
