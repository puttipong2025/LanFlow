import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/server/auth";
import { createSupabaseAdminClient } from "@/lib/server/supabase-admin";
import { isJsonObject } from "@/lib/server/management-route-error";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminCheck = await requireRole(request, ["super_admin"]);
  if (!adminCheck.ok) return adminCheck.response;

  try {
    const body: unknown = await request.json();
    if (!isJsonObject(body)) {
      return NextResponse.json({ error: "Invalid role specified" }, { status: 400 });
    }
    const { role } = body;
    if (typeof role !== "string" || !["user", "admin"].includes(role)) {
      return NextResponse.json({ error: "Invalid role specified" }, { status: 400 });
    }

    const targetUserId = (await params).id;
    if (!targetUserId) {
      return NextResponse.json({ error: "Missing user ID" }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    const updates = role === "user"
      ? {
          role,
          can_access_super_admin_features: false,
          can_access_money_transfer: false,
          can_manage_time_payroll: false,
          can_manage_rubber_exports: false,
          updated_at: new Date().toISOString(),
        }
      : { role, updated_at: new Date().toISOString() };
    const { data: updated, error: updateError } = await admin
      .from("profiles")
      .update(updates)
      .eq("id", targetUserId)
      .eq("is_active", true)
      .in("role", ["user", "admin"])
      .select("id")
      .maybeSingle();

    if (updateError) throw updateError;
    if (!updated) {
      return NextResponse.json(
        { error: "บัญชีนี้ไม่สามารถเปลี่ยนบทบาทได้" },
        { status: 403 },
      );
    }

    return NextResponse.json({ success: true, role });
  } catch (error: any) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid role specified" }, { status: 400 });
    }
    console.error("Admin role update error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
