import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/server/auth";

type DecisionRpcResponse = {
  status?: string;
  errorMessage?: string;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminCheck = await requireRole(request, ["super_admin"]);
  if (!adminCheck.ok) return adminCheck.response;

  try {
    const { id } = await params;
    const body = await request.json();
    const decision = body?.decision;

    if (!id) {
      return NextResponse.json({ status: "failed", errorMessage: "Missing request ID" }, { status: 400 });
    }

    if (decision !== "approved" && decision !== "rejected") {
      return NextResponse.json({ status: "failed", errorMessage: "Invalid decision" }, { status: 400 });
    }

    const { data, error } = await adminCheck.supabase.rpc(
      "decide_income_expense_approval_request",
      {
        p_request_id: id,
        p_decision: decision,
        p_comment: typeof body?.comment === "string" ? body.comment : null,
      }
    );

    if (error) {
      console.error("RPC decide_income_expense_approval_request error:", error);
      return NextResponse.json({ status: "failed", errorMessage: error.message }, { status: 500 });
    }

    const result = (data || {}) as DecisionRpcResponse;
    if (result.status === "approved" || result.status === "rejected") {
      return NextResponse.json(result, { status: 200 });
    }

    if (result.status === "failed") {
      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json(
      { status: "failed", errorMessage: `Unexpected RPC status: ${String(result.status)}` },
      { status: 500 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Decide income-expense approval request API error:", message);
    return NextResponse.json({ status: "failed", errorMessage: message }, { status: 500 });
  }
}
