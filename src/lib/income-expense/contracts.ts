import {
  isCanonicalDate,
  isFeedTimestamp,
  isIncomeExpenseFeedCursor,
  isIncomeExpenseFeedPageOrder,
  isIsoTimestamp,
} from "./feed-cursor";

const DATABASE_ERROR_DETAIL_PATTERN = /(?:\b(?:relation|column|constraint|schema|table|function|operator|sequence|trigger)\b.*\b(?:does not exist|violates|already exists|not found)\b)|(?:duplicate key value|invalid input syntax|permission denied|sqlstate|syntax error at or near|division by zero|numeric field overflow|value too long|deadlock detected|could not serialize|current transaction is aborted)|(?:\b(?:private|public|auth|storage)\.[a-z_][a-z0-9_]*)|(?:\b[a-z][a-z0-9_]*(?:_pkey|_key|_fkey|_check)\b)/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSTGRES_INTEGER_MAX = 2_147_483_647;
const APPROVAL_REASONS = new Set(["keyword", "amount_threshold", "non_current_date"]);
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const THAI_CHARACTERS = /[\u0E00-\u0E7F]/;
const FEED_APPROVAL_FIELDS = [
  "approvalPending",
  "approvalRequestId",
  "approvalRequestType",
  "approvalOperation",
  "approvalReasons",
] as const;
const FEED_RELATION_SOURCE_TYPES = new Set([
  "money_transfer",
  "rubber_bill_daily",
  "rubber_export",
  "time_tracking_withdrawal",
  "time_tracking_withdrawal_adjustment",
  "payroll_slip",
]);
const PUBLIC_ENGLISH_ERROR_MESSAGES = new Set([
  "Cannot update or delete non-existent record",
  "Invalid billOption for expense",
  "Invalid billOption for income",
  "Invalid decision",
  "Invalid operation",
  "Invalid type",
  "Location access denied",
  "Missing idempotency key",
  "Record already exists",
  "Revision mismatch",
  "Unauthorized or inactive user",
  "billOption is required",
  "cost must be > 0",
]);

function isNonBlankString(value: unknown, maxLength = 500): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isNonNegativePostgresInteger(value: unknown): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= 0
    && value <= POSTGRES_INTEGER_MAX;
}

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function hasAtMostTwoDecimalPlaces(value: number) {
  return Math.abs(value * 100 - Math.round(value * 100)) <= 1e-7;
}

function isOptionalString(value: unknown, maxLength: number) {
  return value === undefined || (typeof value === "string" && value.length <= maxLength);
}

function isOptionalNonBlankString(value: unknown, maxLength: number) {
  return value === undefined || isNonBlankString(value, maxLength);
}

function isApprovalReasons(value: unknown) {
  return Array.isArray(value)
    && value.length > 0
    && value.every((reason) => typeof reason === "string" && APPROVAL_REASONS.has(reason));
}

function hasValidSubmissionSaleLines(
  value: Record<string, unknown>,
  operation: unknown,
  billOption: unknown,
) {
  const lines = value.saleLines;
  if (billOption !== "บิลขาย") {
    return lines === undefined || (Array.isArray(lines) && lines.length === 0);
  }
  if (lines === undefined) return operation === "delete";
  if (!Array.isArray(lines)
      || lines.length > 50
      || (operation !== "delete" && lines.length < 1)) {
    return false;
  }
  return lines.every((line, index) => isJsonObject(line)
    && isUuid(line.incomeSaleItemId)
    && isSafePositiveInteger(line.quantity)
    && isFiniteNonNegative(line.unitPrice)
    && hasAtMostTwoDecimalPlaces(line.unitPrice)
    && line.sequenceNo === index + 1);
}

export type IncomeExpenseServerFeedMode = "latest" | "pending_approval";

function hasValidFeedApproval(value: Record<string, unknown>) {
  if (value.approvalPending !== true
      || !isUuid(value.approvalRequestId)
      || !Array.isArray(value.approvalReasons)
      || !value.approvalReasons.every(
        (reason) => typeof reason === "string" && APPROVAL_REASONS.has(reason),
      )) {
    return false;
  }
  if (value.approvalRequestType === "cash_transfer_delete") {
    return value.approvalOperation === "delete" && value.approvalReasons.length === 0;
  }
  return value.approvalRequestType === "income_expense"
    && (value.approvalOperation === "create"
      || value.approvalOperation === "update"
      || value.approvalOperation === "delete")
    && value.approvalReasons.length > 0;
}

function hasValidLatestFeedState(
  value: Record<string, unknown>,
  hasApprovalFields: boolean,
  approvalIsValid: boolean,
) {
  if (value.syncStatus === "pending") {
    return approvalIsValid
      && value.approvalRequestType === "income_expense"
      && value.approvalOperation === "create";
  }
  if (value.syncStatus !== "synced") return false;
  if (!hasApprovalFields) return true;
  return approvalIsValid
    && value.approvalRequestType === "income_expense"
    && (value.approvalOperation === "update" || value.approvalOperation === "delete");
}

function hasValidFeedDisplayMetadata(value: Record<string, unknown>) {
  return isOptionalNonBlankString(value.serverBillNo, 300)
    && isOptionalString(value.createdByUserId, 300)
    && isOptionalString(value.createdByName, 1_000)
    && isOptionalString(value.createdByPhone, 100)
    && (value.serverReceivedAt === undefined || isFeedTimestamp(value.serverReceivedAt))
    && (value.saleLineCount === undefined || isNonNegativePostgresInteger(value.saleLineCount))
    && value.saleLines === undefined
    && (value.relationSourceType === undefined || (
      typeof value.relationSourceType === "string"
      && FEED_RELATION_SOURCE_TYPES.has(value.relationSourceType)
    ))
    && isOptionalNonBlankString(value.relationSourceId, 300)
    && (value.relationSourceLocationId === undefined || isUuid(value.relationSourceLocationId))
    && (value.relationSourceDate === undefined || isCanonicalDate(value.relationSourceDate))
    && isOptionalNonBlankString(value.relationLockReason, 1_000)
    && isOptionalNonBlankString(value.relationLabel, 300)
    && (value.reportLockNo === undefined
      || value.reportLockNo === null
      || isNonBlankString(value.reportLockNo, 300));
}

function isZeroCashTransferIncome(
  value: Record<string, unknown>,
  type: unknown,
  billOption: unknown,
  cost: unknown,
) {
  if (type !== "income"
      || billOption !== "รายรับ"
      || cost !== 0
      || value.relationSourceType !== "money_transfer"
      || typeof value.relationSourceId !== "string"
      || !value.relationSourceId.startsWith("cash:")) {
    return false;
  }
  const transferId = value.relationSourceId.slice("cash:".length);
  const derivedId = `cash-transfer-income:${transferId}`;
  return isUuid(transferId)
    && value.id === derivedId
    && value.clientTempId === derivedId
    && value.idempotencyKey === derivedId;
}

function isPinnedLatestCreate(row: Record<string, unknown>) {
  return row.syncStatus === "pending"
    && row.approvalRequestType === "income_expense"
    && row.approvalOperation === "create";
}

export function publicIncomeExpenseErrorMessage(value: unknown, fallback: string) {
  if (typeof value !== "string"
      || value.trim().length === 0
      || value.length > 500
      || CONTROL_CHARACTERS.test(value)
      || DATABASE_ERROR_DETAIL_PATTERN.test(value)
      || (!THAI_CHARACTERS.test(value) && !PUBLIC_ENGLISH_ERROR_MESSAGES.has(value))) {
    return fallback;
  }
  return value;
}

export function isIncomeExpenseSubmission(value: unknown): value is Record<string, unknown> {
  if (!isJsonObject(value)) return false;
  const operation = value.operation;
  const revision = value.expectedRevisionNo;
  const billOption = value.billOption;
  const type = value.type;
  const cost = value.cost;
  const expectedKey = `${String(operation)}:${String(value.clientTempId)}:${String(revision)}`;

  return (operation === "create" || operation === "update" || operation === "delete")
    && isNonNegativePostgresInteger(revision)
    && (operation === "create" ? revision === 0 : revision > 0)
    && isNonBlankString(value.clientTempId, 200)
    && value.idempotencyKey === expectedKey
    && isUuid(value.locationId)
    && value.recordStatus === (operation === "delete" ? "deleted" : "active")
    && isNonBlankString(value.localBillNo, 200)
    && isCanonicalDate(value.txDate)
    && (type === "income" || type === "expense")
    && isNonBlankString(value.title, 1_000)
    && isFiniteNonNegative(cost)
    && (billOption === "รายรับ" || billOption === "บิลขาย" || billOption === "ค่าใช้จ่าย")
    && (type === "income" ? billOption !== "ค่าใช้จ่าย" : billOption === "ค่าใช้จ่าย")
    && (billOption === "บิลขาย" ? cost >= 0 : cost > 0)
    && hasValidSubmissionSaleLines(value, operation, billOption)
    && isIsoTimestamp(value.clientRecordedAt)
    && isIsoTimestamp(value.clientCreatedAt);
}

export function isIncomeExpenseSyncResult(value: unknown, submission: Record<string, unknown>) {
  if (!isJsonObject(value)) return false;
  if (value.status === "synced") {
    const expectedRevision = submission.expectedRevisionNo;
    const revisionMatches = submission.operation === "create"
      ? isSafePositiveInteger(value.revisionNo)
      : isSafePositiveInteger(expectedRevision) && value.revisionNo === expectedRevision + 1;
    return revisionMatches
      && isUuid(value.id)
      && isNonBlankString(value.serverBillNo, 200)
      && isIsoTimestamp(value.serverReceivedAt);
  }
  if (value.status === "pending_approval") {
    return isUuid(value.requestId) && isApprovalReasons(value.matchedReasons);
  }
  if (value.status === "failed" || value.status === "conflict") {
    return isNonBlankString(value.errorMessage);
  }
  return false;
}

function isFeedRow(value: unknown, locationId: string, mode: IncomeExpenseServerFeedMode) {
  if (!isJsonObject(value)) return false;
  const billOption = value.billOption;
  const type = value.type;
  const cost = value.cost;
  const hasApprovalFields = FEED_APPROVAL_FIELDS.some((field) => value[field] !== undefined);
  const approvalIsValid = hasValidFeedApproval(value);
  const statusMatchesMode = mode === "pending_approval"
    ? value.syncStatus === "pending" && approvalIsValid
    : hasValidLatestFeedState(value, hasApprovalFields, approvalIsValid);
  return statusMatchesMode
    && hasValidFeedDisplayMetadata(value)
    && isNonBlankString(value.id, 300)
    && isNonBlankString(value.clientTempId, 300)
    && isNonBlankString(value.idempotencyKey, 300)
    && isNonBlankString(value.localBillNo, 300)
    && value.locationId === locationId
    && value.recordStatus === "active"
    && (type === "income" || type === "expense")
    && isNonBlankString(value.number, 300)
    && isCanonicalDate(value.txDate)
    && isNonBlankString(value.title, 1_000)
    && isFiniteNonNegative(cost)
    && (billOption === "รายรับ" || billOption === "บิลขาย" || billOption === "ค่าใช้จ่าย")
    && (type === "income" ? billOption !== "ค่าใช้จ่าย" : billOption === "ค่าใช้จ่าย")
    && (billOption === "บิลขาย"
      || cost > 0
      || isZeroCashTransferIncome(value, type, billOption, cost))
    && isFeedTimestamp(value.clientRecordedAt)
    && isFeedTimestamp(value.clientCreatedAt)
    && isNonNegativePostgresInteger(value.revisionNo);
}

export function isIncomeExpenseFeedPayload(
  value: unknown,
  locationId: string,
  mode: IncomeExpenseServerFeedMode,
  normalizedSearch: string,
) {
  if (!isJsonObject(value)
      || !Array.isArray(value.rows)
      || typeof value.hasMore !== "boolean"
      || !isNonNegativePostgresInteger(value.pendingApprovalCount)
      || !(value.nextCursor === null || isNonBlankString(value.nextCursor, 4_096))) {
    return false;
  }
  if (value.hasMore !== (typeof value.nextCursor === "string")) return false;
  if (value.hasMore && value.rows.length === 0) return false;
  if (mode === "pending_approval" && value.pendingApprovalCount < value.rows.length) return false;
  if (!value.rows.every((row) => isFeedRow(row, locationId, mode))) return false;
  const rows = value.rows as Array<Record<string, unknown>>;
  let pinnedCount = 0;
  if (mode === "latest") {
    const firstPageableIndex = rows.findIndex((row) => !isPinnedLatestCreate(row));
    pinnedCount = firstPageableIndex === -1 ? rows.length : firstPageableIndex;
    if (rows.slice(pinnedCount).some(isPinnedLatestCreate)
        || rows.length - pinnedCount > 100) {
      return false;
    }
  } else if (rows.length > 100) {
    return false;
  }
  if (!isIncomeExpenseFeedPageOrder(rows, mode, pinnedCount)) return false;
  if (typeof value.nextCursor === "string"
      && !isIncomeExpenseFeedCursor(
        value.nextCursor,
        locationId,
        mode,
        normalizedSearch,
        rows.at(-1)!,
      )) {
    return false;
  }
  const ids = rows.map((row) => row.id);
  const clientIdentities = rows.map((row) => row.clientTempId);
  return new Set(ids).size === ids.length
    && new Set(clientIdentities).size === clientIdentities.length;
}

export function isApprovalRequestResult(value: unknown) {
  if (!isJsonObject(value)) return false;
  if (value.status === "no_approval") return true;
  if (value.status === "pending") {
    return isUuid(value.requestId)
      && (value.requestStatus === undefined || value.requestStatus === "pending")
      && isApprovalReasons(value.matchedReasons);
  }
  return value.status === "failed" && isNonBlankString(value.errorMessage);
}

export function isValidApprovalComment(value: unknown) {
  return value == null || (
    typeof value === "string"
    && value.length <= 1_000
    && !CONTROL_CHARACTERS.test(value)
  );
}

export function isApprovalDecisionResult(value: unknown, requestId: string) {
  if (!isJsonObject(value) || value.requestId !== requestId) return false;
  if (value.status === "approved") return isUuid(value.incomeExpenseId);
  if (value.status === "rejected") return true;
  if (value.status === "conflict" || value.status === "failed") {
    return isNonBlankString(value.errorMessage);
  }
  return false;
}

function numeric(value: unknown) {
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseSaleDetail(
  bill: Record<string, unknown>,
  lines: Array<Record<string, unknown>>,
) {
  if (lines.length < 1 || lines.length > 50) return null;
  const cost = numeric(bill.cost);
  if (!isUuid(bill.id)
      || !isUuid(bill.location_id)
      || bill.bill_option !== "บิลขาย"
      || !isNonBlankString(bill.title, 1_000)
      || cost === null
      || cost < 0
      || !isNonBlankString(bill.server_bill_no, 200)
      || !isCanonicalDate(bill.tx_date)
      || typeof bill.created_by_name !== "string"
      || !isSafePositiveInteger(bill.revision_no)
      || !(bill.report_lock_no == null || isNonBlankString(bill.report_lock_no, 200))) {
    return null;
  }

  const mapped = lines.map((line) => {
    const quantity = numeric(line.quantity);
    const unitPrice = numeric(line.unit_price);
    const lineTotal = numeric(line.line_total);
    if (!isUuid(line.id)
        || !isUuid(line.income_sale_item_id)
        || !isUuid(line.stock_product_id)
        || !isNonBlankString(line.title, 1_000)
        || quantity === null
        || !Number.isSafeInteger(quantity)
        || quantity <= 0
        || unitPrice === null
        || unitPrice < 0
        || lineTotal === null
        || lineTotal < 0
        || Math.abs(lineTotal - quantity * unitPrice) > 0.005
        || !isSafePositiveInteger(line.sequence_no)) {
      return null;
    }
    return {
      id: line.id,
      incomeSaleItemId: line.income_sale_item_id,
      stockProductId: line.stock_product_id,
      title: line.title,
      quantity,
      unitPrice,
      lineTotal,
      sequenceNo: line.sequence_no,
    };
  });
  if (mapped.some((line) => line === null)) return null;
  const sequenceNumbers = mapped.map((line) => line!.sequenceNo);
  if (sequenceNumbers.some((sequenceNo, index) => sequenceNo !== index + 1)) return null;
  const total = mapped.reduce((sum, line) => sum + line!.lineTotal, 0);
  if (Math.abs(total - cost) > 0.005) return null;

  return {
    title: bill.title,
    cost,
    serverBillNo: bill.server_bill_no,
    txDate: bill.tx_date,
    createdByName: bill.created_by_name,
    revisionNo: bill.revision_no,
    reportLockNo: bill.report_lock_no,
    saleLineCount: mapped.length,
    saleLines: mapped,
  };
}
