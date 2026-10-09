import { expect, test } from "@playwright/test";

import { coalesceQueueGroup } from "../src/lib/coalesceQueueGroup";
import type { SyncEvent } from "../src/lib/idb-queue";
import { getPendingServerActionBlockReason } from "../src/lib/record-action-locks";
import {
  mergeRubberBillLocalEvents,
  rubberBillFromSyncEvent,
  scopeRubberBillLocalEventsToServerRows,
} from "../src/lib/rubber-bills/local-feed";

const ownerUserId = "71000000-0000-4000-8000-000000000001";
const locationId = "71000000-0000-4000-8000-000000000002";
const clientTempId = "local-bill-1";
const serverId = "71000000-0000-4000-8000-000000000003";

function syncEvent(operation: SyncEvent["operation"], status: SyncEvent["status"]): SyncEvent {
  return {
    id: clientTempId,
    entity: "rubber_bills",
    ownerUserId,
    locationId,
    operation,
    status,
    timestamp: 1,
    payload: {
      operation,
      clientTempId,
      localBillNo: "LOCAL-1",
      idempotencyKey: `${operation}:${clientTempId}:1`,
      locationId,
      billDate: "2026-10-06",
      customerName: "ลูกค้าทดสอบ",
      billType: "บิลเครื่องชั่งเล็ก",
      clientCreatedAt: "2026-10-06T00:00:00.000Z",
      clientRecordedAt: "2026-10-06T00:00:00.000Z",
      expectedRevisionNo: 1,
      items: [],
    },
  };
}

function serverBill() {
  const bill = rubberBillFromSyncEvent(syncEvent("update", "pending"), ownerUserId)!;
  return {
    ...bill,
    id: serverId,
    serverBillNo: "RB-1",
    billNo: "RB-1",
    syncStatus: "synced" as const,
    revisionNo: 1,
  };
}

test("a local replacement is included once when its server bill arrives on a later page", () => {
  const event = syncEvent("update", "pending");
  const firstPage = mergeRubberBillLocalEvents([], [event], ownerUserId);
  const laterPage = mergeRubberBillLocalEvents([serverBill()], [event], ownerUserId, "suppress");
  const bills = [...firstPage, ...laterPage];

  expect(bills).toHaveLength(1);
  expect(bills[0].clientTempId).toBe(clientTempId);
  expect(bills[0].syncStatus).toBe("pending");
});

test("a failed delete does not hide the unchanged server bill from a later page", () => {
  const event = syncEvent("delete", "failed");
  const laterPage = mergeRubberBillLocalEvents([serverBill()], [event], ownerUserId, "suppress");

  expect(laterPage).toHaveLength(1);
  expect(laterPage[0].serverBillNo).toBe("RB-1");
});

test("a queued update keeps the server identity used by action locks and later edits", () => {
  const event = {
    ...syncEvent("update", "pending"),
    serverId,
    serverBillNo: "RB-1",
  } satisfies SyncEvent;

  const local = rubberBillFromSyncEvent(event, ownerUserId)!;

  expect(local.id).toBe(serverId);
  expect(local.serverBillNo).toBe("RB-1");
  expect(local.billNo).toBe("RB-1");
});

test("a queued bill keeps the latest price-adjustment target and legacy events default to zero", () => {
  const adjustedEvent = syncEvent("create", "pending");
  adjustedEvent.payload.priceAdjustmentTarget = 500;

  expect(rubberBillFromSyncEvent(adjustedEvent, ownerUserId)?.priceAdjustmentTarget).toBe(500);
  expect(rubberBillFromSyncEvent(syncEvent("create", "pending"), ownerUserId)?.priceAdjustmentTarget).toBe(0);
});

test("a legacy queued update inherits server identity from the loaded bill", () => {
  const event = syncEvent("update", "pending");

  const [local] = mergeRubberBillLocalEvents([serverBill()], [event], ownerUserId);

  expect(local.id).toBe(serverId);
  expect(local.serverBillNo).toBe("RB-1");
  expect(local.billNo).toBe("RB-1");
  expect(local.syncStatus).toBe("pending");
});

test("a server-confirmed create with a lost response stays action-locked until replay completes", () => {
  const [local] = mergeRubberBillLocalEvents(
    [serverBill()],
    [syncEvent("create", "pending")],
    ownerUserId,
  );

  expect(local.id).toBe(serverId);
  expect(local.serverBillNo).toBe("RB-1");
  expect(local.syncStatus).toBe("pending");
  expect(getPendingServerActionBlockReason(local)).toContain("กำลังยืนยันผล");
});

test("a create whose server submission may have committed stays action-locked before feed confirmation", () => {
  const event = {
    ...syncEvent("create", "pending"),
    serverSubmissionAttempted: true,
  } as SyncEvent & { serverSubmissionAttempted: true };

  const local = rubberBillFromSyncEvent(event, ownerUserId)!;

  expect(local.id).toBe(clientTempId);
  expect(local.serverBillNo).toBeUndefined();
  expect(getPendingServerActionBlockReason(local)).toContain("กำลังยืนยันผล");
});

test("queue normalization preserves an attempted create marker", () => {
  const create = {
    ...syncEvent("create", "pending"),
    queueId: 1,
    serverSubmissionAttempted: true,
  } satisfies SyncEvent;
  const update = {
    ...syncEvent("update", "pending"),
    queueId: 2,
    timestamp: 2,
  } satisfies SyncEvent;

  const result = coalesceQueueGroup([create, update]);

  expect(result.action).toBe("keep");
  if (result.action === "keep") {
    expect(result.keeper.operation).toBe("create");
    expect(result.keeper.serverSubmissionAttempted).toBe(true);
  }
});

test("queue normalization never drops an attempted create when a competing delete exists", () => {
  const create = {
    ...syncEvent("create", "pending"),
    queueId: 1,
    serverSubmissionAttempted: true,
  } satisfies SyncEvent;
  const deleteEvent = {
    ...syncEvent("delete", "pending"),
    queueId: 2,
    timestamp: 2,
  } satisfies SyncEvent;

  const result = coalesceQueueGroup([create, deleteEvent]);

  expect(result.action).toBe("keep");
  if (result.action === "keep") {
    expect(result.keeper).toMatchObject({
      queueId: 1,
      operation: "create",
      serverSubmissionAttempted: true,
      status: "failed",
    });
    expect(result.keeper.errorMessage).toContain("หลายหน้าต่าง");
    expect(result.remove).toEqual([deleteEvent]);
  }
});

test("a queued update keeps authoritative server action locks", () => {
  const lockedServerBill = {
    ...serverBill(),
    approvalPending: true,
    approvalRequestId: "71000000-0000-4000-8000-000000000005",
    approvalOperation: "update" as const,
    approvalReasons: ["price" as const],
    reportLockNo: "RPT-1",
    transferLockId: "71000000-0000-4000-8000-000000000004",
  };

  const [local] = mergeRubberBillLocalEvents(
    [lockedServerBill],
    [syncEvent("update", "pending")],
    ownerUserId,
  );

  expect(local.approvalPending).toBe(true);
  expect(local.approvalRequestId).toBe("71000000-0000-4000-8000-000000000005");
  expect(local.approvalOperation).toBe("update");
  expect(local.approvalReasons).toEqual(["price"]);
  expect(local.reportLockNo).toBe("RPT-1");
  expect(local.transferLockId).toBe("71000000-0000-4000-8000-000000000004");
});

test("a queued update does not hide an authoritative pending approval on a later page", () => {
  const pendingServerBill = {
    ...serverBill(),
    approvalPending: true,
    approvalRequestId: "71000000-0000-4000-8000-000000000005",
    approvalOperation: "update" as const,
    approvalReasons: ["price" as const],
  };
  const event = syncEvent("update", "pending");

  const firstPage = mergeRubberBillLocalEvents([], [event], ownerUserId)
    .filter((bill) => bill.approvalPending);
  const laterPage = mergeRubberBillLocalEvents(
    [pendingServerBill],
    [event],
    ownerUserId,
    "server_authoritative",
  ).filter((bill) => bill.approvalPending);

  expect([...firstPage, ...laterPage]).toHaveLength(1);
});

test("a queued create keeps a server-confirmed pending approval after a lost response", () => {
  const pendingCreate = {
    ...serverBill(),
    id: "approval:71000000-0000-4000-8000-000000000005",
    serverBillNo: undefined,
    billNo: "LOCAL-1",
    approvalPending: true,
    approvalRequestId: "71000000-0000-4000-8000-000000000005",
    approvalOperation: "create" as const,
    approvalReasons: ["price" as const],
  };

  const [merged] = mergeRubberBillLocalEvents(
    [pendingCreate],
    [syncEvent("create", "pending")],
    ownerUserId,
  );

  expect(merged.id).toBe("approval:71000000-0000-4000-8000-000000000005");
  expect(merged.approvalPending).toBe(true);
  expect(merged.approvalRequestId).toBe("71000000-0000-4000-8000-000000000005");
  expect(merged.approvalOperation).toBe("create");
});

test("a queued delete keeps a server-confirmed pending approval after a lost response", () => {
  const pendingDelete = {
    ...serverBill(),
    approvalPending: true,
    approvalRequestId: "71000000-0000-4000-8000-000000000005",
    approvalOperation: "delete" as const,
    approvalReasons: ["price" as const],
  };

  const merged = mergeRubberBillLocalEvents(
    [pendingDelete],
    [syncEvent("delete", "pending")],
    ownerUserId,
  );

  expect(merged).toHaveLength(1);
  expect(merged[0].approvalPending).toBe(true);
  expect(merged[0].approvalOperation).toBe("delete");
});

test("a queued delete does not hide authoritative report or transfer locks", () => {
  const lockedBills = [
    { ...serverBill(), reportLockNo: "RPT-1" },
    { ...serverBill(), transferLockId: "71000000-0000-4000-8000-000000000004" },
  ];

  for (const lockedBill of lockedBills) {
    const merged = mergeRubberBillLocalEvents(
      [lockedBill],
      [syncEvent("delete", "pending")],
      ownerUserId,
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe(serverId);
  }
});

test("an editable server filter does not assume an unmatched queued update is unlocked", () => {
  const event = syncEvent("update", "pending");
  const serverScopedEvents = scopeRubberBillLocalEventsToServerRows([], [event], true);

  const editableBills = mergeRubberBillLocalEvents([], serverScopedEvents, ownerUserId)
    .filter((bill) => !bill.approvalPending && !bill.reportLockNo && !bill.transferLockId);

  expect(editableBills).toHaveLength(0);
});

test("a queued create keeps its device-local identity", () => {
  const event = syncEvent("create", "pending");
  const local = rubberBillFromSyncEvent(event, ownerUserId)!;

  expect(local.id).toBe(clientTempId);
  expect(local.serverBillNo).toBeUndefined();
  expect(scopeRubberBillLocalEventsToServerRows([], [event], true)).toEqual([event]);
  expect(scopeRubberBillLocalEventsToServerRows([], [event], false)).toEqual([]);
});
