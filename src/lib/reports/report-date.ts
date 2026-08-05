import { bangkokDateString } from "@/lib/bangkok-date";

export function reportDatePart(value: unknown) {
  if (typeof value !== "string" || value.length === 0) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : bangkokDateString(date);
}
