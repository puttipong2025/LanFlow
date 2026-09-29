import { NextRequest, NextResponse } from "next/server";
import {
  hasSystemManagerAccess,
  requireAuth,
  type AuthTokenPayload,
} from "@/lib/server/auth";
import { cashTransferErrorResponse } from "@/lib/server/cash-branch-transfer-response";
import { calculateCashTotal, isCashDenominationCounts } from "@/lib/cash-branch-transfer";
import { isJsonObject, isUuid } from "@/lib/server/management-route-error";

export const dynamic = "force-dynamic";

function canAccess(result: { auth: AuthTokenPayload }, locationId: string) {
  return hasSystemManagerAccess(result.auth) || result.auth.locationIds.includes(locationId);
}

export async function GET(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const locationId = request.nextUrl.searchParams.get("locationId");
  const view = request.nextUrl.searchParams.get("view") ?? "pending";
  if (view !== "pending") return NextResponse.json({ error: "พารามิเตอร์รายการเงินสดไม่ถูกต้อง" }, { status: 400 });
  if (!isUuid(locationId)) return NextResponse.json({ error: "พารามิเตอร์รายการเงินสดไม่ถูกต้อง" }, { status: 400 });
  if (!canAccess(result, locationId)) return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึงสาขา" }, { status: 403 });

  const { data, error } = await result.supabase.rpc("get_cash_branch_transfer_pending_summary", {
    p_location_id: locationId,
  });
  if (error) {
    console.error("Cash branch transfer pending summary error:", error.message);
    return NextResponse.json({ error: "โหลดคิวรอรับเงินสดไม่สำเร็จ" }, { status: 500 });
  }
  return NextResponse.json(data ?? { transfers: [], total: 0 });
}

export async function POST(request: Request) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const payload: unknown = await request.json().catch(() => null);
  if (
    !isJsonObject(payload)
    || !isUuid(payload.sourceLocationId)
    || !isUuid(payload.targetLocationId)
    || (payload.id != null && !isUuid(payload.id))
    || (payload.clientTempId != null && (
      typeof payload.clientTempId !== "string" || payload.clientTempId.trim() === ""
    ))
    || (payload.idempotencyKey != null && (
      typeof payload.idempotencyKey !== "string" || payload.idempotencyKey.trim() === ""
    ))
    || (payload.note != null && typeof payload.note !== "string")
    || !isCashDenominationCounts(payload.sent)
    || calculateCashTotal(payload.sent) <= 0
  ) {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }
  const { data, error } = await result.supabase.rpc("create_cash_branch_transfer", { payload });
  if (error) return cashTransferErrorResponse(error.message);
  return NextResponse.json(data);
}
