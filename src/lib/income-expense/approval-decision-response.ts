import { isJsonObject, isUuid } from "@/lib/validation/primitives";

export function isMatchingApprovalDecision(value: unknown, requestId: string, decision: "approved" | "rejected"): value is Record<string, unknown> {
  return isJsonObject(value) && isUuid(value.requestId) && isUuid(requestId)
    && value.requestId.toLowerCase() === requestId.toLowerCase() && value.status === decision;
}

export async function readApprovalDecisionResponse(
  response: Response, requestId: string, decision: "approved" | "rejected", requireIncomeExpenseId = false,
) {
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isJsonObject(data) ? data.errorMessage ?? data.error : null;
    throw new Error(typeof message === "string" ? message : "ดำเนินการคำขอไม่สำเร็จ");
  }
  if (!isMatchingApprovalDecision(data, requestId, decision)
      || (requireIncomeExpenseId && decision === "approved" && !isUuid(data.incomeExpenseId))) {
    throw new Error("ยังยืนยันผลการพิจารณาไม่ได้ กรุณาโหลดรายการล่าสุดก่อนทำรายการต่อ");
  }
  return data;
}
