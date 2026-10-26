export const CASH_COUNT_OVERDUE_CODE = "CASH_COUNT_OVERDUE_LOCKED";
export const CASH_COUNT_OVERDUE_MESSAGE = "สาขาเกินกำหนดนับเงิน กรุณานับเงินหรือให้ผู้มีสิทธิ์ปลดล็อกชั่วคราว หากมีงานค้างต้องปลดล็อกเพื่อจัดการก่อนเริ่มนับ";
export function isCashCountOverdueError(value: unknown) {
  return typeof value === "string" && value.includes(CASH_COUNT_OVERDUE_CODE);
}
export type CashCountLockState = {
  locationId: string; locationName: string; groupId: string; enabled: boolean; locked: boolean;
  dueDate: string; lockAt: string | null; unlockedUntil: string | null;
  unlockedAt: string | null; unlockedByName: string | null; canUnlock: boolean;
  contacts: Array<{ id: string; name: string }>;
};
export function parseCashCountLocks(value: unknown): { states: CashCountLockState[]; serverNow: string } | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (typeof body.serverNow !== "string" || !Number.isFinite(Date.parse(body.serverNow)) || !Array.isArray(body.states)) return null;
  for (const entry of body.states) {
    if (!entry || typeof entry !== "object") return null;
    const state = entry as Record<string, unknown>;
    if (!["locationId", "locationName", "groupId", "dueDate"].every((key) => typeof state[key] === "string")
      || !["enabled", "locked", "canUnlock"].every((key) => typeof state[key] === "boolean")
      || !["lockAt", "unlockedUntil", "unlockedAt"].every((key) => state[key] === null || (typeof state[key] === "string" && Number.isFinite(Date.parse(state[key] as string))))
      || !(state.unlockedByName === null || typeof state.unlockedByName === "string")
      || !Array.isArray(state.contacts) || !state.contacts.every((contact) => contact && typeof contact.id === "string" && typeof contact.name === "string")) return null;
  }
  return body as { states: CashCountLockState[]; serverNow: string };
}
