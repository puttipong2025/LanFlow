import { cashCountUnavailableResponse } from "@/lib/server/cash-count-response";
import { NextResponse } from "next/server";
import { mapCashCount } from "@/lib/server/cash-count-row";
import { createSupabaseAdminClient } from "@/lib/server/supabase-admin";
import { requireSystemManager } from "@/lib/server/auth";
import { cashCountErrorResponse } from "@/lib/server/cash-count-response";
import { isUuid } from "@/lib/server/management-route-error";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ countId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const result = await requireSystemManager(request);
    if (!result.ok) return result.response;
    const { countId } = await context.params;
    const locationId = new URL(request.url).searchParams.get("locationId");
    if (!isUuid(countId)) return cashCountErrorResponse("รหัสผลตรวจนับไม่ถูกต้อง");
    if (!isUuid(locationId)) return cashCountErrorResponse("กรุณาระบุสาขา");
    const { data: row, error } = await result.supabase
      .from("cash_counts")
      .select("*, locations(name)")
      .eq("id", countId)
      .eq("location_id", locationId)
      .eq("status", "active")
      .maybeSingle();
    if (error) return cashCountErrorResponse(error.message);
    if (!row) return cashCountErrorResponse("ไม่พบผลตรวจนับ");
    const location = Array.isArray((row as any).locations) ? (row as any).locations[0] : (row as any).locations;
    const { data: bank, error: bankError } = await createSupabaseAdminClient().from("cash_count_bank_evidence")
      .select("id,amount,account_position").eq("count_id", countId).order("account_position");
    if (bankError) return cashCountErrorResponse("โหลดหลักฐานบัญชีไม่สำเร็จ");
    return NextResponse.json({
      ...mapCashCount(row),
      hasBankAccount: !!bank?.length,
      bankAccounts: (bank ?? []).map((item) => ({ id: item.id, position: item.account_position, amount: Number(item.amount) })),
      locationName: location?.name ?? "", cutoffAt: row.cutoff_at, actualCounts: row.actual_counts,
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch {
    return cashCountUnavailableResponse();
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const result = await requireSystemManager(request);
    if (!result.ok) return result.response;
    const { countId } = await context.params;
    if (!isUuid(countId)) return cashCountErrorResponse("รหัสผลนับเงินไม่ถูกต้อง");
    const { data, error } = await result.supabase.rpc("check_cash_count", { p_count_id: countId });
    if (error) return cashCountErrorResponse(error.message);
    return NextResponse.json(data);
  } catch {
    return cashCountUnavailableResponse();
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const result = await requireSystemManager(request);
    if (!result.ok) return result.response;
    const { countId } = await context.params;
    const locationId = new URL(request.url).searchParams.get("locationId");
    if (!isUuid(countId)) return cashCountErrorResponse("รหัสผลตรวจนับไม่ถูกต้อง");
    if (!isUuid(locationId)) return cashCountErrorResponse("กรุณาระบุสาขา");
    const { data: count, error: lookupError } = await result.supabase
      .from("cash_counts")
      .select("id")
      .eq("id", countId)
      .eq("location_id", locationId)
      .maybeSingle();
    if (lookupError) return cashCountErrorResponse(lookupError.message);
    if (!count) {
      const { data: audit, error: auditError } = await result.supabase
        .from("document_deletion_audits")
        .select("document_no")
        .eq("document_kind", "cash_count")
        .eq("source_id", countId)
        .eq("location_id", locationId)
        .maybeSingle();
      if (auditError) return cashCountErrorResponse(auditError.message);
      if (!audit) return cashCountErrorResponse("ไม่พบผลตรวจนับในสาขาปัจจุบัน");
      return NextResponse.json({
        id: countId,
        reportNo: audit.document_no,
        status: "deleted",
      }, {
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      });
    }
    const { data, error } = await result.supabase.rpc("delete_cash_count", { p_cash_count_id: countId });
    if (error) return cashCountErrorResponse(error.message);
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch {
    return cashCountUnavailableResponse();
  }
}
