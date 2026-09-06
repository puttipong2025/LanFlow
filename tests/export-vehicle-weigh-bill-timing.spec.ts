import { expect, test } from "@playwright/test";

import {
  addRandomMinutes,
  bangkokDateTimeInput,
  bangkokDateTimeInputToIso,
  initialWexTruckInboundAt,
} from "../src/lib/export-vehicle-weigh-bills/timing";

test("formats and parses WEX wall-clock times in Asia/Bangkok", () => {
  const instant = new Date("2026-09-05T03:04:05.000Z");

  expect(bangkokDateTimeInput(instant)).toBe("2026-09-05T10:04");
  expect(bangkokDateTimeInputToIso("2026-09-05T10:04:05")).toBe(instant.toISOString());
  expect(bangkokDateTimeInputToIso("2026-02-30T10:04")).toBeNull();
});

test("defaults a new truck inbound time to two hours before modal open", () => {
  expect(initialWexTruckInboundAt(new Date("2026-09-05T07:37:42.000Z")))
    .toBe("2026-09-05T12:37");
  expect(initialWexTruckInboundAt(new Date("2026-09-04T18:30:42.000Z")))
    .toBe("2026-09-04T23:30");
});

test("adds inclusive whole random minutes to a Bangkok wall-clock time", () => {
  expect(addRandomMinutes("2026-09-05T23:59", 1, 3, () => 0)).toBe("2026-09-06T00:00");
  expect(addRandomMinutes("2026-09-05T23:59", 1, 3, () => 0.999_999)).toBe("2026-09-06T00:02");
  expect(addRandomMinutes("2026-09-05T10:00", 30, 180, () => 0)).toBe("2026-09-05T10:30");
  expect(addRandomMinutes("2026-09-05T10:00", 30, 180, () => 0.999_999)).toBe("2026-09-05T13:00");
});

test("rejects invalid calculated-time inputs instead of creating Invalid Date", () => {
  expect(addRandomMinutes("", 1, 3, () => 0)).toBe("");
  expect(addRandomMinutes("2026-02-30T10:00", 1, 3, () => 0)).toBe("");
  expect(addRandomMinutes("2026-09-05T10:00", 3, 1, () => 0)).toBe("");
  expect(addRandomMinutes("2026-09-05T10:00", 1.5, 3, () => 0)).toBe("");
  expect(addRandomMinutes("2026-09-05T10:00", 1, 3, () => 1)).toBe("");
});

test("keeps Bangkok wall-clock conversion correct across a day boundary", () => {
  expect(bangkokDateTimeInput(new Date("2026-09-05T17:00:01.000Z")))
    .toBe("2026-09-06T00:00");
  expect(bangkokDateTimeInputToIso("2026-09-06T00:00:01"))
    .toBe("2026-09-05T17:00:01.000Z");
});
