import { NextRequest, NextResponse } from "next/server";

import { requireRole } from "@/lib/server/auth";
import {
  isJsonObject,
  managementAuthFailure,
  managementErrorResponse,
} from "@/lib/server/management-route-error";
import { isRubberPriceAllowanceAutoResetSaveResult } from "@/lib/server/rubber-approval-groups";

export async function PUT(request: NextRequest) {
  try {
    const authCheck = await requireRole(request, ["super_admin"]);
    if (!authCheck.ok) return managementAuthFailure(authCheck.response);
    const body: unknown = await request.json().catch(() => null);
    if (!isJsonObject(body)
        || Object.keys(body).some((key) => key !== "enabled" && key !== "expectedEnabled")
        || typeof body.enabled !== "boolean"
        || typeof body.expectedEnabled !== "boolean") {
      return NextResponse.json(
        { errorMessage: "ข้อมูลการรีเซ็ตราคายางอัตโนมัติไม่ถูกต้อง" },
        { status: 400 },
      );
    }
    const { data, error } = await authCheck.supabase.rpc(
      "save_rubber_price_allowance_auto_reset",
      {
        p_enabled: body.enabled,
        p_expected_enabled: body.expectedEnabled,
      },
    );
    if (error) {
      return managementErrorResponse(error, "บันทึกการรีเซ็ตราคายางอัตโนมัติไม่สำเร็จ");
    }
    if (!isRubberPriceAllowanceAutoResetSaveResult(data, body.enabled, body.expectedEnabled)) {
      return NextResponse.json({ errorMessage: "ระบบไม่ตอบกลับผลการบันทึก" }, { status: 500 });
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ errorMessage: "ระบบตั้งค่าบิลยางไม่พร้อมใช้งาน กรุณาลองอีกครั้ง" }, {
      status: 503, headers: { "Cache-Control": "private, no-store" },
    });
  }
}
