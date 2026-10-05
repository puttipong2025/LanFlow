import { NextRequest, NextResponse } from "next/server";

import { requireSystemManager } from "@/lib/server/auth";
import {
  isJsonObject,
  isNonNegativeNumeric12Scale2,
  isNonNegativePostgresInteger,
  isSafePositiveInteger,
  managementAuthFailure,
  managementErrorResponse,
} from "@/lib/server/management-route-error";

export async function PUT(request: NextRequest) {
  const authCheck = await requireSystemManager(request);
  if (!authCheck.ok) return managementAuthFailure(authCheck.response);
  const body: unknown = await request.json().catch(() => null);
  if (!isJsonObject(body)
      || !isNonNegativePostgresInteger(body.editWindowMinutes)
      || !isNonNegativeNumeric12Scale2(body.priceAllowance)
      || !isSafePositiveInteger(body.expectedRevision)) {
    return NextResponse.json({ errorMessage: "ข้อมูลกลุ่มเริ่มต้นไม่ถูกต้อง" }, { status: 400 });
  }
  const { data, error } = await authCheck.supabase.rpc("save_rubber_ungrouped_defaults", {
    p_edit_window_minutes: body.editWindowMinutes,
    p_price_allowance: body.priceAllowance,
    p_expected_revision: body.expectedRevision,
  });
  if (error) return managementErrorResponse(error, "บันทึกกลุ่มเริ่มต้นไม่สำเร็จ");
  return NextResponse.json({ ...(data as Record<string, unknown>), canEditMaxPriceAllowance: authCheck.auth.role === "super_admin" });
}
