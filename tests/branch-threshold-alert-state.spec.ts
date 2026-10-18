import { expect, test } from "@playwright/test";
import { validCashThreshold, parseBranchThresholdCheck } from "../src/lib/lanflow/branch-threshold-alert";
import { parseCashAlertGroupBody } from "../src/lib/server/rubber-weight-alert-groups";
test("cash accepts signed cents and rejects silent rounding or nonnumbers", () => {
  for (const value of [-9999999999.99, -10.12, 0, 0.01, 1.1, 9999999999.99]) expect(validCashThreshold(value)).toBe(true);
  for (const value of [NaN, Infinity, "1", null, 1.001, 10000000000]) expect(validCashThreshold(value)).toBe(false);
  expect(parseCashAlertGroupBody(null)).toHaveProperty("errorMessage");
  expect(parseCashAlertGroupBody({ locationIds: [], thresholdAmount: 0 })).toHaveProperty("errorMessage");
});
test("empty, partial and unavailable results remain distinct", () => {
  const result = { config: { thresholdKg: 10000, intervalMinutes: 60 }, candidates: [], unavailable: [], configuredCount: 0, checkedCount: 0 };
  expect(parseBranchThresholdCheck(result)).toEqual(result);
  expect(parseBranchThresholdCheck({ ...result, configuredCount: 1 })).toBeNull();
  const partial = { ...result, configuredCount: 1, unavailable: [{ kind: "cash", locationId: "a", locationName: "A", reason: "missing_snapshot" }] };
  expect(parseBranchThresholdCheck(partial)).toEqual(partial);
  expect(parseBranchThresholdCheck({ ...partial, checkedCount: 1 })).toBeNull();
});

test("duplicate branches are rejected regardless of UUID letter casing", () => {
  const id = "a1000000-0000-4000-8000-000000000001";
  expect(parseCashAlertGroupBody({ locationIds: [id, id], thresholdAmount: 0 })).toHaveProperty("errorMessage");
  expect(parseCashAlertGroupBody({ locationIds: [id, id.toUpperCase()], thresholdAmount: 0 })).toHaveProperty("errorMessage");
});
