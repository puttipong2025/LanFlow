import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MOVEMENT_TYPES = new Set(["all", "receive", "transfer", "sale", "rubber_bill"]);
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
const MAX_CURSOR_LENGTH = 4096;

type MovementCursor = {
  version: 1;
  ownerUserId: string;
  locationId: string;
  txDate: string;
  createdAt: string;
  movementId: string;
};

function isIsoDate(value: string | null): value is string {
  if (!value || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function decodeCursor(value: string): MovementCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as MovementCursor;
    return parsed?.version === 1
      && UUID.test(parsed.ownerUserId)
      && UUID.test(parsed.locationId)
      && isIsoDate(parsed.txDate)
      && typeof parsed.createdAt === "string"
      && !Number.isNaN(Date.parse(parsed.createdAt))
      && typeof parsed.movementId === "string"
      && parsed.movementId.length > 0
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function encodeCursor(value: MovementCursor) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function canAccessLocation(auth: { canAccessSystemManager: boolean; locationIds: string[] }, locationId: string) {
  return auth.canAccessSystemManager || auth.locationIds.includes(locationId);
}

export async function GET(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;

  const locationId = request.nextUrl.searchParams.get("locationId");
  if (!locationId || !UUID.test(locationId)) {
    return NextResponse.json({ error: "พารามิเตอร์สาขาไม่ถูกต้อง" }, { status: 400 });
  }
  if (!canAccessLocation(result.auth, locationId)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์ดูสต็อกของสาขานี้" }, { status: 403 });
  }

  const view = request.nextUrl.searchParams.get("view") ?? "movements";
  if (view === "balances") {
    const { data, error } = await result.supabase.rpc("get_stock_balances", {
      p_location_id: locationId,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ balances: data ?? [] }, { headers: NO_STORE_HEADERS });
  }
  if (view !== "movements") {
    return NextResponse.json({ error: "มุมมองสต็อกไม่ถูกต้อง" }, { status: 400 });
  }

  const search = request.nextUrl.searchParams.get("search")?.trim() ?? "";
  const type = request.nextUrl.searchParams.get("type") ?? "all";
  const fromDate = request.nextUrl.searchParams.get("fromDate");
  const toDate = request.nextUrl.searchParams.get("toDate");
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
  if (
    search.length > 200
    || search.includes("\u0000")
    || !MOVEMENT_TYPES.has(type)
    || (fromDate !== null && !isIsoDate(fromDate))
    || (toDate !== null && !isIsoDate(toDate))
    || (fromDate !== null && toDate !== null && fromDate > toDate)
    || !Number.isInteger(limit)
    || limit < 1
    || limit > 100
  ) {
    return NextResponse.json({ error: "พารามิเตอร์รายการสต็อกไม่ถูกต้อง" }, { status: 400 });
  }

  const cursorValue = request.nextUrl.searchParams.get("cursor");
  if (cursorValue && cursorValue.length > MAX_CURSOR_LENGTH) {
    return NextResponse.json({ error: "cursor ไม่ถูกต้อง" }, { status: 400 });
  }
  const cursor = cursorValue ? decodeCursor(cursorValue) : null;
  if (cursorValue && !cursor) {
    return NextResponse.json({ error: "cursor ไม่ถูกต้อง" }, { status: 400 });
  }
  if (cursor && (cursor.ownerUserId !== result.auth.sub || cursor.locationId !== locationId)) {
    return NextResponse.json({ error: "cursor ไม่ตรงกับขอบเขตรายการ" }, { status: 400 });
  }

  const { data, error } = await result.supabase.rpc("get_stock_movement_page", {
    p_location_id: locationId,
    p_search: search,
    p_type: type,
    p_from_date: fromDate,
    p_to_date: toDate,
    p_cursor_tx_date: cursor?.txDate ?? null,
    p_cursor_created_at: cursor?.createdAt ?? null,
    p_cursor_movement_id: cursor?.movementId ?? null,
    p_page_size: limit,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const page = (data ?? {}) as {
    rows?: Array<Record<string, unknown>>;
    hasMore?: boolean;
    nextTxDate?: string | null;
    nextCreatedAt?: string | null;
    nextMovementId?: string | null;
  };
  const rows = (page.rows ?? []).map((row) => ({
    movementId: row.movement_id,
    sourceType: row.source_type,
    sourceLabel: row.source_type === "income_sale"
      ? "ขายจากรับ-จ่าย"
      : row.source_type === "rubber_bill_acid" || row.source_type === "rubber_bill_stock_deduction"
        ? "หักจากบิลยาง"
        : row.tx_type === "receive"
          ? "รับเข้า"
          : row.tx_type === "transfer_out"
            ? "ย้ายออก"
            : row.tx_type === "transfer_in" ? "ย้ายเข้า" : String(row.tx_type ?? "—"),
    sourceId: row.source_id,
    sourceLineId: row.source_line_id,
    txDate: row.tx_date,
    locationId: row.location_id,
    productId: row.product_id,
    productName: row.product_name,
    quantityDelta: Number(row.quantity_delta ?? 0),
    amount: Number(row.amount ?? 0),
    displayBillNo: row.display_bill_no,
    txType: row.tx_type,
    createdByUserId: row.created_by_user_id,
    createdByName: row.created_by_name,
    createdByPhone: row.created_by_phone,
    createdAt: row.created_at,
    relationLockReason: row.relation_lock_reason,
    reportLockNo: row.report_lock_no ?? null,
  }));
  const hasMore = Boolean(page.hasMore);
  const nextCursor = hasMore && page.nextTxDate && page.nextCreatedAt && page.nextMovementId
    ? encodeCursor({
        version: 1,
        ownerUserId: result.auth.sub,
        locationId,
        txDate: page.nextTxDate,
        createdAt: page.nextCreatedAt,
        movementId: page.nextMovementId,
      })
    : null;

  return NextResponse.json({ movements: rows, hasMore, nextCursor }, { headers: NO_STORE_HEADERS });
}

export async function POST(request: Request) {
  try {
    const result = await requireAuth(request);
    if (!result.ok) return result.response;
    const supabase = result.supabase;

    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ status: "failed", errorMessage: "Invalid JSON payload" }, { status: 400 });
    }

    const action = (payload as { action?: string }).action;
    if (action === "create_product") {
      const approvalPayload = {
        ...(payload as Record<string, unknown>),
        requestType: "create_product",
      };
      const { data, error } = await supabase.rpc(
        "create_stock_product_approval_request",
        { payload: approvalPayload }
      );

      if (error) {
        console.error("create_stock_product_approval_request error:", error);
        return NextResponse.json({ status: "failed", errorMessage: error.message }, { status: 500 });
      }

      const status = (data as Record<string, unknown> | null)?.status || "failed";
      if (status === "pending") {
        return NextResponse.json(data, { status: 200 });
      }
      return NextResponse.json(data || { status: "failed", errorMessage: "No response from RPC" }, { status: 400 });
    }

    const rpcName =
      action === "transfer"
          ? "transfer_stock"
          : "sync_stock_entry";
    const { data, error } = await supabase.rpc(rpcName, { payload });

    if (error) {
      console.error(`${rpcName} error:`, error);
      return NextResponse.json({ status: "failed", errorMessage: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ status: "failed", errorMessage: "No response from RPC" }, { status: 500 });
    }

    const status = (data as Record<string, unknown>).status || "failed";
    if (status === "synced") {
      return NextResponse.json(data, { status: 200 });
    }
    if (status === "conflict") {
      return NextResponse.json(data, { status: 409 });
    }

    return NextResponse.json(data, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Stock API error:", message);
    return NextResponse.json({ status: "failed", errorMessage: message }, { status: 500 });
  }
}
