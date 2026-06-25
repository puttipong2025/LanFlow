import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;

  try {
    const userId = result.auth.sub;
    const [locationsResult, profileResult, assignmentsResult] = await Promise.all([
      result.supabase.from("locations").select("*").order("created_at", { ascending: true }),
      result.supabase.from("profiles").select("id, phone, name, role, is_active").eq("id", userId).single(),
      result.supabase.from("user_locations").select("location_id").eq("user_id", userId),
    ]);

    if (locationsResult.error) throw locationsResult.error;
    if (profileResult.error) throw profileResult.error;
    if (assignmentsResult.error) throw assignmentsResult.error;

    const locations = (locationsResult.data ?? []).map((row: any) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      address: row.address,
      isActive: row.is_active
    }));

    const locationIds = (assignmentsResult.data ?? []).map((item: any) => item.location_id);
    const profile = {
      id: profileResult.data.id,
      name: profileResult.data.name,
      phone: profileResult.data.phone,
      role: profileResult.data.role,
      isActive: profileResult.data.is_active,
      locationIds
    };

    return NextResponse.json({ locations, profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
