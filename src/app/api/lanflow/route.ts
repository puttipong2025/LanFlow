import { NextRequest, NextResponse } from "next/server";
import { parseRubberWeightAlertConfig } from "@/lib/lanflow/rubber-weight-alert";
import { requireAuth } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: NextRequest) {
  const result = await requireAuth(request, { allowUserLanflow: true });
  if (!result.ok) return result.response;

  const confirmationResult = await result.supabase
    .rpc("get_branch_create_confirmation_minutes");
  const confirmationMinutes = confirmationResult.error
    || typeof confirmationResult.data !== "number"
    || !Number.isInteger(confirmationResult.data)
      ? null
      : confirmationResult.data;
  if (confirmationResult.error) {
    console.error("Branch confirmation setting load failed", confirmationResult.error.message);
  }

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
    return NextResponse.json(
      { locations: [], profile, confirmationMinutes, rubberWeightAlertConfig: null },
      { headers: NO_STORE_HEADERS },
    );
  }

  try {
    const alertConfigResult = await result.supabase
      .rpc("get_rubber_weight_alert_config");
    const rubberWeightAlertConfig = alertConfigResult.error
      ? null
      : parseRubberWeightAlertConfig(alertConfigResult.data);
    if (alertConfigResult.error) {
      console.error("Rubber weight alert config load failed", alertConfigResult.error.message);
    } else if (!rubberWeightAlertConfig) {
      console.error("Rubber weight alert config load returned an invalid payload");
    }

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

    return NextResponse.json(
      { locations, profile, confirmationMinutes, rubberWeightAlertConfig },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
