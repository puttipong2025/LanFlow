import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/server/auth";
import { createSupabaseAdminClient } from "@/lib/server/supabase-admin";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminCheck = await requireRole(request, ["super_admin"]);
  if (!adminCheck.ok) return adminCheck.response;

  try {
    const { id: userId } = await params;
    const body = await request.json();

    if (typeof body.canAccessSystemManager !== "boolean") {
      return NextResponse.json(
        { error: "canAccessSystemManager is required and must be a boolean" },
        { status: 400 }
      );
    }

    const admin = createSupabaseAdminClient();
    const { data: updated, error } = await admin
      .from("profiles")
      .update({
        can_access_super_admin_features: body.canAccessSystemManager,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId)
      .eq("role", "admin")
      .eq("is_active", true)
      .select("can_access_money_transfer, can_manage_time_payroll")
      .maybeSingle();

    if (error) throw error;
    if (!updated) {
      return NextResponse.json(
        { error: "ต้องตั้งบัญชีเป็น Admin ที่ใช้งานอยู่ก่อน" },
        { status: 403 },
      );
    }

    return NextResponse.json({
      success: true,
      canAccessSystemManager: body.canAccessSystemManager,
      canAccessMoneyTransfer:
        body.canAccessSystemManager || updated.can_access_money_transfer === true,
      canManageTimePayroll:
        body.canAccessSystemManager || updated.can_manage_time_payroll === true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update system manager access";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
