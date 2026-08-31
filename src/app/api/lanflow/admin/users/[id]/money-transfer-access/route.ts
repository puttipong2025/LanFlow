import { NextRequest, NextResponse } from "next/server";
import { requireSystemManager } from "@/lib/server/auth";
import { createSupabaseAdminClient } from "@/lib/server/supabase-admin";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminCheck = await requireSystemManager(request);
  if (!adminCheck.ok) return adminCheck.response;

  try {
    const { id: userId } = await params;
    const body = await request.json();

    if (typeof body.canAccessMoneyTransfer !== "boolean") {
      return NextResponse.json(
        { error: "canAccessMoneyTransfer is required and must be a boolean" },
        { status: 400 }
      );
    }

    const admin = createSupabaseAdminClient();
    const { data: updated, error } = await admin
      .from("profiles")
      .update({
        can_access_money_transfer: body.canAccessMoneyTransfer,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId)
      .eq("role", "admin")
      .eq("is_active", true)
      .eq("can_access_super_admin_features", false)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!updated) {
      return NextResponse.json(
        { error: "ต้องเป็น Admin ที่ใช้งานอยู่และไม่ใช่ผู้จัดการระบบ" },
        { status: 403 },
      );
    }

    return NextResponse.json({
      success: true,
      canAccessMoneyTransfer: body.canAccessMoneyTransfer,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update Money Transfer access";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
