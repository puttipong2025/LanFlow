import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import type { IncomeExpense } from "@/types";
import { bangkokDateWindow } from "@/lib/bangkok-date";
import { formatCurrency } from "@/lib/format";

export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;

  const { searchParams } = request.nextUrl;
  const defaultWindow = bangkokDateWindow(90);
  const locationId = searchParams.get("locationId");
  const from = searchParams.get("from") ?? defaultWindow.from;
  const to = searchParams.get("to") ?? defaultWindow.to;
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
      .select("id, report_lock_no, sale_group_id, sale_line_order, sale_expected_lines")
      .in("id", directIds);
    if (lockError) {
      console.error("Income/Expense report lock error:", lockError.message);
      return NextResponse.json({ error: "โหลดสถานะล็อกรายงานไม่สำเร็จ" }, { status: 500 });
    }

    const metadataById = new Map(
      (locks ?? []).map((row) => [row.id, {
        reportLockNo: row.report_lock_no as string | null,
        saleGroupId: row.sale_group_id as string | null,
        saleLineOrder: row.sale_line_order as number | null,
        saleExpectedLines: row.sale_expected_lines as number | null,
      }])
    );
    payload.rows = payload.rows.map((row) => {
      const metadata = metadataById.get(row.id);
      if (!metadata) return row;
      return {
        ...row,
        saleGroupId: metadata.saleGroupId,
        saleLineOrder: metadata.saleLineOrder,
        saleExpectedLines: metadata.saleExpectedLines,
        ...(metadata.reportLockNo && {
          reportLockNo: metadata.reportLockNo,
          relationLockReason: `ล็อกโดยรายงาน ${metadata.reportLockNo} — ต้องลบรายงานล่าสุดตามลำดับก่อน`,
        }),
      };
    });
  }

  const cashIncomeSourceIds = Array.from(new Set(
    payload.rows
      .filter((row) => row.id.startsWith("cash-transfer-income:"))
      .map((row) => row.relationSourceLocationId)
      .filter((id): id is string => Boolean(id))
  ));

  if (cashIncomeSourceIds.length > 0) {
    const { data: sourceLocations, error: locationError } = await result.supabase
      .from("locations")
      .select("id, name")
      .in("id", cashIncomeSourceIds);
    if (locationError) {
      console.error("Cash transfer source location error:", locationError.message);
      return NextResponse.json({ error: "โหลดชื่อสาขาต้นทางไม่สำเร็จ" }, { status: 500 });
    }

    const sourceNameById = new Map(
      (sourceLocations ?? []).map((location) => [location.id, location.name])
    );
    payload.rows = payload.rows.map((row) => {
      if (!row.id.startsWith("cash-transfer-income:") || !row.relationSourceLocationId) return row;
      const sourceName = sourceNameById.get(row.relationSourceLocationId);
      return sourceName ? { ...row, title: `รับโอนเงินสดจาก ${sourceName}` } : row;
    });
  }

  const cashTransferIds = Array.from(new Set(
    payload.rows
      .map((row) => row.relationSourceId)
      .filter((id): id is string => Boolean(id?.startsWith("cash:")))
      .map((id) => id.slice(5))
      .filter((id) => UUID.test(id))
  ));

  if (cashTransferIds.length > 0) {
    const { data: details, error: detailError } = await result.supabase
      .from("money_transfer_cash_details")
      .select("transfer_id, cash_status, difference_total")
      .in("transfer_id", cashTransferIds);
    if (detailError) {
      console.error("Cash transfer receipt status error:", detailError.message);
      return NextResponse.json({ error: "โหลดสถานะการรับเงินสดไม่สำเร็จ" }, { status: 500 });
    }

    const detailByTransferId = new Map((details ?? []).map((detail) => [detail.transfer_id, detail]));
    payload.rows = payload.rows.map((row) => {
      if (!row.relationSourceId?.startsWith("cash:")) return row;
      const detail = detailByTransferId.get(row.relationSourceId.slice(5));
      if (!detail) return row;
      const difference = Number(detail.difference_total ?? 0);
      return {
        ...row,
        relationLabel: detail.cash_status === "pending_receipt"
          ? "รอรับเงิน"
          : difference
            ? `รับเงินแล้ว · ผลต่าง ${formatCurrency(difference)}`
            : "รับเงินแล้ว",
      };
    });
  }

  return NextResponse.json(payload);
}
