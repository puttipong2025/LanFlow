import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;

  try {
    const userId = result.auth.sub;
    const [locationsResult, profileResult] = await Promise.all([
      result.supabase
        .from("locations")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: true }),
      result.supabase.from("profiles").select("id, phone, name, role, is_active").eq("id", userId).single(),
    ]);

    if (locationsResult.error) throw locationsResult.error;
    if (profileResult.error) throw profileResult.error;

    const locations = (locationsResult.data ?? []).map((row: any) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      address: row.address,
      active: row.is_active
    }));

    const profile = {
      id: profileResult.data.id,
      name: profileResult.data.name,
      phone: profileResult.data.phone,
      role: profileResult.data.role,
      isActive: profileResult.data.is_active,
      locationIds: result.auth.locationIds,
      canAccessSystemManager: result.auth.canAccessSystemManager,
      canAccessMoneyTransfer: result.auth.canAccessMoneyTransfer,
      canManageTimePayroll: result.auth.canManageTimePayroll,
      primaryLocationId: result.auth.primaryLocationId
    };

    return NextResponse.json({ locations, profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
