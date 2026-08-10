import { NextResponse } from "next/server";
import { hasSystemManagerAccess, type AuthTokenPayload } from "@/lib/server/auth";
import type { RubberExportSummary } from "@/types/rubber-exports";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function canManageRubberExports(auth: AuthTokenPayload, locationId: string) {
  return hasSystemManagerAccess(auth)
    || (auth.role === "admin" && auth.locationIds.includes(locationId));
}

export function rubberExportErrorResponse(message: string) {
  if (message.includes("ไม่มีสิทธิ์") || message.includes("access denied")) {
    return NextResponse.json({ error: message }, { status: 403 });
  }
  if (message.includes("ไม่พบ")) {
    return NextResponse.json({ error: message }, { status: 404 });
  }
  if (
    message.includes("INVALID_RUBBER_BILL") ||
    message.includes("RUBBER_EXPORT_SELECTION") ||
    message.includes("REPORT_LOCKED") ||
    message.includes("RUBBER_EXPORT_LOCKED") ||
    message.includes("RUBBER_EXPORT_FUTURE_BILL") ||
    message.includes("BRANCH_RECEIPT_SOURCE_LOCKED") ||
    message.includes("BRANCH_RECEIPT_SOURCE_STALE") ||
    message.includes("RUBBER_EXPORT_SOLD_OUT") ||
    message.includes("ถูกจอง") ||
    message.includes("ฉบับร่าง") ||
    message.includes("ตรวจสอบแล้ว") ||
    message.includes("ลบแล้ว") ||
    message.includes("น้ำหนัก")
  ) {
    return NextResponse.json({ error: message }, { status: 409 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function mapRubberExportRow(row: Record<string, any>): RubberExportSummary {
  const location = Array.isArray(row.locations) ? row.locations[0] : row.locations;
  const itemCount = Array.isArray(row.rubber_export_items)
    ? row.rubber_export_items[0]?.count ?? row.rubber_export_items.length
    : 0;
  return {
    id: row.id,
    exportNo: row.export_no,
    locationId: row.location_id,
    locationName: location?.name ?? "",
    status: row.status,
    previousStatus: row.previous_status,
    originalWeightTotal: number(row.original_weight_total),
    paidTotal: number(row.paid_total),
    averagePrice: number(row.average_price),
    currentWeight: row.current_weight === null ? null : number(row.current_weight),
    weightLossPercent: row.weight_loss_percent === null ? null : number(row.weight_loss_percent),
    workRate: row.work_rate === null ? null : number(row.work_rate),
    otherOperatingCost: number(row.other_operating_cost),
    workTotal: row.work_total === null ? null : number(row.work_total),
    expenseDestination: row.expense_destination,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    verifiedByName: row.verified_by_name,
    verifiedAt: row.verified_at,
    soldOutAt: row.sold_out_at ?? null,
    soldOutByName: row.sold_out_by_name ?? null,
    deletedByName: row.deleted_by_name,
    deletedAt: row.deleted_at,
    itemCount: number(itemCount),
    reportLockNo: row.report_lock_no,
    ageCalculatedAt: row.age_calculated_at ?? null,
    averageAgeHours: row.average_age_hours === null || row.average_age_hours === undefined
      ? null : number(row.average_age_hours),
    oldestAgeHours: row.oldest_age_hours === null || row.oldest_age_hours === undefined
      ? null : number(row.oldest_age_hours),
    estimatedAgeItemCount: row.estimated_age_item_count === null || row.estimated_age_item_count === undefined
      ? null : number(row.estimated_age_item_count),
    officialAgeCutoffAt: row.official_age_cutoff_at ?? null,
    officialAverageAgeHours: row.official_average_age_hours === null || row.official_average_age_hours === undefined
      ? null : number(row.official_average_age_hours),
    officialOldestAgeHours: row.official_oldest_age_hours === null || row.official_oldest_age_hours === undefined
      ? null : number(row.official_oldest_age_hours),
    officialEstimatedAgeItemCount: row.official_estimated_age_item_count === null || row.official_estimated_age_item_count === undefined
      ? null : number(row.official_estimated_age_item_count),
    receiptBillId: row.receipt_bill_id ?? null,
    receiptBillNo: row.receipt_bill_no ?? null,
    receiptLocationName: row.receipt_location_name ?? null,
  };
}
