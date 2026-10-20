import { NextRequest, NextResponse } from "next/server";
import { requireRoleOrSystemManager } from "@/lib/server/auth";
import { isIsoTimestamp, isUuid } from "@/lib/server/management-route-error";
import { isOperatorHistoryResponse } from "@/lib/server/operator-history-response";
import { MONEY_HISTORY_ROUTES, type OperatorMoneyHistory } from "@/lib/operator-money-history";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0" };
const jsonError = (error: string, status: number) => NextResponse.json({ error }, { status, headers });

export async function GET(request: NextRequest) {
  const result = await requireRoleOrSystemManager(request, ["admin", "super_admin"]);
  if (!result.ok) return result.response;
  const params = request.nextUrl.searchParams;
  const actor = params.get("actor");
  const location = params.get("locationId");
  const route = params.get("route");
  const date = params.get("date");
  const action = params.get("action") ?? "all";
  if ((actor !== null && actor !== "unknown" && !isUuid(actor)) ||
      (location !== null && !isUuid(location)) ||
      (route !== null && !Object.hasOwn(MONEY_HISTORY_ROUTES, route)) ||
      !["all", "create", "update", "delete"].includes(action)) {
    return jsonError("ตัวกรองไม่ถูกต้อง", 400);
  }
  if (date !== null && !isIsoTimestamp(`${date}T00:00:00Z`)) {
    return jsonError("วันที่ไม่ถูกต้อง", 400);
  }
  let cursorAt: string | null = null;
  let cursorId: string | null = null;
  const cursor = params.get("cursor");
  if (cursor !== null) {
    const parts = Buffer.from(cursor, "base64").toString("utf8").split("|");
    if (parts.length !== 2 || !isUuid(parts[1]) || !isIsoTimestamp(parts[0])) {
      return jsonError("cursor ไม่ถูกต้อง", 400);
    }
    [cursorAt, cursorId] = parts;
  }
  try {
    const { data, error } = await result.supabase.rpc("get_operator_money_history", {
      p_actor_key: actor, p_location_id: location, p_route: route,
      p_event_date: date, p_action: action, p_cursor_at: cursorAt, p_cursor_id: cursorId,
    });
    if (error) {
      if (error.code === "42501") return jsonError("ไม่มีสิทธิ์เข้าถึงประวัติหรือสาขานี้", 403);
      if (error.code === "22023" || error.code === "22P02") return jsonError("ตัวกรองหรือวันที่อยู่นอกช่วงเก็บประวัติ", 400);
      throw error;
    }
    if (!isOperatorHistoryResponse(data)) {
      throw new Error("Invalid operator history response");
    }
    const payload = data;
    return NextResponse.json({
      ...payload,
      nextCursor: payload.nextCursor ? Buffer.from(`${payload.nextCursor.at}|${payload.nextCursor.id}`, "utf8").toString("base64") : null,
    } satisfies OperatorMoneyHistory, { headers });
  } catch (error) {
    console.error("Operator money history read failed", error instanceof Error ? error.message : "RPC failed");
    return jsonError("โหลดประวัติผู้สร้างรายการไม่สำเร็จ กรุณาลองใหม่", 500);
  }
}
