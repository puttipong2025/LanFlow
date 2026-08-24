import { NextRequest } from "next/server";

import { requireAuth } from "@/lib/server/auth";
import {
  canManageExportVehicleWeighBills,
  exportVehicleWeighBillErrorResponse,
  exportVehicleWeighBillJson,
  isWexUuid,
  withExportVehicleWeighBillNoStore,
} from "@/lib/server/export-vehicle-weigh-bill-response";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return withExportVehicleWeighBillNoStore(result.response);

  const locationId = request.nextUrl.searchParams.get("locationId");
  const wexId = request.nextUrl.searchParams.get("wexId");
  if (!isWexUuid(locationId) || (wexId !== null && !isWexUuid(wexId))) {
    return exportVehicleWeighBillErrorResponse("WEX_INVALID_OPTIONS: พารามิเตอร์ตัวเลือกไม่ถูกต้อง");
  }
  if (!canManageExportVehicleWeighBills(result.auth, locationId)) {
    return exportVehicleWeighBillErrorResponse("WEX_FORBIDDEN: ไม่มีสิทธิ์ดูรายการขายยางของสาขานี้");
  }

  const [rubberExportResult, carrierResult] = await Promise.all([
    result.supabase.rpc("get_export_vehicle_weigh_bill_options", {
      p_location_id: locationId,
      p_wex_id: wexId,
    }),
    result.supabase
      .from("transport_staffs")
      .select("id, main_name")
      .eq("record_status", "active")
      .or(`default_location_id.is.null,default_location_id.eq.${locationId}`)
      .order("main_name", { ascending: true })
      .order("id", { ascending: true }),
  ]);
  if (rubberExportResult.error) {
    return exportVehicleWeighBillErrorResponse(rubberExportResult.error.message);
  }
  if (carrierResult.error) {
    return exportVehicleWeighBillErrorResponse(carrierResult.error.message);
  }
  return exportVehicleWeighBillJson({
    rubberExports: (rubberExportResult.data ?? []).map((row: Record<string, unknown>) => ({
      rubberExportId: row.rubber_export_id,
      exportNo: row.export_no,
      currentWeight: Number(row.current_weight),
      reservedByCurrentWex: Boolean(row.reserved_by_current_wex),
    })),
    carriers: (carrierResult.data ?? []).map((row: Record<string, unknown>) => ({
      carrierId: row.id,
      carrierName: row.main_name,
    })),
  });
}
