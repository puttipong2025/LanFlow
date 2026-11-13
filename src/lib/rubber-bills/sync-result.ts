import type { SyncEvent } from "@/lib/idb-queue";
import { isIsoTimestamp, isUuid, sameUuid } from "@/lib/validation/primitives";
import { isNumberedRubberFinal } from "./numbering-contract";

export function isConfirmedRubberSyncResult(value: unknown, event: SyncEvent) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  if (event.payload.contractVersion === 2 && data.commandId !== event.payload.commandId
    && !sameUuid(data.commandId, event.payload.commandId)) return false;
  if (data.status === "pending_approval" || data.status === "discarded") {
    return data.operation === event.operation && data.clientTempId === event.id
      && (data.status === "discarded" || isUuid(data.requestId));
  }
  return data.status === "synced" && isUuid(data.id)
    && (!event.payload.billNumbering || isNumberedRubberFinal(event.payload.localBillNo, data.serverBillNo))
    && (event.operation === "create" || !event.serverId || String(data.id).toLowerCase() === event.serverId.toLowerCase())
    && Number.isSafeInteger(data.revisionNo) && Number(data.revisionNo) > 0
    && (event.operation === "create" || data.revisionNo === event.payload.expectedRevisionNo + 1)
    && typeof data.serverBillNo === "string" && data.serverBillNo.trim().length > 0
    && isIsoTimestamp(data.serverReceivedAt);
}
