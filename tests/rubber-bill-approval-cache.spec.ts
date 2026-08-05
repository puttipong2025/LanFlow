import { expect, test } from "@playwright/test";

import {
  loadRubberBillApprovalSettingsCache,
  saveRubberBillApprovalSettingsCache,
} from "../src/lib/rubber-bills/approval";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

test.describe("Rubber Bill approval settings cache", () => {
  test("retains an explicit null cap without expiry", () => {
    const storage = memoryStorage();
    saveRubberBillApprovalSettingsCache(
      { editWindowMinutes: 30, configuredPrice: null, nonCurrentDateRequiresApproval: false },
      new Date("2020-01-01T00:00:00.000Z"),
      storage
    );

    expect(loadRubberBillApprovalSettingsCache(storage)).toEqual({
      editWindowMinutes: 30,
      configuredPrice: null,
      nonCurrentDateRequiresApproval: false,
      cachedAt: "2020-01-01T00:00:00.000Z",
    });
  });

  test("overwrites the prior snapshot and accepts a zero cap", () => {
    const storage = memoryStorage();
    saveRubberBillApprovalSettingsCache(
      { editWindowMinutes: 30, configuredPrice: 20, nonCurrentDateRequiresApproval: false },
      new Date("2026-07-25T00:00:00.000Z"),
      storage
    );
    saveRubberBillApprovalSettingsCache(
      { editWindowMinutes: 0, configuredPrice: 0, nonCurrentDateRequiresApproval: true },
      new Date("2026-07-25T01:00:00.000Z"),
      storage
    );

    expect(loadRubberBillApprovalSettingsCache(storage)).toEqual({
      editWindowMinutes: 0,
      configuredPrice: 0,
      nonCurrentDateRequiresApproval: true,
      cachedAt: "2026-07-25T01:00:00.000Z",
    });
  });
});
