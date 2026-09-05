import { expect, test } from "@playwright/test";

import {
  bangkokDateTimeInput,
  bangkokDateTimeInputToIso,
  currentBangkokDateTimeAfter,
  currentBangkokDateTimeNotBefore,
  initialWexTruckInboundAt,
} from "../src/lib/export-vehicle-weigh-bills/timing";

test("formats and parses WEX wall-clock times in Asia/Bangkok", () => {
  const instant = new Date("2026-09-05T03:04:05.000Z");

  expect(bangkokDateTimeInput(instant)).toBe("2026-09-05T10:04");
  expect(bangkokDateTimeInput(instant, true)).toBe("2026-09-05T10:04:05");
  expect(bangkokDateTimeInputToIso("2026-09-05T10:04:05")).toBe(instant.toISOString());
  expect(bangkokDateTimeInputToIso("2026-02-30T10:04")).toBeNull();
});

test("defaults a new truck inbound time to two hours before modal open", () => {
  expect(initialWexTruckInboundAt(new Date("2026-09-05T07:37:42.000Z")))
    .toBe("2026-09-05T12:37");
  expect(initialWexTruckInboundAt(new Date("2026-09-04T18:30:42.000Z")))
    .toBe("2026-09-04T23:30");
});

test("uses the actual Bangkok time only when it follows every prior WEX event", () => {
  const now = new Date("2026-09-05T03:04:05.000Z");

  expect(currentBangkokDateTimeAfter(["2026-09-05T10:04"], now)).toBe("2026-09-05T10:04:05");
  expect(currentBangkokDateTimeAfter(["2026-09-05T10:04:05"], now)).toBe("");
  expect(currentBangkokDateTimeAfter(["2026-09-05T10:04:06"], now)).toBe("");
});

test("allows simultaneous cross-line events without inventing a future second", () => {
  const now = new Date("2026-09-05T03:04:05.000Z");

  expect(currentBangkokDateTimeNotBefore("2026-09-05T10:04:05", now)).toBe("2026-09-05T10:04:05");
  expect(currentBangkokDateTimeNotBefore("2026-09-05T10:04:06", now)).toBe("");
});

test("keeps Bangkok wall-clock conversion correct across a day boundary", () => {
  expect(bangkokDateTimeInput(new Date("2026-09-05T17:00:01.000Z"), true))
    .toBe("2026-09-06T00:00:01");
  expect(bangkokDateTimeInputToIso("2026-09-06T00:00:01"))
    .toBe("2026-09-05T17:00:01.000Z");
});
