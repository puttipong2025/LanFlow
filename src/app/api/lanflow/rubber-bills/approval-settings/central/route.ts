import { NextRequest, NextResponse } from "next/server";

import { requireSystemManager } from "@/lib/server/auth";
import {
  isJsonObject,
  isNonNegativeNumeric12Scale2,
  isSafePositiveInteger,
  managementAuthFailure,
  managementErrorResponse,
} from "@/lib/server/management-route-error";

export async function PUT(request: NextRequest) {
  const authCheck = await requireSystemManager(request);
  if (!authCheck.ok) return managementAuthFailure(authCheck.response);
  const body: unknown = await request.json().catch(() => null);
  if (!isJsonObject(body)
      || !isNonNegativeNumeric12Scale2(body.centralPrice)
      || body.centralPrice === 0
      || !isSafePositiveInteger(body.expectedRevision)) {
    return NextResponse.json({ errorMessage: "ข้อมูลราคากลางไม่ถูกต้อง" }, { status: 400 });
  }
  const { data, error } = await authCheck.supabase.rpc("save_rubber_central_price", {
    p_central_price: body.centralPrice,
    p_expected_revision: body.expectedRevision,
  });
  if (error) return managementErrorResponse(error, "บันทึกราคากลางไม่สำเร็จ");
  return NextResponse.json({ ...(data as Record<string, unknown>), canEditQuota: authCheck.auth.role === "super_admin" });
}
