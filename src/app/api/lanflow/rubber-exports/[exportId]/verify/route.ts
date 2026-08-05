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
    currentWeight?: number;
    workRate?: number;
    otherOperatingCost?: number;
  } | null;
  if (
    payload?.expenseDestination !== "branch"
    && payload?.expenseDestination !== "external"
  ) {
    return NextResponse.json({ error: "กรุณาเลือกปลายทางค่าใช้จ่าย" }, { status: 400 });
  }
  if (
    typeof payload.currentWeight !== "number"
    || !Number.isFinite(payload.currentWeight)
    || payload.currentWeight <= 0
    || typeof payload.workRate !== "number"
    || !Number.isFinite(payload.workRate)
    || payload.workRate < 0
    || typeof payload.otherOperatingCost !== "number"
    || !Number.isFinite(payload.otherOperatingCost)
    || payload.otherOperatingCost < 0
  ) {
    return NextResponse.json({ error: "กรุณากรอกน้ำหนักและค่าใช้จ่ายให้ถูกต้อง" }, { status: 400 });
  }

  const { data, error } = await result.supabase.rpc("verify_rubber_export_atomic", {
    p_export_id: exportId,
    p_current_weight: payload.currentWeight,
    p_work_rate: payload.workRate,
    p_other_operating_cost: payload.otherOperatingCost,
    p_expense_destination: payload.expenseDestination,
  });
  if (error) return rubberExportErrorResponse(error.message);
  return NextResponse.json(data, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
