import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import { isUuid } from "@/lib/server/management-route-error";

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const params = new URL(request.url).searchParams;
  const locationId = params.get("locationId");
  const clientTempId = params.get("clientTempId");
  if (!isUuid(locationId) || !clientTempId?.trim() || clientTempId.length > 512) {
    return NextResponse.json({ error: "ข้อมูลอ้างอิงบิลไม่ถูกต้อง" }, { status: 400 });
  }
  const { data, error } = await auth.supabase.rpc("get_rubber_bill_command_context", {
    p_location_id: locationId, p_client_temp_id: clientTempId,
  });
  return NextResponse.json(error ? { error: "ตรวจสถานะคำสั่งบิลยางไม่สำเร็จ" } : data, {
    status: error ? 403 : 200, headers: { "Cache-Control": "private, no-store" },
  });
}
