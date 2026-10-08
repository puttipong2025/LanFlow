import { NextResponse } from "next/server";

type ErrorLike = { code?: string; message?: string } | null | undefined;

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

export function managementErrorResponse(error: ErrorLike, fallback: string) {
  const message = error?.message ?? "";
  const known = [
    { prefix: "FORBIDDEN:", status: 403 },
    { prefix: "RUBBER_GROUP_NOT_FOUND:", status: 404 },
    { prefix: "RUBBER_WEIGHT_ALERT_GROUP_NOT_FOUND:", status: 404 },
    { prefix: "RUBBER_LOCATION_NOT_FOUND:", status: 404 },
    { prefix: "ADMIN_USER_NOT_FOUND:", status: 404 },
    { prefix: "ADMIN_AUDIT_NOT_FOUND:", status: 404 },
    { prefix: "RUBBER_GROUP_BRANCH_CONFLICT:", status: 409 },
    { prefix: "RUBBER_CENTRAL_PRICE_STALE:", status: 409 },
    { prefix: "RUBBER_UNGROUPED_STALE:", status: 409 },
    { prefix: "RUBBER_ALLOWANCE_STALE:", status: 409 },
    { prefix: "RUBBER_GROUP_STALE:", status: 409 },
    { prefix: "RUBBER_WEIGHT_ALERT_GROUP_BRANCH_CONFLICT:", status: 409 },
    { prefix: "ADMIN_REQUEST_CONFLICT:", status: 409 },
    { prefix: "RUBBER_GROUP_EMPTY:", status: 400 },
    { prefix: "RUBBER_GROUP_DUPLICATE_BRANCH:", status: 400 },
    { prefix: "RUBBER_GROUP_INVALID_BRANCH:", status: 400 },
    { prefix: "RUBBER_GROUP_INVALID:", status: 400 },
    { prefix: "RUBBER_CENTRAL_PRICE_INVALID:", status: 400 },
    { prefix: "RUBBER_EFFECTIVE_PRICE_CAP_INVALID:", status: 400 },
    { prefix: "RUBBER_ALLOWANCE_INVALID:", status: 400 },
    { prefix: "RUBBER_ALLOWANCE_LIMIT_TOO_LOW:", status: 400 },
    { prefix: "RUBBER_ALLOWANCE_LIMIT_EXCEEDED:", status: 400 },
    { prefix: "RUBBER_EDIT_WINDOW_INVALID:", status: 400 },
    { prefix: "RUBBER_WEIGHT_ALERT_GROUP_EMPTY:", status: 400 },
    { prefix: "RUBBER_WEIGHT_ALERT_GROUP_INVALID:", status: 400 },
    { prefix: "ADMIN_PROFILE_INVALID:", status: 400 },
    { prefix: "ADMIN_AUDIT_INVALID:", status: 400 },
  ].find(({ prefix }) => message.includes(prefix));

  if (!known) {
    return NextResponse.json({ errorMessage: fallback }, { status: 500 });
  }
  const errorMessage = message.slice(message.indexOf(known.prefix) + known.prefix.length).trim();
  return NextResponse.json({ errorMessage }, { status: known.status });
}

export function opaqueRpcErrorResponse(
  error: ErrorLike,
  fallback: string,
  businessErrorCodes: readonly string[],
) {
  const status = error?.code && businessErrorCodes.includes(error.code) ? 400 : 500;
  return NextResponse.json({ errorMessage: fallback }, { status });
}

export async function managementAuthFailure(response: NextResponse) {
  let errorMessage = "ไม่มีสิทธิ์เข้าถึง";
  try {
    const payload = await response.clone().json() as { error?: string; errorMessage?: string };
    errorMessage = payload.errorMessage ?? payload.error ?? errorMessage;
  } catch {
    // Keep the stable public message when an upstream auth response is not JSON.
  }
  return NextResponse.json(
    { errorMessage },
    { status: response.status, headers: response.headers },
  );
}
