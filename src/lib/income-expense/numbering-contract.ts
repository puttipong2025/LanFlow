import { isRubberBillNumbering, isNumberedRubberFinal, type RubberBillNumbering } from "@/lib/rubber-bills/numbering-contract";

export type IncomeExpenseNumbering = RubberBillNumbering;
export type IncomeNumberState = {
  version: 1;
  hasIssued: boolean;
  counters: Record<string, number>;
  reservations: Record<string, { base: string; metadata: IncomeExpenseNumbering; type: "income" | "expense" }>;
};
export function incomeBaseNumber(type: "income" | "expense", date: string, sequence: number, code: string) {
  return `${type === "income" ? "I" : "E"}-${String(sequence).padStart(4, "0")}-${date.slice(2).replaceAll("-", "")}-${code}`;
}
export function incomeApprovalBillNumber(payload: Record<string, unknown> | null, final: unknown) {
  if (!isRubberBillNumbering(payload?.billNumbering) || typeof payload?.localBillNo !== "string") return undefined;
  return isNumberedRubberFinal(payload.localBillNo, final) ? String(final) : payload.localBillNo;
}
export function validIncomeNumberState(value: unknown, issuerId?: string, code?: string): value is IncomeNumberState {
  if (!value || typeof value !== "object") return false;
  const x = value as IncomeNumberState;
  return x.version === 1 && !!x.counters && typeof x.counters === "object" && !Array.isArray(x.counters)
    && !!x.reservations && typeof x.reservations === "object" && !Array.isArray(x.reservations)
    && typeof x.hasIssued === "boolean" && x.hasIssued === (Object.keys(x.counters).length > 0)
    && x.hasIssued === (Object.keys(x.reservations).length > 0)
    && Object.values(x.counters).every(n => Number.isSafeInteger(n) && n >= 0)
    && Object.values(x.reservations).every(r => {
      if (!r || typeof r.base !== "string" || !isRubberBillNumbering(r.metadata) || !["income", "expense"].includes(r.type)) return false;
      const { date, sequence } = r.metadata, parsed = new Date(`${date}T00:00:00Z`);
      const own = r.metadata.issuerId === issuerId, suffix = r.base?.split("-").at(-1) ?? "";
      return !date.startsWith("0000") && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
        && /^D\d{2,18}$/.test(suffix) && (!own || suffix === code)
        && r.base === incomeBaseNumber(r.type, date, sequence, suffix)
        && (!own || (x.counters[`${r.type}:${date}`] ?? -1) >= sequence);
    });
}
