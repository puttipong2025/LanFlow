import { requireAuth, requireSystemManager } from "@/lib/server/auth";
import {
  exportVehicleWeighBillErrorResponse,
  exportVehicleWeighBillJson,
  isWexUuid,
  mapExportVehicleWeighBillDetail,
  parseDeleteExportVehicleWeighBillPayload,
  parseUpdateExportVehicleWeighBillPayload,
  withExportVehicleWeighBillNoStore,
} from "@/lib/server/export-vehicle-weigh-bill-response";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ wexId: string }> };

function canUseWexModule(role: string, canAccessSystemManager: boolean) {
  return role === "admin" || role === "super_admin" || canAccessSystemManager;
}

export async function GET(request: Request, context: RouteContext) {
  const result = await requireAuth(request);
  if (!result.ok) return withExportVehicleWeighBillNoStore(result.response);
  const { wexId } = await context.params;
  if (!isWexUuid(wexId)) {
    return exportVehicleWeighBillErrorResponse("WEX_INVALID_ID: รหัสบิลรถส่งออกไม่ถูกต้อง");
  }
  if (!canUseWexModule(result.auth.role, result.auth.canAccessSystemManager)) {
    return exportVehicleWeighBillErrorResponse("WEX_FORBIDDEN: ไม่มีสิทธิ์ดูบิลรถส่งออก");
  }

  const { data, error } = await result.supabase.rpc("get_export_vehicle_weigh_bill_detail", {
    p_wex_id: wexId,
  });
  if (error) return exportVehicleWeighBillErrorResponse(error.message);
  const detail = mapExportVehicleWeighBillDetail(data);
  return detail
    ? exportVehicleWeighBillJson(detail)
    : exportVehicleWeighBillErrorResponse("WEX_NOT_FOUND: ไม่พบบิลรถส่งออก");
}

export async function PATCH(request: Request, context: RouteContext) {
  const result = await requireAuth(request);
  if (!result.ok) return withExportVehicleWeighBillNoStore(result.response);
  const { wexId } = await context.params;
  if (!isWexUuid(wexId)) {
    return exportVehicleWeighBillErrorResponse("WEX_INVALID_ID: รหัสบิลรถส่งออกไม่ถูกต้อง");
  }
  if (!canUseWexModule(result.auth.role, result.auth.canAccessSystemManager)) {
    return exportVehicleWeighBillErrorResponse("WEX_FORBIDDEN: ไม่มีสิทธิ์แก้ไขบิลรถส่งออก");
  }
  const payload = parseUpdateExportVehicleWeighBillPayload(await request.json().catch(() => null));
  if (!payload) {
    return exportVehicleWeighBillErrorResponse("WEX_INVALID_PAYLOAD: ข้อมูลแก้ไขบิลรถส่งออกไม่ถูกต้อง");
  }

  const { data, error } = await result.supabase.rpc("update_export_vehicle_weigh_bill", {
    p_wex_id: wexId,
    p_expected_revision: payload.expectedRevision,
    p_lines: payload.lines,
    p_rubber_export_ids: payload.rubberExportIds,
  });
  if (error) return exportVehicleWeighBillErrorResponse(error.message);
  return exportVehicleWeighBillJson(data);
}

export async function DELETE(request: Request, context: RouteContext) {
  const result = await requireSystemManager(request);
  if (!result.ok) return withExportVehicleWeighBillNoStore(result.response);
  const { wexId } = await context.params;
  if (!isWexUuid(wexId)) {
    return exportVehicleWeighBillErrorResponse("WEX_INVALID_ID: รหัสบิลรถส่งออกไม่ถูกต้อง");
  }
  const payload = parseDeleteExportVehicleWeighBillPayload(await request.json().catch(() => null));
  if (!payload) {
    return exportVehicleWeighBillErrorResponse("WEX_INVALID_DELETE: expectedRevision ไม่ถูกต้อง");
  }

  const { data, error } = await result.supabase.rpc("delete_export_vehicle_weigh_bill", {
    p_wex_id: wexId,
    p_expected_revision: payload.expectedRevision,
  });
  if (error) return exportVehicleWeighBillErrorResponse(error.message);
  return exportVehicleWeighBillJson(data);
}
