import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import { isIncomeExpenseSubmission, publicIncomeExpenseErrorMessage } from "@/lib/income-expense/contracts";
import { confirmedIncomeExpenseBackgroundOutcome, isIncomeExpenseBackgroundCommand } from "@/lib/income-expense/background-command";
import type { SyncEvent } from "@/lib/idb-queue";
import { cashCountLockResponse } from "@/lib/server/cash-count-lock-response";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const headers = { "Cache-Control": "private, no-store" };
const unavailable = () => NextResponse.json({ errorMessage: "ยังยืนยันผลรับจ่ายไม่ได้" }, { status: 503, headers });

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;
    const params = new URL(request.url).searchParams;
    const serverId = (params.get("serverId") ?? "").toLowerCase();
    const locationId = (params.get("locationId") ?? "").toLowerCase();
    if (!UUID.test(serverId) || !UUID.test(locationId)) return NextResponse.json({}, { status: 400, headers });
    const { data, error } = await auth.supabase.rpc("income_expense_background_context", { p_server_id: serverId, p_location_id: locationId });
    if (error) return unavailable();
    if (data?.status === "forbidden") return NextResponse.json({}, { status: 403, headers });
    if (data?.status === "missing") return NextResponse.json({}, { status: 404, headers });
    if (data?.status !== "ok" || data.serverId !== serverId || data.locationId !== locationId
      || typeof data.clientTempId !== "string" || !Number.isSafeInteger(data.revisionNo)
      || data.revisionNo < 1 || !["active", "deleted"].includes(data.recordStatus)
      || typeof data.approvalPending !== "boolean") return unavailable();
    return NextResponse.json({ ...data, actorUserId: auth.auth.sub }, { headers });
  } catch { return unavailable(); }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;
    const payload = await request.json().catch(() => null);
    if (!isIncomeExpenseSubmission(payload)) return NextResponse.json({}, { status: 400, headers });
    if (payload.actorUserId !== auth.auth.sub) return NextResponse.json({ errorCode: "ACTOR_CHANGED" }, { status: 409, headers });
    const event = { entity: "income_expense", id: payload.clientTempId, ownerUserId: auth.auth.sub,
      locationId: payload.locationId, operation: payload.operation, serverId: payload.expectedServerId, payload } as SyncEvent;
    if (!isIncomeExpenseBackgroundCommand(event)) return NextResponse.json({}, { status: 400, headers });
    const { data, error } = await auth.supabase.rpc("sync_income_expense_background", { payload });
    const locked = cashCountLockResponse(error?.message ?? data?.errorMessage);
    if (locked) return locked;
    if (error) return unavailable();
    if (confirmedIncomeExpenseBackgroundOutcome(event, data)) return NextResponse.json(data, { headers });
    if (data?.status === "failed" || data?.status === "conflict") return NextResponse.json({
      errorMessage: publicIncomeExpenseErrorMessage(data.errorMessage, "บันทึกรายการไม่สำเร็จ"),
    }, { status: 400, headers });
    return unavailable();
  } catch { return unavailable(); }
}
