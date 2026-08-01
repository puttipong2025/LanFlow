import { NextRequest, NextResponse } from "next/server";
import { requireSystemManager } from "@/lib/server/auth";
import { createSupabaseAdminClient } from "@/lib/server/supabase-admin";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const manager = await requireSystemManager(request);
  if (!manager.ok) return manager.response;

  try {
    const { id: userId } = await params;
    const body = await request.json();
    if (typeof body.canManageTimePayroll !== "boolean") {
      return NextResponse.json(
        { error: "canManageTimePayroll is required and must be a boolean" },
        { status: 400 }
      );
    }

    const admin = createSupabaseAdminClient();
    const { data: target, error: targetError } = await admin
      .from("profiles")
      .select("role, can_access_super_admin_features")
      .eq("id", userId)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
    if (target.role === "super_admin" || target.can_access_super_admin_features === true) {
      return NextResponse.json(
        { error: "ผู้จัดการระบบมีสิทธิ์เวลาและเงินเดือนโดยอัตโนมัติ" },
        { status: 403 }
      );
    }

    const { error } = await admin
      .from("profiles")
      .update({
        can_manage_time_payroll: body.canManageTimePayroll,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);
    if (error) throw error;

    return NextResponse.json({
      success: true,
      canManageTimePayroll: body.canManageTimePayroll,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update Time and Payroll access";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
