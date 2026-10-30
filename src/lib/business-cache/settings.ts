export type BusinessCacheSettings = { intervalMinutes: number | null; revision: number };
export const businessCacheSettingsKey = (owner: string) => ["businessCacheSettings", owner] as const;

export function isCacheInterval(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isInteger(value) && value >= 10 && value <= 120);
}

export function isBusinessCacheSettings(value: unknown): value is BusinessCacheSettings {
  if (!value || typeof value !== "object") return false;
  const row = value as BusinessCacheSettings;
  return isCacheInterval(row.intervalMinutes) && Number.isSafeInteger(row.revision) && row.revision >= 1;
}
