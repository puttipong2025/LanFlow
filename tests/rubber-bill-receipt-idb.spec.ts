import { expect, test } from "@playwright/test";
import { IDBFactory } from "fake-indexeddb";

import {
  deleteRubberBillReceiptSnapshotsByClientTempId,
  enqueueSyncEvent,
  getPendingEvents,
  getRubberBillReceiptSnapshots,
  pruneRubberBillReceiptSnapshots,
  putRubberBillReceiptSnapshots,
  reconcileSyncEventsIfCurrent,
  removeSyncEventIfCurrent,
  removeSyncEventsForOwner,
  updateSyncEvent,
  updateSyncEventIfCurrent,
  tombstoneRubberBillReceiptSnapshotByBillId,
  tombstoneRubberBillReceiptSnapshotsByClientTempId,
  type RubberBillReceiptSnapshot,
  type SyncEvent,
} from "../src/lib/idb-queue";
import { renderRubberBillReceiptHtml } from "../src/components/rubber-bills/bill-display";
import type { RubberBill } from "../src/types";

const DB_NAME = "lanflow_sync_db";

async function putRubberBillReceiptSnapshot(snapshot: RubberBillReceiptSnapshot) {
  return putRubberBillReceiptSnapshots([snapshot]);
}

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

  test("upgrades version 3 to 5 without changing sync_queue records", async () => {
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

    const dbV5 = await openDatabase(DB_NAME);
    expect(dbV5.version).toBe(5);
    expect(Array.from(dbV5.objectStoreNames)).toContain("rubber_bill_receipts");
    expect(Array.from(dbV5.objectStoreNames)).toContain("rubber_bill_receipt_tombstones");
    const actualEvents = await new Promise<SyncEvent[]>((resolve, reject) => {
      const transaction = dbV5.transaction("sync_queue", "readonly");
      const requestAll = transaction.objectStore("sync_queue").getAll();
      requestAll.onsuccess = () => resolve(requestAll.result as SyncEvent[]);
      requestAll.onerror = () => reject(requestAll.error);
    });
    dbV5.close();

    expect(actualEvents).toEqual(originalEvents);
  });

  test("upgrades version 4 to 5 without changing cached receipts", async () => {
    const snapshot = makeSnapshot("v4-receipt", "location-a", "2026-07-25T00:00:01.000Z");
    const request = indexedDB.open(DB_NAME, 4);
    request.onupgradeneeded = () => {
      const db = request.result;
      const queueStore = db.createObjectStore("sync_queue", {
        keyPath: "queueId",
        autoIncrement: true,
      });
      queueStore.createIndex("entity", "entity");
      queueStore.createIndex("id", "id");
      queueStore.createIndex("status", "status");
      queueStore.createIndex("ownerUserId", "ownerUserId");
      queueStore.createIndex("locationId", "locationId");
      const receiptStore = db.createObjectStore("rubber_bill_receipts", { keyPath: "billId" });
      receiptStore.createIndex("locationId", "locationId");
      receiptStore.createIndex("serverReceivedAt", "serverReceivedAt");
    };
    const dbV4 = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = dbV4.transaction("rubber_bill_receipts", "readwrite");
      transaction.objectStore("rubber_bill_receipts").put(snapshot);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    dbV4.close();

    expect(await getRubberBillReceiptSnapshots("location-a")).toEqual([snapshot]);
    const dbV5 = await openDatabase(DB_NAME);
    expect(dbV5.version).toBe(5);
    expect(Array.from(dbV5.objectStoreNames)).toContain("rubber_bill_receipt_tombstones");
    dbV5.close();
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

  test("does not write receipt snapshots after its operation is aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await putRubberBillReceiptSnapshots([
      makeSnapshot("aborted-1", "location-a", "2026-07-25T00:00:01.000Z"),
    ], controller.signal);

    expect(await getRubberBillReceiptSnapshots("location-a")).toEqual([]);
  });

  test("does not resurrect a deleted receipt from a stale cross-tab feed write", async () => {
    const staleSnapshot = makeSnapshot(
      "deleted-1",
      "location-a",
      "2026-07-25T00:00:01.000Z",
    );
    await putRubberBillReceiptSnapshot(staleSnapshot);

    await tombstoneRubberBillReceiptSnapshotsByClientTempId(
      "location-a",
      staleSnapshot.bill.clientTempId,
    );
    await putRubberBillReceiptSnapshot(staleSnapshot);

    expect(await getRubberBillReceiptSnapshots("location-a")).toEqual([]);
  });

  test("allows a current server receipt to replace a discarded local snapshot", async () => {
    const snapshot = makeSnapshot(
      "discarded-update-1",
      "location-a",
      "2026-07-25T00:00:01.000Z",
    );
    await putRubberBillReceiptSnapshot(snapshot);

    await deleteRubberBillReceiptSnapshotsByClientTempId(
      "location-a",
      snapshot.bill.clientTempId,
    );
    await putRubberBillReceiptSnapshot({
      ...snapshot,
      revisionNo: 2,
      serverReceivedAt: "2026-07-25T00:00:02.000Z",
    });

    expect(await getRubberBillReceiptSnapshots("location-a")).toEqual([
      expect.objectContaining({ billId: snapshot.billId, revisionNo: 2 }),
    ]);
  });

  test("does not resurrect a receipt after an approval-confirmed delete", async () => {
    const staleSnapshot = makeSnapshot(
      "approved-delete-1",
      "location-a",
      "2026-07-25T00:00:01.000Z",
    );
    await putRubberBillReceiptSnapshot(staleSnapshot);

    await tombstoneRubberBillReceiptSnapshotByBillId(
      "location-a",
      staleSnapshot.billId,
    );
    await putRubberBillReceiptSnapshot(staleSnapshot);

    expect(await getRubberBillReceiptSnapshots("location-a")).toEqual([]);
  });

  test("reads and renders a legacy receipt snapshot without upgrading or clearing IndexedDB", async () => {
    await getRubberBillReceiptSnapshots("location-a");
    const current = makeSnapshot("legacy-1", "location-a", "2026-07-25T00:00:01.000Z");
    const { hasZeroPrice: _hasZeroPrice, ...legacyReceipt } = current.receipt;
    const db = await openDatabase(DB_NAME);
    expect(db.version).toBe(5);
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("rubber_bill_receipts", "readwrite");
      transaction.objectStore("rubber_bill_receipts").put({
        ...current,
        receipt: legacyReceipt,
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();

    const [snapshot] = await getRubberBillReceiptSnapshots("location-a");
    expect(snapshot.billId).toBe("legacy-1");
    expect(snapshot.receipt.customerName).toBe("ลูกค้า legacy-1");
    expect((snapshot.receipt as { hasZeroPrice?: boolean }).hasZeroPrice).toBeUndefined();
    expect(renderRubberBillReceiptHtml(snapshot.receipt)).toContain("ลูกค้า legacy-1");
    const unchangedDb = await openDatabase(DB_NAME);
    expect(unchangedDb.version).toBe(5);
    unchangedDb.close();
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

  test("stale workers cannot remove or overwrite a replaced sync command", async () => {
    await enqueueSyncEvent({
      id: "client-bill-1",
      entity: "rubber_bills",
      ownerUserId: "user-1",
      locationId: "location-a",
      operation: "update",
      serverId: "server-bill-1",
      payload: { operation: "update", expectedRevisionNo: 3 },
      timestamp: 1,
      status: "pending",
    });
    const partition = {
      entity: "rubber_bills" as const,
      ownerUserId: "user-1",
      locationId: "location-a",
    };
    const [staleUpdate] = await getPendingEvents(partition);
    await updateSyncEvent({
      ...staleUpdate,
      operation: "delete",
      payload: { operation: "delete", expectedRevisionNo: 3 },
      timestamp: 2,
    });

    expect(await updateSyncEventIfCurrent({
      ...staleUpdate,
      status: "conflict",
      errorMessage: "STALE_UPDATE",
    })).toBe(false);
    expect(await removeSyncEventIfCurrent(staleUpdate)).toBe(false);
    expect(await getPendingEvents(partition)).toEqual([
      expect.objectContaining({ operation: "delete", status: "pending" }),
    ]);

    const [currentDelete] = await getPendingEvents(partition);
    expect(await removeSyncEventIfCurrent(currentDelete)).toBe(true);
    expect(await getPendingEvents(partition)).toEqual([]);
  });

  test("competing Rubber Bill commands cannot both enqueue from the same empty snapshot", async () => {
    const enqueueFromSnapshot = enqueueSyncEvent as (
      event: Omit<SyncEvent, "queueId">,
      expectedEvents: readonly SyncEvent[],
    ) => Promise<number | null>;
    const baseEvent = {
      id: "client-bill-race",
      entity: "rubber_bills" as const,
      ownerUserId: "user-1",
      locationId: "location-a",
      timestamp: 1,
      status: "pending" as const,
    };

    const results = await Promise.all([
      enqueueFromSnapshot({
        ...baseEvent,
        operation: "create",
        serverSubmissionAttempted: true,
        payload: { operation: "create", expectedRevisionNo: 0 },
      }, []),
      enqueueFromSnapshot({
        ...baseEvent,
        operation: "delete",
        payload: { operation: "delete", expectedRevisionNo: 0 },
      }, []),
    ]);

    expect(results.filter((queueId) => typeof queueId === "number")).toHaveLength(1);
    expect(results.filter((queueId) => queueId === null)).toHaveLength(1);
    expect(await getPendingEvents({
      entity: "rubber_bills",
      ownerUserId: "user-1",
      locationId: "location-a",
    })).toHaveLength(1);
  });

  test("stale queue normalization cannot overwrite a replacement command", async () => {
    await enqueueSyncEvent({
      id: "client-bill-2",
      entity: "rubber_bills",
      ownerUserId: "user-1",
      locationId: "location-a",
      operation: "update",
      serverId: "server-bill-2",
      payload: { operation: "update", expectedRevisionNo: 5, customerName: "old" },
      timestamp: 1,
      status: "pending",
    });
    await enqueueSyncEvent({
      id: "client-bill-2",
      entity: "rubber_bills",
      ownerUserId: "user-1",
      locationId: "location-a",
      operation: "update",
      serverId: "server-bill-2",
      payload: { operation: "update", expectedRevisionNo: 5, customerName: "new" },
      timestamp: 2,
      status: "pending",
    });
    const partition = {
      entity: "rubber_bills" as const,
      ownerUserId: "user-1",
      locationId: "location-a",
    };
    const staleGroup = await getPendingEvents(partition);
    const staleKeeper = {
      ...staleGroup[0],
      payload: staleGroup[1].payload,
    };
    await updateSyncEvent({
      ...staleGroup[0],
      operation: "delete",
      payload: { operation: "delete", expectedRevisionNo: 5 },
      timestamp: 3,
    });

    expect(await reconcileSyncEventsIfCurrent(staleGroup, staleKeeper)).toBe(false);
    expect(await getPendingEvents(partition)).toEqual([
      expect.objectContaining({ queueId: staleGroup[0].queueId, operation: "delete" }),
      expect.objectContaining({ queueId: staleGroup[1].queueId, operation: "update" }),
    ]);
  });

  test("applies a current queue normalization plan as one transaction", async () => {
    await enqueueSyncEvent({
      id: "client-bill-3",
      entity: "rubber_bills",
      ownerUserId: "user-1",
      locationId: "location-a",
      operation: "update",
      serverId: "server-bill-3",
      payload: { operation: "update", expectedRevisionNo: 2, customerName: "old" },
      timestamp: 1,
      status: "pending",
    });
    await enqueueSyncEvent({
      id: "client-bill-3",
      entity: "rubber_bills",
      ownerUserId: "user-1",
      locationId: "location-a",
      operation: "update",
      serverId: "server-bill-3",
      payload: { operation: "update", expectedRevisionNo: 2, customerName: "new" },
      timestamp: 2,
      status: "pending",
    });
    const partition = {
      entity: "rubber_bills" as const,
      ownerUserId: "user-1",
      locationId: "location-a",
    };
    const currentGroup = await getPendingEvents(partition);
    const keeper = {
      ...currentGroup[0],
      payload: currentGroup[1].payload,
      timestamp: currentGroup[1].timestamp,
    };

    expect(await reconcileSyncEventsIfCurrent(currentGroup, keeper)).toBe(true);
    expect(await getPendingEvents(partition)).toEqual([
      expect.objectContaining({
        queueId: currentGroup[0].queueId,
        payload: expect.objectContaining({ customerName: "new" }),
        timestamp: 2,
      }),
    ]);
  });

  test("removes only one user's business queue and keeps receipt snapshots", async () => {
    await putRubberBillReceiptSnapshot(
      makeSnapshot("receipt-1", "location-a", "2026-09-01T00:00:00.000Z"),
    );
    await Promise.all([
      enqueueSyncEvent({
        id: "user-1-rubber",
        entity: "rubber_bills",
        ownerUserId: "user-1",
        locationId: "location-a",
        operation: "create",
        payload: {},
        timestamp: 1,
        status: "pending",
      }),
      enqueueSyncEvent({
        id: "user-1-cash",
        entity: "income_expense",
        ownerUserId: "user-1",
        locationId: "location-a",
        operation: "create",
        payload: {},
        timestamp: 2,
        status: "failed",
      }),
      enqueueSyncEvent({
        id: "user-2-rubber",
        entity: "rubber_bills",
        ownerUserId: "user-2",
        locationId: "location-a",
        operation: "create",
        payload: {},
        timestamp: 3,
        status: "pending",
      }),
    ]);

    expect(await removeSyncEventsForOwner("user-1")).toBe(2);
    expect(await removeSyncEventsForOwner("user-1")).toBe(0);
    expect(await getPendingEvents({
      entity: "rubber_bills",
      ownerUserId: "user-1",
      locationId: "location-a",
    })).toEqual([]);
    expect(await getPendingEvents({
      entity: "rubber_bills",
      ownerUserId: "user-2",
      locationId: "location-a",
    })).toHaveLength(1);
    expect(await getRubberBillReceiptSnapshots("location-a")).toHaveLength(1);
  });
});
