import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import { isUuid, rubberExportErrorResponse } from "@/lib/server/rubber-export-response";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ exportId: string }> };

export async function PUT(request: Request, context: RouteContext) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const { exportId } = await context.params;
  const payload = await request.json().catch(() => null) as {
    selectedReportItemIds?: string[];
  } | null;
  const selectedIds = payload?.selectedReportItemIds;
  if (
    !isUuid(exportId)
    || !Array.isArray(selectedIds)
    || selectedIds.length === 0
    || selectedIds.some((id) => !isUuid(id))
    || new Set(selectedIds).size !== selectedIds.length
  ) {
    return NextResponse.json(
      { error: "กรุณาเลือกบิลอย่างน้อย 1 ใบและห้ามเลือกซ้ำ" },
      { status: 400 },
    );
  }
  const { data, error } = await result.supabase.rpc("replace_rubber_export_items", {
    p_export_id: exportId,
    p_selected_report_item_ids: selectedIds,
  });
  if (error) return rubberExportErrorResponse(error.message);
  return NextResponse.json(data, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
