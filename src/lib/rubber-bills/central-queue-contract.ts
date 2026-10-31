import { isRubberBillNumbering } from "./numbering-contract";
const isUuid = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const isJsonObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const isIsoTimestamp = (value: unknown): value is string => typeof value === "string" && !value.startsWith("0000")
  && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-5]):[0-5]\d)$/.test(value)
  && Number.isFinite(Date.parse(value))
  && new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) === value.slice(0, 10);

export function isConfirmedRubberManagerResult(value: unknown, action: "approve" | "cancel", target: string) {
  if (!isJsonObject(value) || value.requestId !== target) return false;
  if (action === "cancel") return value.status === "cancelled";
  const sync = value.syncResult;
  return value.status === "approved" && isUuid(value.billId) && typeof value.operation === "string"
    && ["create", "update", "delete"].includes(value.operation)
    && isJsonObject(sync) && sync.status === "synced" && sync.id === value.billId
    && Number.isSafeInteger(sync.revisionNo) && Number(sync.revisionNo) > 0
    && typeof sync.serverBillNo === "string" && sync.serverBillNo.trim().length > 0 && isIsoTimestamp(sync.serverReceivedAt);
}

function validTerminalResult(row: Record<string, unknown>) {
  const result = row.result;
  if (!isJsonObject(result) || result.commandId !== row.commandId) return false;
  if (result.status === "discarded") return result.operation === row.action && result.clientTempId === row.clientTempId;
  if (row.action === "approve" || row.action === "cancel") return typeof row.clientTempId === "string"
    && isConfirmedRubberManagerResult(result, row.action, row.clientTempId.slice("request:".length));
  if (result.status === "pending_approval") return isUuid(result.requestId) && result.operation === row.action && result.clientTempId === row.clientTempId;
  return result.status === "synced" && isUuid(result.id) && Number.isSafeInteger(result.revisionNo) && Number(result.revisionNo) > 0
    && typeof result.serverBillNo === "string" && result.serverBillNo.trim().length > 0 && isIsoTimestamp(result.serverReceivedAt);
}

export type RubberQueueAction = "create" | "update" | "delete" | "approve" | "cancel";
export type RubberQueueState = "queued" | "retry_wait" | "paused" | "correction_required" | "done";
export interface RubberQueueRow {
  commandId: string;
  actorUserId: string;
  locationId: string;
  clientTempId: string;
  reference?: string;
  action: RubberQueueAction;
  state: RubberQueueState;
  acceptedAt: string;
  version: number;
  attempts: number;
  nextAttemptAt: string;
  errorCode: string | null;
  result: Record<string, unknown> | null;
  completedAt: string | null;
  canRetire: boolean;
}

export function isRubberQueueRow(value: unknown): value is RubberQueueRow {
  if (!isJsonObject(value)) return false;
  return isUuid(value.commandId) && isUuid(value.actorUserId) && isUuid(value.locationId)
    && typeof value.clientTempId === "string" && value.clientTempId.length > 0 && value.clientTempId.length <= 512
    && (value.reference === undefined || (typeof value.reference === "string" && value.reference.length <= 128))
    && typeof value.action === "string" && ["create", "update", "delete", "approve", "cancel"].includes(value.action)
    && typeof value.state === "string" && ["queued", "retry_wait", "paused", "correction_required", "done"].includes(value.state)
    && isIsoTimestamp(value.acceptedAt) && isIsoTimestamp(value.nextAttemptAt)
    && Number.isSafeInteger(value.version) && Number(value.version) > 0
    && Number.isSafeInteger(value.attempts) && Number(value.attempts) >= 0
    && (value.errorCode === null || typeof value.errorCode === "string")
    && (value.result === null || isJsonObject(value.result))
    && (value.completedAt === null || isIsoTimestamp(value.completedAt)) && typeof value.canRetire === "boolean"
    && (value.state !== "done" || validTerminalResult(value));
}

export function isRubberQueueSubmission(value: unknown): value is Record<string, unknown> {
  if (isJsonObject(value) && value.billNumbering !== undefined && !isRubberBillNumbering(value.billNumbering)) return false;
  if (!isJsonObject(value) || value.centralQueue !== true || value.localContextPending !== undefined || value.contractVersion !== 2 || !isUuid(value.commandId)
    || value.idempotencyKey !== value.commandId || !isUuid(value.locationId) || !isUuid(value.actorUserId)
    || typeof value.clientTempId !== "string" || value.clientTempId.length < 1 || value.clientTempId.length > 512) return false;
  if (value.queueAction === "approve" || value.queueAction === "cancel") {
    return value.operation === "update" && isUuid(value.targetRequestId)
      && value.clientTempId === `request:${value.targetRequestId}`;
  }
  return (value.queueAction === undefined || value.queueAction === value.operation)
    && typeof value.operation === "string" && ["create", "update", "delete"].includes(value.operation)
    && Number.isSafeInteger(value.expectedCommandGeneration) && Number(value.expectedCommandGeneration) >= 0
    && Number.isSafeInteger(value.expectedQueueVersion) && Number(value.expectedQueueVersion) >= 0
    && Number.isSafeInteger(value.expectedRevisionNo) && Number(value.expectedRevisionNo) <= 2_147_483_647
    && (value.expectedServerId === undefined || (value.operation !== "create" && isUuid(value.expectedServerId)))
    && (value.operation === "create" ? value.expectedRevisionNo === 0 : Number(value.expectedRevisionNo) > 0);
}

export function rubberQueueMessage(row: Pick<RubberQueueRow, "state" | "errorCode">) {
  if (row.errorCode === "BILL_ALREADY_DELETED") return "บิลนี้ถูกลบแล้ว";
  if (row.errorCode === "COMMAND_SUPERSEDED" || row.errorCode === "STALE_COMMAND_CONTEXT"
      || row.errorCode === "REQUEST_CHANGED" || row.errorCode === "BILL_CHANGED_OR_LOCKED") return "ข้อมูลเปลี่ยนแล้ว ยกเลิกคำสั่งเก่าและคงข้อมูลล่าสุดไว้";
  if (row.errorCode === "BUSINESS_REJECTED") return "ข้อมูลไม่ผ่านเงื่อนไข ยกเลิกคำสั่งค้างและคงบิลล่าสุดไว้";
  if (row.errorCode === "ACCOUNT_CLOSED") return "ผู้จัดการยกเลิกงานค้างของบัญชีที่ปิดแล้ว";
  if (row.errorCode === "CASH_COUNT_PAUSED") return "รอปลดล็อกตรวจนับเงิน แล้วระบบจะทำต่ออัตโนมัติ";
  if (row.errorCode === "ACTOR_PERMISSION_PAUSED") return "พักรายการไว้จนกว่าสิทธิ์ผู้ส่งและสาขาจะพร้อม";
  if (row.state === "correction_required") return "กรุณาแก้ไขร่างบิลเดิมแล้วส่งใหม่";
  if (row.state === "retry_wait") return "รอลองใหม่อัตโนมัติ";
  if (row.state === "done") return "ดำเนินการแล้ว";
  return "รอประมวลผลอัตโนมัติ";
}
