import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/server/lanflow-db";
import { requireAuth, requireRole } from "@/lib/server/auth";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  // Only super_admin or admin can access the user list
  const adminCheck = await requireRole(request, ["super_admin", "admin"]);
  if (adminCheck instanceof NextResponse) return adminCheck;

  try {
    const supabase = getAdminClient();

    // Fetch all active profiles
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, name, phone, role")
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (profilesError) throw profilesError;

    // Fetch user_locations mapping
    const { data: userLocations, error: ulError } = await supabase
      .from("user_locations")
      .select("user_id, location_id");

    if (ulError) throw ulError;

    // Group location IDs by user
    const locationMap = new Map<string, string[]>();
    for (const ul of userLocations) {
      if (!locationMap.has(ul.user_id)) {
        locationMap.set(ul.user_id, []);
      }
      locationMap.get(ul.user_id)!.push(ul.location_id);
    }

    // Map to Profile type
    const result = profiles.map(p => ({
      id: p.id,
      name: p.name,
      phone: p.phone,
      role: p.role,
      locationIds: locationMap.get(p.id) || [],
    }));

    return NextResponse.json({ users: result });
  } catch (error: any) {
    console.error("Admin fetch users error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
