import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import { cashTransferErrorResponse } from "@/lib/server/cash-branch-transfer-response";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const body = await request.json().catch(() => null);
  const { id } = await params;
  const { data, error } = await result.supabase.rpc("accept_cash_branch_difference", { p_transfer_id: id, p_reason: body?.reason });
  if (error) return cashTransferErrorResponse(error.message);
  return NextResponse.json(data);
}
