import { uploadEvidenceImageToDrive } from "@/lib/server/google-drive";
import { requireAuth } from "@/lib/server/auth";
import {
  canAccessEvidenceLocation,
  evidenceError,
  isWeightEvidenceBackupRole,
  noStoreJson,
  parseBackupIdentityHeaders,
  UUID_PATTERN,
  WEIGHT_EVIDENCE_MAX_BACKUP_IMAGE_BYTES,
} from "@/lib/server/weight-evidence";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ billId: string; rowId: string; role: string }> };

type BackupContext = {
  authResult: Extract<Awaited<ReturnType<typeof requireAuth>>, { ok: true }>;
  billId: string;
  rowId: string;
  role: "rubber" | "displayIn" | "displayOut";
  identity: { locationId: string; completionId: string; revisionNo: number };
  evidenceKey: string;
};

async function validateBackupRequest(request: Request, context: RouteContext) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return { response: authResult.response } as const;
  const { billId, rowId, role } = await context.params;
  const identity = parseBackupIdentityHeaders(request.headers);
  if (!UUID_PATTERN.test(billId) || !UUID_PATTERN.test(rowId) || !isWeightEvidenceBackupRole(role) || !identity) {
    return { response: evidenceError(400, "INVALID_REQUEST", "ข้อมูลสำรองหลักฐานไม่ถูกต้อง") } as const;
  }
  if (!canAccessEvidenceLocation(authResult.auth, identity.locationId)) {
    return { response: evidenceError(403, "LOCATION_ACCESS_DENIED", "ไม่มีสิทธิ์เข้าถึงสาขานี้") } as const;
  }

  const { data: bill, error: billError } = await authResult.supabase
    .from("rubber_bills")
    .select("id, revision_no, record_status, source_rubber_export_id, evidence_completion_id")
    .eq("id", billId)
    .eq("location_id", identity.locationId)
    .maybeSingle();
  if (billError) return { response: evidenceError(503, "BILL_READ_FAILED", "ตรวจสอบบิลไม่สำเร็จ", true) } as const;
  if (!bill || bill.record_status !== "active" || bill.source_rubber_export_id != null) {
    return { response: evidenceError(409, "BILL_INACTIVE", "บิลนี้ไม่พร้อมสำรอง") } as const;
  }
  if (bill.revision_no !== identity.revisionNo) {
    return { response: evidenceError(409, "BILL_STALE", "บิลถูกแก้ไขแล้ว") } as const;
  }
  if (bill.evidence_completion_id !== identity.completionId) {
    return { response: evidenceError(409, "NOT_COMPLETION_OWNER", "completion นี้ไม่ได้เป็นเจ้าของบิล") } as const;
  }

  const { data: row, error: rowError } = await authResult.supabase
    .from("rubber_bill_items")
    .select("id, sequence_no")
    .eq("id", rowId)
    .eq("bill_id", billId)
    .eq("item_type", "weigh")
    .maybeSingle();
  if (rowError) return { response: evidenceError(503, "ROW_READ_FAILED", "ตรวจสอบรายการชั่งไม่สำเร็จ", true) } as const;
  if (!row) return { response: evidenceError(404, "ROW_NOT_FOUND", "ไม่พบรายการชั่ง") } as const;

  const evidenceKey = `${identity.completionId}:${identity.revisionNo}:${rowId}:${role}`;
  const result: BackupContext & { sequenceNo: number } = {
    authResult,
    billId,
    rowId,
    role,
    identity,
    evidenceKey,
    sequenceNo: row.sequence_no,
  };
  return { result } as const;
}

async function findExisting(context: BackupContext) {
  const { data, error } = await context.authResult.supabase
    .from("rubber_bill_item_evidence_files")
    .select("evidence_key, drive_file_id, web_view_url")
    .eq("bill_item_id", context.rowId)
    .eq("role", context.role)
    .maybeSingle();
  if (error) return { response: evidenceError(503, "BACKUP_READ_FAILED", "ตรวจสอบสถานะสำรองไม่สำเร็จ", true) } as const;
  if (!data) return { state: "pending" } as const;
  if (data.evidence_key !== context.evidenceKey) {
    return { response: evidenceError(409, "BACKUP_CONFLICT", "รายการนี้มีหลักฐานคนละชุดแล้ว") } as const;
  }
  return {
    state: "uploaded",
    fileId: data.drive_file_id,
    webViewUrl: data.web_view_url,
  } as const;
}

export async function GET(request: Request, routeContext: RouteContext) {
  const validation = await validateBackupRequest(request, routeContext);
  if ("response" in validation) return validation.response;
  const existing = await findExisting(validation.result);
  if ("response" in existing) return existing.response;
  return noStoreJson(existing);
}

export async function POST(request: Request, routeContext: RouteContext) {
  const validation = await validateBackupRequest(request, routeContext);
  if ("response" in validation) return validation.response;
  const context = validation.result;
  const existing = await findExisting(context);
  if ("response" in existing) return existing.response;
  if (existing.state === "uploaded") return noStoreJson(existing);

  const form = await request.formData().catch(() => null);
  const image = form?.get("image");
  if (!(image instanceof File) || image.type !== "image/jpeg" || image.size <= 0) {
    return evidenceError(400, "IMAGE_REQUIRED", "ต้องมีรูป JPEG สำหรับสำรอง");
  }
  if (image.size > WEIGHT_EVIDENCE_MAX_BACKUP_IMAGE_BYTES) {
    return evidenceError(413, "IMAGE_TOO_LARGE", "รูปหลักฐานต้องไม่เกิน 4 MB");
  }

  let driveFile: { fileId: string; webViewLink: string };
  try {
    const safeRole = context.role.replace(/[^a-zA-Z]/g, "-");
    driveFile = await uploadEvidenceImageToDrive(
      Buffer.from(await image.arrayBuffer()),
      "image/jpeg",
      `weight-evidence-${context.sequenceNo}-${safeRole}.jpg`,
      context.evidenceKey,
    );
  } catch {
    return evidenceError(503, "DRIVE_UPLOAD_FAILED", "สำรองรูปไป Google Drive ไม่สำเร็จ", true);
  }

  const { data, error } = await context.authResult.supabase.rpc("record_weight_evidence_backup", {
    p_bill_id: context.billId,
    p_row_id: context.rowId,
    p_role: context.role,
    p_location_id: context.identity.locationId,
    p_revision_no: context.identity.revisionNo,
    p_completion_id: context.identity.completionId,
    p_evidence_key: context.evidenceKey,
    p_drive_file_id: driveFile.fileId,
    p_web_view_url: driveFile.webViewLink,
  });
  if (error) return evidenceError(503, "BACKUP_RECORD_FAILED", "บันทึกลิงก์สำรองไม่สำเร็จ", true);
  const state = typeof data === "object" && data !== null && "state" in data
    ? String((data as { state: unknown }).state)
    : "invalid";
  if (state === "stored") return noStoreJson(data);
  if (["inactive", "stale", "not_owner", "invalid_row", "conflict"].includes(state)) {
    return evidenceError(409, `BACKUP_${state.toUpperCase()}`, "สถานะบิลเปลี่ยนก่อนบันทึกสำรอง");
  }
  return evidenceError(503, "BACKUP_RECORD_INVALID", "บันทึกลิงก์สำรองไม่สำเร็จ", true);
}
