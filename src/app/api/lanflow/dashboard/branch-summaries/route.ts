import { NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/server/auth";
import { isIsoTimestamp, isJsonObject, isUuid } from "@/lib/server/management-route-error";
import type { DashboardBranchSummary } from "@/types/dashboard";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
const SNAPSHOT_STATUSES = new Set(["dirty", "queued", "running", "ready", "failed"]);
const CASH_STATUSES = new Set(["low", "normal", "unconfigured", "no_data"]);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPurchaseToday(value: unknown) {
  if (!isJsonObject(value)) return false;
  return isNonNegativeInteger(value.billCount)
    && isFiniteNumber(value.netWeight)
    && isFiniteNumber(value.paidTotal)
    && (value.averagePrice === null || isFiniteNumber(value.averagePrice))
    && isFiniteNumber(value.rubberValue)
    && isFiniteNumber(value.deductionTotal)
    && isNonNegativeInteger(value.unpricedBillCount)
    && isNonNegativeInteger(value.pendingApprovalCount);
}

function isBranchSummary(value: unknown): value is DashboardBranchSummary {
  if (!isJsonObject(value)
    || !isUuid(value.locationId)
    || value.locationId !== value.locationId.toLowerCase()
    || !(value.snapshotStatus === null
      || (typeof value.snapshotStatus === "string" && SNAPSHOT_STATUSES.has(value.snapshotStatus)))
    || !(value.calculatedAt === null || isIsoTimestamp(value.calculatedAt))
    || typeof value.isOverdue !== "boolean"
    || typeof value.cashStatus !== "string"
    || !CASH_STATUSES.has(value.cashStatus)) {
    return false;
  }
  if ((value.summary === null) !== (value.calculatedAt === null)) return false;
  if (value.isOverdue && (value.snapshotStatus === null || value.snapshotStatus === "ready")) return false;
  if (value.snapshotStatus === null && value.summary !== null) return false;
  if (value.snapshotStatus === "ready" && value.summary === null) return false;
  if (value.summary === null) return value.cashStatus === "no_data";
  if (!isJsonObject(value.summary) || value.cashStatus === "no_data") return false;
  return isFiniteNumber(value.summary.netCashFlow)
    && isFiniteNumber(value.summary.rubberInventoryWeight)
    && isPurchaseToday(value.summary.purchaseToday);
}

function isBranchSummaryResponse(value: unknown): value is DashboardBranchSummary[] {
  if (!Array.isArray(value)) return false;
  const locationIds = new Set<string>();
  return value.every((summary) => {
    if (!isBranchSummary(summary) || locationIds.has(summary.locationId)) return false;
    locationIds.add(summary.locationId);
    return true;
  });
}

export async function GET(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;

  const failure = () => NextResponse.json(
    { error: "โหลดสรุปภาพรวมสาขาไม่สำเร็จ" },
    { status: 500, headers: NO_STORE_HEADERS },
  );
  try {
    const { data, error } = await result.supabase.rpc("get_dashboard_branch_summaries");
    if (error) {
      console.error("Dashboard branch summaries error:", error.message);
      return failure();
    }
    if (!isBranchSummaryResponse(data)) {
      console.error("Dashboard branch summaries contract mismatch");
      return failure();
    }
    return NextResponse.json(data, { headers: NO_STORE_HEADERS });
  } catch {
    console.error("Dashboard branch summaries request failed");
    return failure();
  }
}
