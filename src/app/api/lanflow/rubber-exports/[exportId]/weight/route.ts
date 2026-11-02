import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import { isUuid, rubberExportErrorResponse } from "@/lib/server/rubber-export-response";
import { hasTwoDecimalPrecision } from "@/lib/rubber-exports/calculations";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ exportId: string }> }) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const { exportId } = await context.params;
  if (!isUuid(exportId)) return NextResponse.json({ error: "รหัสรายการส่งออกไม่ถูกต้อง" }, { status: 400 });
  const payload: unknown = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }
  const values = payload as Record<string, unknown>;
  if (Object.keys(values).some((key) => !["currentWeight", "expectedCurrentWeight", "note"].includes(key))
    || [values.currentWeight, values.expectedCurrentWeight].some((weight) =>
      typeof weight !== "number" || !hasTwoDecimalPrecision(weight) || weight <= 0 || weight > 999999999999.99)
    || (values.note != null && (typeof values.note !== "string" || values.note.length > 300))) {
    return NextResponse.json({ error: "น้ำหนักต้องมากกว่า 0 รองรับทศนิยม 2 ตำแหน่ง และหมายเหตุไม่เกิน 300 ตัวอักษร" }, { status: 400 });
  }
  const { data, error } = await result.supabase.rpc("adjust_rubber_export_weight", {
    p_export_id: exportId,
    p_current_weight: values.currentWeight,
    p_expected_current_weight: values.expectedCurrentWeight,
    p_note: typeof values.note === "string" ? values.note.trim() || null : null,
  });
  if (error) return rubberExportErrorResponse(error.message);
  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
