import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import {
  canManageRubberExports,
  isUuid,
  rubberExportErrorResponse,
} from "@/lib/server/rubber-export-response";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const payload = await request.json().catch(() => null) as {
    locationId?: string;
    selectedReportItemIds?: string[];
  } | null;
  const selectedIds = payload?.selectedReportItemIds;
  if (
    !isUuid(payload?.locationId)
    || !Array.isArray(selectedIds)
    || selectedIds.length === 0
    || selectedIds.some((id) => !isUuid(id))
    || new Set(selectedIds).size !== selectedIds.length
  ) {
    return NextResponse.json({ error: "กรุณาเลือกบิลอย่างน้อย 1 ใบและห้ามเลือกซ้ำ" }, { status: 400 });
  }
  if (!canManageRubberExports(result.auth, payload.locationId)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์ดู preview ของสาขานี้" }, { status: 403 });
  }

  const { data, error } = await result.supabase.rpc("preview_rubber_export", {
    p_location_id: payload.locationId,
    p_selected_report_item_ids: selectedIds,
  });
  if (error) return rubberExportErrorResponse(error.message);
  return NextResponse.json(data, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
