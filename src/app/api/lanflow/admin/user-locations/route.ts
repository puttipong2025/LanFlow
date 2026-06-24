import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/server/auth";

export async function POST(request: NextRequest) {
  const adminCheck = await requireRole(request, ["super_admin", "admin"]);
  if (!adminCheck.ok) return adminCheck.response;

  try {
    const { userId, locationId } = await request.json();
    if (!userId || !locationId) {
      return NextResponse.json({ error: "Missing userId or locationId" }, { status: 400 });
    }

    const supabase = adminCheck.supabase;

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
  const adminCheck = await requireRole(request, ["super_admin", "admin"]);
  if (!adminCheck.ok) return adminCheck.response;

  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");
    const locationId = url.searchParams.get("locationId");

    if (!userId || !locationId) {
      return NextResponse.json({ error: "Missing userId or locationId" }, { status: 400 });
    }

    const supabase = adminCheck.supabase;

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
