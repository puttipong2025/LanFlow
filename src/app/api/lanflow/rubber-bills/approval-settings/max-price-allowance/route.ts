import { NextRequest, NextResponse } from "next/server";

import { requireRole } from "@/lib/server/auth";
import {
  isJsonObject,
  isNonNegativeNumeric12Scale2,
  managementAuthFailure,
  managementErrorResponse,
} from "@/lib/server/management-route-error";

export async function PUT(request: NextRequest) {
  const authCheck = await requireRole(request, ["super_admin"]);
  if (!authCheck.ok) return managementAuthFailure(authCheck.response);
  const body: unknown = await request.json().catch(() => null);
  if (!isJsonObject(body)
      || !isNonNegativeNumeric12Scale2(body.maxPriceAllowance)
      || !isNonNegativeNumeric12Scale2(body.expectedMaxPriceAllowance)) {
    return NextResponse.json(
      { errorMessage: "ข้อมูลราคายางที่กำหนดสูงสุดไม่ถูกต้อง" },
      { status: 400 },
    );
  }
  const { data, error } = await authCheck.supabase.rpc("save_rubber_max_price_allowance", {
    p_max_price_allowance: body.maxPriceAllowance,
    p_expected_max_price_allowance: body.expectedMaxPriceAllowance,
  });
  if (error) return managementErrorResponse(error, "บันทึกราคายางที่กำหนดสูงสุดไม่สำเร็จ");
  if (!isJsonObject(data)) {
    return NextResponse.json({ errorMessage: "ระบบไม่ตอบกลับผลการบันทึก" }, { status: 500 });
  }
  const status = data.status;
  return NextResponse.json(data, { status: status === "conflict" ? 409 : 200 });
}
