import { expect, test } from "@playwright/test";

import {
  DEFAULT_RUBBER_WEIGHT_ALERT_CONFIG,
  parseRubberWeightAlertCheck,
  readRubberWeightAlertLastCheckedAt,
  resolveRubberWeightAlertConfig,
  rubberWeightAlertDelayMs,
  writeRubberWeightAlertLastCheckedAt,
} from "../src/lib/lanflow/rubber-weight-alert";
import { parseRubberWeightAlertGroupBody } from "../src/lib/server/rubber-weight-alert-groups";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

test.describe("rubber weight alert browser state", () => {
  const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

  test.beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: new MemoryStorage(),
    });
  });

  test.afterEach(() => {
    if (originalLocalStorage) {
      Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
    } else {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  });

  test("stores one timestamp per account and rejects corrupt or future values", () => {
    writeRubberWeightAlertLastCheckedAt("admin-a", 1_000);
    writeRubberWeightAlertLastCheckedAt("admin-b", 2_000);

    expect(readRubberWeightAlertLastCheckedAt("admin-a", 3_000)).toBe(1_000);
    expect(readRubberWeightAlertLastCheckedAt("admin-b", 3_000)).toBe(2_000);
    localStorage.setItem("lanflow:rubber-weight-alert:last-checked:v1:admin-a", "broken");
    expect(readRubberWeightAlertLastCheckedAt("admin-a", 3_000)).toBeNull();
    localStorage.setItem("lanflow:rubber-weight-alert:last-checked:v1:admin-a", "4000");
    expect(readRubberWeightAlertLastCheckedAt("admin-a", 3_000)).toBeNull();
  });

  test("is due once at the exact interval boundary", () => {
    expect(rubberWeightAlertDelayMs(null, 15, 100_000)).toBe(0);
    expect(rubberWeightAlertDelayMs(100_000, 15, 100_000)).toBe(900_000);
    expect(rubberWeightAlertDelayMs(100_000, 15, 999_999)).toBe(1);
    expect(rubberWeightAlertDelayMs(100_000, 15, 1_000_000)).toBe(0);
    expect(rubberWeightAlertDelayMs(200_000, 15, 100_000)).toBe(0);
  });

  test("uses valid config and rejects malformed check payloads", () => {
    expect(resolveRubberWeightAlertConfig(
      { thresholdKg: 25_000, intervalMinutes: 120 },
    )).toEqual({ thresholdKg: 25_000, intervalMinutes: 120 });
    expect(resolveRubberWeightAlertConfig(
      { thresholdKg: 0, intervalMinutes: 120 },
    )).toEqual(DEFAULT_RUBBER_WEIGHT_ALERT_CONFIG);

    expect(parseRubberWeightAlertCheck({
      config: { thresholdKg: 10_000, intervalMinutes: 60 },
      candidates: [{
        locationId: "branch-a",
        locationName: "สาขา A",
        netWeight: 12_500.5,
      }],
    })?.candidates).toEqual([{
      locationId: "branch-a",
      locationName: "สาขา A",
      netWeight: 12_500.5,
      groupId: null,
      groupOrder: null,
      thresholdKg: null,
    }]);
    expect(parseRubberWeightAlertCheck({
      config: { thresholdKg: 10_000, intervalMinutes: 60 },
      candidates: [{
        locationId: "branch-a",
        locationName: "สาขา A",
        netWeight: 12_500.5,
        groupId: "group-a",
        groupOrder: 3,
        thresholdKg: 12_000,
      }],
    })?.candidates[0]).toMatchObject({ groupId: "group-a", groupOrder: 3, thresholdKg: 12_000 });
    expect(parseRubberWeightAlertCheck({
      config: { thresholdKg: 10_000, intervalMinutes: 60 },
      candidates: [{
        locationId: "branch-a",
        locationName: "สาขา A",
        netWeight: 12_500.5,
        groupId: "group-a",
      }],
    })).toBeNull();
    expect(parseRubberWeightAlertCheck({
      config: { thresholdKg: 10_000, intervalMinutes: 60 },
      candidates: [{ locationId: "branch-a", netWeight: Number.NaN }],
    })).toBeNull();
  });

  test("validates group membership and integer threshold input", () => {
    const locationId = crypto.randomUUID();
    expect(parseRubberWeightAlertGroupBody({ locationIds: [locationId], thresholdKg: 10_000 }))
      .toEqual({ value: { locationIds: [locationId], thresholdKg: 10_000 } });
    expect(parseRubberWeightAlertGroupBody({ locationIds: [], thresholdKg: 10_000 }))
      .toEqual({ errorMessage: "ต้องเลือกสาขาอย่างน้อยหนึ่งสาขาและห้ามซ้ำ" });
    expect(parseRubberWeightAlertGroupBody({ locationIds: [locationId], thresholdKg: 10_000.5 }))
      .toEqual({ errorMessage: "เกณฑ์ต้องอยู่ระหว่าง 1–1,000,000 กก." });
  });
});
