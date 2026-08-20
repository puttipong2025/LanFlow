import { NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/server/auth";
import { canManageRubberExports, rubberExportErrorResponse } from "@/lib/server/rubber-export-response";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const locationId = request.nextUrl.searchParams.get("locationId") ?? "";
  if (!canManageRubberExports(result.auth, locationId)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์ดูบิลที่เลือกได้ของสาขานี้" }, { status: 403 });
  }
  const { data, error } = await result.supabase.rpc("get_rubber_export_available_bills", {
    p_location_id: locationId,
  });
  if (error) return rubberExportErrorResponse(error.message);
  return NextResponse.json({
    availableBills: (data ?? []).map((row: Record<string, any>) => ({
      reportItemId: row.report_item_id,
      billId: row.bill_id,
      billDate: row.bill_date,
      billNo: row.bill_no,
      customerName: row.customer_name,
      eligibilityAt: row.eligibility_at,
      netWeight: Number(row.net_weight),
      paidAmount: Number(row.paid_amount),
      rubberValueAmount: Number(row.rubber_value_amount),
    })),
  }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
