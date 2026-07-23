import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import type { IncomeExpense } from "@/types";

export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  const payload = (data ?? { rows: [], nextCursor: null }) as {
    rows: IncomeExpense[];
    nextCursor: string | null;
  };
  const directIds = payload.rows
    .filter((row) => !row.relationSourceType && UUID.test(row.id))
    .map((row) => row.id);

  if (directIds.length > 0) {
    const { data: locks, error: lockError } = await result.supabase
      .from("income_expense")
      .select("id, report_lock_no")
      .in("id", directIds);
    if (lockError) {
      console.error("Income/Expense report lock error:", lockError.message);
      return NextResponse.json({ error: "โหลดสถานะล็อกรายงานไม่สำเร็จ" }, { status: 500 });
    }

    const lockById = new Map(
      (locks ?? []).map((row) => [row.id, row.report_lock_no as string | null])
    );
    payload.rows = payload.rows.map((row) => {
      const reportLockNo = lockById.get(row.id) ?? null;
      return reportLockNo
        ? {
            ...row,
            reportLockNo,
            relationLockReason: `ล็อกโดยรายงาน ${reportLockNo} — ต้องลบรายงานล่าสุดตามลำดับก่อน`,
          }
        : row;
    });
  }

  return NextResponse.json(payload);
}
