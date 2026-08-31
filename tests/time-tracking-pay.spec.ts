import { expect, test } from "@playwright/test";
import { calculateTimeSegmentPaidDays } from "@/lib/time-tracking/pay";

test("Bangkok 15:00 cutoff awards a full day to a legacy segment", () => {
  const beforeCutoff = { start_time: "2026-07-20T07:59:00.000Z", end_time: "2026-07-20T08:00:00.000Z" }; // 14:59–15:00 Asia/Bangkok
  const afterCutoff = { start_time: "2026-07-20T08:00:00.000Z", end_time: "2026-07-20T08:01:00.000Z" }; // 15:00–15:01 Asia/Bangkok

  expect(calculateTimeSegmentPaidDays(beforeCutoff)).toBe(1);
  expect(calculateTimeSegmentPaidDays(afterCutoff)).toBeCloseTo(1 / 480, 10);
});
