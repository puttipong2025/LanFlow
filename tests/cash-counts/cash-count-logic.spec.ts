import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { parseBankBalance, readBankBalance } from "../../src/lib/server/cash-count-bank-ocr";
import { cashCountDifference } from "../../src/lib/cash-count-pdf";
import { parseBranchThresholdCheck } from "../../src/lib/lanflow/branch-threshold-alert";
import { validCashCountCounts } from "../../src/lib/cash-count-validation";

test("bank OCR rejects unknown, negative, rounded or ambiguous amounts", () => {
  expect(parseBankBalance({ amount: "29500.00", kind: "balance" })).toEqual({ amount: "29500.00", kind: "balance" });
  expect(parseBankBalance({ amount: "0.00", kind: "available" })).toBeTruthy();
  for (const amount of [null, 100, "1,000.00", "-1.00", "1.001", "1e3", "", "NaN"]) {
    expect(parseBankBalance({ amount, kind: "balance" })).toBeNull();
  }
  expect(parseBankBalance({ amount: "12.00", kind: "transaction" })).toBeNull();
});
test("difference labels preserve missing legacy baseline", () => {
  expect(cashCountDifference(-500)).toBe("เงินขาด 500.00 บาท");
  expect(cashCountDifference(500)).toBe("เงินเกิน 500.00 บาท");
  expect(cashCountDifference(0)).toBe("ยอดตรงกัน 0.00 บาท");
  expect(cashCountDifference(null)).toBe("ไม่มีข้อมูลฐานเดิม");
});
test("denominations must be complete nonnegative integer counts", () => {
  const counts = { "1000": 1, "500": 0, "100": 0, "50": 0, "20": 0, "10": 0, "5": 0, "2": 0, "1": 0 };
  expect(validCashCountCounts(counts)).toBe(true);
  for (const value of [null, [], {}, { ...counts, "1": null }, { ...counts, "1": -1 }, { ...counts, "1": 0.5 }, { ...counts, "1": 10000001 }]) expect(validCashCountCounts(value)).toBe(false);
});
test("count alerts parse alongside unavailable money snapshots", () => {
  const value = { config: { thresholdKg: 10000, intervalMinutes: 60 }, configuredCount: 2, checkedCount: 1,
    candidates: [{ kind: "count", locationId: "a", locationName: "A", groupId: "g", groupOrder: 1,
      threshold: 2, value: 1, calculatedAt: "2026-10-24T00:00:00Z" }],
    unavailable: [{ kind: "cash", locationId: "a", locationName: "A", reason: "not_ready" }] };
  expect(parseBranchThresholdCheck(value)).toEqual(value);
});

test("live bank OCR reads the six supplied photos", async () => {
  test.skip(process.env.RUN_BANK_OCR !== "1", "Opt in to the external OCR acceptance run");
  test.setTimeout(6 * 70_000);
  const fixtures = [
    ["9190c2d3-02a8-4650-89b0-f8e4bb427686", "5256.06"],
    ["b87920f9-1919-4798-a43d-3c56154cbca5", "1366.68"],
    ["849b902a-047f-4c20-a9c1-70a6ff5fa103", "0.97"],
    ["6b9193bf-36d1-4239-8c6a-74cb9d06c889", "69717.07"],
    ["4666f2f5-63c7-454d-aa89-3de8ebf425ce", "391.49"],
    ["ddbf8f53-3ed7-4431-aae8-b1a95dafdaa5", "568.41"],
  ];
  for (const [id, amount] of fixtures) {
    const result = await readBankBalance(readFileSync(`C:/Users/Do/AppData/Local/Temp/codex-clipboard-${id}.jpg`), "image/jpeg");
    expect(result.amount, id).toBe(amount);
  }
});

test("live bank OCR prioritizes balance and refuses ambiguous or blank synthetic screens", async () => {
  test.skip(process.env.RUN_BANK_OCR !== "1", "Opt in to external OCR acceptance");
  test.setTimeout(3 * 70_000);
  const result = await readBankBalance(readFileSync("tests/fixtures/cash-count/balance-priority.png"), "image/png");
  expect(result).toEqual({ amount: "1500.25", kind: "balance" });
  for (const fixture of ["multiple-accounts.png", "unreadable.png"]) {
    const error = await readBankBalance(readFileSync(`tests/fixtures/cash-count/${fixture}`), "image/png")
      .then(() => null, (cause: Error) => cause.message);
    expect(error).toContain("ยอดไม่แน่ชัด");
  }
});
