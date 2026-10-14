import { NextRequest, NextResponse } from "next/server";

import { requireRole } from "@/lib/server/auth";
import {
  isJsonObject,
  isUuid,
  managementAuthFailure,
  managementErrorResponse,
} from "@/lib/server/management-route-error";
import { isRubberPriceAllowanceAutoResetLockSaveResult } from "@/lib/server/rubber-approval-groups";

const GROUP_KEYS = new Set(["scope", "groupId", "locked", "expectedLocked"]);
const UNGROUPED_KEYS = new Set(["scope", "locked", "expectedLocked"]);

export async function PUT(request: NextRequest) {
  const authCheck = await requireRole(request, ["super_admin"]);
  if (!authCheck.ok) return managementAuthFailure(authCheck.response);
  const body: unknown = await request.json().catch(() => null);
  if (!isJsonObject(body)
      || (body.scope !== "group" && body.scope !== "ungrouped")
      || typeof body.locked !== "boolean"
      || typeof body.expectedLocked !== "boolean") {
    return NextResponse.json({ errorMessage: "ข้อมูลล็อกรีเซ็ตราคายางไม่ถูกต้อง" }, { status: 400 });
  }
  const keys = Object.keys(body);
  const isGroup = body.scope === "group";
  if ((isGroup && (!keys.every((key) => GROUP_KEYS.has(key)) || !isUuid(body.groupId)))
      || (!isGroup && !keys.every((key) => UNGROUPED_KEYS.has(key)))) {
    return NextResponse.json({ errorMessage: "ข้อมูลล็อกรีเซ็ตราคายางไม่ถูกต้อง" }, { status: 400 });
  }
  const groupId = isGroup ? (body.groupId as string).toLowerCase() : undefined;
  const { data, error } = await authCheck.supabase.rpc(
    "save_rubber_price_allowance_auto_reset_lock",
    {
      p_scope: body.scope,
      p_group_id: groupId ?? null,
      p_locked: body.locked,
      p_expected_locked: body.expectedLocked,
    },
  );
  if (error) {
    return managementErrorResponse(error, "บันทึกล็อกรีเซ็ตราคายางไม่สำเร็จ");
  }
  if (!isRubberPriceAllowanceAutoResetLockSaveResult(data, {
    scope: body.scope,
    groupId,
    locked: body.locked,
    previousLocked: body.expectedLocked,
  })) {
    return NextResponse.json({ errorMessage: "ระบบไม่ตอบกลับผลการบันทึก" }, { status: 500 });
  }
  return NextResponse.json(data);
}
