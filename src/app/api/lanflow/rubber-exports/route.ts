import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import {
  canManageRubberExports,
  mapRubberExportRow,
  rubberExportErrorResponse,
} from "@/lib/server/rubber-export-response";

export const dynamic = "force-dynamic";

const columns = `
  id, export_no, location_id, cutoff_at, status, previous_status,
  original_weight_total, paid_total, average_price, current_weight,
  weight_loss_percent, work_rate, other_operating_cost, work_total,
  expense_destination, created_by_name, created_at, verified_by_name,
  verified_at, deleted_by_name, deleted_at, report_lock_no,
  rubber_export_items(count), locations(name)
`;

export async function GET(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const locationId = request.nextUrl.searchParams.get("locationId");
  if (!locationId || !canManageRubberExports(result.auth, locationId)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์ดูรายการส่งออกของสาขานี้" }, { status: 403 });
  }

  const [{ data: rows, error }, { data: options, error: optionsError }] = await Promise.all([
    result.supabase
      .from("rubber_exports")
      .select(columns)
      .eq("location_id", locationId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }),
    result.supabase.rpc("get_rubber_export_cutoff_options", {
      p_location_id: locationId,
    }),
  ]);

  if (error) return rubberExportErrorResponse(error.message);
  if (optionsError) return rubberExportErrorResponse(optionsError.message);

  return NextResponse.json({
    exports: (rows ?? []).map((row) => mapRubberExportRow(row as Record<string, any>)),
    cutoffOptions: (options ?? []).map((row: Record<string, any>) => ({
      reportItemId: row.report_item_id,
      billId: row.bill_id,
      billDate: row.bill_date,
      billNo: row.bill_no,
      customerName: row.customer_name,
      eligibilityAt: row.eligibility_at,
    })),
  }, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

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
    return NextResponse.json({ error: "ข้อมูลหรือสิทธิ์สร้างรายการส่งออกไม่ถูกต้อง" }, { status: 403 });
  }

  const { data, error } = await result.supabase.rpc("create_rubber_export", {
    p_location_id: payload.locationId,
    p_cutoff_report_item_id: payload.cutoffReportItemId,
  });
  if (error) return rubberExportErrorResponse(error.message);
  return NextResponse.json(data, {
    status: 201,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
