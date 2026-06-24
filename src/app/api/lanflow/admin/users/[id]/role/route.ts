import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/server/auth";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminCheck = await requireRole(request, ["super_admin"]);
  if (!adminCheck.ok) return adminCheck.response;

  try {
    const { role } = await request.json();
    if (!role || !["user", "admin"].includes(role)) {
      return NextResponse.json({ error: "Invalid role specified" }, { status: 400 });
    }

    const targetUserId = (await params).id;
    if (!targetUserId) {
      return NextResponse.json({ error: "Missing user ID" }, { status: 400 });
    }

    const supabase = adminCheck.supabase;

    // Ensure target user is not a super_admin
    const { data: targetUser, error: checkError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", targetUserId)
      .single();

    if (checkError || !targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (targetUser.role === "super_admin") {
      return NextResponse.json({ error: "Cannot change role of super_admin" }, { status: 403 });
    }

    // Update role
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ role, updated_at: new Date().toISOString() })
      .eq("id", targetUserId);

    if (updateError) throw updateError;

    return NextResponse.json({ success: true, role });
  } catch (error: any) {
    console.error("Admin role update error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
