const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSTGRES_INTEGER_MAX = 2_147_483_647;
const POSTGRES_NUMERIC_12_2_MAX = 9_999_999_999.99;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string"
      || value.startsWith("0000")
      || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-5]):[0-5]\d)$/.test(value)
      || !Number.isFinite(Date.parse(value))) {
    return false;
  }
  const calendarDate = value.slice(0, 10);
  return new Date(`${calendarDate}T00:00:00.000Z`).toISOString().slice(0, 10)
    === calendarDate;
}

export function isNonNegativePostgresInteger(value: unknown): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= 0
    && value <= POSTGRES_INTEGER_MAX;
}

export function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

export function isNonNegativeNumeric12Scale2(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= 0
    && value <= POSTGRES_NUMERIC_12_2_MAX
    && Number(value.toFixed(2)) === value;
}
