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
      { locationId: "branch-a", groupId: null, priceTimeExempt: true, editWindowMinutes: null, configuredPrice: null, nonCurrentDateRequiresApproval: false },
      new Date("2020-01-01T00:00:00.000Z"),
      storage
    );

    expect(loadRubberBillApprovalSettingsCache("branch-a", storage)).toEqual({
      locationId: "branch-a",
      groupId: null,
      priceTimeExempt: true,
      editWindowMinutes: null,
      configuredPrice: null,
      nonCurrentDateRequiresApproval: false,
      cachedAt: "2020-01-01T00:00:00.000Z",
    });
  });

  test("overwrites the prior snapshot and accepts a zero cap", () => {
    const storage = memoryStorage();
    saveRubberBillApprovalSettingsCache(
      { locationId: "branch-a", groupId: "group-a", priceTimeExempt: false, editWindowMinutes: 30, configuredPrice: 20, nonCurrentDateRequiresApproval: false },
      new Date("2026-07-25T00:00:00.000Z"),
      storage
    );
    saveRubberBillApprovalSettingsCache(
      { locationId: "branch-a", groupId: "group-a", priceTimeExempt: false, editWindowMinutes: 0, configuredPrice: 0, nonCurrentDateRequiresApproval: true },
      new Date("2026-07-25T01:00:00.000Z"),
      storage
    );

    expect(loadRubberBillApprovalSettingsCache("branch-a", storage)).toEqual({
      locationId: "branch-a",
      groupId: "group-a",
      priceTimeExempt: false,
      editWindowMinutes: 0,
      configuredPrice: 0,
      nonCurrentDateRequiresApproval: true,
      cachedAt: "2026-07-25T01:00:00.000Z",
    });
  });

  test("keeps each branch setting isolated", () => {
    const storage = memoryStorage();
    saveRubberBillApprovalSettingsCache(
      { locationId: "branch-a", groupId: "group-a", priceTimeExempt: false, editWindowMinutes: 30, configuredPrice: 20, nonCurrentDateRequiresApproval: false },
      new Date("2026-08-23T00:00:00.000Z"),
      storage,
    );
    saveRubberBillApprovalSettingsCache(
      { locationId: "branch-b", groupId: null, priceTimeExempt: true, editWindowMinutes: null, configuredPrice: null, nonCurrentDateRequiresApproval: true },
      new Date("2026-08-23T01:00:00.000Z"),
      storage,
    );

    expect(loadRubberBillApprovalSettingsCache("branch-a", storage)?.configuredPrice).toBe(20);
    expect(loadRubberBillApprovalSettingsCache("branch-b", storage)?.priceTimeExempt).toBe(true);
  });

  test("rejects old or corrupt shapes that could leak a price/time rule", () => {
    const storage = memoryStorage();
    storage.setItem("lanflow:rubber-bill-approval-settings:v3:branch-a", JSON.stringify({
      locationId: "branch-a", groupId: null, priceTimeExempt: true, editWindowMinutes: 30, configuredPrice: null,
      nonCurrentDateRequiresApproval: false, cachedAt: "2026-08-23T00:00:00.000Z",
    }));
    expect(loadRubberBillApprovalSettingsCache("branch-a", storage)).toBeNull();

    storage.setItem("lanflow:rubber-bill-approval-settings:v3:branch-a", JSON.stringify({
      locationId: "branch-a", groupId: "group-a", priceTimeExempt: false, editWindowMinutes: null, configuredPrice: null,
      nonCurrentDateRequiresApproval: false, cachedAt: "2026-08-23T00:00:00.000Z",
    }));
    expect(loadRubberBillApprovalSettingsCache("branch-a", storage)).toBeNull();
  });
});
