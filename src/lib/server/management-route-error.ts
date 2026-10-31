import { NextResponse } from "next/server";
import { cashCountLockResponse } from "@/lib/server/cash-count-lock-response";

type ErrorLike = { code?: string; message?: string } | null | undefined;

export { isUuid, isJsonObject, isIsoTimestamp, isNonNegativePostgresInteger, isSafePositiveInteger, isNonNegativeNumeric12Scale2 } from "@/lib/validation/primitives";

export function managementErrorResponse(error: ErrorLike, fallback: string) {
  const locked = cashCountLockResponse(error?.message); if (locked) return locked;
  const message = error?.message ?? "";
  const known = error?.code === "P0001" ? [
    { prefix: "FORBIDDEN:", status: 403 },
    { prefix: "RUBBER_GROUP_NOT_FOUND:", status: 404 },
    { prefix: "RUBBER_WEIGHT_ALERT_GROUP_NOT_FOUND:", status: 404 },
    { prefix: "RUBBER_LOCATION_NOT_FOUND:", status: 404 },
    { prefix: "CASH_ALERT_GROUP_NOT_FOUND:", status: 404 },
    { prefix: "CASH_ALERT_GROUP_BRANCH_CONFLICT:", status: 409 },
    { prefix: "CASH_ALERT_GROUP_EMPTY:", status: 400 },
    { prefix: "CASH_ALERT_GROUP_INVALID:", status: 400 },
    { prefix: "ADMIN_USER_NOT_FOUND:", status: 404 },
    { prefix: "ADMIN_AUDIT_NOT_FOUND:", status: 404 },
    { prefix: "RUBBER_GROUP_BRANCH_CONFLICT:", status: 409 },
    { prefix: "RUBBER_CENTRAL_PRICE_STALE:", status: 409 },
    { prefix: "RUBBER_UNGROUPED_STALE:", status: 409 },
    { prefix: "RUBBER_ALLOWANCE_STALE:", status: 409 },
    { prefix: "RUBBER_AUTO_RESET_LOCK_STALE:", status: 409 },
    { prefix: "RUBBER_AUTO_RESET_STALE:", status: 409 },
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
    { prefix: "RUBBER_AUTO_RESET_LOCK_INVALID:", status: 400 },
    { prefix: "RUBBER_AUTO_RESET_INVALID:", status: 400 },
    { prefix: "RUBBER_EDIT_WINDOW_INVALID:", status: 400 },
    { prefix: "RUBBER_WEIGHT_ALERT_GROUP_EMPTY:", status: 400 },
    { prefix: "RUBBER_WEIGHT_ALERT_GROUP_INVALID:", status: 400 },
    { prefix: "ADMIN_PROFILE_INVALID:", status: 400 },
    { prefix: "ADMIN_AUDIT_INVALID:", status: 400 },
  ].find(({ prefix }) => message.startsWith(prefix)) : undefined;

  if (!known) {
    return NextResponse.json({ errorMessage: fallback }, { status: 500 });
  }
  const errorMessage = message.slice(known.prefix.length).trim();
  return NextResponse.json({ errorMessage }, { status: known.status });
}

export function opaqueRpcErrorResponse(
  error: ErrorLike,
  fallback: string,
  businessErrorCodes: readonly string[],
) {
  const locked = cashCountLockResponse(error?.message); if (locked) return locked;
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
