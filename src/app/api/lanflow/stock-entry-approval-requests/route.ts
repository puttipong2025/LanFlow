import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";

type StockEntryApprovalRpcResponse = {
  status?: string;
  errorMessage?: string;
};

export async function POST(request: NextRequest) {
  const authCheck = await requireAuth(request);
  if (!authCheck.ok) return authCheck.response;

  try {
    const payload = await request.json();
    const { data, error } = await authCheck.supabase.rpc(
      "create_stock_entry_delete_approval_request",
      { payload }
    );

    if (error) {
      console.error("RPC create_stock_entry_delete_approval_request error:", error);
      return NextResponse.json({ status: "failed", errorMessage: error.message }, { status: 500 });
    }

    const result = (data || {}) as StockEntryApprovalRpcResponse;
    if (result.status === "pending") {
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
    console.error("Create stock entry approval request API error:", message);
    return NextResponse.json({ status: "failed", errorMessage: message }, { status: 500 });
  }
}
