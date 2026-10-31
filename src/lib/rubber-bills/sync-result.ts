import type { SyncEvent } from "@/lib/idb-queue";
import { isNumberedRubberFinal } from "./numbering-contract";

const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export function isConfirmedRubberSyncResult(value: unknown, event: SyncEvent) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  if (event.payload.contractVersion === 2 && data.commandId !== event.payload.commandId) return false;
  if (data.status === "pending_approval" || data.status === "discarded") {
    return data.operation === event.operation && data.clientTempId === event.id
      && (data.status === "discarded" || uuid(data.requestId));
  }
  const receivedAt = data.serverReceivedAt;
  const validReceivedAt = typeof receivedAt === "string" && !receivedAt.startsWith("0000")
    && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-5]):[0-5]\d)$/.test(receivedAt)
    && Number.isFinite(Date.parse(receivedAt))
    && new Date(`${receivedAt.slice(0, 10)}T00:00:00.000Z`).toISOString().slice(0, 10) === receivedAt.slice(0, 10);
  return data.status === "synced" && uuid(data.id)
    && (!event.payload.billNumbering || isNumberedRubberFinal(event.payload.localBillNo, data.serverBillNo))
    && (event.operation === "create" || !event.serverId || String(data.id).toLowerCase() === event.serverId.toLowerCase())
    && Number.isSafeInteger(data.revisionNo) && Number(data.revisionNo) > 0
    && (event.operation === "create" || data.revisionNo === event.payload.expectedRevisionNo + 1)
    && typeof data.serverBillNo === "string" && data.serverBillNo.trim().length > 0
    && validReceivedAt;
}
