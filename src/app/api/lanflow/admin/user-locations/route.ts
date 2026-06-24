import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/server/lanflow-db";
import { requireAuth, requireRole } from "@/lib/server/auth";

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  // super_admin or admin can assign branches
  const adminCheck = await requireRole(request, ["super_admin", "admin"]);
  if (!adminCheck.ok) return adminCheck.response;

  try {
    const { userId, locationId } = await request.json();
    if (!userId || !locationId) {
      return NextResponse.json({ error: "Missing userId or locationId" }, { status: 400 });
    }

    const supabase = getAdminClient();

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
        assigned_by: (auth as any).auth?.sub,
      });

    if (insertError) throw insertError;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Admin user-location add error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  // super_admin or admin can remove branches
  const adminCheck = await requireRole(request, ["super_admin", "admin"]);
  if (!adminCheck.ok) return adminCheck.response;

  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");
    const locationId = url.searchParams.get("locationId");

    if (!userId || !locationId) {
      return NextResponse.json({ error: "Missing userId or locationId" }, { status: 400 });
    }

    const supabase = getAdminClient();

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
