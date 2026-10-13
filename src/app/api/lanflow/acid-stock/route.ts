import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import { summarizeUpstreamError } from "@/lib/server/auth-access-failure";
import {
  isIsoTimestamp,
  isNonNegativeNumeric12Scale2,
} from "@/lib/server/management-route-error";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MOVEMENT_TYPES = new Set(["all", "receive", "transfer", "sale", "rubber_bill"]);
const STOCK_SOURCE_TYPES = new Set([
  "stock_entry",
  "income_sale",
  "rubber_bill_acid",
  "rubber_bill_stock_deduction",
]);
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
const MAX_CURSOR_LENGTH = 4096;
const STOCK_FAILURE_MESSAGES = new Set([
  "จำนวนรับเข้าต้องมากกว่า 0",
  "จำนวนรับเข้าไม่ถูกต้อง",
  "ยอดเงินรับเข้าไม่ถูกต้อง",
  "ข้อมูลย้ายสต็อกไม่ถูกต้อง",
  "ไม่พบสาขาปลายทาง",
  "จำนวนย้ายต้องมากกว่า 0",
  "จำนวนย้ายไม่ถูกต้อง",
  "ไม่พบสินค้าในสต็อก",
  "สต็อกไม่พอสำหรับย้ายสินค้า",
  "บันทึกสต็อกไม่สำเร็จ",
  "ย้ายสต็อกไม่สำเร็จ",
]);

type MovementCursor = {
  version: 2;
  ownerUserId: string;
  locationId: string;
  scope: string;
  txDate: string;
  createdAt: string;
  movementId: string;
};

type MovementPage = {
  rows: Array<Record<string, unknown>>;
  hasMore: boolean;
  nextTxDate: string | null;
  nextCreatedAt: string | null;
  nextMovementId: string | null;
};

type StockCommand =
  | { action: "receive"; entryId: string; locationId: string; productId: string; txDate: string; quantity: number; amount: number }
  | { action: "transfer"; outId: string; inId: string; fromLocationId: string; toLocationId: string; productId: string; txDate: string; quantity: number };

function isIsoDate(value: string | null): value is string {
  if (!value || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function decodeCursor(value: string): MovementCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as MovementCursor;
    return parsed?.version === 2
      && UUID.test(parsed.ownerUserId)
      && UUID.test(parsed.locationId)
      && typeof parsed.scope === "string"
      && parsed.scope.length <= 1024
      && isIsoDate(parsed.txDate)
      && isIsoTimestamp(parsed.createdAt)
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

function movementScopeKey(search: string, type: string, fromDate: string | null, toDate: string | null) {
  return JSON.stringify([search, type, fromDate, toDate]);
}

function canAccessLocation(auth: { canAccessSystemManager: boolean; locationIds: string[] }, locationId: string) {
  return auth.canAccessSystemManager || auth.locationIds.includes(locationId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isMovementRow(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return typeof value.movement_id === "string"
    && value.movement_id.length > 0
    && typeof value.source_type === "string"
    && STOCK_SOURCE_TYPES.has(value.source_type)
    && isUuid(value.source_id)
    && (value.source_line_id === null || isUuid(value.source_line_id))
    && typeof value.tx_date === "string"
    && isIsoDate(value.tx_date)
    && isUuid(value.location_id)
    && isUuid(value.product_id)
    && typeof value.product_name === "string"
    && typeof value.quantity_delta === "number"
    && Number.isFinite(value.quantity_delta)
    && typeof value.amount === "number"
    && Number.isFinite(value.amount)
    && typeof value.display_bill_no === "string"
    && typeof value.tx_type === "string"
    && (value.created_by_user_id === null || isUuid(value.created_by_user_id))
    && isNullableString(value.created_by_name)
    && isNullableString(value.created_by_phone)
    && isIsoTimestamp(value.created_at)
    && isNullableString(value.relation_lock_reason)
    && isNullableString(value.report_lock_no);
}

function isMovementPage(value: unknown, locationId: string): value is MovementPage {
  if (
    !isRecord(value)
    || !Array.isArray(value.rows)
    || !value.rows.every((row) => isMovementRow(row) && row.location_id === locationId)
    || typeof value.hasMore !== "boolean"
  ) {
    return false;
  }
  const nextTxDate = value.nextTxDate;
  const nextCreatedAt = value.nextCreatedAt;
  const nextMovementId = value.nextMovementId;
  if (!value.hasMore) {
    return (nextTxDate === null || typeof nextTxDate === "string")
      && (nextCreatedAt === null || typeof nextCreatedAt === "string")
      && (nextMovementId === null || typeof nextMovementId === "string");
  }
  const lastRow = value.rows.at(-1);
  return Boolean(lastRow)
    && typeof nextTxDate === "string"
    && isIsoDate(nextTxDate)
    && isIsoTimestamp(nextCreatedAt)
    && typeof nextMovementId === "string"
    && nextMovementId.length > 0
    && nextTxDate === lastRow.tx_date
    && nextCreatedAt === lastRow.created_at
    && nextMovementId === lastRow.movement_id;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function parseStockBalances(value: unknown) {
  if (!Array.isArray(value)) return null;
  const balances = [];
  for (const item of value) {
    if (
      !isRecord(item)
      || !isUuid(item.productId)
      || typeof item.name !== "string"
      || typeof item.unit !== "string"
      || typeof item.balance !== "number"
      || !Number.isFinite(item.balance)
    ) {
      return null;
    }
    balances.push({
      productId: item.productId,
      name: item.name,
      unit: item.unit,
      balance: item.balance,
    });
  }
  return balances;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseSyncedStockResult(
  data: Record<string, unknown>,
  payload: Record<string, unknown>,
) {
  if (
    payload.action === "receive"
    && data.id === payload.entryId
    && isNonEmptyString(data.serverBillNo)
    && isIsoTimestamp(data.serverReceivedAt)
  ) {
    return {
      status: "synced",
      id: data.id,
      serverBillNo: data.serverBillNo,
      serverReceivedAt: data.serverReceivedAt,
    };
  }
  if (
    payload.action === "transfer"
    && data.outId === payload.outId
    && data.inId === payload.inId
    && isNonEmptyString(data.transferBillNo)
    && isIsoTimestamp(data.serverReceivedAt)
  ) {
    return {
      status: "synced",
      outId: data.outId,
      inId: data.inId,
      transferBillNo: data.transferBillNo,
      serverReceivedAt: data.serverReceivedAt,
    };
  }
  return null;
}

function parseStockCommand(payload: Record<string, unknown>): StockCommand | null {
  if (payload.action === "receive") {
    if (!(isUuid(payload.entryId)
      && isUuid(payload.locationId)
      && isUuid(payload.productId)
      && typeof payload.txDate === "string"
      && isIsoDate(payload.txDate)
      && isNonNegativeNumeric12Scale2(payload.quantity)
      && payload.quantity > 0
      && isNonNegativeNumeric12Scale2(payload.amount))) return null;
    return {
      action: "receive",
      entryId: payload.entryId,
      locationId: payload.locationId,
      productId: payload.productId,
      txDate: payload.txDate,
      quantity: payload.quantity,
      amount: payload.amount,
    };
  }
  if (payload.action === "transfer") {
    if (!(isUuid(payload.outId)
      && isUuid(payload.inId)
      && payload.outId !== payload.inId
      && isUuid(payload.fromLocationId)
      && isUuid(payload.toLocationId)
      && payload.fromLocationId !== payload.toLocationId
      && isUuid(payload.productId)
      && typeof payload.txDate === "string"
      && isIsoDate(payload.txDate)
      && isNonNegativeNumeric12Scale2(payload.quantity)
      && payload.quantity > 0)) return null;
    return {
      action: "transfer",
      outId: payload.outId,
      inId: payload.inId,
      fromLocationId: payload.fromLocationId,
      toLocationId: payload.toLocationId,
      productId: payload.productId,
      txDate: payload.txDate,
      quantity: payload.quantity,
    };
  }
  return null;
}

function stockErrorResponse(message = "บันทึกสต็อกไม่สำเร็จ", status = 500) {
  return NextResponse.json({ status: "failed", errorMessage: message }, { status });
}

function stockReadErrorResponse() {
  return NextResponse.json(
    { error: "โหลดข้อมูลสต็อกไม่สำเร็จ" },
    { status: 500, headers: NO_STORE_HEADERS },
  );
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
    let balanceResult;
    try {
      balanceResult = await result.supabase.rpc("get_stock_balances", {
        p_location_id: locationId,
      });
    } catch (error) {
      console.error("Stock balances read failed", summarizeUpstreamError(error));
      return stockReadErrorResponse();
    }
    if (balanceResult.error) {
      console.error("Stock balances unavailable", summarizeUpstreamError(balanceResult.error));
      return stockReadErrorResponse();
    }
    const balances = parseStockBalances(balanceResult.data);
    if (!balances) {
      console.error("Stock balances read returned an invalid payload");
      return stockReadErrorResponse();
    }
    return NextResponse.json({ balances }, { headers: NO_STORE_HEADERS });
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
  const scope = movementScopeKey(search, type, fromDate, toDate);
  if (cursor && (
    cursor.ownerUserId !== result.auth.sub
    || cursor.locationId !== locationId
    || cursor.scope !== scope
  )) {
    return NextResponse.json({ error: "cursor ไม่ตรงกับขอบเขตรายการ" }, { status: 400 });
  }

  let movementResult;
  try {
    movementResult = await result.supabase.rpc("get_stock_movement_page", {
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
  } catch (error) {
    console.error("Stock movements read failed", summarizeUpstreamError(error));
    return stockReadErrorResponse();
  }
  if (movementResult.error) {
    console.error("Stock movements unavailable", summarizeUpstreamError(movementResult.error));
    return stockReadErrorResponse();
  }
  if (!isMovementPage(movementResult.data, locationId)) {
    console.error("Stock movements read returned an invalid payload");
    return stockReadErrorResponse();
  }
  const page = movementResult.data;
  const rows = page.rows.map((row) => ({
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
        version: 2,
        ownerUserId: result.auth.sub,
        locationId,
        scope,
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

    const requestPayload = await request.json().catch(() => null);
    const payload = isRecord(requestPayload) ? parseStockCommand(requestPayload) : null;
    if (!payload) {
      return NextResponse.json({ status: "failed", errorMessage: "Invalid JSON payload" }, { status: 400 });
    }

    const sourceLocationId = payload.action === "transfer"
      ? payload.fromLocationId
      : payload.locationId;
    if (!canAccessLocation(result.auth, sourceLocationId)) {
      return NextResponse.json(
        { status: "failed", errorMessage: "ไม่มีสิทธิ์แก้ไขสต็อกของสาขานี้" },
        { status: 403 },
      );
    }

    const rpcName = payload.action === "transfer" ? "transfer_stock" : "sync_stock_entry";
    const { data, error } = await supabase.rpc(rpcName, { payload });

    if (error) {
      console.error(`${rpcName} error:`, summarizeUpstreamError(error));
      return stockErrorResponse();
    }

    if (!isRecord(data)) {
      console.error(`${rpcName} returned an invalid payload`);
      return stockErrorResponse();
    }

    const status = data.status;
    if (status === "synced") {
      const syncedResult = parseSyncedStockResult(data, payload);
      if (!syncedResult) {
        console.error(`${rpcName} returned an invalid synced payload`);
        return stockErrorResponse();
      }
      return NextResponse.json(syncedResult, { status: 200 });
    }
    if (status === "conflict") {
      return NextResponse.json(
        { status: "conflict", errorMessage: "คำสั่งสต็อกนี้ถูกใช้กับข้อมูลอื่นแล้ว" },
        { status: 409 },
      );
    }
    if (status === "failed") {
      const message = typeof data.errorMessage === "string"
        && STOCK_FAILURE_MESSAGES.has(data.errorMessage)
        ? data.errorMessage
        : "บันทึกสต็อกไม่สำเร็จ";
      return stockErrorResponse(message, 400);
    }

    console.error(`${rpcName} returned an unexpected status`);
    return stockErrorResponse();
  } catch (err: unknown) {
    console.error("Stock API error:", summarizeUpstreamError(err));
    return stockErrorResponse();
  }
}
