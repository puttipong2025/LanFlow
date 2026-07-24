import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import {
  canManageRubberExports,
  rubberExportErrorResponse,
} from "@/lib/server/rubber-export-response";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const payload = await request.json().catch(() => null) as {
    locationId?: string;
    cutoffReportItemId?: string;
  } | null;
  if (
    !payload?.locationId ||
    !payload.cutoffReportItemId ||
    !canManageRubberExports(result.auth, payload.locationId)
  ) {
    return NextResponse.json({ error: "ข้อมูลหรือสิทธิ์ preview ไม่ถูกต้อง" }, { status: 403 });
  }

  const { data, error } = await result.supabase.rpc("preview_rubber_export", {
    p_location_id: payload.locationId,
    p_cutoff_report_item_id: payload.cutoffReportItemId,
  });
  if (error) return rubberExportErrorResponse(error.message);
  return NextResponse.json(data, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

