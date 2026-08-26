import { NextRequest, NextResponse } from "next/server";
import { hasSystemManagerAccess, requireAuth } from "@/lib/server/auth";
import type { IncomeExpense } from "@/types";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODES = new Set(["latest", "pending_approval"]);

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
  if (!MODES.has(mode) || search.length > 200 || (cursor?.length ?? 0) > 4096) {
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
    console.error("Income/Expense operational feed error:", error.message);
    if (/invalid cursor|cursor scope mismatch/i.test(error.message)) {
      return NextResponse.json({ error: "cursor ไม่ถูกต้อง" }, { status: 400 });
    }
    return NextResponse.json({ error: "โหลดรายการรับ-จ่ายไม่สำเร็จ" }, { status: 500 });
  }

  const payload = (data ?? {}) as Partial<{
    rows: IncomeExpense[];
    nextCursor: string | null;
    hasMore: boolean;
    pendingApprovalCount: number;
  }>;
  return NextResponse.json({
    rows: payload.rows ?? [],
    nextCursor: payload.nextCursor ?? null,
    hasMore: payload.hasMore === true,
    pendingApprovalCount: Number(payload.pendingApprovalCount ?? 0),
  });
}
