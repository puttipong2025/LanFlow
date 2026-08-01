import { NextRequest, NextResponse } from "next/server";
import { hasSystemManagerAccess, requireRoleOrSystemManager, requireSystemManager } from "@/lib/server/auth";

export async function PATCH(request: NextRequest) {
  const manager = await requireSystemManager(request);
  if (!manager.ok) return manager.response;

  try {
    const { userId, locationId } = await request.json();
    if (!userId || !locationId) {
      return NextResponse.json({ error: "Missing userId or locationId" }, { status: 400 });
    }

    const { data, error } = await manager.supabase.rpc("set_user_primary_location", {
      p_user_id: userId,
      p_location_id: locationId,
    });
    if (error) throw error;
    return NextResponse.json({ success: true, result: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not change primary location";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const adminCheck = await requireRoleOrSystemManager(request, ["super_admin", "admin"]);
  if (!adminCheck.ok) return adminCheck.response;

  try {
    const { userId, locationId } = await request.json();
    if (!userId || !locationId) {
      return NextResponse.json({ error: "Missing userId or locationId" }, { status: 400 });
    }

    const supabase = adminCheck.supabase;

    // Check if target user is admin
    const { data: targetUser } = await supabase.from('profiles').select('role').eq('id', userId).single();
    if (targetUser?.role === 'super_admin') {
      return NextResponse.json({ error: "Cannot modify super_admin locations" }, { status: 403 });
    }
    if (targetUser?.role === 'admin' && !hasSystemManagerAccess(adminCheck.auth)) {
      return NextResponse.json({ error: "Only system managers can modify admin locations" }, { status: 403 });
    }

    // Check if assignment already exists
    const { data: existing, error: existError } = await supabase
      .from("user_locations")
      .select("id")
      .eq("user_id", userId)
      .eq("location_id", locationId)
      .maybeSingle();

    if (existError) throw existError;
    if (existing) {
      return NextResponse.json({ success: true, message: "Already assigned" });
    }

    // Insert new assignment
    const { error: insertError } = await supabase
      .from("user_locations")
      .insert({
        user_id: userId,
        location_id: locationId,
        assigned_by: adminCheck.auth.sub,
      });

    if (insertError) throw insertError;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Admin user-location add error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const adminCheck = await requireRoleOrSystemManager(request, ["super_admin", "admin"]);
  if (!adminCheck.ok) return adminCheck.response;

  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");
    const locationId = url.searchParams.get("locationId");
    const replacementLocationId = url.searchParams.get("replacementLocationId");

    if (!userId || !locationId) {
      return NextResponse.json({ error: "Missing userId or locationId" }, { status: 400 });
    }

    const supabase = adminCheck.supabase;

    // Check if target user is admin
    const { data: targetUser } = await supabase.from('profiles').select('role').eq('id', userId).single();
    if (targetUser?.role === 'super_admin') {
      return NextResponse.json({ error: "Cannot modify super_admin locations" }, { status: 403 });
    }
    if (targetUser?.role === 'admin' && !hasSystemManagerAccess(adminCheck.auth)) {
      return NextResponse.json({ error: "Only system managers can modify admin locations" }, { status: 403 });
    }

    const { data: assignments, error: assignmentError } = await supabase
      .from("user_locations")
      .select("location_id, is_primary")
      .eq("user_id", userId);
    if (assignmentError) throw assignmentError;

    const selected = assignments?.find((assignment) => assignment.location_id === locationId);
    if (!selected) return NextResponse.json({ success: true });
    const requiresReplacement = selected.is_primary === true && (assignments?.length ?? 0) > 1;

    if (requiresReplacement && !hasSystemManagerAccess(adminCheck.auth)) {
      return NextResponse.json(
        { error: "สาขาหลักต้องให้ superadmin หรือผู้จัดการระบบเลือกสาขาหลักใหม่ก่อนลบ" },
        { status: 403 }
      );
    }
    if (requiresReplacement && !replacementLocationId) {
      return NextResponse.json(
        { error: "กรุณาเลือกสาขาหลักใหม่" },
        { status: 409 }
      );
    }

    if (hasSystemManagerAccess(adminCheck.auth)) {
      const { error: rpcError } = await supabase.rpc("remove_user_location_with_primary_replacement", {
        p_user_id: userId,
        p_location_id: locationId,
        p_replacement_location_id: replacementLocationId,
      });
      if (rpcError) throw rpcError;
      return NextResponse.json({ success: true });
    }

    const { error: deleteError } = await supabase
      .from("user_locations")
      .delete()
      .eq("user_id", userId)
      .eq("location_id", locationId);

    if (deleteError) throw deleteError;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Admin user-location remove error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
