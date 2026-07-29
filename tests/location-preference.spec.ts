import { expect, test } from "@playwright/test";
import {
  readLastLocationPreference,
  resolveSelectedLocationId,
  writeLastLocationPreference,
} from "../src/lib/lanflow/bootstrap-cache";

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
      { id: "location-a" },
      { id: "location-b" },
      { id: "location-c" },
    ];

    expect(resolveSelectedLocationId(locations, ["location-a", "location-b"], "location-b"))
      .toBe("location-b");
    expect(resolveSelectedLocationId(locations, ["location-a"], "location-b"))
      .toBe("location-a");
    expect(resolveSelectedLocationId(locations, [], "location-b")).toBe("");
  });
});
