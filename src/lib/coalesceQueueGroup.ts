import type { SyncEvent } from "./idb-queue";

export type CoalesceResult =
  | { action: "noop" }
  | { action: "keep"; keeper: SyncEvent; remove: SyncEvent[] };

export function coalesceQueueGroup(group: readonly SyncEvent[]): CoalesceResult {
  if (group.length <= 1) {
    return { action: "keep", keeper: { ...group[0] }, remove: [] };
  }

  const ordered = [...group].sort((a, b) => (a.queueId || 0) - (b.queueId || 0));
  const id = ordered[0].id;
  const hasCreate = ordered.some(e => e.payload.operation === "create");
  const hasDelete = ordered.some(e => e.payload.operation === "delete");
  const lastEvent = ordered[ordered.length - 1];

  if (hasCreate && hasDelete) {
    return { action: "noop" };
  }

  if (hasCreate) {
    // create + update(s): keep oldest create slot, latest payload, rev = 0
    const base = ordered.find(e => e.payload.operation === "create")!;
    const keeper: SyncEvent = {
      ...base,
      payload: {
        ...lastEvent.payload,
        operation: "create",
        expectedRevisionNo: 0,
        idempotencyKey: `create:${id}:0`,
      },
      timestamp: lastEvent.timestamp,
    };
    const remove = ordered.filter(e => e.queueId !== base.queueId);
    return { action: "keep", keeper, remove };
  }

  if (hasDelete) {
    // update(s) + delete: keep delete slot, rev from first update
    const deleteBase = ordered.find(e => e.payload.operation === "delete")!;
    const firstUpdate = ordered.find(e => e.payload.operation === "update");
    const rev = firstUpdate
      ? firstUpdate.payload.expectedRevisionNo
      : deleteBase.payload.expectedRevisionNo;
    const keeper: SyncEvent = {
      ...deleteBase,
      payload: {
        ...deleteBase.payload,
        expectedRevisionNo: rev,
        idempotencyKey: `delete:${id}:${rev}`,
      },
    };
    const remove = ordered.filter(e => e.queueId !== deleteBase.queueId);
    return { action: "keep", keeper, remove };
  }

  // only updates: keep first slot, latest payload, preserve original rev
  const base = ordered[0];
  const originalRev = base.payload.expectedRevisionNo;
  const keeper: SyncEvent = {
    ...base,
    payload: {
      ...lastEvent.payload,
      operation: "update",
      expectedRevisionNo: originalRev,
      idempotencyKey: `update:${id}:${originalRev}`,
    },
    timestamp: lastEvent.timestamp,
  };
  const remove = ordered.filter(e => e.queueId !== base.queueId);
  return { action: "keep", keeper, remove };
}
