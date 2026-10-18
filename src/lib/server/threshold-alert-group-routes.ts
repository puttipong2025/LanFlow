import { NextRequest, NextResponse } from "next/server";
import { requireSystemManager } from "@/lib/server/auth";
import { isUuid, managementAuthFailure, managementErrorResponse } from "@/lib/server/management-route-error";
import { parseCashAlertGroupBody, parseRubberWeightAlertGroupBody } from "@/lib/server/rubber-weight-alert-groups";

const headers = { "Cache-Control": "private, no-store, max-age=0" };
type Context = { params: Promise<{ id: string }> };
export function thresholdAlertGroupRoutes(kind: "cash" | "weight") {
  const prefix = kind === "cash" ? "cash_alert" : "rubber_weight_alert";
  const errorResponse = (error: { code?: string; message?: string }, fallback: string) => {
    const response = managementErrorResponse(error, fallback);
    response.headers.set("Cache-Control", headers["Cache-Control"]);
    return response;
  };
  const protect = async (action: () => Promise<NextResponse>) => {
    try { return await action(); }
    catch { return errorResponse({}, "ติดต่อระบบกลุ่มแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่"); }
  };
  const invalid = (message: string) => NextResponse.json({ errorMessage: message }, { status: 400, headers });
  async function save(request: NextRequest, id?: string) {
    const auth = await requireSystemManager(request);
    if (!auth.ok) return managementAuthFailure(auth.response);
    if (id !== undefined && !isUuid(id)) return invalid("รหัสกลุ่มไม่ถูกต้อง");
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return invalid("ข้อมูลกลุ่มไม่ถูกต้อง");
    const parsed = kind === "cash" ? parseCashAlertGroupBody(body) : parseRubberWeightAlertGroupBody(body);
    if ("errorMessage" in parsed) return invalid(parsed.errorMessage ?? "ข้อมูลกลุ่มไม่ถูกต้อง");
    const value = parsed.value;
    const args = { p_location_ids: value.locationIds, ...(id ? { p_group_id: id } : {}),
      ...("thresholdAmount" in value ? { p_threshold_amount: value.thresholdAmount } : { p_threshold_kg: value.thresholdKg }) };
    const { data, error } = await auth.supabase.rpc(`${id ? "update" : "create"}_${prefix}_group`, args);
    if (error) return errorResponse(error, "บันทึกกลุ่มไม่สำเร็จ");
    return NextResponse.json(data, { status: id ? 200 : 201, headers });
  }
  return {
    GET: (request: NextRequest) => protect(async () => {
      const auth = await requireSystemManager(request);
      if (!auth.ok) return managementAuthFailure(auth.response);
      const { data, error } = await auth.supabase.rpc(`list_${prefix}_groups`);
      if (error) return errorResponse(error, "โหลดกลุ่มแจ้งเตือนไม่สำเร็จ");
      return NextResponse.json(data, { headers });
    }),
    POST: (request: NextRequest) => protect(() => save(request)),
    PUT: (request: NextRequest, context: Context) => protect(async () => save(request, (await context.params).id)),
    DELETE: (request: NextRequest, context: Context) => protect(async () => {
      const auth = await requireSystemManager(request);
      if (!auth.ok) return managementAuthFailure(auth.response);
      const { id } = await context.params;
      if (!isUuid(id)) return invalid("รหัสกลุ่มไม่ถูกต้อง");
      const { data, error } = await auth.supabase.rpc(`delete_${prefix}_group`, { p_group_id: id });
      if (error) return errorResponse(error, "ลบกลุ่มไม่สำเร็จ");
      return NextResponse.json(data, { headers });
    }),
  };
}
