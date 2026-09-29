import { NextResponse } from "next/server";
import { calculateCashTotal, isCashDenominationCounts } from "@/lib/cash-branch-transfer";
import { requireAuth } from "@/lib/server/auth";
import { cashTransferErrorResponse } from "@/lib/server/cash-branch-transfer-response";
import { isJsonObject, isUuid } from "@/lib/server/management-route-error";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "ไม่พบรายการเงินสด" }, { status: 404 });
  const { data, error } = await result.supabase.rpc("get_cash_branch_transfer_detail", {
    p_transfer_id: id,
  });
  if (error) {
    if (/not found/i.test(error.message)) {
      return NextResponse.json({ error: "ไม่พบรายการเงินสด" }, { status: 404 });
    }
    if (/access denied|authentication required/i.test(error.message)) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึงรายการเงินสด" }, { status: 403 });
    }
    console.error("Cash branch transfer detail error:", error.message);
    return NextResponse.json({ error: "โหลดรายละเอียดเงินสดไม่สำเร็จ" }, { status: 500 });
  }
  return NextResponse.json({ transfer: data });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  const { data, error } = await result.supabase.rpc("delete_cash_branch_transfer", { p_transfer_id: id });
  if (error) return cashTransferErrorResponse(error.message);
  return NextResponse.json(data);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  const payload: unknown = await request.json().catch(() => null);
  if (
    !isJsonObject(payload)
    || !isUuid(payload.targetLocationId)
    || (payload.note != null && typeof payload.note !== "string")
    || !isCashDenominationCounts(payload.sent)
    || calculateCashTotal(payload.sent) <= 0
  ) {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }
  const { data, error } = await result.supabase.rpc("update_cash_branch_transfer", { p_transfer_id: id, payload });
  if (error) return cashTransferErrorResponse(error.message);
  return NextResponse.json(data);
}
