import { expect, test } from "@playwright/test";
import { reportDatePart } from "../src/lib/reports/report-date";

test.use({ timezoneId: "UTC" });

test.describe("report business-date projection", () => {
  for (const [label, value, expected] of [
    ["date-only rubber/stock value", "2026-08-03", "2026-08-03"],
    ["time segment before midnight", "2026-08-03T16:59:59.999Z", "2026-08-03"],
    ["time segment at midnight", "2026-08-03T17:00:00.000Z", "2026-08-04"],
    ["financial approval", "2026-08-03T17:05:00.000Z", "2026-08-04"],
    ["payroll approval", "2026-08-03T18:00:00.000Z", "2026-08-04"],
    ["bank transfer", "2026-08-03T23:00:00.000Z", "2026-08-04"],
  ] as const) {
    test(label, () => expect(reportDatePart(value)).toBe(expected));
  }
});
