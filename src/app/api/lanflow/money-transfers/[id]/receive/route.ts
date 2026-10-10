import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/server/auth";
import {
  isIsoTimestamp,
  isJsonObject,
  isNonNegativePostgresInteger,
  isUuid,
} from "@/lib/server/management-route-error";

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isScale2Number(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= 0
    && Number(value.toFixed(2)) === value;
}

function isBranchReceiptSlip(value: unknown) {
  return isJsonObject(value)
    && isUuid(value.id)
    && (value.input_method === null || value.input_method === "manual" || value.input_method === "ocr")
    && isScale2Number(value.amount)
    && isNullableString(value.reference_number)
    && isScale2Number(value.fee)
    && isNullableString(value.sender_name)
    && isNullableString(value.receiver_name)
    && (value.transaction_date === null || isIsoTimestamp(value.transaction_date))
    && isNullableString(value.slip_image_url)
    && isNonNegativePostgresInteger(value.sort_order);
}

function isBranchReceiptResult(value: unknown, expectedId: string) {
  return isJsonObject(value)
    && value.id === expectedId
    && value.transfer_type === "branch"
    && value.record_status !== "deleted"
    && value.branch_receipt_contract_version === 1
    && value.branch_receipt_status === "received"
    && value.virtualStatus === "branch_received"
    && typeof value.idempotentReplay === "boolean"
    && isNonNegativePostgresInteger(value.revision_no)
    && isUuid(value.location_id)
    && value.target_location_id === value.location_id
    && isUuid(value.branch_received_by_user_id)
    && typeof value.branch_received_by_name === "string"
    && value.branch_received_by_name.trim().length > 0
    && isIsoTimestamp(value.branch_received_at)
    && isIsoDate(value.accounting_date)
    && Array.isArray(value.slips)
    && value.slips.length > 0
    && value.slips.every(isBranchReceiptSlip);
}

function errorResponse(message: string) {
  const publicMessage = message.replace(/^.*?(MT_[A-Z_]+:\s*)/, "");
  const status = message.includes("MT_LOCATION_DENIED") || message.includes("MT_ACCESS_DENIED")
    ? 403
    : message.includes("MT_NOT_FOUND")
      ? 404
      : message.includes("MT_REVISION_CONFLICT")
        ? 409
        : 400;
  if (!message.startsWith("MT_")) {
    console.error("Branch money transfer receive RPC error:", message);
    return NextResponse.json({ error: "ยืนยันรับเงินไม่สำเร็จ" }, { status: 500 });
  }
  return NextResponse.json({ error: publicMessage }, { status });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  const transferId = id.toLowerCase();

  const payload: unknown = await request.json().catch(() => null);
  if (
    !isJsonObject(payload)
    || !Number.isSafeInteger(payload.revisionNo)
    || Number(payload.revisionNo) < 0
    || Number(payload.revisionNo) > 2_147_483_647
  ) {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }

  const { data, error } = await auth.supabase.rpc("receive_branch_money_transfer", {
    p_transfer_id: transferId,
    p_expected_revision: Number(payload.revisionNo),
  });
  if (error) return errorResponse(error.message);
  if (!isBranchReceiptResult(data, transferId)) {
    console.error("Branch money transfer receive contract mismatch", { id: transferId });
    return NextResponse.json(
      { error: "ระบบไม่ตอบกลับผลการยืนยันรับเงินตามรูปแบบที่กำหนด" },
      { status: 500 },
    );
  }
  return NextResponse.json(data);
}
