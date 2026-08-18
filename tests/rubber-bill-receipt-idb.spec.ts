import { expect, test } from "@playwright/test";
import { IDBFactory } from "fake-indexeddb";

import {
  enqueueSyncEvent,
  getPendingEvents,
  getRubberBillReceiptSnapshots,
  pruneRubberBillReceiptSnapshots,
  putRubberBillReceiptSnapshot,
  putRubberBillReceiptSnapshots,
  type RubberBillReceiptSnapshot,
  type SyncEvent,
} from "../src/lib/idb-queue";
import type { RubberBill } from "../src/types";

const DB_NAME = "lanflow_sync_db";

function resetIndexedDb() {
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: new IDBFactory(),
    writable: true,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: globalThis,
    writable: true,
  });
}

function openDatabase(name: string, version?: number) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = version === undefined
      ? indexedDB.open(name)
      : indexedDB.open(name, version);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function makeBill(id: string, locationId: string): RubberBill {
  return {
    id,
    clientTempId: `client-${id}`,
    localBillNo: `LOCAL-${id}`,
    serverBillNo: `SERVER-${id}`,
    syncStatus: "synced",
    idempotencyKey: `server:${id}`,
    locationId,
    billNo: `SERVER-${id}`,
    billDate: "2026-07-25",
    customerName: `ลูกค้า ${id}`,
    billType: "บิลเครื่องชั่งเล็ก",
    deductWeight: 0,
    weight: 10,
    netWeight: 10,
    weighValueTotal: 200,
    rubberValue: 200,
    price: 20,
    deductionTotal: 0,
    payableBeforeRounding: 200,
    netTotal: 200,
    acidPackCount: 0,
    configuredPriceSnapshot: 20,
    approvalState: "not_required",
    approvalApprovedByName: null,
    approvalRevisionNo: null,
    weighItems: [{
      id: `weigh-${id}`,
      label: "ชั่ง1",
      inWeight: 20,
      outWeight: 10,
      netWeight: 10,
      price: 20,
    }],
    createdByUserId: "user-1",
    createdByName: "พนักงานทดสอบ",
    createdByPhone: "",
    clientCreatedAt: "2026-07-25T00:00:00.000Z",
    clientRecordedAt: "2026-07-25T00:00:00.000Z",
    serverReceivedAt: "2026-07-25T00:00:00.000Z",
    revisionNo: 1,
    recordStatus: "active",
  };
}

function makeSnapshot(
  id: string,
  locationId: string,
  serverReceivedAt: string
): RubberBillReceiptSnapshot {
  const bill = makeBill(id, locationId);
  return {
    billId: id,
    locationId,
    serverBillNo: bill.serverBillNo!,
    serverReceivedAt,
    revisionNo: bill.revisionNo,
    bill: { ...bill, serverReceivedAt },
    receipt: {
      receiptKind: "synced",
      referenceLabel: "เลขบิล",
      referenceNo: bill.serverBillNo!,
      billDate: bill.billDate,
      customerName: bill.customerName,
      approvalLabel: "ไม่ต้องอนุมัติ",
      hasZeroPrice: false,
      weighItems: [{
        label: "ชั่ง1",
        inWeight: 20,
        outWeight: 10,
        netWeight: 10,
        price: 20,
        lineTotal: 200,
      }],
      deductions: [],
      totalWeight: bill.weight,
      deductWeight: bill.deductWeight,
      netWeight: 10,
      rubberValue: 200,
      averagePrice: 20,
      deductionTotal: 0,
      netTotal: 200,
      netTotalText: "สองร้อยบาทถ้วน",
    },
  };
}

test.describe.serial("Rubber Bill receipt IndexedDB", () => {
  test.beforeEach(() => resetIndexedDb());

  test("upgrades version 3 to 4 without changing sync_queue records", async () => {
    const originalEvents: SyncEvent[] = [
      {
        queueId: 1,
        id: "rubber-1",
        entity: "rubber_bills",
        ownerUserId: "user-1",
        locationId: "location-a",
        operation: "create",
        payload: { customerName: "หนึ่ง", configuredPriceSnapshot: 20 },
        timestamp: 1,
        status: "pending",
      },
      {
        queueId: 2,
        id: "rubber-2",
        entity: "rubber_bills",
        ownerUserId: "user-1",
        locationId: "location-a",
        operation: "update",
        payload: { customerName: "สอง", nested: { value: 2 } },
        timestamp: 2,
        status: "failed",
        errorMessage: "เดิม",
      },
    ];

    const request = indexedDB.open(DB_NAME, 3);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("sync_queue", {
        keyPath: "queueId",
        autoIncrement: true,
      });
      store.createIndex("entity", "entity");
      store.createIndex("id", "id");
      store.createIndex("status", "status");
      store.createIndex("ownerUserId", "ownerUserId");
      store.createIndex("locationId", "locationId");
    };
    const dbV3 = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = dbV3.transaction("sync_queue", "readwrite");
      const store = transaction.objectStore("sync_queue");
      originalEvents.forEach((event) => store.put(event));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    dbV3.close();

    expect(await getRubberBillReceiptSnapshots("location-a")).toEqual([]);

    const dbV4 = await openDatabase(DB_NAME);
    expect(dbV4.version).toBe(4);
    expect(Array.from(dbV4.objectStoreNames)).toContain("rubber_bill_receipts");
    const actualEvents = await new Promise<SyncEvent[]>((resolve, reject) => {
      const transaction = dbV4.transaction("sync_queue", "readonly");
      const requestAll = transaction.objectStore("sync_queue").getAll();
      requestAll.onsuccess = () => resolve(requestAll.result as SyncEvent[]);
      requestAll.onerror = () => reject(requestAll.error);
    });
    dbV4.close();

    expect(actualEvents).toEqual(originalEvents);
  });

  test("keeps the latest 100 of 101 receipts and deletes only the oldest", async () => {
    for (let index = 0; index < 101; index += 1) {
      const id = `bill-${String(index).padStart(3, "0")}`;
      await putRubberBillReceiptSnapshot(
        makeSnapshot(
          id,
          "location-a",
          new Date(Date.UTC(2026, 6, 25, 0, 0, index)).toISOString()
        )
      );
    }

    await pruneRubberBillReceiptSnapshots("location-a", 100);
    const snapshots = await getRubberBillReceiptSnapshots("location-a");

    expect(snapshots).toHaveLength(100);
    expect(snapshots.map((snapshot) => snapshot.billId)).not.toContain("bill-000");
    expect(snapshots[0].billId).toBe("bill-100");
    expect(snapshots[99].billId).toBe("bill-001");
  });

  test("writes a receipt batch in one call and keeps the newest revision", async () => {
    const first = makeSnapshot("a-1", "location-a", "2026-07-25T00:00:01.000Z");
    const second = makeSnapshot("a-2", "location-a", "2026-07-25T00:00:02.000Z");
    await putRubberBillReceiptSnapshots([first, second]);

    await putRubberBillReceiptSnapshots([{
      ...first,
      serverReceivedAt: "2026-07-25T00:00:03.000Z",
      revisionNo: 0,
      bill: { ...first.bill, customerName: "ข้อมูลเก่ากว่า" },
    }]);

    const snapshots = await getRubberBillReceiptSnapshots("location-a");
    expect(snapshots.map((snapshot) => snapshot.billId)).toEqual(["a-2", "a-1"]);
    expect(snapshots.find((snapshot) => snapshot.billId === "a-1")?.bill.customerName)
      .toBe("ลูกค้า a-1");
  });

  test("prunes one location without changing another location or sync_queue", async () => {
    await Promise.all([
      putRubberBillReceiptSnapshot(makeSnapshot("a-1", "location-a", "2026-07-25T00:00:01.000Z")),
      putRubberBillReceiptSnapshot(makeSnapshot("a-2", "location-a", "2026-07-25T00:00:02.000Z")),
      putRubberBillReceiptSnapshot(makeSnapshot("a-3", "location-a", "2026-07-25T00:00:03.000Z")),
      putRubberBillReceiptSnapshot(makeSnapshot("b-1", "location-b", "2026-07-25T00:00:01.000Z")),
      putRubberBillReceiptSnapshot(makeSnapshot("b-2", "location-b", "2026-07-25T00:00:02.000Z")),
    ]);
    await enqueueSyncEvent({
      id: "pending-a",
      entity: "rubber_bills",
      ownerUserId: "user-1",
      locationId: "location-a",
      operation: "create",
      payload: { customerName: "ยังไม่ซิงก์" },
      timestamp: 1,
      status: "pending",
    });

    await pruneRubberBillReceiptSnapshots("location-a", 2);

    expect((await getRubberBillReceiptSnapshots("location-a")).map((item) => item.billId))
      .toEqual(["a-3", "a-2"]);
    expect((await getRubberBillReceiptSnapshots("location-b")).map((item) => item.billId))
      .toEqual(["b-2", "b-1"]);
    expect(await getPendingEvents({
      entity: "rubber_bills",
      ownerUserId: "user-1",
      locationId: "location-a",
    })).toEqual([
      expect.objectContaining({
        id: "pending-a",
        payload: { customerName: "ยังไม่ซิงก์" },
        status: "pending",
      }),
    ]);
  });
});
