export type IssuerRow = { id: string; code: string; locationId: string; locationName: string | null;
  browser: string; platform: string; lastUserName: string | null; createdAt: string; lastSeenAt: string;
  retiredAt: string | null; retiredByName: string | null };
export type IssuerPage = { total: number; rows: IssuerRow[] };
export function isIssuerPage(value: unknown): value is IssuerPage {
  if (!value || typeof value !== "object") return false;
  const v = value as IssuerPage;
  return Number.isSafeInteger(v.total) && v.total >= 0 && Array.isArray(v.rows) && v.rows.length <= 100
    && v.rows.every(row => row && typeof row === "object"
      && [row.id, row.code, row.locationId, row.browser, row.platform, row.createdAt, row.lastSeenAt].every(x => typeof x === "string")
      && [row.createdAt, row.lastSeenAt, ...(row.retiredAt ? [row.retiredAt] : [])].every(x => Number.isFinite(Date.parse(x)))
      && [row.locationName, row.lastUserName, row.retiredAt, row.retiredByName].every(x => x === null || typeof x === "string"));
}
