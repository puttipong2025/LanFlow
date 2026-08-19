import { NextRequest, NextResponse } from "next/server";

import { hasSystemManagerAccess, requireAuth } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

type Cursor = {
  version: 2;
  ownerUserId: string;
  locationId: string;
  mode: string;
  documentStatus: string;
  search: string;
  sortAt: string;
  workIdentity: string;
};

function decodeCursor(value: string): Cursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Cursor;
    return parsed?.version === 2
      && typeof parsed.ownerUserId === "string"
      && typeof parsed.locationId === "string"
      && typeof parsed.mode === "string"
      && typeof parsed.documentStatus === "string"
      && typeof parsed.search === "string"
      && typeof parsed.sortAt === "string"
      && typeof parsed.workIdentity === "string"
      ? parsed : null;
  } catch {
    return null;
  }
}

function encodeCursor(cursor: Cursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export async function GET(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;

  const params = request.nextUrl.searchParams;
  const locationId = params.get("locationId") ?? "";
  const mode = params.get("mode") ?? "latest";
  const documentStatus = params.get("documentStatus") ?? "any";
  const search = (params.get("search") ?? "").trim().toLocaleLowerCase("th-TH");
  const limit = Number(params.get("limit") ?? 100);
  if (!hasSystemManagerAccess(result.auth) && !result.auth.locationIds.includes(locationId)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึงสาขา" }, { status: 403 });
  }
  if (!["latest", "unpriced", "pending_approval"].includes(mode)
    || !["any", "editable", "report_locked", "in_transfer"].includes(documentStatus)
    || !Number.isInteger(limit) || limit < 1 || limit > 150) {
    return NextResponse.json({ error: "พารามิเตอร์รายการบิลยางไม่ถูกต้อง" }, { status: 400 });
  }

  const cursorValue = params.get("cursor");
  const cursor = cursorValue ? decodeCursor(cursorValue) : null;
  if (cursorValue && !cursor) {
    return NextResponse.json({ error: "cursor ไม่ถูกต้อง", code: "INVALID_CURSOR" }, { status: 400 });
  }
  if (cursor && (
    cursor.ownerUserId !== result.auth.sub
    || cursor.locationId !== locationId
    || cursor.mode !== mode
    || cursor.documentStatus !== documentStatus
    || cursor.search !== search
  )) {
    return NextResponse.json({ error: "cursor ไม่ตรงกับขอบเขตรายการ", code: "CURSOR_SCOPE_MISMATCH" }, { status: 400 });
  }

  const { data, error } = await result.supabase.rpc("get_rubber_bill_operational_feed_v2", {
    p_location_id: locationId,
    p_mode: mode,
    p_document_status: documentStatus,
    p_search: search,
    p_cursor_sort_at: cursor?.sortAt ?? null,
    p_cursor_work_identity: cursor?.workIdentity ?? null,
    p_page_size: limit,
  });
  if (error) {
    console.error("Rubber Bill feed error", error.message);
    return NextResponse.json({ error: "โหลดรายการบิลยางไม่สำเร็จ" }, { status: 500 });
  }

  const payload = (data ?? {}) as {
    rows?: Array<Record<string, unknown>>;
    hasMore?: boolean;
    nextSortAt?: string | null;
    nextWorkIdentity?: string | null;
  };
  const rows = payload.rows ?? [];
  const billIds = rows
    .filter((row) => row.row_kind === "bill")
    .map((row) => String(row.id));
  let evidenceStates: Array<Record<string, unknown>> = [];
  if (billIds.length > 0) {
    const evidenceResult = await result.supabase.rpc("get_rubber_bill_evidence_states_for_bills", {
      p_location_id: locationId,
      p_bill_ids: billIds,
    });
    if (evidenceResult.error) {
      console.error("Rubber Bill page evidence error", evidenceResult.error.message);
      return NextResponse.json({ error: "โหลดสถานะหลักฐานไม่สำเร็จ" }, { status: 500 });
    }
    evidenceStates = (evidenceResult.data ?? []) as Array<Record<string, unknown>>;
  }

  const nextCursor = payload.hasMore && payload.nextSortAt && payload.nextWorkIdentity
    ? encodeCursor({
      version: 2,
      ownerUserId: result.auth.sub,
      locationId,
      mode,
      documentStatus,
      search,
      sortAt: payload.nextSortAt,
      workIdentity: payload.nextWorkIdentity,
    })
    : null;

  return NextResponse.json({ rows, evidenceStates, hasMore: Boolean(payload.hasMore), nextCursor });
}
