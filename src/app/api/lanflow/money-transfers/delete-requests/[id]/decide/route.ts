import { NextResponse } from "next/server";

import { requireSystemManager } from "@/lib/server/auth";
import { isJsonObject, isUuid } from "@/lib/server/management-route-error";

function isDeleteDecisionResult(
  value: unknown,
  expectedId: string,
  expectedDecision: "approved" | "rejected",
) {
  return isJsonObject(value)
    && value.requestId === expectedId
    && value.status === expectedDecision;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSystemManager(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  const requestId = id.toLowerCase();
  const payload: unknown = await request.json().catch(() => null);
  if (!isJsonObject(payload) || (payload.decision !== "approved" && payload.decision !== "rejected")) {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }
  if (payload.comment != null && typeof payload.comment !== "string") {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }
  const comment = payload.comment?.trim() || null;
  if (comment && comment.length > 500) {
    return NextResponse.json({ error: "เหตุผลยาวเกินไป" }, { status: 400 });
  }
  const { data, error } = await auth.supabase.rpc("decide_branch_transfer_delete_request", {
    p_request_id: requestId,
    p_decision: payload.decision,
    p_comment: comment || null,
  });
  if (error) {
    if (/เฉพาะผู้จัดการระบบ|ไม่มีสิทธิ์/.test(error.message)) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์ดำเนินการคำขอนี้" }, { status: 403 });
    }
    if (/ไม่พบ/.test(error.message)) {
      return NextResponse.json({ error: "ไม่พบคำขอลบรายการโอนเงิน" }, { status: 404 });
    }
    if (/ถูกดำเนินการแล้ว/.test(error.message)) {
      return NextResponse.json({ error: "คำขอนี้ถูกดำเนินการแล้ว" }, { status: 409 });
    }
    if (/ถูกแก้ไขแล้ว|REVISION_CONFLICT/.test(error.message)) {
      return NextResponse.json({ error: "คำขอลบถูกแก้ไขแล้ว กรุณาโหลดใหม่" }, { status: 409 });
    }
    if (/REPORT_LOCKED/.test(error.message)) {
      return NextResponse.json({ error: "รายการถูกล็อกโดยรายงาน ต้องลบรายงานล่าสุดก่อน" }, { status: 409 });
    }
    console.error("Branch transfer delete decision failed", { code: error.code });
    return NextResponse.json({ error: "ดำเนินการคำขอลบไม่สำเร็จ" }, { status: 500 });
  }
  if (!isDeleteDecisionResult(data, requestId, payload.decision)) {
    console.error("Branch transfer delete decision contract mismatch", { id: requestId });
    return NextResponse.json(
      { error: "ระบบไม่ตอบกลับผลการตัดสินคำขอลบตามรูปแบบที่กำหนด" },
      { status: 500 },
    );
  }
  return NextResponse.json(data);
}
