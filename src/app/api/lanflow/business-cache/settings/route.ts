import { NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/server/auth";
import { isBusinessCacheSettings, isCacheInterval } from "@/lib/business-cache/settings";
import { isNonNegativePostgresInteger } from "@/lib/server/management-route-error";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;
    const { data, error } = await auth.supabase.rpc("get_business_cache_settings");
    if (error?.code === "42501") return reply({ error: "ไม่มีสิทธิ์เข้าถึงการตั้งค่าแคช" }, 403);
    if (error || !isBusinessCacheSettings(data)) return reply({ error: "โหลดรอบตรวจแคชไม่สำเร็จ" }, 503);
    return reply(data);
  } catch { return reply({ error: "โหลดรอบตรวจแคชไม่สำเร็จ" }, 503); }
}

export async function PUT(request: Request) {
  try {
    const auth = await requireRole(request, ["super_admin"]);
    if (!auth.ok) return auth.response;
    const body = await request.json().catch(() => null);
    if (!body || !isCacheInterval(body.intervalMinutes) || !isNonNegativePostgresInteger(body.expectedRevision) || body.expectedRevision < 1) {
      return reply({ error: "กรุณากำหนดจำนวนเต็ม 10–120 นาที หรือปิดรอบตรวจ" }, 400);
    }
    const { data, error } = await auth.supabase.rpc("save_business_cache_settings", {
      p_interval_minutes: body.intervalMinutes, p_expected_revision: body.expectedRevision,
    });
    if (error?.code === "40001") return reply({ error: "มีผู้แก้ไขค่ากลางแล้ว กรุณาปิดและเปิดหน้าตั้งค่าใหม่" }, 409);
    if (error?.code === "42501") return reply({ error: "เฉพาะ superadmin เท่านั้นที่ตั้งรอบตรวจได้" }, 403);
    if (error || !isBusinessCacheSettings(data) || data.intervalMinutes !== body.intervalMinutes) {
      return reply({ error: "บันทึกรอบตรวจแคชไม่สำเร็จ กรุณาเปิดตรวจค่าล่าสุดอีกครั้ง" }, 503);
    }
    return reply(data);
  } catch { return reply({ error: "บันทึกรอบตรวจแคชไม่สำเร็จ" }, 503); }
}
