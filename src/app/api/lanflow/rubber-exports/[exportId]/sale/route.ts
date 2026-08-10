import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import { isUuid, rubberExportErrorResponse } from "@/lib/server/rubber-export-response";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ exportId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const { exportId } = await context.params;
  const payload = await request.json().catch(() => null) as { soldOut?: boolean } | null;
  if (!isUuid(exportId) || typeof payload?.soldOut !== "boolean") {
    return NextResponse.json({ error: "สถานะขายยางออกไม่ถูกต้อง" }, { status: 400 });
  }
  const { data, error } = await result.supabase.rpc("set_rubber_export_sold_out", {
    p_export_id: exportId,
    p_sold_out: payload.soldOut,
  });
  if (error) return rubberExportErrorResponse(error.message);
  return NextResponse.json(data, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
