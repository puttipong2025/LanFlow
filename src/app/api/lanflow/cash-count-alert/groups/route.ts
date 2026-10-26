import { cashCountUnavailableResponse } from "@/lib/server/cash-count-response";
import { NextResponse } from "next/server";
import { requireSystemManager } from "@/lib/server/auth";
import { isUuid } from "@/lib/server/management-route-error";

const headers = { "Cache-Control": "private, no-store" };
function groupErrorResponse(error: { code?: string; message: string }) {
  if (error.code === "23514") return NextResponse.json({ error: "กรุณาระบุชั่วโมงผ่อนผันและใช้งานหลังปลดล็อก 1–48 ชั่วโมงให้ครบก่อนเปิดล็อก" }, { status: 400, headers });
  if (error.code !== "P0001") return cashCountUnavailableResponse();
  if (error.message === "FORBIDDEN") return NextResponse.json({ error: "ไม่มีสิทธิ์จัดการกลุ่มนับเงิน" }, { status: 403, headers });
  const messages: Record<string, number> = {
    "เกณฑ์ต้องเป็น 1–5 วัน และต้องเลือกสาขาไม่ซ้ำอย่างน้อยหนึ่งสาขา": 400,
    "ไม่พบกลุ่ม": 404,
    "ไม่พบสาขาที่เปิดใช้งาน": 404,
    "สาขาอยู่ในกลุ่มอื่นแล้ว กรุณานำออกจากกลุ่มเดิมก่อน": 409,
    "ชั่วโมงต้องเป็น 1–48": 400,
  };
  return Object.hasOwn(messages, error.message)
    ? NextResponse.json({ error: error.message }, { status: messages[error.message], headers })
    : cashCountUnavailableResponse();
}
export async function GET(request: Request) {
  try {
    const auth = await requireSystemManager(request);
    if (!auth.ok) return auth.response;
    const { data, error } = await auth.supabase.rpc("list_cash_count_alert_groups");
    return error ? groupErrorResponse(error) : NextResponse.json(data, { headers });
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
      || !Number.isInteger(body.dueDays) || body.dueDays < 1 || body.dueDays > 5 || (body.id != null && !isUuid(body.id))) {
      return NextResponse.json({ error: "กรุณาเลือกสาขาและเกณฑ์ 1–5 วัน" }, { status: 400, headers });
    }
    if ((Object.hasOwn(body, "lockEnabled") && typeof body.lockEnabled !== "boolean")
      || ["graceHours", "unlockHours"].some((key) => Object.hasOwn(body, key) && (!Number.isInteger(body[key]) || body[key] < 1 || body[key] > 48))) {
      return NextResponse.json({ error: "กรุณาระบุสวิตช์และชั่วโมงจำนวนเต็ม 1–48" }, { status: 400, headers });
    }
    const { data, error } = await auth.supabase.rpc("save_cash_count_alert_group", {
      p_group_id: body.id ?? null, p_location_ids: body.locationIds, p_due_days: body.dueDays,
      p_lock_enabled: body.lockEnabled ?? null, p_grace_hours: body.graceHours ?? null, p_unlock_hours: body.unlockHours ?? null,
    });
    return error ? groupErrorResponse(error) : NextResponse.json(data, { headers });
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
    return error ? groupErrorResponse(error) : NextResponse.json(data, { headers });
  } catch {
    return cashCountUnavailableResponse();
  }
}
