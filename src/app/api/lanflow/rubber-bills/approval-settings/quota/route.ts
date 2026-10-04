import { NextRequest, NextResponse } from "next/server";

import { requireRole } from "@/lib/server/auth";
import {
  isJsonObject,
  isNonNegativePostgresInteger,
  isUuid,
  managementAuthFailure,
  managementErrorResponse,
} from "@/lib/server/management-route-error";

export async function PUT(request: NextRequest) {
  const authCheck = await requireRole(request, ["super_admin"]);
  if (!authCheck.ok) return managementAuthFailure(authCheck.response);
  const body: unknown = await request.json().catch(() => null);
  if (!isJsonObject(body)
      || !isNonNegativePostgresInteger(body.quotaLimit)
      || !isUuid(body.expectedRoundId)) {
    return NextResponse.json({ errorMessage: "ข้อมูลโควต้าไม่ถูกต้อง" }, { status: 400 });
  }
  const { data, error } = await authCheck.supabase.rpc("save_rubber_admin_quota", {
    p_quota_limit: body.quotaLimit,
    p_expected_round_id: body.expectedRoundId,
  });
  if (error) return managementErrorResponse(error, "บันทึกโควต้าไม่สำเร็จ");
  return NextResponse.json({ ...(data as Record<string, unknown>), canEditQuota: true });
}
