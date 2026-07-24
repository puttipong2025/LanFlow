import { NextResponse } from "next/server";
import { requireSystemManager } from "@/lib/server/auth";
import { rubberExportErrorResponse } from "@/lib/server/rubber-export-response";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ exportId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const result = await requireSystemManager(request);
  if (!result.ok) return result.response;
  const { exportId } = await context.params;
  const payload = await request.json().catch(() => null) as {
    expenseDestination?: "branch" | "external";
  } | null;
  if (!payload?.expenseDestination) {
    return NextResponse.json({ error: "กรุณาเลือกปลายทางค่าใช้จ่าย" }, { status: 400 });
  }

  const { data, error } = await result.supabase.rpc("verify_rubber_export", {
    p_export_id: exportId,
    p_expense_destination: payload.expenseDestination,
  });
  if (error) return rubberExportErrorResponse(error.message);
  return NextResponse.json(data, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

