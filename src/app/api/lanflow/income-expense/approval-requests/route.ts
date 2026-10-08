import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import {
  isApprovalRequestResult,
  isIncomeExpenseSubmission,
  publicIncomeExpenseErrorMessage,
} from "@/lib/income-expense/contracts";

type ApprovalRpcResponse = {
  status?: string;
  errorMessage?: string;
};

export async function POST(request: NextRequest) {
  const authCheck = await requireAuth(request);
  if (!authCheck.ok) return authCheck.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ status: "failed", errorMessage: "Invalid request body" }, { status: 400 });
  }
  if (!isIncomeExpenseSubmission(payload)) {
    return NextResponse.json({ status: "failed", errorMessage: "Invalid request body" }, { status: 400 });
  }

  try {
    const { data, error } = await authCheck.supabase.rpc(
      "create_income_expense_approval_request",
      { payload }
    );

    if (error) {
      console.error("RPC create_income_expense_approval_request error:", error);
      return NextResponse.json({ status: "failed", errorMessage: "ตรวจสอบคำขออนุมัติไม่สำเร็จ" }, { status: 503 });
    }

    const result = (data || {}) as ApprovalRpcResponse;
    if (!isApprovalRequestResult(result)) {
      return NextResponse.json(
        { status: "failed", errorMessage: "ระบบไม่ตอบกลับผลคำขออนุมัติตามรูปแบบที่กำหนด" },
        { status: 500 },
      );
    }
    if (result.status === "pending" || result.status === "no_approval") {
      return NextResponse.json(result, { status: 200 });
    }

    if (result.status === "failed") {
      return NextResponse.json({
        ...result,
        errorMessage: publicIncomeExpenseErrorMessage(result.errorMessage, "ตรวจสอบคำขออนุมัติไม่สำเร็จ"),
      }, { status: 400 });
    }
    return NextResponse.json(
      { status: "failed", errorMessage: "ระบบไม่ตอบกลับผลคำขออนุมัติตามรูปแบบที่กำหนด" },
      { status: 500 },
    );
  } catch (error: unknown) {
    console.error("Create income-expense approval request API error:", error);
    return NextResponse.json({ status: "failed", errorMessage: "ตรวจสอบคำขออนุมัติไม่สำเร็จ" }, { status: 503 });
  }
}
