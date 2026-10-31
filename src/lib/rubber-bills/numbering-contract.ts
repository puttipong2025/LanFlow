export type RubberBillNumbering = { version: 1; issuerId: string; date: string; sequence: number };
export type RubberBillIssuer = { version: 1; id: string; code: string; locationId: string };
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export function isRubberBillIssuer(v: unknown): v is RubberBillIssuer {
  if (!v || typeof v !== "object") return false;
  const x = v as RubberBillIssuer;
  return x.version === 1 && uuid(x.id) && uuid(x.locationId) && /^D\d{2,18}$/.test(x.code);
}
export function isRubberBillNumbering(v: unknown): v is RubberBillNumbering {
  if (!v || typeof v !== "object") return false;
  const x = v as RubberBillNumbering;
  return x.version === 1 && uuid(x.issuerId) && typeof x.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.date)
    && Number.isSafeInteger(x.sequence) && x.sequence > 0;
}
export function rubberBaseNumber(date: string, sequence: number, code: string) {
  return `${String(sequence).padStart(4, "0")}-${date.slice(2).replaceAll("-", "")}-${code}`;
}
export function isNumberedRubberFinal(base: unknown, final: unknown) {
  return typeof base === "string" && typeof final === "string" && final.startsWith(`${base}-`)
    && /^[1-9]\d{0,18}$/.test(final.slice(base.length + 1));
}
