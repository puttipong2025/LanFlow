import { NextRequest, NextResponse } from "next/server";
import { requireSystemManager } from "@/lib/server/auth";
import { isJsonObject, isUuid } from "@/lib/server/management-route-error";
import { isMatchingApprovalDecision } from "@/lib/income-expense/approval-decision-response";
import {
  isApprovalDecisionResult,
  isValidApprovalComment,
  publicIncomeExpenseErrorMessage,
} from "@/lib/income-expense/contracts";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
  const adminCheck = await requireSystemManager(request);
  if (!adminCheck.ok) return adminCheck.response;

    const { id } = await params;
    const body: unknown = await request.json().catch(() => null);
    if (!isJsonObject(body)) {
      return NextResponse.json({ status: "failed", errorMessage: "Invalid request body" }, { status: 400 });
    }
    const decision = body.decision;

    if (!isUuid(id)) {
      return NextResponse.json({ status: "failed", errorMessage: "Invalid request ID" }, { status: 400 });
    }

    if (decision !== "approved" && decision !== "rejected") {
      return NextResponse.json({ status: "failed", errorMessage: "Invalid decision" }, { status: 400 });
    }
    const requestId = id.toLowerCase();
    if (!isValidApprovalComment(body.comment)) {
      return NextResponse.json({ status: "failed", errorMessage: "Invalid request body" }, { status: 400 });
    }

    const { data, error } = await adminCheck.supabase.rpc(
      "decide_income_expense_approval_request",
      {
        p_request_id: requestId,
        p_decision: decision,
        p_comment: typeof body.comment === "string" ? body.comment : null,
      }
    );

    if (error) {
      console.error("RPC decide_income_expense_approval_request error:", error);
      return NextResponse.json({ status: "failed", errorMessage: "ดำเนินการคำขอไม่สำเร็จ" }, { status: 503 });
    }

    const rawResult = isJsonObject(data) ? data : {};
    const result = (rawResult.status === "conflict" || rawResult.status === "failed")
      && rawResult.requestId === undefined
      ? { ...rawResult, requestId }
      : rawResult;
    if (!isApprovalDecisionResult(result, requestId)
        || ((result.status === "approved" || result.status === "rejected") && !isMatchingApprovalDecision(result, requestId, decision))) {
      return NextResponse.json(
        { status: "failed", errorMessage: "ระบบไม่ตอบกลับผลการอนุมัติตามรูปแบบที่กำหนด" },
        { status: 500 },
      );
    }
    if (result.status === "approved") {
      return NextResponse.json({ requestId, status: result.status, incomeExpenseId: result.incomeExpenseId });
    }
    if (result.status === "rejected") {
      return NextResponse.json({ requestId, status: result.status });
    }

    return NextResponse.json({
      requestId,
      status: result.status,
      errorMessage: publicIncomeExpenseErrorMessage(result.errorMessage, "ดำเนินการคำขอไม่สำเร็จ"),
    }, { status: result.status === "conflict" ? 409 : 400 });
  } catch (error: unknown) {
    console.error("Decide income-expense approval request API error:", error);
    return NextResponse.json({ status: "failed", errorMessage: "ดำเนินการคำขอไม่สำเร็จ" }, {
      status: 503, headers: { "Cache-Control": "private, no-store" },
    });
  }
}
