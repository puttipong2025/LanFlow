import { NextRequest, NextResponse } from "next/server";
import { hasSystemManagerAccess, requireAuth } from "@/lib/server/auth";
import {
  isIncomeExpenseFeedPayload,
  type IncomeExpenseServerFeedMode,
} from "@/lib/income-expense/contracts";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODES = new Set<IncomeExpenseServerFeedMode>(["latest", "pending_approval"]);

function isFeedMode(value: string): value is IncomeExpenseServerFeedMode {
  return MODES.has(value as IncomeExpenseServerFeedMode);
}

function normalizeSearch(value: string | null) {
  return (value ?? "").trim().replace(/\s+/gu, " ");
}

export async function GET(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;

  const locationId = request.nextUrl.searchParams.get("locationId");
  const mode = request.nextUrl.searchParams.get("mode") ?? "latest";
  const search = normalizeSearch(request.nextUrl.searchParams.get("search"));
  const cursor = request.nextUrl.searchParams.get("cursor");

  if (!locationId || !UUID.test(locationId)) {
    return NextResponse.json({ error: "พารามิเตอร์ feed ไม่ถูกต้อง" }, { status: 400 });
  }
  if (!isFeedMode(mode) || search.length > 200 || (cursor?.length ?? 0) > 4096) {
    return NextResponse.json({ error: "พารามิเตอร์ feed ไม่ถูกต้อง" }, { status: 400 });
  }
  if (!hasSystemManagerAccess(result.auth) && !result.auth.locationIds.includes(locationId)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึงสาขา" }, { status: 403 });
  }
  if (mode === "pending_approval" && !hasSystemManagerAccess(result.auth)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึงคิวอนุมัติ" }, { status: 403 });
  }

  const { data, error } = await result.supabase.rpc("get_income_expense_operational_feed", {
    p_location_id: locationId,
    p_mode: mode,
    p_search: search,
    p_cursor: cursor,
  });

  if (error) {
    console.error("Income/Expense operational feed error:", error);
    if (/invalid cursor|cursor scope mismatch/i.test(error.message)) {
      return NextResponse.json({ error: "cursor ไม่ถูกต้อง" }, { status: 400 });
    }
    return NextResponse.json({ error: "โหลดรายการรับ-จ่ายไม่สำเร็จ" }, { status: 500 });
  }

  if (!isIncomeExpenseFeedPayload(data, locationId, mode)) {
    return NextResponse.json(
      { error: "ระบบไม่ตอบกลับรายการรับ-จ่ายตามรูปแบบที่กำหนด" },
      { status: 500 },
    );
  }
  return NextResponse.json(data);
}
