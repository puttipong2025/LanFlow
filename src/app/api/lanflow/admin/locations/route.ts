import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/server/auth";
import { createSupabaseAdminClient } from "@/lib/server/supabase-admin";

export async function POST(request: NextRequest) {
  const adminCheck = await requireRole(request, ["super_admin"]);
  if (!adminCheck.ok) return adminCheck.response;

  try {
    const body = await request.json();
    if (!body.name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    const adminId = adminCheck.auth.sub;
    const locationId = crypto.randomUUID();
    const code = body.name.slice(0, 3).toUpperCase();

    const { error: locError } = await admin.from("locations").insert({
      id: locationId,
      name: body.name.trim(),
      code: code
    });

    if (locError) throw locError;

    // Automatically assign to the admin who created it
    const { error: assignError } = await admin.from("user_locations").insert({
      user_id: adminId,
      location_id: locationId,
      assigned_by: adminId,
      is_primary: false
    });

    if (assignError) throw assignError;

    return NextResponse.json({ success: true, location: { id: locationId, name: body.name.trim(), code, active: true } });
  } catch (error: any) {
    console.error("Add location error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
