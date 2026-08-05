import { expect, test } from "@playwright/test";
import {
  bangkokDateString,
  bangkokDateTimeLocalValue,
  bangkokWallClockToUtcIso,
  formatBangkokDateTime,
  formatBangkokTime,
  normalizeBangkokDateTime,
  nextBangkokCutoff,
  isAtOrAfterBangkokHour,
} from "../src/lib/bangkok-date";

test.use({ timezoneId: "UTC" });

test.describe("Bangkok business date primitives", () => {
  for (const [instant, expected] of [
    ["2026-08-03T16:59:59.999Z", "2026-08-03"],
    ["2026-08-03T17:00:00.000Z", "2026-08-04"],
  ] as const) {
    test(`projects ${instant} to ${expected}`, () => {
      expect(bangkokDateString(new Date(instant))).toBe(expected);
    });
  }

  test("round-trips Bangkok datetime-local without using the machine timezone", () => {
    const instant = "2026-08-03T17:00:00.000Z";
    expect(bangkokDateTimeLocalValue(instant)).toBe("2026-08-04T00:00");
    expect(bangkokWallClockToUtcIso("2026-08-04T00:00")).toBe(instant);
  });

  test("normalizes timezone-less OCR timestamps as Bangkok wall-clock", () => {
    expect(normalizeBangkokDateTime("2026-08-04T00:00:00")).toBe("2026-08-03T17:00:00.000Z");
    expect(normalizeBangkokDateTime("2026-08-03T17:00:00Z")).toBe("2026-08-03T17:00:00.000Z");
    expect(normalizeBangkokDateTime(null)).toBeNull();
  });

  test("formats timestamps explicitly in Bangkok", () => {
    const instant = "2026-08-03T17:05:00.000Z";
    expect(formatBangkokTime(instant)).toBe("00:05");
    expect(formatBangkokDateTime(instant)).toContain("00:05");
  });

  test("uses one Bangkok 15:00 cutoff independent of the browser timezone", () => {
    expect(nextBangkokCutoff("2026-08-04T07:59:59.999Z").toISOString()).toBe("2026-08-04T08:00:00.000Z");
    expect(nextBangkokCutoff("2026-08-04T08:00:00.000Z").toISOString()).toBe("2026-08-05T08:00:00.000Z");
    expect(isAtOrAfterBangkokHour("2026-08-04T07:59:59.999Z", 15)).toBe(false);
    expect(isAtOrAfterBangkokHour("2026-08-04T08:00:00.000Z", 15)).toBe(true);
  });
});
