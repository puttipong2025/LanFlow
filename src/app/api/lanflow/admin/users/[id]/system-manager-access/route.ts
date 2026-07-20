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
    const { data: targetUser, error: targetError } = await admin
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();

    if (targetError) throw targetError;
    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (targetUser.role === "super_admin") {
      return NextResponse.json(
        { error: "super_admin manages system permissions directly" },
        { status: 403 }
      );
    }

    const { error } = await admin
      .from("profiles")
      .update({
        can_access_super_admin_features: body.canAccessSystemManager,
        can_access_money_transfer: body.canAccessSystemManager,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (error) throw error;

    return NextResponse.json({
      success: true,
      canAccessSystemManager: body.canAccessSystemManager,
      canAccessMoneyTransfer: body.canAccessSystemManager,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update system manager access";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
