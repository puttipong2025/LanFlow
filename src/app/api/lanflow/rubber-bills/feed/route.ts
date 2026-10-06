import { NextRequest, NextResponse } from "next/server";

import { hasSystemManagerAccess, requireAuth } from "@/lib/server/auth";
import {
  isIsoTimestamp,
  isJsonObject,
  isNonNegativePostgresInteger,
  isUuid,
} from "@/lib/server/management-route-error";

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

type FeedPayload = {
  rows: Array<Record<string, unknown>>;
  hasMore: boolean;
  nextSortAt: string | null;
  nextWorkIdentity: string | null;
};

function isApprovalReasonArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every((reason) => (
      reason === "price" || reason === "time" || reason === "non_current_date"
    ))
    && new Set(value).size === value.length;
}

function isApprovalProposedSummary(value: unknown) {
  if (value === undefined || value === null) return true;
  return isJsonObject(value)
    && typeof value.customerName === "string"
    && typeof value.billDate === "string"
    && typeof value.billType === "string"
    && [
      value.netWeight,
      value.averagePrice,
      value.netRubberValue,
      value.deductionTotal,
      value.netTotal,
    ].every((amount) => typeof amount === "number" && Number.isFinite(amount));
}

const DISPLAY_TEXT_FIELDS = [
  "local_bill_no",
  "server_bill_no",
  "bill_no",
  "bill_date",
  "customer_name",
  "bill_type",
  "created_by_name",
  "created_by_phone",
  "approved_by_name",
  "approval_requested_by_name",
  "record_status",
  "report_lock_no",
  "source_export_no",
] as const;

const FEED_NUMBER_FIELDS = [
  "deduct_weight",
  "weight",
  "net_weight",
  "rubber_value",
  "net_rubber_value",
  "average_price",
  "deduction_total",
  "payable_before_rounding",
  "net_total",
  "acid_pack_count",
  "configured_price_snapshot",
  "approval_revision_no",
  "revision_no",
  "received_age_hours",
] as const;

const ITEM_NUMBER_FIELDS = [
  "weight_in",
  "weight_out",
  "net_weight",
  "price",
  "total",
  "quantity",
  "sequence_no",
] as const;

const RETIRED_APPROVAL_FIELDS = [
  "original_payload",
  "proposed_payload",
  "approval_original_summary",
] as const;

function hasSafeDisplayText(value: Record<string, unknown>) {
  return DISPLAY_TEXT_FIELDS.every((field) => (
    value[field] === undefined || value[field] === null || typeof value[field] === "string"
  ));
}

function hasSafeNumbers(value: Record<string, unknown>, fields: readonly string[]) {
  return fields.every((field) => (
    value[field] === undefined
    || value[field] === null
    || (typeof value[field] === "number" && Number.isFinite(value[field]))
  ));
}

function isFeedItem(value: unknown) {
  return isJsonObject(value)
    && ["id", "item_type", "description", "unit", "stock_product_id"].every((field) => (
      value[field] === undefined || value[field] === null || typeof value[field] === "string"
    ))
    && hasSafeNumbers(value, ITEM_NUMBER_FIELDS);
}

function hasExpectedDocumentStatus(value: Record<string, unknown>, documentStatus: string) {
  if (documentStatus === "any") return true;
  if (value.row_kind !== "bill") return false;
  if (documentStatus === "report_locked") {
    return typeof value.report_lock_no === "string" && value.report_lock_no.trim().length > 0;
  }
  if (documentStatus === "in_transfer") return isUuid(value.transfer_lock_id);
  return value.report_lock_no == null
    && value.transfer_lock_id == null
    && value.approval_pending === false;
}

function isFeedRow(
  value: unknown,
  expectedLocationId: string,
  mode: string,
  documentStatus: string,
) {
  if (!isJsonObject(value)
      || !isUuid(value.id)
      || value.location_id !== expectedLocationId
      || value.record_status !== "active"
      || !isIsoTimestamp(value.operational_sort_at)
      || RETIRED_APPROVAL_FIELDS.some((field) => (
        Object.prototype.hasOwnProperty.call(value, field)
      ))
      || (value.report_lock_no != null && (
        typeof value.report_lock_no !== "string" || value.report_lock_no.trim().length === 0
      ))
      || (value.transfer_lock_id != null && !isUuid(value.transfer_lock_id))
      || !hasSafeDisplayText(value)
      || !hasSafeNumbers(value, FEED_NUMBER_FIELDS)
      || !Array.isArray(value.items)
      || !value.items.every(isFeedItem)
      || !isApprovalProposedSummary(value.approval_proposed_summary)
      || !hasExpectedDocumentStatus(value, documentStatus)) {
    return false;
  }
  const expectedIdentity = value.row_kind === "bill"
    ? `bill:${value.id}`
    : value.row_kind === "approval_create"
      ? `approval:${value.id}`
      : null;
  if (expectedIdentity === null || value.work_identity !== expectedIdentity) return false;
  const hasValidPendingApproval = value.approval_pending === true
    && isUuid(value.approval_request_id)
    && (value.approval_operation === "create"
      || value.approval_operation === "update"
      || value.approval_operation === "delete")
    && isApprovalReasonArray(value.approval_reasons);
  if (mode === "pending_approval" && (
    !hasValidPendingApproval
    || (value.row_kind === "bill" && value.approval_proposed_summary == null)
  )) return false;
  if (mode === "unpriced" && (
    value.row_kind !== "bill"
    || !value.items.some((item) => (
      isJsonObject(item)
      && item.item_type === "weigh"
      && (item.price === undefined
        || item.price === null
        || (typeof item.price === "number" && item.price <= 0))
    ))
  )) return false;
  if (value.row_kind === "bill") {
    return value.approval_pending === false
      || (hasValidPendingApproval && value.approval_operation !== "create");
  }
  return hasValidPendingApproval
    && value.approval_request_id === value.id
    && value.approval_operation === "create"
    && value.revision_no === 0;
}

function hasExpectedFeedOrder(rows: Array<Record<string, unknown>>, mode: string) {
  const ascending = mode === "unpriced" || mode === "pending_approval";
  const timestampMicros = (value: string) => {
    const fraction = /\.(\d{1,6})/.exec(value)?.[1]?.padEnd(6, "0") ?? "000000";
    return BigInt(Date.parse(value)) * BigInt(1_000) + BigInt(fraction.slice(3) || "0");
  };
  return rows.every((row, index) => {
    if (index === 0) return true;
    const previous = rows[index - 1];
    const rowTime = timestampMicros(row.operational_sort_at as string);
    const previousTime = timestampMicros(previous.operational_sort_at as string);
    if (rowTime !== previousTime) return ascending ? rowTime > previousTime : rowTime < previousTime;
    return ascending
      ? (row.work_identity as string) > (previous.work_identity as string)
      : (row.work_identity as string) < (previous.work_identity as string);
  });
}

function isFeedPayload(
  value: unknown,
  expectedLocationId: string,
  mode: string,
  documentStatus: string,
): value is FeedPayload {
  if (!isJsonObject(value)
      || !Array.isArray(value.rows)
      || !value.rows.every((row) => isFeedRow(row, expectedLocationId, mode, documentStatus))
      || !hasExpectedFeedOrder(value.rows, mode)
      || typeof value.hasMore !== "boolean") {
    return false;
  }
  const workIdentities = value.rows.map((row) => row.work_identity);
  if (new Set(workIdentities).size !== workIdentities.length) return false;
  const hasNoCursor = value.nextSortAt === null && value.nextWorkIdentity === null;
  const hasValidCursor = isIsoTimestamp(value.nextSortAt)
    && typeof value.nextWorkIdentity === "string"
    && value.nextWorkIdentity.length > 0;
  if (!hasNoCursor && !hasValidCursor) return false;
  if (!value.hasMore) return true;
  const lastRow = value.rows.at(-1);
  return hasValidCursor
    && isJsonObject(lastRow)
    && lastRow.operational_sort_at === value.nextSortAt
    && lastRow.work_identity === value.nextWorkIdentity;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isEvidenceState(
  value: unknown,
  expectedLocationId: string,
  expectedBillIds: Set<string>,
): value is Record<string, unknown> {
  if (!isJsonObject(value)
      || value.location_id !== expectedLocationId
      || !isUuid(value.bill_id)
      || !expectedBillIds.has(value.bill_id)
      || !isNonNegativePostgresInteger(value.revision_no)
      || (value.client_created_at !== null && !isIsoTimestamp(value.client_created_at))
      || (value.review_period_id !== null && !isUuid(value.review_period_id))
      || !["outside", "normal", "pending", "pass", "improve"].includes(String(value.review_status))
      || typeof value.missing_rubber !== "boolean"
      || typeof value.missing_display_in !== "boolean"
      || typeof value.has_manual_correction !== "boolean"
      || typeof value.is_unpriced !== "boolean"
      || typeof value.has_any_evidence !== "boolean"
      || !isNonNegativeSafeInteger(value.required_role_count)
      || !isNonNegativeSafeInteger(value.present_required_role_count)
      || value.present_required_role_count > value.required_role_count
      || (value.decision !== null && value.decision !== "pass" && value.decision !== "improve")
      || (value.reviewed_by_name !== null && typeof value.reviewed_by_name !== "string")
      || (value.reviewed_at !== null && !isIsoTimestamp(value.reviewed_at))) {
    return false;
  }
  return value.decision === null || value.review_status === value.decision;
}

function isWorkIdentity(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const [kind, id, extra] = value.split(":");
  return extra === undefined && (kind === "bill" || kind === "approval") && isUuid(id);
}

function decodeCursor(value: string): Cursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Cursor;
    return parsed?.version === 2
      && typeof parsed.ownerUserId === "string"
      && typeof parsed.locationId === "string"
      && typeof parsed.mode === "string"
      && typeof parsed.documentStatus === "string"
      && typeof parsed.search === "string"
      && isIsoTimestamp(parsed.sortAt)
      && isWorkIdentity(parsed.workIdentity)
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
  if (!isUuid(locationId)) {
    return NextResponse.json({ error: "รหัสสาขาไม่ถูกต้อง" }, { status: 400 });
  }
  if (!hasSystemManagerAccess(result.auth) && !result.auth.locationIds.includes(locationId)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึงสาขา" }, { status: 403 });
  }
  if (mode === "pending_approval" && !hasSystemManagerAccess(result.auth)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึงงานอนุมัติ" }, { status: 403 });
  }
  if (!["latest", "unpriced", "pending_approval"].includes(mode)
    || !["any", "editable", "report_locked", "in_transfer"].includes(documentStatus)
    || search.length > 200
    || !Number.isInteger(limit) || limit < 1 || limit > 150) {
    return NextResponse.json({ error: "พารามิเตอร์รายการบิลยางไม่ถูกต้อง" }, { status: 400 });
  }

  const cursorValue = params.get("cursor");
  if ((cursorValue?.length ?? 0) > 4096) {
    return NextResponse.json({ error: "cursor ไม่ถูกต้อง", code: "INVALID_CURSOR" }, { status: 400 });
  }
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

  if (!isFeedPayload(data, locationId, mode, documentStatus)) {
    return NextResponse.json(
      { error: "ระบบไม่ตอบกลับรายการบิลยางตามรูปแบบที่กำหนด" },
      { status: 500 },
    );
  }
  const payload = data;
  const rows = payload.rows;
  let evidenceStates: Array<Record<string, unknown>> = [];
  if (mode !== "pending_approval") {
    const billIds = rows
      .filter((row) => row.row_kind === "bill")
      .map((row) => String(row.id));
    if (billIds.length > 0) {
      const evidenceResult = await result.supabase.rpc("get_rubber_bill_evidence_states_for_bills", {
        p_location_id: locationId,
        p_bill_ids: billIds,
      });
      if (evidenceResult.error) {
        console.error("Rubber Bill page evidence error", evidenceResult.error.message);
        return NextResponse.json({ error: "โหลดสถานะหลักฐานไม่สำเร็จ" }, { status: 500 });
      }
      const evidenceData = evidenceResult.data ?? [];
      const expectedBillIds = new Set(billIds);
      if (!Array.isArray(evidenceData)
          || !evidenceData.every((state) => isEvidenceState(state, locationId, expectedBillIds))
          || evidenceData.length !== expectedBillIds.size
          || new Set(evidenceData.map((state) => state.bill_id)).size !== evidenceData.length) {
        return NextResponse.json(
          { error: "ระบบไม่ตอบกลับสถานะหลักฐานตามรูปแบบที่กำหนด" },
          { status: 500 },
        );
      }
      evidenceStates = evidenceData;
    }
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
