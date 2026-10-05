import { expect, test } from "@playwright/test";

import {
  commitWeighingAppointmentNumber,
  getWeighingAppointmentCounterKey,
  previewWeighingAppointmentNumber,
  reserveWeighingAppointmentNumber,
  rollbackWeighingAppointmentNumber,
} from "../src/lib/rubber-bills/weighing-appointment-counter";

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

class UnreadableStorage extends MemoryStorage {
  override getItem(): string | null {
    throw new Error("blocked");
  }
}

class UnwritableStorage extends MemoryStorage {
  override setItem(): void {
    throw new Error("blocked");
  }
}

class MismatchedReadbackStorage extends MemoryStorage {
  override setItem(key: string, value: string): void {
    super.setItem(key, `${value} `);
  }
}

class ToggleWriteStorage extends MemoryStorage {
  blocked = false;

  override setItem(key: string, value: string): void {
    if (this.blocked) throw new Error("blocked");
    super.setItem(key, value);
  }
}

const firstDay = new Date("2026-07-25T10:00:00.000Z");
const nextBangkokDay = new Date("2026-07-25T17:01:00.000Z");

test.describe("Weighing appointment counter", () => {
  test("persists independently per storage bucket and location, then resets on the next Bangkok day", () => {
    const storage = new MemoryStorage();
    const otherDeviceStorage = new MemoryStorage();
    const scope = { locationId: "branch-a", storage };

    expect(previewWeighingAppointmentNumber({ ...scope, now: firstDay })).toBe(1);
    expect(
      reserveWeighingAppointmentNumber({
        ...scope,
        expectedNumber: 1,
        token: "first",
        now: firstDay,
      }),
    ).toEqual({ kind: "reserved", number: 1 });
    commitWeighingAppointmentNumber({ ...scope, token: "first", now: firstDay });

    expect(previewWeighingAppointmentNumber({ ...scope, now: firstDay })).toBe(2);
    expect(
      previewWeighingAppointmentNumber({
        ...scope,
        storage: otherDeviceStorage,
        now: firstDay,
      }),
    ).toBe(1);
    expect(
      previewWeighingAppointmentNumber({
        ...scope,
        locationId: "branch-b",
        now: firstDay,
      }),
    ).toBe(1);
    expect(previewWeighingAppointmentNumber({ ...scope, now: nextBangkokDay })).toBe(1);

    reserveWeighingAppointmentNumber({
      ...scope,
      expectedNumber: 1,
      token: "next-day",
      now: nextBangkokDay,
    });
    commitWeighingAppointmentNumber({ ...scope, token: "next-day", now: nextBangkokDay });
    expect(storage.length).toBe(1);
    expect(JSON.parse(storage.getItem(
      getWeighingAppointmentCounterKey(scope.locationId),
    ) ?? "null")).toMatchObject({ date: "2026-07-26", lastIssued: 1 });
  });

  test("rolls back a normal cancellation without consuming its number", () => {
    const storage = new MemoryStorage();
    const scope = { locationId: "branch-a", storage, now: firstDay };

    reserveWeighingAppointmentNumber({
      ...scope,
      expectedNumber: 1,
      token: "cancelled",
    });
    rollbackWeighingAppointmentNumber({ ...scope, token: "cancelled" });

    expect(previewWeighingAppointmentNumber(scope)).toBe(1);
  });

  test("turns a stale pending reservation into a gap and requires the refreshed preview", () => {
    const storage = new MemoryStorage();
    const scope = { locationId: "branch-a", storage, now: firstDay };

    reserveWeighingAppointmentNumber({
      ...scope,
      expectedNumber: 1,
      token: "crashed-tab",
    });

    expect(previewWeighingAppointmentNumber(scope)).toBe(2);
    expect(
      reserveWeighingAppointmentNumber({
        ...scope,
        expectedNumber: 1,
        token: "new-tab",
      }),
    ).toEqual({ kind: "changed", nextNumber: 2 });
    expect(
      reserveWeighingAppointmentNumber({
        ...scope,
        expectedNumber: 2,
        token: "new-tab",
      }),
    ).toEqual({ kind: "reserved", number: 2 });
  });

  test("fails closed for corrupt, unsupported, out-of-range, and unreadable storage", () => {
    const storage = new MemoryStorage();
    const scope = { locationId: "branch-a", storage, now: firstDay };
    const key = getWeighingAppointmentCounterKey(scope.locationId);

    for (const raw of [
      "not-json",
      JSON.stringify({ version: 2, date: "2026-07-25", lastIssued: 0, pending: null }),
      JSON.stringify({ version: 1, date: "2026-07-25", lastIssued: 10_000, pending: null }),
      JSON.stringify({ version: 1, date: "2026-99-99", lastIssued: 0, pending: null }),
      JSON.stringify({ version: 1, date: "2026-07-25", lastIssued: 0, pending: null, extra: true }),
    ]) {
      storage.setItem(key, raw);
      expect(() => previewWeighingAppointmentNumber(scope)).toThrow();
    }

    const unreadable = new UnreadableStorage();
    expect(() => previewWeighingAppointmentNumber({ ...scope, storage: unreadable })).toThrow();
    expect(() => reserveWeighingAppointmentNumber({
      ...scope,
      storage: new UnwritableStorage(),
      expectedNumber: 1,
      token: "blocked",
    })).toThrow();
    expect(() => reserveWeighingAppointmentNumber({
      ...scope,
      storage: new MismatchedReadbackStorage(),
      expectedNumber: 1,
      token: "mismatch",
    })).toThrow();
  });

  test("rejects number 10,000 and a mismatched reservation token", () => {
    const storage = new MemoryStorage();
    const scope = { locationId: "branch-a", storage, now: firstDay };
    reserveWeighingAppointmentNumber({ ...scope, expectedNumber: 1, token: "owner" });

    expect(() => commitWeighingAppointmentNumber({ ...scope, token: "other" })).toThrow();
    commitWeighingAppointmentNumber({ ...scope, token: "owner" });

    const key = getWeighingAppointmentCounterKey(scope.locationId);
    storage.setItem(key, JSON.stringify({
      version: 1,
      date: "2026-07-25",
      lastIssued: 9_999,
      pending: null,
    }));
    expect(() => previewWeighingAppointmentNumber(scope)).toThrow("9,999");
  });

  test("keeps a pending reservation when commit or cleanup cannot be written", () => {
    for (const finish of [commitWeighingAppointmentNumber, rollbackWeighingAppointmentNumber]) {
      const storage = new ToggleWriteStorage();
      const scope = { locationId: "branch-a", storage, now: firstDay };
      reserveWeighingAppointmentNumber({ ...scope, expectedNumber: 1, token: "owner" });
      storage.blocked = true;
      expect(() => finish({ ...scope, token: "owner" })).toThrow();
      storage.blocked = false;
      expect(previewWeighingAppointmentNumber(scope)).toBe(2);
    }
  });
});
