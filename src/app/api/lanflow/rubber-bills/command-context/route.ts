import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import { isJsonObject, isUuid } from "@/lib/server/management-route-error";

function failure(status: number) {
  return NextResponse.json({ error: "ตรวจสถานะคำสั่งบิลยางไม่สำเร็จ" }, {
    status, headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(request: Request) {
  try {
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
    if (error) return failure(error.code === "P0001" && error.message?.startsWith("FORBIDDEN:") ? 403 : 503);
    if (!isJsonObject(data) || !Number.isSafeInteger(data.generation) || Number(data.generation) < 0
        || !Number.isSafeInteger(data.revisionNo) || Number(data.revisionNo) < 0
        || ![null, "active", "deleted"].includes(data.recordStatus as string | null)
        || !(data.serverId === null || isUuid(data.serverId))
        || !(data.ocrUploadId === null || isUuid(data.ocrUploadId))) return failure(503);
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return failure(503);
  }
}
