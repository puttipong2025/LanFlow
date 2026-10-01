import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  millisecondsUntilNextActionableBadgeRefresh,
  millisecondsUntilNextPayrollCutoff,
  millisecondsUntilNextPayrollRefresh,
} from "@/lib/time-tracking/payroll-cutoff-refresh";

const actionableBadgeSource = readFileSync(resolve("src/hooks/useActionableBadges.ts"), "utf8");

test("schedules the manager refresh at the Bangkok month-end cutoff", () => {
  expect(millisecondsUntilNextPayrollCutoff(
    new Date("2026-09-30T15:00:00+07:00"),
    "16:00",
  )).toBe(3_601_000);
});

test("moves the refresh to next month after the current cutoff", () => {
  const now = new Date("2026-09-30T16:00:02+07:00");
  const next = new Date("2026-10-31T16:00:01+07:00");
  expect(millisecondsUntilNextPayrollCutoff(now, "16:00")).toBe(next.getTime() - now.getTime());
});

test("ignores an invalid cutoff instead of starting a busy timer", () => {
  expect(millisecondsUntilNextPayrollCutoff(new Date("2026-09-30T15:00:00+07:00"), "bad")).toBeNull();
});

test("refreshes at midnight when a scheduled END becomes effective before month-end", () => {
  const now = new Date("2026-09-14T23:59:00+07:00");
  expect(millisecondsUntilNextPayrollRefresh(now, "16:00", ["2026-09-15"]))
    .toBe(new Date("2026-09-15T00:00:01+07:00").getTime() - now.getTime());
});

test("refreshes when a pending cutoff setting becomes effective", () => {
  const now = new Date("2026-09-29T23:59:00+07:00");
  expect(millisecondsUntilNextPayrollRefresh(now, "16:00", [], "2026-09-30"))
    .toBe(new Date("2026-09-30T00:00:01+07:00").getTime() - now.getTime());
});

test("shortens the global badge poll to the exact payroll boundary", () => {
  expect(millisecondsUntilNextActionableBadgeRefresh(
    new Date("2026-09-30T15:59:51+07:00"),
    "16:00",
  )).toBe(10_000);
  expect(millisecondsUntilNextActionableBadgeRefresh(
    new Date("2026-09-30T15:00:00+07:00"),
    "16:00",
  )).toBe(60_000);
  expect(actionableBadgeSource).toContain('supabase.rpc("get_time_payroll_settings")');
  expect(actionableBadgeSource).toContain("millisecondsUntilNextActionableBadgeRefresh");
});
