import { NextResponse } from "next/server";
import { isCashDenominationCounts } from "@/lib/cash-branch-transfer";
import { requireAuth } from "@/lib/server/auth";
import { cashTransferErrorResponse } from "@/lib/server/cash-branch-transfer-response";
import { isJsonObject, isUuid } from "@/lib/server/management-route-error";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  const payload: unknown = await request.json().catch(() => null);
  if (
    !isJsonObject(payload)
    || !isCashDenominationCounts(payload.received)
  ) {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }
  const { data, error } = await result.supabase.rpc("receive_cash_branch_transfer", { p_transfer_id: id, payload });
  if (error) return cashTransferErrorResponse(error.message);
  return NextResponse.json(data);
}
