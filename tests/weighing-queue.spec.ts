import { expect, test } from "@playwright/test";

import {
  buildWeighingQueueTicket,
  createEmptyDailyQueue,
  hasQueueItemChangedSinceShare,
  isQueueForCurrentBangkokDay,
  loadCustomerCache,
  loadDailyWeighingQueue,
  markQueueItemShared,
  moveQueueItem,
  removeQueueItem,
  renderWeighingQueueTicketHtml,
  saveCustomerCache,
  saveDailyWeighingQueue,
  type WeighingQueueItem,
} from "../src/lib/rubber-bills/weighing-queue";

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

function queueItem(id: string, customerName = "ลูกค้า"): WeighingQueueItem {
  return {
    id,
    customerId: null,
    customerName,
    createdAt: "2026-07-25T01:00:00.000Z",
    printSnapshot: null,
  };
}

test.describe("Device-local weighing queue", () => {
  test("persists per device and branch, then resets on the next Bangkok day", () => {
    const storage = new MemoryStorage();
    const firstDay = new Date("2026-07-25T10:00:00.000Z");
    const queue = {
      ...createEmptyDailyQueue(firstDay),
      weighingTime: "14:00",
      items: [queueItem("one")],
    };

    saveDailyWeighingQueue("device-a", "branch-a", queue, storage);

    expect(loadDailyWeighingQueue("device-a", "branch-a", firstDay, storage)).toEqual(queue);
    expect(loadDailyWeighingQueue("device-a", "branch-b", firstDay, storage).items).toEqual([]);

    const nextDay = loadDailyWeighingQueue(
      "device-a",
      "branch-a",
      new Date("2026-07-25T17:01:00.000Z"),
      storage,
    );
    expect(nextDay.date).toBe("2026-07-26");
    expect(nextDay.weighingTime).toBeNull();
    expect(nextDay.items).toEqual([]);
    expect(isQueueForCurrentBangkokDay(queue, firstDay)).toBe(true);
    expect(isQueueForCurrentBangkokDay(queue, new Date("2026-07-25T17:01:00.000Z"))).toBe(false);
  });

  test("keeps only the latest customer snapshot and expires it after seven days", () => {
    const storage = new MemoryStorage();
    const cachedAt = new Date("2026-07-25T00:00:00.000Z");

    saveCustomerCache("device-a", [
      { id: "one", mainName: "ลูกค้าเดิม", legacyMemberId: "M001" },
    ], cachedAt, storage);
    saveCustomerCache("device-a", [
      {
        id: "two",
        mainName: "ลูกค้าใหม่",
        legacyMemberId: null,
        class: "สาขาใหญ่จ่าย",
        farmAddress: "สวนทดสอบ",
      },
    ], new Date("2026-07-26T00:00:00.000Z"), storage);

    expect(loadCustomerCache("device-a", new Date("2026-08-01T00:00:00.000Z"), storage)).toEqual([
      {
        id: "two",
        mainName: "ลูกค้าใหม่",
        legacyMemberId: null,
        class: "สาขาใหญ่จ่าย",
        farmAddress: "สวนทดสอบ",
      },
    ]);
    expect(loadCustomerCache("device-a", new Date("2026-08-02T00:00:00.001Z"), storage)).toEqual([]);
  });

  test("allows duplicate customer names and moves rows without changing their identity", () => {
    const first = queueItem("one", "ชื่อซ้ำ");
    const second = queueItem("two", "ชื่อซ้ำ");
    const third = queueItem("three", "อีกคน");

    expect(moveQueueItem([first, second, third], "three", "one").map((item) => item.id)).toEqual([
      "three",
      "one",
      "two",
    ]);
  });

  test("warns only when the current number or weighing time differs from the last share", () => {
    const sharedAt = new Date("2026-07-25T07:10:00.000Z");
    const [shared] = markQueueItemShared([queueItem("one")], "one", 1, "14:00", sharedAt);

    expect(hasQueueItemChangedSinceShare(shared, 1, "14:00")).toBe(false);
    expect(hasQueueItemChangedSinceShare(shared, 2, "14:00")).toBe(true);
    expect(hasQueueItemChangedSinceShare(shared, 1, "15:00")).toBe(true);
  });

  test("deletes a row and exposes the renumbered shared row as changed", () => {
    const first = queueItem("one");
    const [second] = markQueueItemShared([queueItem("two")], "two", 2, "14:00", new Date());
    const remaining = removeQueueItem([first, second], "one");

    expect(remaining.map((item) => item.id)).toEqual(["two"]);
    expect(hasQueueItemChangedSinceShare(remaining[0], 1, "14:00")).toBe(true);
  });

  test("renders an escaped 80mm ticket with Bangkok issue time", () => {
    const item = queueItem("one", "<ร้าน & ลูกค้า>");
    const ticket = buildWeighingQueueTicket(
      item,
      7,
      "14:00",
      new Date("2026-07-25T07:10:00.000Z"),
    );
    const html = renderWeighingQueueTicketHtml(ticket);

    expect(ticket).toEqual({
      queueNumber: 7,
      customerName: "<ร้าน & ลูกค้า>",
      weighingTime: "14:00",
      printedDate: "25/07/2569",
      printedTime: "14:10",
    });
    expect(html).toContain("@page { size: 80mm auto;");
    expect(html).toContain(">07<");
    expect(html).toContain("&lt;ร้าน &amp; ลูกค้า&gt;");
    expect(html).not.toContain("<ร้าน & ลูกค้า>");
    expect(html).toContain("14:00 น.");
    expect(html).toContain("25/07/2569 เวลา 14:10 น.");
  });
});
