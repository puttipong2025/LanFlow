import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import { cashTransferErrorResponse } from "@/lib/server/cash-branch-transfer-response";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const { id } = await params;
  const { data, error } = await result.supabase
    .from("money_transfers")
    .select("*, report_lock_no, money_transfer_cash_details(*)")
    .eq("id", id)
    .eq("transfer_type", "cash")
    .eq("transfer_method", "cash")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "ไม่พบรายการเงินสด" }, { status: 404 });
  return NextResponse.json({ transfer: data });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const { id } = await params;
  const { data, error } = await result.supabase.rpc("delete_cash_branch_transfer", { p_transfer_id: id });
  if (error) return cashTransferErrorResponse(error.message);
  return NextResponse.json(data);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const { id } = await params;
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  const { data, error } = await result.supabase.rpc("update_cash_branch_transfer", { p_transfer_id: id, payload });
  if (error) return cashTransferErrorResponse(error.message);
  return NextResponse.json(data);
}
