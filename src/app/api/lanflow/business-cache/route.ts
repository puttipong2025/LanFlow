import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import { isUuid } from "@/lib/server/management-route-error";
import { BUSINESS_CACHE_PROTOCOL, BUSINESS_CACHE_VERSIONS } from "@/lib/business-cache/protocol";
import { mapRubberBillFeedRow } from "@/lib/rubber-bills/map-feed-row";
import { buildRubberBillReceiptModel } from "@/components/rubber-bills/bill-display";
import { isBusinessCacheSettings } from "@/lib/business-cache/settings";

export const dynamic = "force-dynamic";
const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: Request) {
  try {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const locationId = new URL(request.url).searchParams.get("locationId")?.toLowerCase();
  if (!isUuid(locationId) || !auth.auth.locationIds.includes(locationId)) return reply({ error: "ไม่มีสิทธิ์ในสาขานี้" }, 403);
  const { data, error } = await auth.supabase.rpc("get_business_cache_settings");
  if (error?.code === "42501") return reply({ error: "ไม่มีสิทธิ์เข้าถึงการตั้งค่าแคช" }, 403);
  if (error || !isBusinessCacheSettings(data)) return reply({ error: "อ่านรอบตรวจแคชไม่สำเร็จ" }, 503);
  return reply({ protocol: BUSINESS_CACHE_PROTOCOL, versions: BUSINESS_CACHE_VERSIONS, settings: data });
  } catch { return reply({ error: "อ่านเวอร์ชันแคชไม่สำเร็จ" }, 503); }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;
    const body = await request.json().catch(() => null);
    if (!isUuid(body?.locationId) || !Array.isArray(body.ids) || body.ids.length > 100
      || !body.ids.every(isUuid) || new Set(body.ids).size !== body.ids.length) return reply({ error: "ข้อมูลอ้างอิงไม่ถูกต้อง" }, 400);
    body.locationId = body.locationId.toLowerCase();
    body.ids = body.ids.map((id: string) => id.toLowerCase());
    if (new Set(body.ids).size !== body.ids.length) return reply({ error: "ข้อมูลอ้างอิงซ้ำ" }, 400);
    if (!auth.auth.locationIds.includes(body.locationId)) return reply({ error: "ไม่มีสิทธิ์ในสาขานี้" }, 403);
    if (!body.ids.length) return reply({ checks: [] });
    // RPC checks live branch/role/browser-session scope in one statement, just as
    // the operational feed does. Private OCR provenance never leaves the RPC.
    const { data, error } = await auth.supabase.rpc("get_rubber_bill_cache_rows", {
      p_location_id: body.locationId, p_bill_ids: body.ids,
    });
    if (error?.code === "42501") return reply({ error: "ไม่มีสิทธิ์ตรวจแคชของสาขานี้" }, 403);
    if (error || !Array.isArray(data)) {
      console.error("Business receipt cache read failed", error?.code, error?.message);
      return reply({ error: "ตรวจสถานะบิลไม่สำเร็จ" }, 503);
    }
    const checks = body.ids.map((id: string) => {
      const row = data.find((item: Record<string, unknown>) => item.id === id);
      if (!row) return { billId: id, state: "unknown" };
      if (row.record_status === "deleted") return { billId: id, state: "deleted", revisionNo: row.revision_no };
      if (row.record_status !== "active") return { billId: id, state: "unknown" };
      const bill = mapRubberBillFeedRow(row);
      return { billId: id, state: "active", snapshot: { billId: id, locationId: body.locationId,
        serverBillNo: bill.serverBillNo, serverReceivedAt: bill.serverReceivedAt ?? bill.serverCreatedAt,
        revisionNo: bill.revisionNo, bill, receipt: buildRubberBillReceiptModel(bill) } };
    });
    return reply({ checks });
  } catch (error) {
    console.error("Business receipt cache read failed", error instanceof Error ? error.message : "unknown");
    return reply({ error: "ตรวจสถานะบิลไม่สำเร็จ" }, 503);
  }
}
