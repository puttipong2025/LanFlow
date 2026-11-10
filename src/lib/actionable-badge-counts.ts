import { tabs, type Tab } from "@/components/lanflow/tabs";
import { isJsonObject } from "@/lib/validation/primitives";

export type ModuleBadgeCounts = Partial<Record<Tab, number>>;
export type ActionableBadgeCounts = Record<string, ModuleBadgeCounts>;

// PostgreSQL UUID output also permits legacy/nil UUIDs, not just RFC v1-v5.
const databaseUuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function parseActionableBadgeCounts(value: unknown): ActionableBadgeCounts {
  if (!Array.isArray(value)) throw new Error("รูปแบบจำนวนงานไม่ถูกต้อง");
  const counts: ActionableBadgeCounts = {};
  const totals: Record<string, number> = {};
  for (const row of value) {
    if (!isJsonObject(row) || typeof row.location_id !== "string" || !databaseUuidPattern.test(row.location_id)
      || typeof row.item_count !== "number" || !Number.isSafeInteger(row.item_count) || row.item_count < 0) {
      throw new Error("รูปแบบจำนวนงานไม่ถูกต้อง");
    }
    const moduleId = tabs.find(tab => tab.id === row.module_id)?.id;
    if (!moduleId) throw new Error("ไม่รู้จักประเภทงาน");
    const locationId = row.location_id.toLowerCase();
    const branch = counts[locationId] ??= {};
    if (Object.hasOwn(branch, moduleId)) throw new Error("จำนวนงานของสาขาซ้ำกัน");
    const total = (totals[locationId] ?? 0) + row.item_count;
    if (!Number.isSafeInteger(total)) throw new Error("จำนวนงานเกินขอบเขต");
    totals[locationId] = total;
    branch[moduleId] = row.item_count;
  }
  return counts;
}
