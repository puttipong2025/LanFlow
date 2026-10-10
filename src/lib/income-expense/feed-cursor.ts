const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-5]):[0-5]\d)$/;
const POSTGRES_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?[+-](?:0\d|1[0-5])(?::?[0-5]\d)?$/;
const TIMESTAMP_PARTS_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/;

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonBlankString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

export function isCanonicalDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

export function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && !value.startsWith("0000")
    && ISO_TIMESTAMP_PATTERN.test(value)
    && Number.isFinite(Date.parse(value))
    && isCanonicalDate(value.slice(0, 10));
}

export function isFeedTimestamp(value: unknown): value is string {
  return isIsoTimestamp(value) || (
    typeof value === "string"
    && !value.startsWith("0000")
    && POSTGRES_TIMESTAMP_PATTERN.test(value)
    && Number.isFinite(Date.parse(value))
    && isCanonicalDate(value.slice(0, 10))
  );
}

function feedTimestampMicros(value: unknown) {
  if (!isFeedTimestamp(value)) return null;
  const parts = TIMESTAMP_PARTS_PATTERN.exec(value);
  if (!parts) return null;
  const [, year, month, day, hour, minute, second, fraction = "", zone] = parts;
  const offsetSign = zone === "Z" || zone[0] === "+" ? 1 : -1;
  const offset = zone === "Z" ? "0000" : zone.slice(1).replace(":", "").padEnd(4, "0");
  const offsetMinutes = offsetSign * (Number(offset.slice(0, 2)) * 60 + Number(offset.slice(2)));
  const wholeSecond = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  ) - offsetMinutes * 60_000;
  return BigInt(wholeSecond) * BigInt(1_000) + BigInt(fraction.padEnd(6, "0"));
}

function feedRowSortKey(row: Record<string, unknown>) {
  const id = row.id;
  if (typeof id !== "string") return null;
  if (id.startsWith("money-transfer-income:")) {
    return typeof row.relationSourceId === "string" ? `transfer-income:${row.relationSourceId}` : null;
  }
  if (id.startsWith("money-transfer-branch-expense:")) {
    return typeof row.relationSourceId === "string" ? `transfer-expense:${row.relationSourceId}` : null;
  }
  if (id.startsWith("money-transfer-branch-paid-expense:")) {
    return typeof row.relationSourceId === "string"
      ? `customer-transfer-expense:${row.relationSourceId}`
      : null;
  }
  if (id.startsWith("cash-transfer-expense:")
      || id.startsWith("cash-transfer-income:")
      || id.startsWith("time-tracking-withdrawal:")
      || id.startsWith("time-tracking-withdrawal-adjustment:")
      || id.startsWith("payroll-slip:")
      || id.startsWith("rubber-export-expense:")) {
    return id;
  }
  if (row.relationSourceType === "rubber_bill_daily") {
    return typeof row.relationSourceId === "string" ? `rubber:${row.relationSourceId}` : null;
  }
  return `actual:${id}`;
}

function approvalRowPosition(row: Record<string, unknown>) {
  const key = row.approvalRequestType === "cash_transfer_delete"
    ? `cash-delete:${row.approvalRequestId}`
    : `income:${row.approvalRequestId}`;
  const at = row.approvalRequestType === "cash_transfer_delete"
    ? row.clientRecordedAt
    : row.serverReceivedAt;
  const micros = feedTimestampMicros(at);
  return micros === null ? null : { primary: micros, key };
}

function isOrdered<T extends string | bigint>(
  rows: Record<string, unknown>[],
  position: (row: Record<string, unknown>) => { primary: T; key: string } | null,
  direction: "asc" | "desc",
) {
  const positions = rows.map(position);
  if (positions.some((value) => value === null)) return false;
  for (let index = 1; index < positions.length; index += 1) {
    const previous = positions[index - 1]!;
    const current = positions[index]!;
    const outOfOrder = direction === "asc"
      ? previous.primary > current.primary
        || (previous.primary === current.primary && previous.key > current.key)
      : previous.primary < current.primary
        || (previous.primary === current.primary && previous.key < current.key);
    if (outOfOrder) return false;
  }
  return true;
}

export function isIncomeExpenseFeedPageOrder(
  rows: Record<string, unknown>[],
  mode: "latest" | "pending_approval",
  pinnedCount: number,
) {
  if (mode === "pending_approval") return isOrdered(rows, approvalRowPosition, "asc");
  const pinnedRows = rows.slice(0, pinnedCount);
  const pageableRows = rows.slice(pinnedCount);
  return isOrdered(pinnedRows, approvalRowPosition, "desc")
    && isOrdered(pageableRows, (row) => {
      const key = feedRowSortKey(row);
      return typeof row.txDate === "string" && key ? { primary: row.txDate, key } : null;
    }, "desc");
}

export function isIncomeExpenseFeedCursor(
  value: string,
  locationId: string,
  mode: "latest" | "pending_approval",
  normalizedSearch: string,
  lastRow: Record<string, unknown>,
) {
  if (value.length % 2 !== 0 || !/^[0-9a-f]+$/.test(value)) return false;
  try {
    const bytes = new Uint8Array(value.length / 2);
    for (let index = 0; index < value.length; index += 2) {
      bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
    }
    const encodedBytes = Array.from(bytes, (byte) => `%${byte.toString(16).padStart(2, "0")}`).join("");
    const cursor: unknown = JSON.parse(decodeURIComponent(encodedBytes));
    if (!isJsonObject(cursor)
        || cursor.v !== 1
        || cursor.locationId !== locationId
        || cursor.mode !== mode
        || cursor.search !== normalizedSearch.toLowerCase()
        || !isNonBlankString(cursor.key, 300)) {
      return false;
    }
    if (mode === "latest") {
      return cursor.sort === "tx_date_desc"
        && cursor.date === lastRow.txDate
        && cursor.key === feedRowSortKey(lastRow);
    }
    const expectedKey = lastRow.approvalRequestType === "cash_transfer_delete"
      ? `cash-delete:${lastRow.approvalRequestId}`
      : `income:${lastRow.approvalRequestId}`;
    const expectedAt = lastRow.approvalRequestType === "cash_transfer_delete"
      ? lastRow.clientRecordedAt
      : lastRow.serverReceivedAt;
    return cursor.sort === "requested_at_asc"
      && isFeedTimestamp(cursor.at)
      && cursor.key === expectedKey
      && feedTimestampMicros(cursor.at) === feedTimestampMicros(expectedAt);
  } catch {
    return false;
  }
}
