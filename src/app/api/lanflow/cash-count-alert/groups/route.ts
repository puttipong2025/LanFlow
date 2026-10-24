import { cashCountUnavailableResponse } from "@/lib/server/cash-count-response";
import { NextResponse } from "next/server";
import { requireSystemManager } from "@/lib/server/auth";
import { isUuid } from "@/lib/server/management-route-error";

const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  try {
    const auth = await requireSystemManager(request);
    if (!auth.ok) return auth.response;
    const { data, error } = await auth.supabase.rpc("list_cash_count_alert_groups");
    return NextResponse.json(error ? { error: "โหลดกลุ่มไม่สำเร็จ" } : data, { status: error ? 500 : 200, headers });
  } catch {
    return cashCountUnavailableResponse();
  }
}
export async function POST(request: Request) {
  try {
    const auth = await requireSystemManager(request);
    if (!auth.ok) return auth.response;
    const body = await request.json().catch(() => null);
    if (!body || !Array.isArray(body.locationIds) || !body.locationIds.length || !body.locationIds.every(isUuid)
      || !Number.isInteger(body.dueDays) || body.dueDays < 1 || body.dueDays > 5 || (body.id && !isUuid(body.id))) {
      return NextResponse.json({ error: "กรุณาเลือกสาขาและเกณฑ์ 1–5 วัน" }, { status: 400, headers });
    }
    const { data, error } = await auth.supabase.rpc("save_cash_count_alert_group", {
      p_group_id: body.id ?? null, p_location_ids: body.locationIds, p_due_days: body.dueDays,
    });
    return NextResponse.json(error ? { error: error.message } : data, { status: error ? 400 : 200, headers });
  } catch {
    return cashCountUnavailableResponse();
  }
}
export async function DELETE(request: Request) {
  try {
    const auth = await requireSystemManager(request);
    if (!auth.ok) return auth.response;
    const id = new URL(request.url).searchParams.get("id");
    if (!isUuid(id)) return NextResponse.json({ error: "รหัสกลุ่มไม่ถูกต้อง" }, { status: 400, headers });
    const { data, error } = await auth.supabase.rpc("delete_cash_count_alert_group", { p_group_id: id });
    return NextResponse.json(error ? { error: error.message } : data, { status: error ? 400 : 200, headers });
  } catch {
    return cashCountUnavailableResponse();
  }
}
