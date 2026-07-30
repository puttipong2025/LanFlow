export function isRetryableSyncResponse(status: number) {
  return status === 401
    || status === 408
    || status === 425
    || status === 429
    || status >= 500;
}
