import { CASH_COUNT_OVERDUE_CODE } from "./cash-count-lock";

export function isCashCountLockSyncResponse(body: unknown) {
  return !!body && typeof body === "object" && (body as Record<string, unknown>).errorCode === CASH_COUNT_OVERDUE_CODE;
}
export function isRetryableSyncResponse(status: number, body?: unknown) {
  return status === 401
    || status === 408
    || status === 425
    || status === 429
    || status >= 500
    || (status === 409 && isCashCountLockSyncResponse(body));
}
