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
  const grouped = {
    locationId: "branch-a",
    groupId: "group-a",
    ruleSource: "group" as const,
    editWindowMinutes: 30,
    centralPrice: 42,
    priceAllowance: 3,
    effectivePriceCap: 45,
    priceRuleRevision: 1,
    nonCurrentDateRequiresApproval: false,
  };

  test("retains the authoritative central-plus-allowance formula", () => {
    const storage = memoryStorage();
    saveRubberBillApprovalSettingsCache(
      grouped,
      new Date("2020-01-01T00:00:00.000Z"),
      storage
    );

    expect(loadRubberBillApprovalSettingsCache("branch-a", storage)).toEqual({
      ...grouped,
      cachedAt: "2020-01-01T00:00:00.000Z",
    });
  });

  test("overwrites the prior snapshot and accepts a zero allowance", () => {
    const storage = memoryStorage();
    saveRubberBillApprovalSettingsCache(
      grouped,
      new Date("2026-07-25T00:00:00.000Z"),
      storage
    );
    saveRubberBillApprovalSettingsCache(
      { ...grouped, editWindowMinutes: 0, priceAllowance: 0, effectivePriceCap: 42, priceRuleRevision: 2, nonCurrentDateRequiresApproval: true },
      new Date("2026-07-25T01:00:00.000Z"),
      storage
    );

    expect(loadRubberBillApprovalSettingsCache("branch-a", storage)).toEqual({
      ...grouped,
      editWindowMinutes: 0,
      priceAllowance: 0,
      effectivePriceCap: 42,
      priceRuleRevision: 2,
      nonCurrentDateRequiresApproval: true,
      cachedAt: "2026-07-25T01:00:00.000Z",
    });
  });

  test("keeps each branch setting isolated", () => {
    const storage = memoryStorage();
    saveRubberBillApprovalSettingsCache(
      grouped,
      new Date("2026-08-23T00:00:00.000Z"),
      storage,
    );
    saveRubberBillApprovalSettingsCache(
      { ...grouped, locationId: "branch-b", groupId: null, ruleSource: "ungrouped", priceAllowance: 0, effectivePriceCap: 42, nonCurrentDateRequiresApproval: true },
      new Date("2026-08-23T01:00:00.000Z"),
      storage,
    );

    expect(loadRubberBillApprovalSettingsCache("branch-a", storage)?.effectivePriceCap).toBe(45);
    expect(loadRubberBillApprovalSettingsCache("branch-b", storage)?.ruleSource).toBe("ungrouped");
  });

  test("rejects old or corrupt shapes that could leak a price/time rule", () => {
    const storage = memoryStorage();
    storage.setItem("lanflow:rubber-bill-approval-settings:v4:branch-a", JSON.stringify({ ...grouped, effectivePriceCap: 99, cachedAt: "2026-08-23T00:00:00.000Z" }));
    expect(loadRubberBillApprovalSettingsCache("branch-a", storage)).toBeNull();

    storage.setItem("lanflow:rubber-bill-approval-settings:v4:branch-a", JSON.stringify({ ...grouped, priceRuleRevision: 0, cachedAt: "2026-08-23T00:00:00.000Z" }));
    expect(loadRubberBillApprovalSettingsCache("branch-a", storage)).toBeNull();

    storage.setItem("lanflow:rubber-bill-approval-settings:v3:branch-a", JSON.stringify({ configuredPrice: 45 }));
    expect(loadRubberBillApprovalSettingsCache("branch-a", storage)).toBeNull();
  });
});
