import { NextResponse } from "next/server";
import { parsePendingWorkDetail } from "@/lib/pending-work-blockers";

export const PENDING_WORK_BLOCKED = "PENDING_WORK_BLOCKED";

type DatabaseErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
};

export function pendingWorkErrorResponse(error: DatabaseErrorLike): NextResponse | null {
  if (error.message !== PENDING_WORK_BLOCKED) return null;

  let detail: unknown;
  try {
    detail = JSON.parse(error.details ?? "");
  } catch {
    detail = null;
  }

  const blockers = parsePendingWorkDetail(detail);
  if (!blockers) {
    console.error("PENDING_WORK_BLOCKED returned invalid details", {
      code: error.code,
      hasDetails: Boolean(error.details),
    });
    return NextResponse.json(
      { error: "ตรวจสอบงานค้างไม่สำเร็จ กรุณาลองใหม่" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    error: "ยังมีงานค้างที่ต้องจัดการก่อนดำเนินการ",
    blockers,
  }, { status: 409 });
}
