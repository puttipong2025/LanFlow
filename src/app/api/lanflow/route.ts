import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const result = await requireAuth(request, { allowUserLanflow: true });
  if (!result.ok) return result.response;

  const profile = {
    id: result.auth.sub,
    name: result.auth.name,
    phone: result.auth.phone,
    role: result.auth.role,
    isActive: true,
    locationIds: result.auth.locationIds,
    canAccessSystemManager: result.auth.canAccessSystemManager,
    canAccessMoneyTransfer: result.auth.canAccessMoneyTransfer,
    canManageTimePayroll: result.auth.canManageTimePayroll,
    primaryLocationId: result.auth.primaryLocationId,
  };

  if (result.auth.role === "user") {
    return NextResponse.json({ locations: [], profile });
  }

  try {
    const locationsResult = await result.supabase
      .from("locations")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (locationsResult.error) throw locationsResult.error;

    const locations = (locationsResult.data ?? []).map((row: any) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      address: row.address,
      active: row.is_active
    }));

    return NextResponse.json({ locations, profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
