import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireSystemManager } from "@/lib/server/auth";
import { isUuid } from "@/lib/server/management-route-error";
import { cashCountErrorResponse, cashCountUnavailableResponse } from "@/lib/server/cash-count-response";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;
    const locationId = request.nextUrl.searchParams.get("locationId");
    if (locationId !== null && !isUuid(locationId)) return cashCountErrorResponse("รหัสสาขาไม่ถูกต้อง");
    const { data, error } = await auth.supabase.rpc("get_cash_count_overdue_status", { p_location_id: locationId });
    if (error) return error.message.includes("ไม่มีสิทธิ์") ? cashCountErrorResponse("ไม่มีสิทธิ์ดูสถานะล็อก") : cashCountUnavailableResponse();
    return NextResponse.json(data, { headers });
  } catch { return cashCountUnavailableResponse(); }
}
export async function POST(request: Request) {
  try {
    const auth = await requireSystemManager(request);
    if (!auth.ok) return auth.response;
    const body = await request.json().catch(() => null);
    if (!isUuid(body?.locationId)) return cashCountErrorResponse("รหัสสาขาไม่ถูกต้อง");
    const { data, error } = await auth.supabase.rpc("unlock_cash_count_overdue", { p_location_id: body.locationId });
    if (error) return error.message.includes("ไม่มีสิทธิ์") ? cashCountErrorResponse("ไม่มีสิทธิ์ปลดล็อกสาขา") : cashCountUnavailableResponse();
    return NextResponse.json(data, { headers });
  } catch { return cashCountUnavailableResponse(); }
}
