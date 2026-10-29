import type { SyncEvent } from "@/lib/idb-queue";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Legacy work and sale submissions retain their original sender. */
export function isIncomeExpenseBackgroundCommand(event: SyncEvent): boolean {
  const payload = event.payload as Record<string, unknown> | null;
  return event.entity === "income_expense"
    && (event.operation === "update" || event.operation === "delete")
    && !!payload
    && payload.contractVersion === 2
    && payload.background === true
    && typeof payload.commandId === "string" && UUID.test(payload.commandId)
    && payload.actorUserId === event.ownerUserId
    && typeof payload.expectedServerId === "string" && UUID.test(payload.expectedServerId)
    && payload.expectedServerId === event.serverId
    && payload.locationId === event.locationId
    && payload.clientTempId === event.id
    && payload.operation === event.operation
    && (payload.billOption === "รายรับ" || payload.billOption === "ค่าใช้จ่าย");
}

export type IncomeExpenseBackgroundOutcome =
  | "synced" | "pending_approval" | "rejected" | "deleted" | "revision_conflict";

/** Only an acknowledgement bound to this command can retire its local draft. */
export function confirmedIncomeExpenseBackgroundOutcome(
  event: SyncEvent,
  result: unknown,
): IncomeExpenseBackgroundOutcome | null {
  if (!isIncomeExpenseBackgroundCommand(event) || !result || typeof result !== "object") return null;
  const receipt = result as Record<string, unknown>;
  if (receipt.commandId !== event.payload.commandId
    || receipt.actorUserId !== event.ownerUserId
    || receipt.serverId !== event.serverId
    || receipt.locationId !== event.locationId
    || receipt.clientTempId !== event.id
    || receipt.operation !== event.operation) return null;
  const outcome = receipt.outcome;
  if (outcome !== "synced" && outcome !== "pending_approval" && outcome !== "rejected"
    && outcome !== "deleted" && outcome !== "revision_conflict") return null;
  return outcome;
}
