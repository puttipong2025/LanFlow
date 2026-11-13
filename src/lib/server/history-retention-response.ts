const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validRetentionDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !value.startsWith("0000") && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}

export function validRetentionTimestamp(value: unknown): value is string {
  return typeof value === "string" && validRetentionDate(value.slice(0, 10))
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-5]):[0-5]\d)$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function days(value: unknown) {
  return count(value) && value >= 1 && value <= 365;
}

function counts(value: unknown) {
  return record(value) && Object.values(value).every(count);
}

function nullableTimestamp(value: unknown) {
  return value === null || validRetentionTimestamp(value);
}

function cleanupSummary(value: unknown) {
  return value === null || (record(value) && typeof value.id === "string" && UUID.test(value.id)
    && (value.source === "manual" || value.source === "automatic")
    && (value.status === "running" || value.status === "succeeded" || value.status === "failed")
    && days(value.retentionDays) && validRetentionDate(value.cutoffDate)
    && counts(value.deletedCounts) && counts(value.remainingCounts) && count(value.batches)
    && nullableTimestamp(value.countsAsOf) && nullableTimestamp(value.completedAt)
    && validRetentionTimestamp(value.startedAt)
    && (value.hasMore === null || typeof value.hasMore === "boolean")
    && (value.errorMessage === null || typeof value.errorMessage === "string"));
}

export function validRetentionStatus(value: unknown) {
  return record(value) && days(value.currentDays) && validRetentionDate(value.cutoffDate)
    && validRetentionTimestamp(value.updatedAt) && cleanupSummary(value.lastCleanup);
}

export function validRetentionOverview(value: unknown) {
  if (!record(value) || !validRetentionStatus(value) || !days(value.requestedDays)
    || !(value.totalEligible === null || count(value.totalEligible)) || !Array.isArray(value.groups) || !value.groups.length
    || !(value.updatedByName === null || typeof value.updatedByName === "string")) return false;
  const keys = new Set<string>();
  let total = 0;
  let incomplete = false;
  for (const group of value.groups) {
    if (!record(group) || typeof group.key !== "string" || !group.key || keys.has(group.key)
      || !(group.eligibleCount === null || count(group.eligibleCount))
      || !(group.oldestDate === null || validRetentionDate(group.oldestDate))) return false;
    keys.add(group.key);
    if (group.eligibleCount === null) incomplete = true;
    else total += group.eligibleCount;
  }
  return incomplete ? value.totalEligible === null : total === value.totalEligible;
}

export function validRetentionReceipt(value: unknown) {
  return record(value) && typeof value.runId === "string" && UUID.test(value.runId)
    && (value.status === "running" || value.status === "succeeded" || value.status === "failed");
}
