import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/server/auth";
import { createSupabaseAdminClient } from "@/lib/server/supabase-admin";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminCheck = await requireRole(request, ["super_admin", "admin"]);
  if (!adminCheck.ok) return adminCheck.response;

  try {
    const { id: userId } = await params;
    const body = await request.json();

    if (typeof body.isActive !== "boolean") {
      return NextResponse.json(
        { error: "isActive is required and must be a boolean" },
        { status: 400 }
      );
    }

    if (userId === adminCheck.auth.sub) {
      return NextResponse.json(
        { error: "ไม่สามารถเปลี่ยนสถานะบัญชีของตัวเองได้" },
        { status: 403 }
      );
    }

    // We use admin client because ordinary admins might not have RLS permission to update all profiles
    const admin = createSupabaseAdminClient();

    const { error } = await admin
      .from("profiles")
      .update({ is_active: body.isActive })
      .eq("id", userId);

    if (error) throw error;

    return NextResponse.json({ success: true, isActive: body.isActive });
  } catch (error: any) {
    console.error("Admin user status update error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
