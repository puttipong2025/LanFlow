import { NextResponse } from "next/server";
import { CASH_COUNT_OVERDUE_CODE, CASH_COUNT_OVERDUE_MESSAGE, isCashCountOverdueError } from "@/lib/cash-count-lock";

export function cashCountLockResponse(message: unknown) {
  return isCashCountOverdueError(message) ? NextResponse.json({
    status: "failed", errorCode: CASH_COUNT_OVERDUE_CODE,
    error: CASH_COUNT_OVERDUE_MESSAGE, errorMessage: CASH_COUNT_OVERDUE_MESSAGE,
  }, { status: 409, headers: { "Cache-Control": "private, no-store" } }) : null;
}
