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
      result.supabase.from("profiles").select("id, phone, name, role, is_active, can_access_super_admin_features, can_access_money_transfer, can_manage_time_payroll").eq("id", userId).single(),
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
      canAccessSystemManager:
        profileResult.data.role === "super_admin" ||
        profileResult.data.can_access_super_admin_features === true,
      canAccessMoneyTransfer:
        profileResult.data.role === "super_admin" ||
        profileResult.data.can_access_super_admin_features === true ||
        profileResult.data.can_access_money_transfer === true,
      canManageTimePayroll:
        profileResult.data.role === "super_admin" ||
        profileResult.data.can_access_super_admin_features === true ||
        profileResult.data.can_manage_time_payroll === true,
      primaryLocationId: result.auth.primaryLocationId
    };

    return NextResponse.json({ locations, profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
