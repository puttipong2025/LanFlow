import { NextRequest, NextResponse } from "next/server";
import { requireSystemManager } from "@/lib/server/auth";
import { cashTransferErrorResponse } from "@/lib/server/cash-branch-transfer-response";
import { isJsonObject, isUuid } from "@/lib/server/management-route-error";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const manager = await requireSystemManager(request);
  if (!manager.ok) return manager.response;

  const { id } = await params;
  const body: unknown = await request.json().catch(() => null);
  if (
    !isUuid(id)
    || !isJsonObject(body)
    || (body.decision !== "approved" && body.decision !== "rejected")
    || (body.comment != null && typeof body.comment !== "string")
  ) {
    return NextResponse.json({ error: "ข้อมูลคำตัดสินไม่ถูกต้อง" }, { status: 400 });
  }

  try {
    const { data, error } = await manager.supabase.rpc(
      "decide_cash_transfer_delete_request",
      {
        p_request_id: id,
        p_decision: body.decision,
        p_comment: typeof body.comment === "string" ? body.comment : null,
      },
    );

    if (error) return cashTransferErrorResponse(error.message);
    if (!isJsonObject(data) || !isUuid(data.requestId)
      || data.requestId.toLowerCase() !== id.toLowerCase() || data.status !== body.decision) {
      return cashTransferErrorResponse("CASH_TRANSFER_DECISION_RESPONSE_INVALID");
    }
    return NextResponse.json(data);
  } catch {
    return cashTransferErrorResponse("CASH_TRANSFER_DECISION_UNAVAILABLE");
  }
}
