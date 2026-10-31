import { deleteRubberBillReceiptSnapshotsByClientTempId, getPendingEvents, reconcileSyncEventsIfCurrent, updateSyncEventIfCurrent, type SyncEvent } from "@/lib/idb-queue";
import { isRetryableSyncResponse } from "@/lib/sync-response";

export async function recordRubberSyncFailure(event: SyncEvent, status: number, value: unknown) {
  const data = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const numberingRejection = data.errorCode === "NUMBERING_REJECTED";
  const boundNumberingRejection = numberingRejection && event.payload.billNumbering !== undefined
    && typeof event.payload.commandId === "string" && data.commandId === event.payload.commandId
    && data.clientTempId === event.id && data.operation === event.operation;
  if (event.payload.contractVersion !== 2 && status === 409 && data.status === "conflict" && data.resolution === "discard_local"
      && data.clientTempId === event.id && data.operation === event.operation) {
    const group = (await getPendingEvents({ entity: "rubber_bills", ownerUserId: event.ownerUserId, locationId: event.locationId }))
      .filter((candidate) => candidate.id === event.id);
    // Never discard a dependent command or a command changed while the request ran.
    if (group.length === 1 && group[0].queueId === event.queueId
        && JSON.stringify(group[0].payload) === JSON.stringify(event.payload)
        && await reconcileSyncEventsIfCurrent([event], undefined, true)) {
      try {
        await deleteRubberBillReceiptSnapshotsByClientTempId(event.locationId, event.id);
      } catch (error) {
        console.warn("Unable to clear stale Rubber Bill receipt after conflict", error);
      }
      return "discarded" as const;
    }
  }
  const hasBusinessFailure = (data.status === "failed" || data.status === "conflict")
    && (!numberingRejection || boundNumberingRejection)
    && typeof data.errorMessage === "string" && data.errorMessage.trim().length > 0;
  const retryable = !hasBusinessFailure || isRetryableSyncResponse(status, data) || status === 0 || (status >= 200 && status < 300);
  event.status = retryable ? "pending" : data.status === "conflict" ? "conflict" : "failed";
  event.failureHttpStatus = status;
  event.failureCode = (!numberingRejection || boundNumberingRejection)
    && data.commandId === event.payload.commandId && typeof data.errorCode === "string" ? data.errorCode : undefined;
  event.errorMessage = retryable ? "รอซิงก์อัตโนมัติเมื่อระบบพร้อม"
    : typeof data.errorMessage === "string" ? data.errorMessage : "ข้อมูลบิลยางไม่ผ่านเงื่อนไข";
  if (!retryable && event.status === "failed" && !boundNumberingRejection) event.serverSubmissionAttempted = false;
  await updateSyncEventIfCurrent(event);
  return event.status;
}
