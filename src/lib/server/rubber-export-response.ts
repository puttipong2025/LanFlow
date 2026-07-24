import { NextResponse } from "next/server";
import { hasSystemManagerAccess, type AuthTokenPayload } from "@/lib/server/auth";
import type { RubberExportSummary } from "@/types/rubber-exports";

export function canManageRubberExports(auth: AuthTokenPayload, locationId: string) {
  return hasSystemManagerAccess(auth)
    || (auth.role === "admin" && auth.locationIds.includes(locationId));
}

export function rubberExportErrorResponse(message: string) {
  if (message.includes("ไม่มีสิทธิ์") || message.includes("access denied")) {
    return NextResponse.json({ error: message }, { status: 403 });
  }
  if (
    message.includes("INVALID_RUBBER_BILL") ||
    message.includes("REPORT_LOCKED") ||
    message.includes("RUBBER_EXPORT_LOCKED") ||
    message.includes("cutoff") ||
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
    cutoffAt: row.cutoff_at,
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
    deletedByName: row.deleted_by_name,
    deletedAt: row.deleted_at,
    itemCount: number(itemCount),
    reportLockNo: row.report_lock_no,
  };
}
