export const RUBBER_WEIGHT_ALERT_DEFAULT_THRESHOLD_KG = 10_000;
export const RUBBER_WEIGHT_ALERT_MIN_THRESHOLD_KG = 1;
export const RUBBER_WEIGHT_ALERT_MAX_THRESHOLD_KG = 1_000_000;
export const RUBBER_WEIGHT_ALERT_DEFAULT_INTERVAL_MINUTES = 60;
export const RUBBER_WEIGHT_ALERT_MIN_INTERVAL_MINUTES = 1;
export const RUBBER_WEIGHT_ALERT_MAX_INTERVAL_MINUTES = 1_440;

export type RubberWeightAlertConfig = {
  thresholdKg: number;
  intervalMinutes: number;
};

export type RubberWeightAlertCandidate = {
  locationId: string;
  locationName: string;
  netWeight: number;
  groupId: string | null;
  groupOrder: number | null;
  thresholdKg: number | null;
};

export type RubberWeightAlertCheck = {
  config: RubberWeightAlertConfig;
  candidates: RubberWeightAlertCandidate[];
};

export const DEFAULT_RUBBER_WEIGHT_ALERT_CONFIG: RubberWeightAlertConfig = {
  thresholdKg: RUBBER_WEIGHT_ALERT_DEFAULT_THRESHOLD_KG,
  intervalMinutes: RUBBER_WEIGHT_ALERT_DEFAULT_INTERVAL_MINUTES,
};

export function validRubberWeightAlertThreshold(value: unknown): value is number {
  return Number.isInteger(value)
    && Number(value) >= RUBBER_WEIGHT_ALERT_MIN_THRESHOLD_KG
    && Number(value) <= RUBBER_WEIGHT_ALERT_MAX_THRESHOLD_KG;
}

export function validRubberWeightAlertInterval(value: unknown): value is number {
  return Number.isInteger(value)
    && Number(value) >= RUBBER_WEIGHT_ALERT_MIN_INTERVAL_MINUTES
    && Number(value) <= RUBBER_WEIGHT_ALERT_MAX_INTERVAL_MINUTES;
}

export function parseRubberWeightAlertConfig(value: unknown): RubberWeightAlertConfig | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<RubberWeightAlertConfig>;
  if (!validRubberWeightAlertThreshold(candidate.thresholdKg)
    || !validRubberWeightAlertInterval(candidate.intervalMinutes)) {
    return null;
  }
  return {
    thresholdKg: candidate.thresholdKg,
    intervalMinutes: candidate.intervalMinutes,
  };
}

export function resolveRubberWeightAlertConfig(
  primary: unknown,
  fallback?: unknown,
): RubberWeightAlertConfig {
  return parseRubberWeightAlertConfig(primary)
    ?? parseRubberWeightAlertConfig(fallback)
    ?? DEFAULT_RUBBER_WEIGHT_ALERT_CONFIG;
}

export function parseRubberWeightAlertCheck(value: unknown): RubberWeightAlertCheck | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as { config?: unknown; candidates?: unknown };
  const config = parseRubberWeightAlertConfig(payload.config);
  if (!config || !Array.isArray(payload.candidates)) return null;

  const candidates: RubberWeightAlertCandidate[] = [];
  for (const item of payload.candidates) {
    if (!item || typeof item !== "object") return null;
    const candidate = item as Partial<RubberWeightAlertCandidate>;
    if (typeof candidate.locationId !== "string"
      || typeof candidate.locationName !== "string"
      || typeof candidate.netWeight !== "number"
      || !Number.isFinite(candidate.netWeight)) {
      return null;
    }
    const hasGroupMetadata = candidate.groupId !== undefined
      || candidate.groupOrder !== undefined
      || candidate.thresholdKg !== undefined;
    if (hasGroupMetadata && (
      typeof candidate.groupId !== "string"
      || !Number.isInteger(candidate.groupOrder)
      || Number(candidate.groupOrder) < 1
      || !validRubberWeightAlertThreshold(candidate.thresholdKg)
    )) return null;
    candidates.push({
      locationId: candidate.locationId,
      locationName: candidate.locationName,
      netWeight: candidate.netWeight,
      groupId: hasGroupMetadata ? candidate.groupId as string : null,
      groupOrder: hasGroupMetadata ? Number(candidate.groupOrder) : null,
      thresholdKg: hasGroupMetadata ? Number(candidate.thresholdKg) : null,
    });
  }
  return { config, candidates };
}

function lastCheckedKey(userId: string) {
  return `lanflow:rubber-weight-alert:last-checked:v1:${userId}`;
}

export function readRubberWeightAlertLastCheckedAt(userId: string, now = Date.now()) {
  if (!userId) return null;
  try {
    const value = Number(localStorage.getItem(lastCheckedKey(userId)));
    return Number.isFinite(value) && value > 0 && value <= now ? value : null;
  } catch {
    return null;
  }
}

export function writeRubberWeightAlertLastCheckedAt(userId: string, timestamp: number) {
  if (!userId || !Number.isFinite(timestamp) || timestamp <= 0) return;
  try {
    localStorage.setItem(lastCheckedKey(userId), String(timestamp));
  } catch { /* skip unavailable storage */ }
}

export function rubberWeightAlertDelayMs(
  lastCheckedAt: number | null,
  intervalMinutes: number,
  now = Date.now(),
) {
  if (lastCheckedAt === null || !Number.isFinite(lastCheckedAt) || lastCheckedAt > now) return 0;
  if (!validRubberWeightAlertInterval(intervalMinutes)) {
    intervalMinutes = RUBBER_WEIGHT_ALERT_DEFAULT_INTERVAL_MINUTES;
  }
  return Math.max(0, lastCheckedAt + intervalMinutes * 60_000 - now);
}
