const DAILY_WAGE_PATTERN = /^\d+(?:\.\d{1,4})?$/;

export function parseDailyWageInput(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!DAILY_WAGE_PATTERN.test(value)) return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
