import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import { cashTransferErrorResponse } from "@/lib/server/cash-branch-transfer-response";

export const dynamic = "force-dynamic";

function canAccess(result: { auth: { role: string; locationIds: string[] } }, locationId: string) {
  return result.auth.role === "super_admin" || result.auth.locationIds.includes(locationId);
}

export async function GET(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const locationId = request.nextUrl.searchParams.get("locationId");
  if (!locationId || !canAccess(result, locationId)) return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึงสาขา" }, { status: 403 });

  const { data, error } = await result.supabase
    .from("money_transfers")
    .select("*, money_transfer_cash_details(*)")
    .eq("transfer_type", "cash")
    .eq("transfer_method", "cash")
    .or(`location_id.eq.${locationId},target_location_id.eq.${locationId}`)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ transfers: data ?? [] });
}

export async function POST(request: Request) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  const { data, error } = await result.supabase.rpc("create_cash_branch_transfer", { payload });
  if (error) return cashTransferErrorResponse(error.message);
  return NextResponse.json(data);
}
