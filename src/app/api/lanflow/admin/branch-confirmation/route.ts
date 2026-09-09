import { NextRequest, NextResponse } from "next/server";

import { validBranchConfirmationMinutes } from "@/lib/lanflow/branch-create-guard";
import { requireSystemManager } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE_HEADERS });
}

export async function PUT(request: NextRequest) {
  const result = await requireSystemManager(request);
  if (!result.ok) return result.response;
  const body = await request.json().catch(() => null) as {
    confirmationMinutes?: unknown;
  } | null;
  if (!validBranchConfirmationMinutes(body?.confirmationMinutes)) {
    return errorResponse("ระยะยืนยันสาขาต้องอยู่ระหว่าง 1 ถึง 120 นาที", 400);
  }

  const { data, error } = await result.supabase.rpc(
    "save_branch_create_confirmation_minutes",
    { p_confirmation_minutes: body.confirmationMinutes },
  );
  if (error) {
    if (error.message.includes("FORBIDDEN")) {
      return errorResponse("ไม่มีสิทธิ์จัดการการตั้งค่านี้", 403);
    }
    if (error.message.includes("BRANCH_CONFIRMATION_INVALID")) {
      return errorResponse("ระยะยืนยันสาขาต้องอยู่ระหว่าง 1 ถึง 120 นาที", 400);
    }
    console.error("Branch confirmation setting save failed", error.message);
    return errorResponse("บันทึกระยะยืนยันสาขาไม่สำเร็จ", 500);
  }

  return NextResponse.json({ confirmationMinutes: data }, { headers: NO_STORE_HEADERS });
}
