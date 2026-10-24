import { createSupabaseAdminClient } from "./supabase-admin";
import { bankImage } from "./cash-count-bank-ocr";
import { reservePrivateDriveFileId, uploadPrivateImageToDrive } from "./google-drive";
import { isUuid } from "./management-route-error";
import { validCashCountCounts } from "@/lib/cash-count-validation";
import { CashCountInputError } from "@/lib/server/cash-count-response";

// File IDs are reserved before upload, so a lost Drive/DB response can replay the same file.
export async function prepareCashCountSubmission(request: Request, userId: string) {
  const form = await request.formData().catch(() => { throw new CashCountInputError("ข้อมูลรูปตรวจนับไม่ถูกต้อง"); });
  const sessionId = form.get("sessionId");
  const evidenceIds = form.getAll("evidenceId");
  const images = form.getAll("image");
  const confirmations = form.getAll("confirmed");
  if (evidenceIds.length > 4 || !evidenceIds.every(isUuid) || new Set(evidenceIds).size !== evidenceIds.length
    || images.length !== evidenceIds.length || confirmations.length !== evidenceIds.length) throw new CashCountInputError("เลือกบัญชีได้สูงสุด 4 ช่องพร้อมรูปและการยืนยันครบทุกช่อง");
  if (!isUuid(sessionId)) throw new CashCountInputError("รอบนับไม่ถูกต้อง");
  let actualCounts: unknown;
  try { actualCounts = JSON.parse(String(form.get("actualCounts"))); }
  catch { throw new CashCountInputError("จำนวนเงินแต่ละชนิดไม่ถูกต้อง"); }
  if (!validCashCountCounts(actualCounts)) throw new CashCountInputError("จำนวนเงินแต่ละชนิดไม่ถูกต้อง");
  const admin = createSupabaseAdminClient();
  const { data: session, error: sessionError } = await admin.from("cash_count_sessions").select("status,expires_at")
    .eq("id", sessionId).eq("started_by_user_id", userId).single();
  if (sessionError || !session) throw new CashCountInputError("ไม่มีสิทธิ์ส่งผลนับเงิน");
  if (session.status === "submitted") return { sessionId, actualCounts, evidenceIds: [] as string[] };
  if (session.status !== "active" || Date.parse(session.expires_at) <= Date.now()) throw new CashCountInputError("รอบนับหมดเวลา");
  // Validate every selected image before any external upload; no partial invalid list is accepted.
  const selected = [];
  for (let index = 0; index < evidenceIds.length; index++) {
    const evidenceId = String(evidenceIds[index]);
    if (confirmations[index] !== "true") throw new CashCountInputError("กรุณายืนยันยอดตรงกับรูปทุกบัญชี");
    const image = await bankImage(images[index]);
    const { data: evidence, error } = await admin.from("cash_count_bank_evidence").select("*")
      .eq("id", evidenceId).eq("session_id", sessionId).eq("owner_user_id", userId).single();
    if (error || !evidence || evidence.image_sha256 !== image.hash) throw new CashCountInputError("รูปไม่ตรงกับผล OCR กรุณาถ่ายใหม่");
    selected.push({ evidenceId, image, evidence });
  }
  if (new Set(selected.map((item) => item.evidence.slot_id)).size !== selected.length) throw new CashCountInputError("หนึ่งช่องใช้ได้หนึ่งรูป");
  for (const { evidenceId, image, evidence } of selected) {
    if (!evidence.drive_file_id) {
      const reserved = await reservePrivateDriveFileId();
      const { error: reserveError } = await admin.from("cash_count_bank_evidence")
        .update({ drive_file_id: reserved }).eq("id", evidenceId).is("drive_file_id", null);
      if (reserveError) throw new CashCountInputError("เตรียมจัดเก็บรูปไม่สำเร็จ");
    }
    const { data: current, error: currentError } = await admin.from("cash_count_bank_evidence")
      .select("drive_file_id,drive_uploaded_at").eq("id", evidenceId).single();
    if (currentError || !current?.drive_file_id) throw new CashCountInputError("เตรียมจัดเก็บรูปไม่สำเร็จ");
    if (!current.drive_uploaded_at) {
      const { error: beganError } = await admin.from("cash_count_bank_evidence")
        .update({ upload_started_at: new Date().toISOString() }).eq("id", evidenceId);
      if (beganError) throw new CashCountInputError("เตรียมอัปโหลดรูปไม่สำเร็จ");
      await uploadPrivateImageToDrive(image.buffer, image.type.mimeType, `cash-count-${sessionId}-${evidenceId}.${image.type.extension}`, current.drive_file_id);
      const { error: savedError } = await admin.from("cash_count_bank_evidence")
        .update({ drive_uploaded_at: new Date().toISOString() }).eq("id", evidenceId);
      if (savedError) throw new CashCountInputError("บันทึกหลักฐานไม่สำเร็จ กรุณาลองบันทึกอีกครั้ง");
    }
  }
  return { sessionId, actualCounts, evidenceIds: evidenceIds as string[] };
}
