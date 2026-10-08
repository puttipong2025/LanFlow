import type { SyncEvent } from "./idb-queue";

export function isSameSyncCommand(left: SyncEvent, right: SyncEvent) {
  return left.id === right.id
    && left.entity === right.entity
    && left.ownerUserId === right.ownerUserId
    && left.locationId === right.locationId
    && left.operation === right.operation
    && left.serverId === right.serverId
    && left.serverBillNo === right.serverBillNo
    && JSON.stringify(left.payload) === JSON.stringify(right.payload);
}

export function isSameSyncEvent(left: SyncEvent, right: SyncEvent) {
  return isSameSyncCommand(left, right)
    && left.timestamp === right.timestamp
    && left.status === right.status
    && left.errorMessage === right.errorMessage
    && left.serverSubmissionAttempted === right.serverSubmissionAttempted;
}

export function areSameSyncEventSnapshots(
  currentEvents: readonly SyncEvent[],
  expectedEvents: readonly SyncEvent[],
) {
  const byQueueId = (left: SyncEvent, right: SyncEvent) => (
    (left.queueId ?? 0) - (right.queueId ?? 0)
  );
  const current = [...currentEvents].sort(byQueueId);
  const expected = [...expectedEvents].sort(byQueueId);
  return current.length === expected.length
    && current.every((event, index) => (
      event.queueId === expected[index]?.queueId
      && isSameSyncEvent(event, expected[index])
    ));
}
