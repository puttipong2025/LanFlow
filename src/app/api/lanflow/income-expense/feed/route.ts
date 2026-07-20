import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function defaultStartDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 89);
  return date.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;

  const { searchParams } = request.nextUrl;
  const locationId = searchParams.get("locationId");
  const from = searchParams.get("from") ?? defaultStartDate();
  const to = searchParams.get("to") ?? new Date().toISOString().slice(0, 10);
  const pageSize = Math.min(Math.max(Number(searchParams.get("pageSize") ?? 100), 1), 100);
  const cursor = searchParams.get("cursor");

  if (!locationId || !result.auth.locationIds.includes(locationId)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึงสาขา" }, { status: 403 });
  }
  if (!DATE.test(from) || !DATE.test(to) || from > to || !Number.isInteger(pageSize)) {
    return NextResponse.json({ error: "พารามิเตอร์ feed ไม่ถูกต้อง" }, { status: 400 });
  }

  let cursorDate: string | null = null;
  let cursorKey: string | null = null;
  if (cursor) {
    try {
      [cursorDate, cursorKey] = Buffer.from(cursor, "base64").toString("utf8").split("|", 2);
    } catch {
      return NextResponse.json({ error: "cursor ไม่ถูกต้อง" }, { status: 400 });
    }
    if (!cursorDate || !cursorKey || !DATE.test(cursorDate)) {
      return NextResponse.json({ error: "cursor ไม่ถูกต้อง" }, { status: 400 });
    }
  }

  const { data, error } = await result.supabase.rpc("get_income_expense_feed", {
    p_location_id: locationId,
    p_from_date: from,
    p_to_date: to,
    p_cursor_date: cursorDate,
    p_cursor_key: cursorKey,
    p_page_size: pageSize,
  });

  if (error) {
    console.error("Income/Expense feed error:", error.message);
    return NextResponse.json({ error: "โหลดรายการรับ-จ่ายไม่สำเร็จ" }, { status: 500 });
  }

  return NextResponse.json(data ?? { rows: [], nextCursor: null });
}
