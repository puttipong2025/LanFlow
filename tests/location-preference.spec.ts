import { expect, test } from "@playwright/test";
import {
  readBootstrapCache,
  readLastLocationPreference,
  resolveSelectedLocationId,
  writeBootstrapCache,
  writeLastLocationPreference,
} from "../src/lib/lanflow/bootstrap-cache";
import {
  resolveBranchConfirmationMinutes,
} from "../src/lib/lanflow/branch-create-guard";
import type { Location, Profile } from "../src/types";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

test.describe("last location preference", () => {
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

  test("stores a separate location for each account", () => {
    writeLastLocationPreference("user-a", "location-a");
    writeLastLocationPreference("user-b", "location-b");

    expect(readLastLocationPreference("user-a")).toBe("location-a");
    expect(readLastLocationPreference("user-b")).toBe("location-b");
  });

  test("uses the preferred accessible location and falls back when access is gone", () => {
    const locations = [
      { id: "location-a", active: true },
      { id: "location-b", active: true },
      { id: "location-c", active: true },
    ];

    expect(resolveSelectedLocationId(locations, ["location-a", "location-b"], "location-b"))
      .toBe("location-b");
    expect(resolveSelectedLocationId(locations, ["location-a"], "location-b"))
      .toBe("location-a");
    expect(resolveSelectedLocationId(locations, [], "location-b")).toBe("");
  });

  test("does not restore or fall back to an inactive location", () => {
    const locations = [
      { id: "retired-location", active: false },
      { id: "chanauman", active: true },
    ];

    expect(resolveSelectedLocationId(
      locations,
      ["retired-location", "chanauman"],
      "retired-location",
    )).toBe("chanauman");
  });

  test("keeps a valid cached confirmation duration and defaults old caches to 15", () => {
    const locations: Location[] = [{ id: "location-a", name: "A", code: "A1", active: true }];
    const profile: Profile = {
      id: "user-a", name: "A", phone: "0800000000", role: "admin", isActive: true,
      locationIds: ["location-a"], primaryLocationId: "location-a",
    };
    localStorage.setItem("lanflow_bootstrap_cache:user-a", JSON.stringify({
      locations, profile, selectedLocationId: "location-a",
    }));
    expect(readBootstrapCache("user-a")?.confirmationMinutes).toBe(15);

    writeBootstrapCache("user-a", {
      locations, profile, selectedLocationId: "location-a", confirmationMinutes: 30,
    });
    expect(readBootstrapCache("user-a")?.confirmationMinutes).toBe(30);
    expect(resolveBranchConfirmationMinutes(null, 30)).toBe(30);
    expect(resolveBranchConfirmationMinutes(45, 30)).toBe(45);
    expect(resolveBranchConfirmationMinutes(0, 30)).toBe(30);
    expect(resolveBranchConfirmationMinutes(null, 121)).toBe(15);
  });
});
