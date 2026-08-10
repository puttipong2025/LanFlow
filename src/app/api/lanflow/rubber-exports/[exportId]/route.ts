import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireSystemManager } from "@/lib/server/auth";
import {
  mapRubberExportRow,
  rubberExportErrorResponse,
} from "@/lib/server/rubber-export-response";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ exportId: string }> };

const detailColumns = `
  id, export_no, location_id, status, previous_status,
  original_weight_total, paid_total, average_price, current_weight,
  weight_loss_percent, work_rate, other_operating_cost, work_total,
  expense_destination, created_by_name, created_at,
  verified_by_name, verified_at, deleted_by_name,
  deleted_at, report_lock_no, locations(name),
  rubber_export_items(
    id, source_report_item_id, source_bill_id, bill_date, bill_no,
    customer_name, eligibility_at, net_weight, paid_amount
  )
`;

export async function GET(request: NextRequest, context: RouteContext) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const { exportId } = await context.params;
  const [
    { data: row, error },
    { data: ageDetail, error: ageError },
  ] = await Promise.all([
    result.supabase
      .from("rubber_exports")
      .select(detailColumns)
      .eq("id", exportId)
      .maybeSingle(),
    result.supabase.rpc("get_rubber_export_age_detail", { p_export_id: exportId }),
  ]);
  if (error) return rubberExportErrorResponse(error.message);
  if (!row) return NextResponse.json({ error: "ไม่พบรายการส่งออก" }, { status: 404 });
  if (ageError) return rubberExportErrorResponse(ageError.message);

  const age = (ageDetail ?? {}) as Record<string, any>;
  const itemAges = new Map(
    ((age.items ?? []) as Record<string, any>[]).map((item) => [item.itemId, item]),
  );

  const summary = mapRubberExportRow({
    ...row,
    age_calculated_at: age.calculatedAt ?? null,
    average_age_hours: age.averageAgeHours ?? null,
    oldest_age_hours: age.oldestAgeHours ?? null,
    estimated_age_item_count: age.estimatedAgeItemCount ?? null,
    receipt_bill_id: age.receivedBy?.billId ?? null,
    receipt_bill_no: age.receivedBy?.billNo ?? null,
    receipt_location_name: age.receivedBy?.locationName ?? null,
    rubber_export_items: [{ count: row.rubber_export_items.length }],
  } as Record<string, any>);
  return NextResponse.json({
    ...summary,
    items: row.rubber_export_items
      .map((item) => ({
        id: item.id,
        sourceReportItemId: item.source_report_item_id,
        sourceBillId: item.source_bill_id,
        billDate: item.bill_date,
        billNo: item.bill_no,
        customerName: item.customer_name,
        eligibilityAt: item.eligibility_at,
        netWeight: Number(item.net_weight),
        paidAmount: Number(item.paid_amount),
        ageHours: itemAges.get(item.id)?.ageHours ?? null,
        ageIsEstimated: Boolean(itemAges.get(item.id)?.ageIsEstimated),
      }))
      .sort((left, right) =>
        left.eligibilityAt.localeCompare(right.eligibilityAt)
        || left.sourceBillId.localeCompare(right.sourceBillId)
      ),
  }, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const { exportId } = await context.params;
  const payload = await request.json().catch(() => null) as {
    currentWeight?: number | null;
    workRate?: number | null;
    otherOperatingCost?: number | null;
  } | null;
  if (!payload) return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });

  const { data, error } = await result.supabase.rpc("update_rubber_export", {
    p_export_id: exportId,
    p_current_weight: payload.currentWeight ?? null,
    p_work_rate: payload.workRate ?? null,
    p_other_operating_cost: payload.otherOperatingCost ?? 0,
  });
  if (error) return rubberExportErrorResponse(error.message);
  return NextResponse.json(data, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  const result = await requireSystemManager(request);
  if (!result.ok) return result.response;
  const { exportId } = await context.params;
  const { data, error } = await result.supabase.rpc("delete_rubber_export", {
    p_export_id: exportId,
  });
  if (error) return rubberExportErrorResponse(error.message);
  return NextResponse.json(data, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
