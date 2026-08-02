import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import { cashCountErrorResponse } from "@/lib/server/cash-count-response";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const locationId = request.nextUrl.searchParams.get("locationId");
  if (!locationId) return cashCountErrorResponse("กรุณาระบุสาขา");
  const { data, error } = await result.supabase.rpc("get_cash_count_session", { p_location_id: locationId });
  if (error) return cashCountErrorResponse(error.message);
  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: Request) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const body = await request.json().catch(() => null) as { locationId?: string } | null;
  if (!body?.locationId) return cashCountErrorResponse("กรุณาระบุสาขา");
  const { data, error } = await result.supabase.rpc("start_cash_count_session", { p_location_id: body.locationId });
  if (error) return cashCountErrorResponse(error.message);
  return NextResponse.json(data, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function DELETE(request: Request) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const body = await request.json().catch(() => null) as { sessionId?: string } | null;
  if (!body?.sessionId) return cashCountErrorResponse("กรุณาระบุช่วงตรวจนับ");
  const { data, error } = await result.supabase.rpc("cancel_cash_count_session", { p_session_id: body.sessionId });
  if (error) return cashCountErrorResponse(error.message);
  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
