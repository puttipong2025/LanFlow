import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/auth";
import { isSmsMutationAllowed, SMS_HEADERS } from "@/lib/server/sms-otp";
import { isDeviceResetPreview, isDeviceResetReceipt, isDeviceResetRequest } from "@/lib/rubber-bills/device-reset-contract";

const error = (message: string, status: number, errorCode?: string) =>
  NextResponse.json({ error: message, ...(errorCode ? { errorCode } : {}) }, { status, headers: SMS_HEADERS });

export async function GET(request: Request) {
  try {
    const auth = await requireRole(request, ["super_admin"]);
    if (!auth.ok) return auth.response;
    const result = await auth.supabase.rpc("preview_bill_device_reset");
    if (result.error || !isDeviceResetPreview(result.data)) return error("โหลดจำนวนเครื่องไม่สำเร็จ", result.error?.code === "42501" ? 403 : 503);
    return NextResponse.json(result.data, { headers: SMS_HEADERS });
  } catch { return error("โหลดจำนวนเครื่องไม่สำเร็จ", 503); }
}

export async function POST(request: Request) {
  try {
    const auth = await requireRole(request, ["super_admin"]);
    if (!auth.ok) return auth.response;
    if (!isSmsMutationAllowed(request)) return error("ไม่มีสิทธิ์", 403);
    const body: unknown = await request.json().catch(() => null);
    if (!isDeviceResetRequest(body)) return error("ข้อมูลยืนยันไม่ถูกต้อง", 400);
    const requestId = body.requestId.toLowerCase();
    const result = await auth.supabase.rpc("reset_all_bill_devices", {
      p_request_id: requestId, p_snapshot: body.snapshot, p_confirmation: body.confirmation, p_mode: body.mode,
    });
    if (result.error) {
      if (result.error.code === "42501") return error("ไม่มีสิทธิ์", 403);
      if (result.error.code === "22023") return error("ข้อมูลคำสั่งเดิมไม่ตรงกัน", 400);
      if (result.error.code === "PT409") return error("รายชื่อเครื่องเปลี่ยน กรุณาตรวจจำนวนล่าสุดและยืนยันใหม่", 409, "DEVICE_RESET_CONFLICT");
      return error("ยังยืนยันผลไม่ได้ กรุณาลองคำสั่งเดิมอีกครั้ง", 503);
    }
    if (!isDeviceResetReceipt(result.data) || result.data.requestId !== requestId || result.data.snapshot !== body.snapshot) {
      return error("ยังยืนยันผลไม่ได้ กรุณาลองคำสั่งเดิมอีกครั้ง", 503);
    }
    return NextResponse.json(result.data, { headers: SMS_HEADERS });
  } catch { return error("ยังยืนยันผลไม่ได้ กรุณาลองคำสั่งเดิมอีกครั้ง", 503); }
}
