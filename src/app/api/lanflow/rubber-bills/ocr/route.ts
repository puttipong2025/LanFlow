import { uploadPrivateImageToDrive } from "@/lib/server/google-drive";
import { requireAuth, hasSystemManagerAccess } from "@/lib/server/auth";
import {
  detectRubberBillOcrImage,
  hashRubberBillOcrImage,
  readRubberBillOcrImage,
  resolveRubberBillOcrExistingSource,
  rubberBillOcrError,
  rubberBillOcrSuccess,
  RubberBillOcrUpstreamError,
  RUBBER_BILL_OCR_MAX_IMAGE_BYTES,
  RUBBER_BILL_OCR_UUID_PATTERN,
} from "@/lib/server/rubber-bill-ocr";
import { createSupabaseAdminClient } from "@/lib/server/supabase-admin";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) {
    const status = authResult.response.status;
    return rubberBillOcrError(
      status,
      status === 401 ? "UNAUTHORIZED" : "AUTH_UNAVAILABLE",
      status === 401 ? "กรุณาเข้าสู่ระบบ" : "ตรวจสอบสิทธิ์ไม่สำเร็จ",
      status === 503,
    );
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > RUBBER_BILL_OCR_MAX_IMAGE_BYTES + 1024 * 1024) {
    return rubberBillOcrError(400, "IMAGE_INVALID", "รองรับเฉพาะรูป JPEG หรือ PNG ขนาดไม่เกิน 8 MB");
  }

  const form = await request.formData().catch(() => null);
  const image = form?.get("image");
  const locationId = form?.get("locationId");
  if (!(image instanceof File)) {
    return rubberBillOcrError(400, "IMAGE_REQUIRED", "กรุณาเลือกรูปใบชั่ง");
  }
  if (typeof locationId !== "string" || !RUBBER_BILL_OCR_UUID_PATTERN.test(locationId)) {
    return rubberBillOcrError(400, "LOCATION_INVALID", "ข้อมูลสาขาไม่ถูกต้อง");
  }

  const canAccessLocation = hasSystemManagerAccess(authResult.auth)
    || authResult.auth.locationIds.includes(locationId);
  if (!canAccessLocation) {
    return rubberBillOcrError(403, "LOCATION_ACCESS_DENIED", "ไม่มีสิทธิ์เข้าถึงสาขานี้");
  }
  const { data: activeLocation, error: locationError } = await authResult.supabase
    .from("locations")
    .select("id")
    .eq("id", locationId)
    .eq("is_active", true)
    .maybeSingle();
  if (locationError) {
    return rubberBillOcrError(503, "LOCATION_CHECK_FAILED", "ตรวจสอบสาขาไม่สำเร็จ", true);
  }
  if (!activeLocation) {
    return rubberBillOcrError(403, "LOCATION_INACTIVE", "สาขานี้ไม่พร้อมใช้งาน");
  }

  if (image.size <= 0 || image.size > RUBBER_BILL_OCR_MAX_IMAGE_BYTES) {
    return rubberBillOcrError(400, "IMAGE_INVALID", "รองรับเฉพาะรูป JPEG หรือ PNG ขนาดไม่เกิน 8 MB");
  }
  const buffer = Buffer.from(await image.arrayBuffer());
  const imageType = detectRubberBillOcrImage(buffer, image.type, image.size);
  if (!imageType) {
    return rubberBillOcrError(400, "IMAGE_INVALID", "รองรับเฉพาะรูป JPEG หรือ PNG ขนาดไม่เกิน 8 MB");
  }

  let admin: ReturnType<typeof createSupabaseAdminClient>;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return rubberBillOcrError(503, "OCR_STAGING_NOT_CONFIGURED", "ระบบจัดเก็บรูปยังไม่ได้ตั้งค่า", true);
  }

  const imageSha256 = hashRubberBillOcrImage(buffer);
  const [{ data: duplicateBill, error: billError }, { data: stagedSource, error: sourceError }] = await Promise.all([
    admin
      .from("rubber_bills")
      .select("id")
      .eq("location_id", locationId)
      .eq("record_status", "active")
      .eq("ocr_image_sha256", imageSha256)
      .limit(1)
      .maybeSingle(),
    admin
      .from("rubber_bill_ocr_sources")
      .select("id, owner_user_id, location_id, state, bill_date, in_weight, out_weight, deduct_weight, ocr_total, suggested_price")
      .eq("location_id", locationId)
      .eq("image_sha256", imageSha256)
      .in("state", ["staged", "reserved"])
      .limit(1)
      .maybeSingle(),
  ]);
  if (billError || sourceError) {
    return rubberBillOcrError(503, "DUPLICATE_CHECK_FAILED", "ตรวจสอบรูปซ้ำไม่สำเร็จ", true);
  }
  if (duplicateBill) {
    return rubberBillOcrError(409, "OCR_IMAGE_DUPLICATE", "รูปใบชั่งนี้ถูกใช้ในสาขานี้แล้ว");
  }
  const existingSource = resolveRubberBillOcrExistingSource(
    stagedSource,
    authResult.auth.sub,
    locationId,
  );
  if (existingSource.kind === "replay") {
    return rubberBillOcrSuccess(existingSource.uploadId, existingSource.draft);
  }
  if (existingSource.kind === "conflict") {
    return rubberBillOcrError(
      409,
      "OCR_UPLOAD_IDENTITY_CONFLICT",
      "รูปใบชั่งนี้อยู่ในคิวของคำขออื่นแล้ว",
    );
  }

  let draft;
  try {
    draft = await readRubberBillOcrImage(buffer, imageType.mimeType);
  } catch (error) {
    if (error instanceof RubberBillOcrUpstreamError) {
      return rubberBillOcrError(error.status, error.code, error.message, error.retryable);
    }
    return rubberBillOcrError(503, "OCR_UPSTREAM_FAILED", "ระบบ OCR ประมวลผลไม่สำเร็จ", true);
  }

  let driveFileId: string;
  try {
    const safeName = `rubber-bill-ocr-${Date.now()}-${imageSha256.slice(0, 12)}.${imageType.extension}`;
    driveFileId = (await uploadPrivateImageToDrive(buffer, imageType.mimeType, safeName)).fileId;
  } catch {
    return rubberBillOcrError(503, "OCR_DRIVE_UPLOAD_FAILED", "จัดเก็บรูปใบชั่งไม่สำเร็จ", true);
  }

  const uploadId = crypto.randomUUID();
  const { data: source, error: insertError } = await admin
    .from("rubber_bill_ocr_sources")
    .insert({
      id: uploadId,
      owner_user_id: authResult.auth.sub,
      location_id: locationId,
      state: "staged",
      image_sha256: imageSha256,
      drive_file_id: driveFileId,
      image_mime_type: imageType.mimeType,
      image_size_bytes: image.size,
      original_file_name: image.name.slice(0, 255),
      bill_date: draft.billDate,
      in_weight: draft.inWeight,
      out_weight: draft.outWeight,
      deduct_weight: draft.deductWeight,
      ocr_total: draft.ocrTotal,
      suggested_price: draft.suggestedPrice,
    })
    .select("id")
    .single();
  if (insertError || !source) {
    // Recover a committed INSERT whose response was lost. Drive files are kept
    // for manual cleanup, including rejected or indeterminate attempts.
    const { data: recovered, error: recoveryError } = await admin
      .from("rubber_bill_ocr_sources")
      .select("id, owner_user_id, location_id, state, bill_date, in_weight, out_weight, deduct_weight, ocr_total, suggested_price")
      .eq("id", uploadId)
      .eq("owner_user_id", authResult.auth.sub)
      .eq("location_id", locationId)
      .eq("image_sha256", imageSha256)
      .eq("drive_file_id", driveFileId)
      .maybeSingle();
    if (recoveryError) {
      return rubberBillOcrError(503, "OCR_STAGING_FAILED", "บันทึกรูปใบชั่งไม่สำเร็จ", true);
    }
    if (recovered) {
      const resolution = resolveRubberBillOcrExistingSource(recovered, authResult.auth.sub, locationId);
      if (resolution.kind === "replay") return rubberBillOcrSuccess(resolution.uploadId, resolution.draft);
      return rubberBillOcrError(409, "OCR_UPLOAD_IDENTITY_CONFLICT", "รูปใบชั่งนี้อยู่ในคิวของคำขออื่นแล้ว");
    }
    if (insertError?.code === "23505") {
      const { data: concurrentSource, error: concurrentError } = await admin
        .from("rubber_bill_ocr_sources")
        .select("id, owner_user_id, location_id, state, bill_date, in_weight, out_weight, deduct_weight, ocr_total, suggested_price")
        .eq("location_id", locationId)
        .eq("image_sha256", imageSha256)
        .in("state", ["staged", "reserved"])
        .limit(1)
        .maybeSingle();
      if (concurrentError) {
        return rubberBillOcrError(503, "OCR_STAGING_FAILED", "บันทึกรูปใบชั่งไม่สำเร็จ", true);
      }
      const concurrentResolution = resolveRubberBillOcrExistingSource(
        concurrentSource,
        authResult.auth.sub,
        locationId,
      );
      if (concurrentResolution.kind === "replay") {
        return rubberBillOcrSuccess(concurrentResolution.uploadId, concurrentResolution.draft);
      }
      return rubberBillOcrError(
        409,
        "OCR_UPLOAD_IDENTITY_CONFLICT",
        "รูปใบชั่งนี้อยู่ในคิวของคำขออื่นแล้ว",
      );
    }
    return rubberBillOcrError(503, "OCR_STAGING_FAILED", "บันทึกรูปใบชั่งไม่สำเร็จ", true);
  }

  return rubberBillOcrSuccess(source.id, draft);
}
